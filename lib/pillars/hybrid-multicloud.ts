// Hybrid Multicloud parametric pricing.
//
// Arc-enabled servers / SQL / Kubernetes plus multicloud Defender.
// Arc itself is free for the control plane — paid plans on top drive
// the cost. East US 2 USD list rates, late 2025.

import { type BomLine, emptyBomLine, type InventoryItem } from "../models";

export interface HybridMulticloudParams {
  /** AWS/GCP servers protected via Arc. */
  multicloudServerCount?: number;
  /** Arc-enabled K8s clusters. */
  arcK8sClusterCount?: number;
  /** Arc-enabled SQL Server vCore total. When undefined, derived from
   *  the inventory's DB-flagged VM count assuming 1 vCore/server. */
  arcSqlVcoreCount?: number;
  /** Log Analytics ingestion volume from Arc agents (GB/mo). */
  arcLogIngestionGbMonth?: number;
}

export function buildHybridMulticloudBom(
  items: InventoryItem[],
  region: string,
  appName: string,
  params: HybridMulticloudParams = {},
): BomLine[] {
  const inferredSqlVcores = items.filter((it) => it.hasDb).length || 1;
  const sqlVcores = params.arcSqlVcoreCount ?? inferredSqlVcores;
  const multicloudServers = params.multicloudServerCount ?? 5;
  const arcK8sClusters = params.arcK8sClusterCount ?? 2;
  const laGb = params.arcLogIngestionGbMonth ?? 100;

  const lines: BomLine[] = [];
  const tag = "(Hybrid Multicloud — East US 2)";

  const push = (
    resource: string, sku: string, monthlyCost: number,
    unit: string, unitPrice: number, quantity: number, assumption: string,
  ) => {
    lines.push({
      ...emptyBomLine(),
      category: "Hybrid Multicloud", resource, sku, meter: sku, region,
      quantity, unit, unitPrice,
      monthlyCost: Math.round(monthlyCost * 100) / 100,
      currency: "USD", source: "hybrid-multicloud-baseline",
      serviceName: "Hybrid Multicloud",
      customName: appName ? `${appName}-hybrid` : "Hybrid Multicloud",
      resourceCount: 1, billingTerm: "PAYG",
      assumption: `${assumption} ${tag}`,
    });
  };

  push(
    "Azure Arc — control plane", "arc-control-plane",
    0, "1/Month", 0, 1,
    "Free. Picked because Arc gives one Azure-native control plane (Resource Graph, Policy, RBAC, Update Manager, Inventory) across on-prem + AWS + GCP servers without VM-replication cost. Step toward fully-managed alternatives (Azure SQL Managed Instance, AKS) when you'd rather not maintain the on-prem footprint at all. What's NOT included: the add-on plans below (SQL PAYG, Defender, LA ingestion) — those are where the real spend lives.",
  );
  if (sqlVcores > 0) {
    const cost = sqlVcores * 4.5 * 730;
    push(
      `Arc-enabled SQL Server PAYG — ${sqlVcores} vCore${sqlVcores === 1 ? "" : "s"}`, "arc-sql-payg",
      cost, "1 vCore-Hour", 4.5, 730 * sqlVcores,
      `$4.50/vCore-hour × 730 × ${sqlVcores} vCore = $${cost.toFixed(2)}. ${params.arcSqlVcoreCount !== undefined ? "User-supplied vCore count." : "Inferred from DB-flagged VMs (1 vCore each); override with the real per-server core count for accurate licensing."} Picked Arc PAYG because it lets you pay-as-you-go on existing on-prem SQL Server installs instead of buying perpetual Core licences upfront — typical breakeven is ~3 years (if you'd run the workload >3 years and never move it, perpetual Core + Software Assurance is cheaper). Step to Azure Hybrid Benefit (free Arc + bring your own licence) when you already own SA-covered licences. What's NOT included: the underlying server's OS / Defender / backup; SQL Managed Instance migration (separate offer).`,
    );
  }
  if (multicloudServers > 0) {
    const cost = multicloudServers * 15;
    push(
      `Defender for Servers — multicloud × ${multicloudServers} VM${multicloudServers === 1 ? "" : "s"}`,
      "defender-multicloud-servers",
      cost, "1/Month", 15, multicloudServers,
      `Defender Servers Plan 2 extended to AWS/GCP VMs via Arc: ${multicloudServers} × $15/mo = $${cost.toFixed(2)}. Picked because P2 brings agentless vulnerability scanning, file integrity monitoring, JIT, and free Defender for DNS to multicloud VMs — same capabilities as Azure-native VMs, single pane in Defender for Cloud. Step down to P1 ($5/server) when EDR is the only need; step further to no Defender when you already run third-party EDR on those servers. What's NOT included: data ingestion from those servers into Log Analytics (priced separately).`,
    );
  }
  if (arcK8sClusters > 0) {
    push(
      `Arc-enabled Kubernetes × ${arcK8sClusters} cluster${arcK8sClusters === 1 ? "" : "s"}`, "arc-k8s",
      0, "1/Month", 0, arcK8sClusters,
      `Arc K8s onboarding is FREE (${arcK8sClusters} cluster${arcK8sClusters === 1 ? "" : "s"}). Picked because Arc K8s unlocks Azure Policy for Kubernetes (Gatekeeper templates), Flux GitOps, Defender for Containers, and Azure Monitor for containers across on-prem / EKS / GKE clusters using the same Azure tooling as AKS. Step away from Arc K8s if you're happy with native cluster tooling and don't need unified Azure governance. What's NOT included: Defender for Containers ($7/vCore/mo — adds runtime threat detection); Azure Monitor for containers (per-GB LA ingestion); GitOps cluster extension (free but compute-bound).`,
    );
  }
  if (laGb > 0) {
    const cost = laGb * 2.3;
    push(
      `Log Analytics ingestion from Arc agents — ${laGb} GB/mo`, "la-arc-ingestion",
      cost, "1 GB", 2.3, laGb,
      `Arc agents stream telemetry into LA workspace: ${laGb} GB × $2.30/GB = $${cost.toFixed(2)}. Picked PAYG because Arc telemetry is bursty (security event spikes) — Commitment Tiers (100 GB/day = ~30 % off) only earn their keep above ~50 GB/day sustained. Step up to a 100 GB/day Commitment Tier when usage exceeds 70 GB/day; step further to dedicated cluster pricing at multi-TB/day. What's NOT included: Sentinel surcharge ($2.30/GB on top, only on tables ingested for SIEM), Basic Logs (cheap-ingest tier for query-only data), data export to ADLS.`,
    );
  }
  return lines;
}
