# Code review — Python source (pre-rewrite)

This review covers the Python codebase as of commit
[`0874b38`](https://github.com/danymochtar/azure-cost-assessment/commit/0874b38)
— the last commit before the TypeScript port. The Python source is no longer
on `HEAD` but everything below stays useful as a "do not re-introduce"
checklist while porting the remaining 6 pillars.

File:line references resolve against the `0874b38` tree.

## High-priority findings

### 1. Hardcoded shared credentials in `app.py:80-82`

```python
_AUTH_USER = "admin"
_AUTH_PASS = "noventiqazure"
```

A constant password baked into the source is a meaningful exposure: anyone
with read access to this repo (including any fork) can authenticate. The
inline comment ("deliberately — this app is deployed for a specific
audience") downplays the risk, but the repo is GitHub-public on at least
one fork. **Recommendation:** read both from `st.secrets` and force a
deploy-time override (no defaults), or drop the login entirely and rely
on Streamlit Cloud's tenant-level auth.

The TS port currently has no auth — wire it through your own provider
(Vercel password protection, Auth.js, etc.) before exposing the
deployment.

### 2. API key persisted in browser localStorage by default

`app.py:369-378` offers a "Remember in this browser" checkbox that pipes
the Anthropic API key into `storage.save_api_key()` → localStorage. The
help text warns about DevTools / browser extensions, but the option is
prominent and the key sits at rest in the browser indefinitely until the
user explicitly clears it. **Recommendation:** prefer the secrets.toml
path; if you keep the browser option, default it off (currently it
defaults to false, which is fine, but the "Replace API key" UX subtly
encourages re-saving).

### 3. Hash collisions in cache keys

`app.py:649-651`, `app.py:902-904`, `app.py:1107` all use Python's
built-in `hash(bytes)` to key the classifier / auto-simulate / generate
caches:

```python
key = f"profile::{hash(u['bytes'])}::{u['name']}"
sim_cache_key = f"_sim::{hash(upload_bytes)}::..."
_auto_gen_key = f"_auto_gen::{hash(tuple(u['bytes'] for u in uploads))}::..."
```

Python's `hash()` is **not stable across processes** (PYTHONHASHSEED is
randomised by default) and is collision-prone for large byte blobs.
Within a single Streamlit session this is fine, but if you ever move
the cache to a shared store (Redis, KV, etc.) the keys will collide
silently. **Use SHA-256 of the bytes** as the cache key instead.

### 4. `pd.DataFrame.query()` warning is accurate but understated

`README.md:140-142` notes that `row_filter` "deliberately does NOT
evaluate pandas queries — `pd.DataFrame.query()` is eval-based and is
not safe against a prompt-injected preview." Good. But verify the actual
parser respects this: in `src/parsers/ai_inventory.py` the `InventoryMapping`
schema has a `row_filter` field, and the application code (look for
`.query(`) needs to be audited to confirm there's no path that
evaluates it. The README's claim should be backed by a unit test that
asserts `row_filter` is ignored.

### 5. Defender baseline assumption duplication

In `app.py:1148-1191` the Defender baseline runs **after** the pillar
loop and is supposed to de-dupe via the `azure_security_active` flag in
`recommend_defender_baseline()`. Trace the de-dupe carefully: if both
the `azure_security` pillar AND the always-on baseline emit a
`servers_p2` line, the customer pays twice. There's no test asserting
this — add one before porting.

## Architecture observations

### Pillars over-fit to Streamlit state

Every pillar's `render_inputs()` is a tightly-coupled mix of UI widgets,
session-state writes, AI calls (auto_simulate), and pure data
transformation. Splitting these into:

```
ui/              ← Streamlit (or React) widgets
pillars/x/inputs.ts  ← pure: prefs + answers → PillarInput
pillars/x/build.ts   ← pure: PillarInput + RetailClient → BomLine[]
```

would make the build steps testable in isolation. The TS port should
do this from day one (no Server Components calling business logic
directly).

### `auto_simulate.py` runs 7 pillar-specific Sonnet calls

`src/pillars/auto_simulate.py` (453 lines) effectively reads the same
document 7 times — once per pillar — to extract pillar-specific
defaults. That's 7× the input tokens. **Optimization:** do one Sonnet
pass that returns a structured "envelope" object with a sub-object per
pillar; cache once. The current design rate-limits itself (`time.sleep(2.0 - _elapsed)`)
which is a symptom of fanning out too aggressively.

### `_assumption_log` is global mutable state

The audit trail (`session_state["_assumption_log"]`) is populated by
each pillar via `_alog.setdefault(pk, []).append(...)` then rendered at
the bottom. Works in Streamlit; rebuilding in React, you want to make
each pillar return its assumptions as part of its output object — not
mutate shared state.

## Pricing correctness

### Regional fallback is silent at the BOM level

`RetailPricesClient.query()` (src/pricing/retail.py:119-146) falls back
from `malaysiawest` → `southeastasia` when the primary returns no
records. The user is told ("Some services had no retail prices in your
primary region… came from the fallback region(s)") but the BOM doesn't
**tag** the affected lines. A reviewer reading the Excel can't tell
which lines are local vs fallback. **Add a column or annotation** in
`BomLine.assumption` for fallback-priced rows.

### Term fallback to PAYG also silent on individual lines

Same pattern with `term_fallbacks` (e.g. RI requested but no RI meter
exists for the SKU → priced as PAYG). The aggregate warning fires, but
the `billing_term` column on the affected line still says "RI 3Y" if
the global was RI 3Y — misleading. **Set `billing_term="PAYG"`** when
the fallback fires (or `"PAYG (RI 3Y unavailable)"`).

### `cheapest_nonzero` works, but ranking is fragile

`src/pricing/picker.py:40` filters out `retail_price == 0` then picks
`min(retail_price)`. Edge case: a meter with a tiny but non-zero price
(`$0.000001`) like a metadata-only meter can win over the real meter
and silently zero the BOM. Inspect the Retail API for any such "near
zero" meters in `Storage` / `App Service` and threshold at e.g.
`> $0.0001` if found.

### `Standard_D4s_v5` benchmark in the docstring is the only ground truth

`retail.py:200-208` lists reference per-hour rates for one SKU in
`eastus`. `scripts/verify_calculations.py` codifies more scenarios but
the harness is opt-in (the comment "report-only by default" means
nothing in CI flags a regression). **Add the verification harness to
CI** (pytest gate) and port it to vitest in the TS rewrite — it's the
only thing standing between you and silent ±10% drift after a Microsoft
pricing update.

## Specific bugs to NOT re-introduce when porting

1. **`int(round(item.vcpu * headroom))` → use `Math.round`, NOT `Math.floor`** for vcpu sizing (sizer.py:232). Off-by-one when headroom=1.0 and vcpu is a non-integer.
2. **`environment` field substring matching is order-sensitive** in `sizer.py:_ENV_PRIORITY` — `preprod` matches BEFORE `prod`. The TS port `lib/sizer.ts` flattens this into `NON_PROD_TOKENS` only, losing the `env_tag` granularity. Restore `_ENV_PRIORITY` semantics when you need per-env grouping.
3. **`recommend_disk_tier` is matched case-insensitively against `name + os + notes` joined by spaces** — a VM named `myapp-no-backup` would match `backup` and route to HDD. The Python token list includes spaces (e.g. `"file "`) to mitigate this; preserve the trailing-space convention or switch to word-boundary regex.
4. **AHB with RI** — `vm_price()` queries Linux RI when `use_ahb=True` AND `os_is_windows=True`. Watch for the Retail API returning multiple Linux RI records for the same SKU (different instance families); the cheapest-by-price tiebreak may pick a wrong one. The Python `min(candidates, key=lambda r: r.retail_price)` only considers price — add a sanity check that the chosen record's `armSkuName` matches the input.
5. **PowerState `poweredOff` VMs cost $0 compute but FULL disk** — `infra_lift_shift.build_bom()` (and the equivalent TS port) needs to handle `powerstate="poweredOff"` explicitly. The TS port currently doesn't filter them at all.
6. **`build_compute_bom` was 776 LOC in `infra_lift_shift.py`** — the TS port is ~180 LOC and is deliberately smaller (no LZ, HA, BCDR, SQL license line). Don't lose the per-VM grouping by `(arm, os, env, billing, ahb)` — that's what makes the BOM legible. The TS port does preserve this.

## Test coverage gaps in the Python suite

`tests/` has 4 files (picker, sizer, compute_mode, ai_model_picker) for
13k LOC. **Critical gaps:**

- No tests for `RetailPricesClient` fallback paths (regional or term)
- No tests for any pillar's `build_bom()`
- No test for the Defender baseline ↔ azure_security pillar de-dupe (#5 above)
- No test for the `row_filter` safety claim (#4 above)
- `scripts/verify_calculations.py` is not in `tests/` and not in CI

When porting to TypeScript, set up vitest with these gaps closed first
— it's much easier to write tests for pure functions than for the
Streamlit-coupled originals.

## Summary

The Python code reads well, uses type hints + Pydantic consistently,
and the LZ / Defender / pricing logic carries a lot of well-researched
domain knowledge. The main risks are:

1. **Auth model** (hardcoded password) — fix at deploy time
2. **API key handling** (browser localStorage) — discourage by UI default
3. **Cache key stability** (`hash(bytes)`) — switch to SHA-256
4. **Silent fallbacks** in pricing (regional + RI/SP → PAYG) — annotate per-line, not just aggregate
5. **Test coverage** for the pricing path — port the verify harness to CI

The TS port has addressed (3) by computing once per request (no
cross-process cache), (4) is partially addressed (term fallbacks are
not yet annotated on the line), (2) is sidestepped by removing the
browser-storage option, and (5) is on the porting roadmap.
