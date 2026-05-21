// Infra Modernization parametric pricing.
//
// East US 2 USD list rates (Microsoft public retail, late 2025). Each
// component has a sensible default but can be tuned through the
// `ModernizationParams` object — instance counts, plan SKUs, tiers,
// or set to 0 to drop the line entirely.

import { type BomLine, emptyBomLine } from "../models";

export interface ModernizationParams {
  /** App Service Premium v3 plan size and instance count. */
  appServicePlan?: "P0v3" | "P1v3" | "P2v3" | "P3v3";
  appServiceInstances?: number;
  /** AKS worker pool sizing. */
  aksNodeSku?: "D2s_v5" | "D4s_v5" | "D8s_v5" | "D16s_v5";
  aksNodeCount?: number;
  /** APIM tier. "off" drops the line. */
  apimTier?: "off" | "developer" | "basic_v2" | "standard_v2" | "premium_v2";
  /** Front Door tier. "off" drops the line. */
  frontDoorTier?: "off" | "standard" | "premium";
  /** ACR tier. "off" drops the line. */
  acrTier?: "off" | "basic" | "standard" | "premium";
  /** Container Apps consumption $ baseline (set 0 to drop). */
  containerAppsBaselineUsd?: number;
}

const APP_SERVICE_HOURLY: Record<NonNullable<ModernizationParams["appServicePlan"]>, number> = {
  P0v3: 0.193, P1v3: 0.380, P2v3: 0.760, P3v3: 1.520,
};
const AKS_NODE_HOURLY: Record<NonNullable<ModernizationParams["aksNodeSku"]>, number> = {
  D2s_v5: 0.096, D4s_v5: 0.192, D8s_v5: 0.384, D16s_v5: 0.768,
};
const APIM_HOURLY: Record<Exclude<NonNullable<ModernizationParams["apimTier"]>, "off">, { rate: number; label: string }> = {
  developer:   { rate: 0.066, label: "Developer (1 unit)" },
  basic_v2:    { rate: 0.300, label: "Basic v2 (1 unit)" },
  standard_v2: { rate: 1.000, label: "Standard v2 (1 unit)" },
  premium_v2:  { rate: 4.110, label: "Premium v2 (1 unit)" },
};
const FRONT_DOOR_MONTHLY: Record<Exclude<NonNullable<ModernizationParams["frontDoorTier"]>, "off">, { base: number; label: string }> = {
  standard: { base: 35.00, label: "Standard" },
  premium:  { base: 330.00, label: "Premium" },
};
const ACR_MONTHLY: Record<Exclude<NonNullable<ModernizationParams["acrTier"]>, "off">, { cost: number; label: string }> = {
  basic:    { cost: 5.00,  label: "Basic" },
  standard: { cost: 20.00, label: "Standard" },
  premium:  { cost: 50.00, label: "Premium" },
};

