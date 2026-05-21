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
    "Arc enrolment, inventory, and policy enforcement are free. Add-on plans below carry the cost.",
  );
  if (sqlVcores > 0) {
    const cost = sqlVcores * 4.5 * 730;
    push(
      `Arc-enabled SQL Server PAYG — ${sqlVcores} vCore${sqlVcores === 1 ? "" : "s"}`, "arc-sql-payg",
      cost, "1 vCore-Hour", 4.5, 730 * sqlVcores,
      `$4.50/vCore × 730 hrs × ${sqlVcores} vCore. ${params.arcSqlVcoreCount !== undefined ? "User-supplied vCore count." : "Inferred from DB-flagged VMs (1 vCore each); override for accurate licensing."}`,
    );
  }
  if (multicloudServers > 0) {
    const cost = multicloudServers * 15;
    push(
      `Defender for Servers — multicloud × ${multicloudServers} VM${multicloudServers === 1 ? "" : "s"}`,
      "defender-multicloud-servers",
      cost, "1/Month", 15, multicloudServers,
      `Defender Servers P2 extended to AWS/GCP VMs via Arc. $15/server × ${multicloudServers}.`,
    );
  }
  if (arcK8sClusters > 0) {
    push(
      `Arc-enabled Kubernetes × ${arcK8sClusters} cluster${arcK8sClusters === 1 ? "" : "s"}`, "arc-k8s",
      0, "1/Month", 0, arcK8sClusters,
      "Arc K8s onboarding free. Defender for Containers add-on priced separately at $7/vCore/mo.",
    );
  }
  if (laGb > 0) {
    const cost = laGb * 2.3;
    push(
      `Log Analytics ingestion from Arc agents — ${laGb} GB/mo`, "la-arc-ingestion",
      cost, "1 GB", 2.3, laGb,
      `Arc agents stream telemetry into LA workspace. $2.30/GB × ${laGb} GB/mo.`,
    );
  }
  return lines;
}
