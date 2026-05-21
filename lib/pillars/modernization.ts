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
    push(
      `App Service Plan — Premium v3 ${plan} × ${instances} instance${instances === 1 ? "" : "s"}`,
      `appsvc-${plan.toLowerCase()}-x${instances}`,
      rate * 730 * instances, "1 Hour", rate, 730 * instances,
      `${plan} ($${rate.toFixed(3)}/hr) × ${instances} instances × 730 hrs.`,
    );
  }
  if (aksNodes > 0) {
    const rate = AKS_NODE_HOURLY[aksSku];
    push(
      `AKS — ${aksNodes} × Standard_${aksSku} worker node${aksNodes === 1 ? "" : "s"}`,
      `aks-${aksSku.toLowerCase()}-x${aksNodes}`,
      rate * 730 * aksNodes, "1 Hour", rate, 730 * aksNodes,
      `Control plane free. ${aksNodes} × ${aksSku} ($${rate.toFixed(3)}/hr) × 730 hrs. Add Container Apps for serverless workloads.`,
    );
  }
  if (apim !== "off") {
    const t = APIM_HOURLY[apim];
    push(
      `API Management — ${t.label}`, `apim-${apim}`,
      t.rate * 730, "1 Hour", t.rate, 730,
      `${t.label} (${`$${t.rate.toFixed(3)}/hr`} × 730).`,
    );
  }
  if (fd !== "off") {
    const t = FRONT_DOOR_MONTHLY[fd];
    push(
      `Azure Front Door — ${t.label}`, `front-door-${fd}`,
      t.base, "1/Month", t.base, 1,
      `Base $${t.base.toFixed(2)}/mo + per-GB egress + per-million requests (excluded).`,
    );
  }
  if (acr !== "off") {
    const t = ACR_MONTHLY[acr];
    push(
      `Azure Container Registry — ${t.label}`, `acr-${acr}`,
      t.cost, "1/Month", t.cost, 1,
      `${t.label} tier. Replication adds the same per-day fee per region.`,
    );
  }
  if (containerAppsUsd > 0) {
    push(
      "Container Apps — Consumption baseline", "container-apps-consumption",
      containerAppsUsd, "1/Month", containerAppsUsd, 1,
      `First 180,000 vCPU-seconds and 360,000 GiB-seconds free per month; remainder $${containerAppsUsd.toFixed(2)} baseline.`,
    );
  }
  return lines;
}
