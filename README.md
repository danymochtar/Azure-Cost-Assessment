# Azure Cost Assessment

Upload anything — VM inventory, SIEM design doc, AI use-case, data-platform
spec — and get a live-priced Azure estimate matching Microsoft's Azure
Pricing Calculator export template.

Built with **Next.js 15 (App Router) + TypeScript** and deployable to **Vercel**.

> ### Status: TypeScript port in progress
>
> This repo was originally a Python / Streamlit app (≈13k LOC across 7 Azure
> pillars). The TypeScript port currently delivers the **end-to-end VM
> Infra Lift-and-Shift** flow only — upload → classify → AI extract → live
> retail pricing → Excel + JSON export. The remaining 6 pillars are
> **TODO** and tracked in [docs/PORTING-ROADMAP.md](docs/PORTING-ROADMAP.md).

## What works today

| Capability | Status |
|---|---|
| Multi-file upload (xlsx / csv / pdf / docx / images / text) | ✅ |
| Claude Haiku classifier (cascades to Sonnet / Opus on overload) | ✅ |
| Claude Sonnet VM inventory extraction (tool-use structured output) | ✅ |
| Right-sizing (Burstable / D-series / E-series; AHB; non-prod PAYG) | ✅ |
| Multi-disk per VM (Premium / Standard SSD / Standard HDD auto-routing) | ✅ |
| Live Azure Retail Prices API with regional + term fallback | ✅ |
| Billing terms: PAYG / SP 1Y / SP 3Y / RI 1Y / RI 3Y (with per-line fallback labeling) | ✅ |
| Compute modes: Saving / Normal / High-Performance | ✅ |
| Excel export (Pricing Calculator template) + JSON export | ✅ |
| Multi-file classification with aggregation across uploads | ✅ |
| Vitest suite for picker / bandwidth / sizer (28 tests) | ✅ |
| Zod request validation at /api/price and /api/export | ✅ |
| HMAC-signed cookie auth (env-var admin + DB-less multi-user registration via signed account cookie) | ✅ |
| Installable PWA with iOS / Android home-screen support | ✅ |
| Responsive mobile-first UI (iOS safe area, 44 px tap targets, dark mode) | ✅ |
| Infra Modernization pillar (App Service / AKS / ACA / APIM / Front Door / ACR) | ⏳ TODO |
| Data Platform pillar (Fabric / Synapse / Cosmos / SQL DB / ADLS / ADF / EH) | ⏳ TODO |
| AI Application pillar (Azure OpenAI / AI Search / ML / GPU VMs / Cognitive) | ⏳ TODO |
| Azure Security pillar (Defender suite + Sentinel + WAF + Private Link) | ⏳ TODO |
| Hybrid Multicloud pillar (Azure Arc + Defender across clouds) | ⏳ TODO |
| M365 & Others pillar (M365 Backup / SharePoint Premium / Copilot Studio) | ⏳ TODO |
| Landing Zone composer (Foundation / Standard / Enterprise presets) | ⏳ TODO |
| HA / BCDR (Site Recovery + paired-region defaults) | ⏳ TODO |
| Defender for Cloud always-on baseline | ⏳ TODO |
| Auto-simulate (Sonnet pre-fills pillar inputs from doc) | ⏳ TODO |

## Run locally

```bash
npm install
cp .env.example .env.local   # set ANTHROPIC_API_KEY, BETTER_AUTH_SECRET, APP_PASSWORD
npm run dev
```

Open http://localhost:3000 → redirects to `/login` until you sign in.

### Required env vars

| Var | Purpose | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude classifier + extractor | — (required) |
| `BETTER_AUTH_SECRET` | HMAC key for both the session cookie and the per-browser account-record cookie. **Rotate to invalidate every account + session.** | — (required, ≥16 chars) |
| `APP_USER` | Bootstrap admin username (optional override) | `admin` |
| `APP_PASSWORD` | Bootstrap admin password (optional override) | `noventiq` |

The bootstrap admin works out of the box as `admin` / `noventiq` — no
env-var configuration needed. Override with `APP_USER` / `APP_PASSWORD`
when you deploy to a public URL.

No database. No Redis. No external storage. Two cookies do all the work:

- `azca_session` — HMAC-signed `{user, exp}`, HttpOnly, 30-day TTL.
  Issued on login, cleared on logout.
