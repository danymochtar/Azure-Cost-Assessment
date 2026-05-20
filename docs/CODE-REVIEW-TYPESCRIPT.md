# Code review — TypeScript port

A self-review of the TypeScript port at the cleanup commit. Findings are
grouped by severity. File:line refers to the current `HEAD`.

## Resolved during this pass

- **Per-line billing-term label drift when RI/SP falls back to PAYG**
  (`lib/pillars/lift-shift.ts`). The line's `billingTerm` column now reads
  `PAYG (RI 3Y unavailable in <region>)` when the retail client falls
  back, and the `assumption` field annotates the reason. The Python
  original only surfaced an aggregate warning; this is stricter.
- **Single-file classification.** `classifyMany` in
  `lib/parsers/classifier.ts` parallelises across uploads and aggregates
  the highest-confidence non-unknown result, matching `app.py:670-684`
  in the Python original. The UI surfaces a per-file breakdown when
  more than one file is uploaded.
- **Base64-over-JSON uploads.** Replaced with `multipart/form-data` in
  `/api/classify` and `/api/extract`. Cuts request body size by ~25 %
  and removes the deprecated `unescape` chain that handled pasted UTF-8.
- **No request validation.** `/api/price` and `/api/export` now Zod-parse
  the body; malformed requests get a structured `400` with details
  instead of a stack trace.
- **No tests.** Added `vitest` with 28 assertions covering picker
  (free-tier exclusion, WAF base vs CU pick), bandwidth (tier crossings,
  10 TB reference), and sizer (env detection, SQL detection, family
  routing under each compute mode, disk ladder rounding). A failing test
  caught a token-list regression — `sql-cluster-01` wasn't classified
  as SQL Server because I'd missed `sql-cluster` / `sql-prod` / etc.
  from the Python original. Fixed in the same pass.
- **Vercel body-size cliff.** UI now enforces a 4 MB combined upload cap
  with a live total and a disabled submit button when over-limit.
  README documents the Hobby vs Pro tradeoff.

## Open items (deliberate)

- **Cache lives in `RetailPricesClient` instance.** Each request creates
  a new client, so cross-request caching doesn't happen. Acceptable on
  Vercel (no shared state across serverless invocations); revisit if you
  see >200 requests/min and want to push to KV / Edge Config. Don't use
  Python's `hash(bytes)` cache key trick — that was unstable across
  processes anyway.
- **Disk pricing fan-out is N×M (VMs × disks).** Within one request
  the cache de-dupes by meter name (`P10 LRS Disk` etc.) so a 100-VM
  inventory typically does ≤5 unique queries. Fine.
- **No verification harness** equivalent to `scripts/verify_calculations.py`.
  The 28 vitest tests cover the pure pieces; a `lib/__verify__/` runner
  hitting the live retail API with golden scenarios is on the roadmap.
  Hold off on tying that to CI — it depends on the public Microsoft API
  and would flake on every monthly pricing adjustment.
- **No streaming for the classifier or extractor.** Both APIs await the
  full response. A 20-page PDF can take 40-60 s on Sonnet — within
  Vercel's 60 s Hobby cap but tight. The Anthropic SDK supports
  streaming; switching is straightforward but adds front-end plumbing
  (EventSource / SSE). Defer until users complain.

## Architecture notes

- **No global state.** Every API route is a pure function of `(Request)
  → Response`. The Python original carried Streamlit `session_state`
  threading through every pillar — the TS port instead returns explicit
  per-request results, which is the right shape for serverless.
- **Anthropic SDK cascade** (`lib/anthropic.ts`) treats 502 / 503 / 504
  / 529 / connection errors as "try next tier" and propagates everything
  else (auth, 400, rate-limit) back to the caller. Same policy as the
  Python `llm.call_with_cascade`.
- **Server Components are unused.** The page is `"use client"` end to
  end because the upload flow and stage transitions are interactive.
  This is fine — the page itself is small (6 kB JS); the heavy lifting
  is in the API routes (exceljs / mammoth / Anthropic SDK never reach
  the browser bundle).
- **`runtime = "nodejs"`** declared on every API route — needed for
  Buffer, exceljs, and mammoth. Edge runtime is not viable here.

## Security

- **API key handling**: read from `process.env.ANTHROPIC_API_KEY` only.
  No browser localStorage path was carried over. Set the env var via
  Vercel project secrets at deploy time.
- **No auth.** The Python app had a hardcoded `admin / noventiqazure`
  pair (flagged in `docs/CODE-REVIEW-PYTHON.md`). I deliberately did
  not port it. If this app needs to be private, layer Vercel password
  protection or Auth.js on top before shipping to a public URL.
- **File handling**: uploads are read into a `Buffer` and passed
  directly to Anthropic / parsers. Nothing persists. A `MAX_FILE_MB`
  guard in `lib/parsers/content.ts` rejects >30 MB files; the UI's
  4 MB combined-upload cap is stricter.
- **Excel export is server-side** — the workbook is generated with
  exceljs in the API route and shipped back as base64. The browser
  decodes and triggers a download. No third-party storage involved.

## Test coverage

| Module | Coverage |
|---|---|
| `lib/pricing/picker.ts` | 7 tests — `cheapestNonzero`, `pickBySubstring`, `pickExcluding` |
| `lib/pricing/bandwidth.ts` | 5 tests — free tier, tier crossings, 10 TB reference scenario |
| `lib/sizer.ts` | 16 tests — env / OS / SQL detection, VM family routing under each mode, disk ladder |
| `lib/pricing/retail.ts` | 0 — would need an HTTP mock |
| `lib/parsers/{content,classifier,inventory}.ts` | 0 — would need an LLM / Anthropic mock |
| `lib/pillars/lift-shift.ts` | 0 — depends on retail client |
| `lib/output/excel.ts` | 0 — would need an xlsx reader for assertions |

The biggest gap is `lift-shift.ts`. Mock `RetailPricesClient` with a
fixture-backed map of `(arm, region) → PriceRecord` and you can assert
the BOM-line generation deterministically. Worth adding before the next
pillar ports.
