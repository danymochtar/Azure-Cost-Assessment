// Infra Modernization baseline pricing.
//
// Customers migrating beyond pure lift-and-shift typically land on this
// stack: App Service for web tier, AKS for containerised services, API
// Management for the API gateway, Front Door for global ingress, ACR
// for image registry. Prices below are East US 2 USD list rates
// (Microsoft public retail, late 2025). Flat baselines, refine in
// the customer's own export.

import { type BomLine, emptyBomLine } from "../models";

interface Preset {
  resource: string;
  sku: string;
  monthlyCost: number;
  unit: string;
  unitPrice: number;
  quantity: number;
  assumption: string;
}

const PRESETS: Preset[] = [
  {
    resource: "App Service Plan — Premium v3 P1v3 × 3 instances",
    sku: "appsvc-p1v3-x3",
    monthlyCost: 277.40, unit: "1 Hour", unitPrice: 0.380, quantity: 730,
    assumption: "P1v3 (2 vCPU, 8 GB) × 3 instances × $0.380/hr × 730 hrs. Auto-scale baseline for web/API tier.",
  },
  {
    resource: "AKS — small cluster (3 × Standard_D4s_v5 worker nodes)",
    sku: "aks-d4sv5-x3",
    monthlyCost: 420.48, unit: "1 Hour", unitPrice: 0.192, quantity: 2190,
    assumption: "AKS control plane free. 3 worker nodes × D4s v5 ($0.192/hr) × 730 hrs. Add Container Apps for serverless workloads on top.",
  },
  {
    resource: "API Management — Developer (1 unit)",
    sku: "apim-developer",
    monthlyCost: 48.18, unit: "1 Hour", unitPrice: 0.066, quantity: 730,
    assumption: "Developer tier — non-prod / PoC SLA. Step up to Basic v2 (~$219/mo) or Premium for prod.",
  },
  {
    resource: "Azure Front Door — Standard",
    sku: "front-door-standard",
    monthlyCost: 35.00, unit: "1/Month", unitPrice: 35.00, quantity: 1,
    assumption: "Base $35/mo + $0.01/GB egress (first 5 TB) + $0.60 per million requests. Routing rules first 5 free.",
  },
  {
    resource: "Azure Container Registry — Standard",
    sku: "acr-standard",
    monthlyCost: 20.00, unit: "1/Month", unitPrice: 20.00, quantity: 1,
    assumption: "Standard tier $0.667/day × 30 ≈ $20. 100 GB included; replicate by region for an extra $0.667/day each.",
  },
  {
    resource: "Container Apps — Consumption baseline",
    sku: "container-apps-consumption",
    monthlyCost: 12.00, unit: "1/Month", unitPrice: 12.00, quantity: 1,
    assumption: "First 180,000 vCPU-seconds and 360,000 GiB-seconds free per month. ~$12 covers light additional traffic. Bursty workloads can spike materially higher.",
  },
];

export function buildModernizationBom(region: string, appName: string): BomLine[] {
  const tag = "(Infra Modernization baseline — East US 2; tune per workload)";
  return PRESETS.map((p) => ({
    ...emptyBomLine(),
    category: "Infra Modernization",
    resource: p.resource,
    sku: p.sku,
    meter: p.sku,
    region,
    quantity: p.quantity,
    unit: p.unit,
    unitPrice: p.unitPrice,
    monthlyCost: Math.round(p.monthlyCost * 100) / 100,
    currency: "USD",
    source: "modernization-baseline",
    serviceName: "Infra Modernization",
    customName: appName ? `${appName}-modern` : "Modernization",
    resourceCount: 1,
    billingTerm: "PAYG",
    assumption: `${p.assumption} ${tag}`,
  }));
}
