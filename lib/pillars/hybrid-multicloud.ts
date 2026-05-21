// Hybrid Multicloud baseline pricing.
//
// Covers Azure Arc-enabled servers / SQL / Kubernetes and the
// multicloud Defender plans that extend protection to AWS/GCP. East
// US 2 USD list rates, late 2025. Arc itself is free for the control
// plane; the cost lands on the add-on plans (Defender, SQL PAYG).

import { type BomLine, emptyBomLine, type InventoryItem } from "../models";

interface Preset {
  resource: string;
  sku: string;
  monthlyCost: number;
  unit: string;
  unitPrice: number;
  quantity: number;
  assumption: string;
}

export function buildHybridMulticloudBom(
  items: InventoryItem[],
  region: string,
  appName: string,
): BomLine[] {
  // Arc onboarding is free; the real cost emerges from the add-on
  // plans. Scale Arc SQL PAYG by the SQL-bearing VMs detected in
  // inventory, and assume 5 multicloud servers / 2 Arc K8s clusters
  // as conservative baselines (override in the customer's export).
  const sqlVmCount = items.filter((it) => it.hasDb).length;
  const multicloudServers = 5;
  const arcK8sClusters = 2;

  const presets: Preset[] = [
    {
      resource: "Azure Arc — control plane",
      sku: "arc-control-plane",
      monthlyCost: 0.00, unit: "1/Month", unitPrice: 0, quantity: 1,
      assumption: "Arc enrolment, inventory, and policy enforcement are free. Add-on plans below carry the cost.",
    },
    {
      resource: `Arc-enabled SQL Server PAYG × ${sqlVmCount > 0 ? sqlVmCount : 1} servers`,
      sku: "arc-sql-payg",
      monthlyCost: (sqlVmCount > 0 ? sqlVmCount : 1) * 4.5 * 730,
      unit: "1 vCore-Hour",
      unitPrice: 4.5,
      quantity: 730,
      assumption: `$4.50 per vCore × 730 hrs/mo per server. Defaults to ${sqlVmCount > 0 ? sqlVmCount : 1} server(s) × 1 vCore; multiply by actual core count.`,
    },
    {
      resource: `Defender for Servers — multicloud × ${multicloudServers}`,
      sku: "defender-multicloud-servers",
      monthlyCost: multicloudServers * 15,
      unit: "1/Month",
      unitPrice: 15,
      quantity: multicloudServers,
      assumption: `$15/server/mo Defender Servers P2 extended to AWS/GCP VMs via Arc. Default ${multicloudServers} multicloud servers; tune to real footprint.`,
    },
    {
      resource: `Arc-enabled Kubernetes × ${arcK8sClusters} clusters`,
      sku: "arc-k8s",
      monthlyCost: 0.00, unit: "1/Month", unitPrice: 0, quantity: arcK8sClusters,
      assumption: "Arc K8s onboarding free. Defender for Containers add-on priced separately at $7/vCore/mo.",
    },
    {
      resource: "Log Analytics ingestion from Arc agents — 100 GB/mo",
      sku: "la-arc-ingestion",
      monthlyCost: 230.00, unit: "1 GB", unitPrice: 2.30, quantity: 100,
      assumption: "Arc agents stream telemetry into LA workspace. $2.30/GB × 100 GB/mo baseline.",
    },
  ];

  const tag = "(Hybrid Multicloud baseline — East US 2)";
  return presets.map((p) => ({
    ...emptyBomLine(),
    category: "Hybrid Multicloud",
    resource: p.resource,
    sku: p.sku,
    meter: p.sku,
    region,
    quantity: p.quantity,
    unit: p.unit,
    unitPrice: p.unitPrice,
    monthlyCost: Math.round(p.monthlyCost * 100) / 100,
    currency: "USD",
    source: "hybrid-multicloud-baseline",
    serviceName: "Hybrid Multicloud",
    customName: appName ? `${appName}-hybrid` : "Hybrid Multicloud",
    resourceCount: 1,
    billingTerm: "PAYG",
    assumption: `${p.assumption} ${tag}`,
  }));
}