- `azca_account` — HMAC-signed `{username, bcryptHash, iat}`, HttpOnly,
  1-year TTL. Issued on registration; the cookie IS the user record.

### Sign-up flow

1. Click **Create account** on the login screen, or visit `/register`.
2. Pick a username (≥3 chars) and password (≥6 chars). No email.
3. Server bcrypts the password, signs the resulting payload with
   `BETTER_AUTH_SECRET`, and stores it as the `azca_account` cookie.
   You're signed in immediately.
4. Next time you open the app: type the same username + password — the
   browser sends `azca_account`, server verifies, you're in.

**Trade-offs (intentional, since the goal was zero-setup):**

- Accounts are **per-browser**. Clearing cookies, switching browsers, or
  using a private window means re-registering.
- One account at a time per browser (re-registering overwrites the cookie).
- The bootstrap admin (`APP_USER` / `APP_PASSWORD`) works from any
  browser regardless of cookie state — keep it for emergency access.

## Install on iPhone (PWA)

1. Open the deployed URL in Safari on iOS.
2. Tap the Share button → **Add to Home Screen**.
3. The app launches in its own window with no browser chrome, and uses
   the cloud logo + theme color from `app/manifest.ts` / `app/apple-icon.tsx`.
4. Session cookies persist between launches; sign in once and you're set.

Android Chrome supports the same install flow via the address-bar
**Install** prompt or **Add to Home screen** menu.

## Scripts

```bash
npm run dev        # Next.js dev server
npm run build      # production build
npm run typecheck  # tsc --noEmit
npm run test       # vitest (picker, bandwidth, sizer pure-function tests)
npm run lint       # next lint
```

## Deploy to Vercel

1. Push the branch (or fork) to GitHub.
2. Import the repo at https://vercel.com/new.
3. **Pick the right branch as Production Branch** — the Next.js code only
   lives on `claude/review-repo-zHqBj`. If your repo's default branch
   still points at the old Python code, set Production Branch under
   **Settings → Git → Production Branch** to the branch with this
   `package.json`, or merge it into your default branch first.
4. Leave **Root Directory** blank (or `./`). `package.json` and
   `vercel.json` are both at the repo root.
5. Add env vars in **Settings → Environment Variables**:
   - `ANTHROPIC_API_KEY`
   - `BETTER_AUTH_SECRET` (≥16 chars, e.g. `openssl rand -base64 32`)
   - `APP_PASSWORD` (your login password)
   - `APP_USER` (optional, defaults to `admin`)
6. Deploy.

### Troubleshooting

**`No Next.js version detected. Make sure your package.json has "next" in
either "dependencies" or "devDependencies".`**

Vercel didn't find `next` in the `package.json` it cloned — almost always
because the **wrong branch** was deployed. Confirm:

- `package.json` is at the repo root on the branch Vercel is building
  (`git ls-tree <branch> -- package.json` should show a single entry).
- `next` is in `dependencies` (it is on `claude/review-repo-zHqBj`).
- Vercel's **Root Directory** is empty/`./`, not a subdir.
- Vercel's **Production Branch** is the one containing the Next.js code,
  not the legacy Python branch.

Quick redeploy after fixing branch settings: **Deployments → … → Redeploy**.

### Tier requirements

