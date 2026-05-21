# Porting roadmap (Python → TypeScript)

The original Streamlit app shipped 7 Azure pillars + auto-simulate + a
CAF landing-zone composer. The TypeScript port currently delivers
**Infra Lift-and-Shift only**. This document tracks what's left.

## How to port a pillar

1. Read the Python source for the pillar at the commit before the rewrite
   (`0874b38` on the original branch). Each pillar exposes the same
   contract: `render_inputs` (UI) + `build_bom` (pricing). The TS port
   collapses these — UI in `app/page.tsx`, pricing in `lib/pillars/<key>.ts`.
2. Port the pricing logic first. It's pure functions of
   `InventoryItem | pillar-input → BomLine[]`, identical between Python
   and TS modulo dataclass → interface.
3. Add an API route under `app/api/price-<key>/route.ts` that takes the
   pillar inputs + `RetailPricesClient` and returns lines.
4. Add UI controls in `app/page.tsx` (or split into a `<PillarPanel>`
   component once we have 2+ pillars).

## Pillar-by-pillar status

### Infra Modernization (App Service, AKS, ACA, APIM, Front Door, ACR)

- Python: `src/pillars/infra_modernization.py` (777 lines)
- Picks PaaS targets per the Hybrid / Full-PaaS strategy
- App Service tiers vary by compute mode (`B1/B2/B3` for saving,
  `P0v3/P1v3` normal, `P2v3/P3v3` HP)
- Includes a developer-tooling sub-pillar (GitHub Enterprise, Copilot,
  Visual Studio licensing, Azure DevOps) — `lib/pricing/devtools_static.py`
  is the static rate card to port

### Data Platform (Fabric, Synapse, Cosmos, Azure SQL, ADLS, ADF, Event Hubs)

- Python: `src/pillars/data_platform.py` (1,369 lines — largest pillar)
- Microsoft Fabric Capacity Estimator (`F2..F2048` SKUs)
- Cosmos DB provisioned / autoscale / serverless modes
- Azure SQL DB tiered pricing + AHB SQL discount (~55% GP, ~33% BC, ~25% HS)
- Postgres / MySQL Flexible (Burstable / GP / MO tiers)
- Redis Cache (Basic → Enterprise Flash)
- Azure Files (Std / Premium × LRS/ZRS/GRS)

### AI Application (Azure OpenAI, AI Search, ML, GPU VMs, Cognitive)

- Python: `src/pillars/ai_application.py` (669) + `ai_model_picker.py` (383)
- Per-model token pricing (GPT-4o / 4o-mini / o1 / Claude on Azure)
- AI Search tier picker (Basic / Standard / Storage Optimized)
- GPU VM seeding (NC / ND / NV) — auto when doc mentions training
- Cognitive Services with `meter_unit_divisor` (per-1K transactions)
- Auto-seeds App Service frontend when use case is chat-like

### Azure Security (Defender suite + Sentinel + WAF + Private Link + Purview + PIM)

- Python: `src/pillars/azure_security.py` (722) + `src/landing_zone/defender.py`
- CAF-tier-aware Defender baseline (Foundation = CSPM; Standard adds
  Servers P2; Enterprise adds full CWP)
- Workload-driven plans (SQL → Defender SQL, AKS → Containers, OpenAI → AI)
- Microsoft Sentinel ingestion (PAYG vs commitment 100/200/500 GB/day)
- Log Analytics retention math (MB/day/VM × VM count × 30)
- DDoS Protection (IP per-IP + Network plan)

### Hybrid Multicloud (Azure Arc + Defender across AWS / GCP / on-prem)

- Python: `src/pillars/hybrid_multicloud.py` (399)
- Arc-enabled SQL Server PAYG (Std/Ent per core)
- Arc-enabled Windows Server PAYG (Std/DC per core)
- Defender plans applied to non-Azure resources
- Azure Monitor ingestion from Arc agents

### M365 & Others (M365 Backup / Archive / SharePoint Premium / Copilot Studio)

- Python: `src/pillars/m365_and_others.py` (315)
- M365 Backup (Syntex) per-user per-month
- M365 Archive ingestion + retention
- SharePoint Premium / Syntex AI transactions
- Copilot Studio (prepaid 25K message packs + PAYG overage)
- Generic Azure-marketplace SaaS (Elastic Cloud, Confluent, MongoDB Atlas)

## Cross-cutting work to port

### Landing Zone composer

- `src/landing_zone/landing_zone.py` (CAF Foundation / Standard / Enterprise)
- Per-component checkboxes: Public IP, ExpressRoute, Firewall, Bastion,
  VPN Gateway, App Gateway WAF v2, Log Analytics, Key Vault, Backup, NAT
- Derived quantities: Backup % of total disk, LA MB/day/VM, bandwidth GB,
  WAF capacity units, Firewall data-processed GB, NAT data GB
- Preset auto-tick rules (`LZ_PRESETS`)

**UX rule for the port:** Each component is a checkbox. Quantity inputs
attached to a component (Backup %, LA MB/day/VM, bandwidth GB, WAF CUs,
firewall data GB, NAT data GB, etc.) **only render when the parent
checkbox is ticked** — same pattern as the Safety margin reveal in
Phase 2. Use the `.reveal-field` class in `app/globals.css` and the
`<Tooltip>` component for the help text. No silently-displayed "enter
0 to disable" number inputs.

### HA / BCDR

- 2x compute multiplier + Standard Load Balancer for HA
- `paired_region()` defaults the secondary-region picker
- Site Recovery per-VM instance fee + GRS backup storage

### Auto-simulate (Sonnet pre-fills inputs)

- `src/pillars/auto_simulate.py` (453)
- Per-pillar Sonnet pass that reads the doc, fills inputs, lists
  assumptions + follow-up questions
- Caches by (file, pillar, prior_answers) so widget tweaks don't re-fire
  the API

### Verification harness

- `scripts/verify_calculations.py` codifies reference scenarios with
  ±2% drift tolerance vs the live Azure Pricing Calculator. Port to a
  vitest suite under `tests/` so CI can flag regressions automatically.

### Defender for Cloud always-on baseline

- `src/landing_zone/defender.py` always-emits CWP lines per the LZ
  preset + detected workloads, independent of pillar selection
- De-dupes against the `azure_security` pillar when both are active
