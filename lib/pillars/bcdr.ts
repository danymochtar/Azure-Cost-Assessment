// Azure Site Recovery (BCDR) pricing.
//
// Reference: https://learn.microsoft.com/azure/site-recovery/site-recovery-cost
// Public retail: https://azure.microsoft.com/pricing/details/site-recovery/
//
// Steady-state cost model per protected VM (Azure-to-Azure, the default
// for greenfield Azure landings):
//
//   Protected Instance License fee — $25/instance/month (flat, after the
//     first-31-days-free promo).
//   Replica disk storage — every source disk has a replica disk in the
//     target region. We use Standard SSD as the cheapest credible replica
//     tier: ~$0.075/GB/mo. (Premium SSD v2 source disks default to
//     Premium SSD v1 replicas in Azure-to-Azure.)
//   Cache storage account — small, used for delta replication. Estimated
//     ~$1.50/VM/month based on typical churn.
//
// DR-drill compute (test failovers spinning up the replica VMs four times
// a year for ~7 days each) is intentionally excluded — it depends on user
// policy, customers can layer it on top of the BOM if needed.

import { type BomLine, emptyBomLine, type InventoryItem } from "../models";

const PROTECTED_INSTANCE_PER_MONTH = 25.00;
const REPLICA_DISK_USD_PER_GB_MONTH = 0.075;
const CACHE_STORAGE_PER_VM = 1.50;

export interface BcdrOptions {
  region: string;
  appName: string;
}

export function buildBcdrBom(items: InventoryItem[], opts: BcdrOptions): BomLine[] {
  if (items.length === 0) return [];

  const vmCount = items.length;
  const names = items.map((it) => it.name);
  const totalStorageGb = items.reduce((s, it) => {
    const fromDisks = it.disks.reduce((a, d) => a + (d.sizeGb || 0), 0);
    return s + (fromDisks > 0 ? fromDisks : it.storageGb || 0);
  }, 0);

  const lines: BomLine[] = [];

  // Protected Instance License fee — flat per VM.
  const licenseMonthly = vmCount * PROTECTED_INSTANCE_PER_MONTH;
  lines.push({
    ...emptyBomLine(),
    category: "BCDR · Site Recovery",
    resource: "Azure Site Recovery — Protected Instance License",
    sku: "asr-protected-instance",
    meter: "asr-protected-instance",
    region: opts.region,
    quantity: vmCount,
    unit: "1/Month",
    unitPrice: PROTECTED_INSTANCE_PER_MONTH,
    monthlyCost: Math.round(licenseMonthly * 100) / 100,
    currency: "USD",
    source: "bcdr-baseline",
    serviceName: "Azure Site Recovery",
    customName: opts.appName ? `${opts.appName}-asr` : "Site Recovery",
    resourceCount: vmCount,
    billingTerm: "PAYG",
    workloadNames: names,
    assumption: `$${PROTECTED_INSTANCE_PER_MONTH.toFixed(2)}/VM/mo × ${vmCount} VMs (Azure-to-Azure). Picked A2A because the workloads are landing in Azure — VMware/Hyper-V-to-Azure scenarios use the same license fee but add a configuration server. Step up by enabling test-failover drills quarterly (compute spun up only during the drill — not part of steady-state). NOT included: DR-drill compute / disk burst, target-region egress during failback, network change automation.`,
  });

  // Replica disk storage in the target region — Standard SSD baseline.
  if (totalStorageGb > 0) {
    const replicaMonthly = totalStorageGb * REPLICA_DISK_USD_PER_GB_MONTH;
    lines.push({
      ...emptyBomLine(),
      category: "BCDR · Site Recovery",
      resource: `Replica disks — ${totalStorageGb.toFixed(0)} GB (Standard SSD, target region)`,
      sku: "asr-replica-disks",
      meter: "asr-replica-disks",
      region: opts.region,
      quantity: totalStorageGb,
      unit: "1 GB",
      unitPrice: REPLICA_DISK_USD_PER_GB_MONTH,
      monthlyCost: Math.round(replicaMonthly * 100) / 100,
      currency: "USD",
      source: "bcdr-baseline",
      serviceName: "Managed Disks",
      customName: opts.appName ? `${opts.appName}-asr-disks` : "ASR replica disks",
      resourceCount: vmCount,
      billingTerm: "PAYG",
    workloadNames: names,
      assumption: `${totalStorageGb.toFixed(0)} GB × $${REPLICA_DISK_USD_PER_GB_MONTH.toFixed(3)}/GB/mo (Standard SSD baseline). Picked Standard SSD because A2A defaults source-Premium disks to Premium replicas only if you opt in — Standard SSD is the cheapest credible replica tier. Step up to Premium replicas for sub-1-ms RPO targets on tier-1 DBs. NOT included: snapshot retention beyond the rolling 24 h, cross-region bandwidth (Microsoft absorbs replication traffic).`,
    });
  }

  // Cache storage account — delta replication staging.
  const cacheMonthly = vmCount * CACHE_STORAGE_PER_VM;
  lines.push({
    ...emptyBomLine(),
    category: "BCDR · Site Recovery",
    resource: "Cache storage account (delta replication)",
    sku: "asr-cache-storage",
    meter: "asr-cache-storage",
    region: opts.region,
    quantity: vmCount,
    unit: "1/Month",
    unitPrice: CACHE_STORAGE_PER_VM,
    monthlyCost: Math.round(cacheMonthly * 100) / 100,
    currency: "USD",
    source: "bcdr-baseline",
    serviceName: "Storage Accounts",
    customName: opts.appName ? `${opts.appName}-asr-cache` : "ASR cache",
    resourceCount: 1,
    billingTerm: "PAYG",
    workloadNames: names,
    assumption: `~$${CACHE_STORAGE_PER_VM.toFixed(2)}/VM/mo for delta-replication staging (GPv2 SA). Picked GPv2 standard because cache turnover is fast and high-tier storage adds no recovery benefit. Step up to Premium Block Blob when source-disk churn is high (>500 IOPS sustained) and cache becomes the bottleneck. NOT included: storage transactions (typically <$1/VM/mo), reader/writer egress (intra-region — free).`,
  });

  return lines;
}