| | Hobby | Pro |
|---|---|---|
| Request body size | 4.5 MB | 4.5 MB (raise with [body size limits](https://vercel.com/docs/limits)) |
| Function duration | 60 s default | 300 s configurable |
| Recommended for | demo / single user | production with large PDFs |

The UI enforces a **4 MB combined upload cap** to stay under the Hobby request
body limit. Bigger PDFs / RVTools exports need Pro tier (and the Excel
extraction can use the full 300 s `maxDuration` we set in `vercel.json`).

The browser sends uploads as `multipart/form-data` (no base64 inflation),
and the server reads file bytes via the standard `Request.formData()` API.

## Architecture

```
app/
  layout.tsx                    ← Inter font, PWA meta, viewport-fit=cover, theme-color
  manifest.ts                   ← PWA web manifest (typed)
  icon.tsx / apple-icon.tsx     ← Generated PNG icons (ImageResponse)
  page.tsx                      ← Server component: gate on session cookie → AssessmentApp
  assessment-app.tsx            ← Client UI (upload, context, results, sign-out, reset)
  login/page.tsx, login-form.tsx       ← Sign-in page (with link to /register)
  register/page.tsx, register-form.tsx ← Sign-up page (email + ≥8-char password)
  api/
    auth/login/route.ts         ← Reads `azca_account` cookie → bcrypt verify → falls back to env-var admin → sets session
    auth/logout/route.ts        ← Clears session cookie (keeps account cookie so the user can sign back in)
    auth/register/route.ts      ← bcrypts the password, sets `azca_account` + session cookies
    classify/route.ts           ← multipart upload → Haiku-cascade classifier (per-file + aggregate)
    extract/route.ts            ← multipart upload → Sonnet-cascade VM extractor (tool_use)
    price/route.ts              ← Zod-validated JSON → lift-shift BOM via Retail API
    export/route.ts             ← Zod-validated JSON → Excel download
middleware.ts                   ← Edge: redirects unauthed to /login (structural cookie check)
lib/
  auth.ts                       ← HMAC sign / verify session payloads (Node runtime)
  auth-constants.ts             ← Shared cookie name (Edge-safe, no node:crypto import)
  users.ts                      ← HMAC-signed `azca_account` cookie helpers (the cookie IS the user record). bcrypt hash + verify.
  models.ts                     ← BomLine / InventoryItem / AssessmentProfile types
  constants.ts                  ← Azure regions, labels, fallback map, modes
  anthropic.ts                  ← SDK client + tier-cascade wrapper (529 / 5xx → next tier)
  vm-catalog.ts                 ← Burstable + D-series + E-series catalog
  sizer.ts                      ← Right-sizing + disk ladder + tier routing
  parsers/
    content.ts                  ← Normalize upload → Claude content blocks (mammoth + exceljs)
    classifier.ts               ← Haiku classifier + classifyMany aggregator (tool-use schema)
    inventory.ts                ← Sonnet inventory extractor (tool-use)
  pricing/
    retail.ts                   ← Azure Retail Prices API client (vm/disk/sp/ri, regional + term fallback)
    picker.ts                   ← cheapestNonzero meter selectors (skips $0 free-tier meters)
    bandwidth.ts                ← Tiered egress (100 GB free, 5-tier ladder)
  pillars/
    lift-shift.ts               ← VM compute (grouped) + managed disks BOM + per-line fallback labeling
  output/
    excel.ts                    ← Estimate + Cost Assumptions sheets (exceljs, server-side)
    pricing-calc.ts             ← Pricing Calculator import JSON
tests/
  picker.test.ts, bandwidth.test.ts, sizer.test.ts   ← 28 vitest assertions
```

## Pricing data

All prices come live from the public Azure Retail Prices API
(`https://prices.azure.com/api/retail/prices`) — no authentication needed.
Retail ≠ your negotiated EA / MCA / CSP pricing; apply your discount in
the exported Excel.

Regional fallback is transparent: a request that returns no records for a
new region (e.g. `malaysiawest`) automatically retries against the
geo-paired region (`southeastasia`) and the swap is surfaced in the UI.

## Pillar contract (for porting follow-ups)

Each pillar lives in `lib/pillars/<key>.ts` and exposes:

```ts
export async function build<Pillar>Bom(
  items: InventoryItem[] | <pillar-specific-input>,
  opts: <PillarOptions>,
  client?: RetailPricesClient,
): Promise<{ lines: BomLine[]; ... }>;
```

The Python source at the pre-port commit
[`0874b38`](https://github.com/danymochtar/azure-cost-assessment/commit/0874b38)
has the full business logic for each pillar — use it as the reference
spec when porting. The CHANGELOG.md captures audit-batch history.

## Security & data handling

- API keys live in environment variables only (`.env.local` /
  Vercel project secrets). Never committed.
- When AI features run, the uploaded file (or a 5-row preview for the
  classifier) is sent to Anthropic. Strip secrets / PII before upload.
  Anthropic does not train on API inputs per their terms.
- All structured outputs are validated with Zod schemas before use.
- The Excel export is generated server-side with `exceljs`; the client
  receives a base64 payload and downloads it locally — no third-party
  storage.

## Comparison vs the original Streamlit app

The Python app's `scripts/verify_calculations.py` codified reference
scenarios (3× D4s v5 Linux PAYG, AHB Linux-equivalent, RI 1Y vs PAYG
discount ratio, Fabric F64, Sentinel 50 GB/day, tiered egress at 10 TB,
GPT-4o-mini token spend) with a ±2% drift tolerance. Porting that
harness is on the roadmap so this TS rewrite can be verified against
the same ground truth.