export function buildModernizationBom(
  region: string,
  appName: string,
  params: ModernizationParams = {},
): BomLine[] {
  const plan = params.appServicePlan ?? "P1v3";
  const instances = params.appServiceInstances ?? 3;
  const aksSku = params.aksNodeSku ?? "D4s_v5";
  const aksNodes = params.aksNodeCount ?? 3;
  const apim = params.apimTier ?? "developer";
  const fd = params.frontDoorTier ?? "standard";
  const acr = params.acrTier ?? "standard";
  const containerAppsUsd = params.containerAppsBaselineUsd ?? 12;

  const lines: BomLine[] = [];
  const tag = "(Infra Modernization — East US 2; tune per workload)";

  const push = (
    resource: string, sku: string, monthlyCost: number,
    unit: string, unitPrice: number, quantity: number, assumption: string,
  ) => {
    lines.push({
      ...emptyBomLine(),
      category: "Infra Modernization",
      resource, sku, meter: sku, region,
      quantity, unit, unitPrice,
      monthlyCost: Math.round(monthlyCost * 100) / 100,
      currency: "USD", source: "modernization-baseline",
      serviceName: "Infra Modernization",
      customName: appName ? `${appName}-modern` : "Modernization",
      resourceCount: 1, billingTerm: "PAYG",
      assumption: `${assumption} ${tag}`,
    });
  };

  if (instances > 0) {
    const rate = APP_SERVICE_HOURLY[plan];
    const planFit: Record<NonNullable<ModernizationParams["appServicePlan"]>, string> = {
      P0v3: "P0v3 (1 vCPU / 4 GB) — dev/test or small internal apps; not for prod web tiers that need autoscale headroom.",
      P1v3: "P1v3 (2 vCPU / 8 GB) — small prod web/API tier; the right pick when traffic is steady and per-request RAM stays under 200 MB.",
      P2v3: "P2v3 (4 vCPU / 16 GB) — medium prod; step up from P1v3 when you see >70 % CPU at peak or need >8 GB worker memory.",
      P3v3: "P3v3 (8 vCPU / 32 GB) — large prod with heavy in-process caches or CPU-bound payloads; consider AKS instead if you're scaling past 30 instances.",
    };
    push(
      `App Service Plan — Premium v3 ${plan} × ${instances} instance${instances === 1 ? "" : "s"}`,
      `appsvc-${plan.toLowerCase()}-x${instances}`,
      rate * 730 * instances, "1 Hour", rate, 730 * instances,
      `${plan} × ${instances} × $${rate.toFixed(3)}/hr × 730 = $${(rate * 730 * instances).toFixed(2)}. Picked because ${planFit[plan]} What's NOT included: Application Insights ingestion, custom domain SSL beyond the 1 free SNI, deployment slot storage above 3 slots, App Service Environment (ASE) isolation.`,
    );
  }
  if (aksNodes > 0) {
    const rate = AKS_NODE_HOURLY[aksSku];
    const nodeFit: Record<NonNullable<ModernizationParams["aksNodeSku"]>, string> = {
      D2s_v5: "D2s_v5 (2 vCPU / 8 GB) — dev/test clusters or tiny microservices; pod density caps around 30 — step up before you hit it.",
      D4s_v5: "D4s_v5 (4 vCPU / 16 GB) — prod baseline for general-purpose microservices; comfortable for 50-60 pods per node.",
      D8s_v5: "D8s_v5 (8 vCPU / 32 GB) — high-density prod clusters; cheaper per-pod than D4s once you exceed ~40 pods.",
      D16s_v5: "D16s_v5 (16 vCPU / 64 GB) — large stateful workloads or JVM apps with big heaps; consider scaling out (more D8s nodes) instead unless single-pod RAM is the constraint.",
    };
    push(
      `AKS — ${aksNodes} × Standard_${aksSku} worker node${aksNodes === 1 ? "" : "s"}`,
      `aks-${aksSku.toLowerCase()}-x${aksNodes}`,
      rate * 730 * aksNodes, "1 Hour", rate, 730 * aksNodes,
      `Control plane free (or $0.10/hr for the SLA-tier Uptime SLA). ${aksNodes} × ${aksSku} × $${rate.toFixed(3)}/hr × 730 = $${(rate * 730 * aksNodes).toFixed(2)}. Picked because ${nodeFit[aksSku]} What's NOT included: GPU nodes (NC SKUs), spot nodes (60-90 % cheaper for batch), persistent volume storage, egress, Container Insights LA ingestion. Step toward Container Apps for serverless event-driven workloads instead of AKS.`,
    );
  }
  if (apim !== "off") {
    const t = APIM_HOURLY[apim];
    const apimFit: Record<Exclude<NonNullable<ModernizationParams["apimTier"]>, "off">, string> = {
      developer:   "Developer — single-instance, no SLA, intended for evaluation only; do NOT use in production (it's also v1 legacy with deprecation risk).",
      basic_v2:    "Basic v2 — first prod-suitable tier on the v2 stack; 1 unit handles ~500 RPS, no VNet integration. Step up to Standard v2 if you need private deployment.",
      standard_v2: "Standard v2 — production default; VNet integration, ~1k RPS/unit, supports developer portal customisation.",
      premium_v2:  "Premium v2 — multi-region, internal VNet, ~4k RPS/unit, Azure AD self-hosted gateway. Pick when you need geo-distribution or VNet isolation; otherwise overspend.",
    };
    push(
      `API Management — ${t.label}`, `apim-${apim}`,
      t.rate * 730, "1 Hour", t.rate, 730,
      `${t.label} × $${t.rate.toFixed(3)}/hr × 730 = $${(t.rate * 730).toFixed(2)}. Picked because ${apimFit[apim]} What's NOT included: per-million-call charges above the unit's quota, custom domain SSL certs, self-hosted gateway licenses.`,
    );
  }
  if (fd !== "off") {
    const t = FRONT_DOOR_MONTHLY[fd];
    const fdFit: Record<Exclude<NonNullable<ModernizationParams["frontDoorTier"]>, "off">, string> = {
      standard: "Standard — L7 global ingress, basic WAF rules (managed rule sets only), up to 200 routing rules. Right for most public web apps without regulated traffic.",
      premium:  "Premium — adds DDoS Network Protection, Private Link to origins, bot management, custom WAF rules, security analytics. Step up when you need any of those; the $295/mo delta over Standard buys real attack-surface reduction.",
    };
    push(
      `Azure Front Door — ${t.label}`, `front-door-${fd}`,
      t.base, "1/Month", t.base, 1,
      `Base $${t.base.toFixed(2)}/mo. Picked because ${fdFit[fd]} What's NOT included: egress (~$0.083/GB after 5 TB/mo free), per-million request fees ($0.60/M after 100 M free), origin health probes, WAF rule evaluations (~$1/M).`,
    );
  }
  if (acr !== "off") {
    const t = ACR_MONTHLY[acr];
    const acrFit: Record<Exclude<NonNullable<ModernizationParams["acrTier"]>, "off">, string> = {
      basic:    "Basic — 10 GB included, no geo-replication, no private endpoint, no image scanning. Dev/test only.",
      standard: "Standard — 100 GB included, geo-replication available ($20/extra region), webhooks. Production default for single-region.",
      premium:  "Premium — 500 GB, geo-replication, private endpoints, content trust, image scanning, customer-managed keys, ZRS. Required for regulated workloads or multi-region AKS.",
    };
    push(
      `Azure Container Registry — ${t.label}`, `acr-${acr}`,
      t.cost, "1/Month", t.cost, 1,
      `${t.label} tier — $${t.cost.toFixed(2)}/mo. Picked because ${acrFit[acr]} What's NOT included: image storage above the tier quota ($0.10/GB/mo), image scan per artifact (~$0.001 if Defender for Containers is enabled), build minutes via ACR Tasks.`,
    );
  }
  if (containerAppsUsd > 0) {
    push(
      "Container Apps — Consumption baseline", "container-apps-consumption",
      containerAppsUsd, "1/Month", containerAppsUsd, 1,
      `Free quota: 180,000 vCPU-seconds + 360,000 GiB-seconds per month. Remainder $${containerAppsUsd.toFixed(2)} baseline. Picked over AKS because Consumption pays only for actual request execution (scale-to-zero), with no node ops; ideal for event-driven / bursty APIs. Step toward AKS when you have steady load, GPU workloads, or need multi-tenancy with namespace isolation. What's NOT included: Dedicated workload profiles (fixed-price node pools), Environment-level storage, KEDA-triggered idle minimums.`,
    );
  }
  return lines;
}
