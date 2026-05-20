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
| Billing terms: PAYG / SP 1Y / SP 3Y / RI 1Y / RI 3Y | ✅ |
| Compute modes: Saving / Normal / High-Performance | ✅ |
| Excel export (Pricing Calculator template) + JSON export | ✅ |
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
cp .env.example .env.local   # add your ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:3000.

## Deploy to Vercel

1. Push the branch (or fork) to GitHub.
2. Import the repo at https://vercel.com/new.
3. Add `ANTHROPIC_API_KEY` to **Settings → Environment Variables**.
4. Deploy.

`vercel.json` raises the function timeout to 300s for `/api/extract` (large
PDFs / spreadsheets may take ~60s through Sonnet). The default Hobby tier
caps at 60s; you'll need Pro for full headroom on big inputs.

## Architecture

```
app/
  layout.tsx, page.tsx          ← single-page UI (upload, context, results)
  api/
    classify/route.ts           ← Haiku-cascade workload classifier
    extract/route.ts            ← Sonnet-cascade VM extractor (tool_use)
    price/route.ts              ← Builds the lift-shift BOM via Retail API
    export/route.ts             ← Excel/JSON download
lib/
  models.ts                     ← BomLine / InventoryItem / AssessmentProfile types
  constants.ts                  ← Azure regions, labels, fallback map, modes
  anthropic.ts                  ← SDK client + tier-cascade wrapper
  vm-catalog.ts                 ← Burstable + D-series + E-series catalog
  sizer.ts                      ← Right-sizing + disk ladder + tier routing
  parsers/
    content.ts                  ← Normalize upload → Claude content blocks
    classifier.ts               ← Haiku classifier with tool-use schema
    inventory.ts                ← Sonnet inventory extractor (tool-use)
  pricing/
    retail.ts                   ← Azure Retail Prices API client (vm/disk/sp/ri)
    picker.ts                   ← cheapest_nonzero meter selectors
    bandwidth.ts                ← Tiered egress (100 GB free, 5-tier ladder)
  pillars/
    lift-shift.ts               ← VM compute + managed disks BOM
  output/
    excel.ts                    ← Estimate + Cost Assumptions sheets (exceljs)
    pricing-calc.ts             ← Pricing Calculator import JSON
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
