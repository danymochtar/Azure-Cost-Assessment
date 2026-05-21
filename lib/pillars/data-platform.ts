// Data Platform parametric pricing.
//
// Drives the BOM off use-case knobs: Fabric capacity SKU, SQL vCore
// count, Cosmos RU volume, ADLS Gen2 GB, ADF DIU-hours, Event Hubs TU
// count, Redis tier. East US 2 USD list rates, late 2025.

import { type BomLine, emptyBomLine } from "../models";

export interface DataPlatformParams {
  fabricCapacity?: "off" | "F2" | "F4" | "F8" | "F16" | "F32" | "F64" | "F128" | "F256" | "F512";
  /** Azure SQL DB sizing. tier=off drops the line. */
  sqlDbTier?: "off" | "gp" | "bc";
  sqlDbVcores?: number;
  /** Cosmos DB RU volume per month (millions). 0 drops the line. */
  cosmosMillionRuPerMonth?: number;
  /** ADLS Gen2 hot tier storage in GB. 0 drops the line. */
  adlsGb?: number;
  /** Data Factory monthly $ baseline (orchestration + DIU + IR). 0 drops the line. */
  dataFactoryUsd?: number;
  /** Event Hubs Standard Throughput Unit count. 0 drops the line. */
  eventHubsTu?: number;
  /** Redis Cache tier. "off" drops the line. */
  redisTier?: "off" | "basic_c0" | "basic_c1" | "standard_c1" | "premium_p1";
}

const FABRIC_HOURLY: Record<Exclude<NonNullable<DataPlatformParams["fabricCapacity"]>, "off">, number> = {
  F2: 0.36, F4: 0.72, F8: 1.44, F16: 2.88, F32: 5.76, F64: 11.52, F128: 23.04, F256: 46.08, F512: 92.16,
};
const REDIS: Record<Exclude<NonNullable<DataPlatformParams["redisTier"]>, "off">, { rate: number; label: string }> = {
  basic_c0:    { rate: 0.017, label: "Basic C0 (250 MB)" },
  basic_c1:    { rate: 0.061, label: "Basic C1 (1 GB)" },
  standard_c1: { rate: 0.122, label: "Standard C1 (1 GB)" },
  premium_p1:  { rate: 0.413, label: "Premium P1 (6 GB)" },
};

export function buildDataPlatformBom(
  region: string,
  appName: string,
  params: DataPlatformParams = {},
): BomLine[] {
  const fabric = params.fabricCapacity ?? "F2";
  const sqlTier = params.sqlDbTier ?? "gp";
  const sqlVcores = params.sqlDbVcores ?? 2;
  const cosmosMRu = params.cosmosMillionRuPerMonth ?? 100;
  const adlsGb = params.adlsGb ?? 1000;
  const adfUsd = params.dataFactoryUsd ?? 27.5;
  const ehTu = params.eventHubsTu ?? 1;
  const redis = params.redisTier ?? "standard_c1";

  const lines: BomLine[] = [];
  const tag = "(Data Platform — East US 2; tune per workload)";
  const push = (
    resource: string, sku: string, monthlyCost: number,
    unit: string, unitPrice: number, quantity: number, assumption: string,
  ) => {
    lines.push({
      ...emptyBomLine(),
      category: "Data Platform", resource, sku, meter: sku, region,
      quantity, unit, unitPrice,
      monthlyCost: Math.round(monthlyCost * 100) / 100,
      currency: "USD", source: "data-platform-baseline",
      serviceName: "Data Platform",
      customName: appName ? `${appName}-data` : "Data Platform",
      resourceCount: 1, billingTerm: "PAYG",
      assumption: `${assumption} ${tag}`,
    });
  };

  if (fabric !== "off") {
    const rate = FABRIC_HOURLY[fabric];
    // Fabric capacity sizing — each step doubles compute. Below F8 single-team / dev;
    // F8-F32 multi-team prod; F64+ enterprise multi-domain. Tune by CU saturation.
    const fabricFit: Record<Exclude<NonNullable<DataPlatformParams["fabricCapacity"]>, "off">, string> = {
      F2:   "F2 (2 CU) — single-user dev / PoC; one Power BI dataset, light Synapse SQL queries.",
      F4:   "F4 (4 CU) — small team (5-10 analysts) running Power BI + occasional notebooks.",
      F8:   "F8 (8 CU) — multi-team prod baseline; runs Power BI Premium-equivalent + parallel Synapse jobs.",
      F16:  "F16 (16 CU) — heavier analytics with concurrent users; data engineering on Spark pools.",
      F32:  "F32 (32 CU) — enterprise BI with peak concurrency; consider Reserved Instance for ~30 % discount.",
      F64:  "F64 (64 CU) — large org, multi-domain Lakehouse + DW.",
      F128: "F128 (128 CU) — global enterprise; reserve-purchase mandatory at this spend.",
      F256: "F256 (256 CU) — top-tier enterprise / regulated bank-grade workload.",
      F512: "F512 (512 CU) — rarely the right pick; usually you split into multiple smaller capacities by domain.",
    };
    push(
      `Microsoft Fabric — ${fabric} capacity`, `fabric-${fabric.toLowerCase()}`,
      rate * 730, "1 Hour", rate, 730,
      `${fabric} × $${rate.toFixed(2)}/hr × 730 = $${(rate * 730).toFixed(2)}. Picked because ${fabricFit[fabric]} Includes Power BI Premium, Synapse Data Warehouse, Spark, Real-Time Analytics, Data Factory, Eventstream — all sharing the capacity. Step up when CU usage stays >80 % at peak; step down or pause off-hours. Reserved Instance is ~30-40 % cheaper than PAYG above F8.`,
    );
  }
  if (sqlTier !== "off" && sqlVcores > 0) {
    const gpHourlyPerVcore = 0.254;
    const bcHourlyPerVcore = 0.684;
    const rate = (sqlTier === "bc" ? bcHourlyPerVcore : gpHourlyPerVcore) * sqlVcores;
    const tierLabel = sqlTier === "bc" ? "Business Critical" : "General Purpose";
    const sqlFit = sqlTier === "bc"
      ? "Business Critical — 99.995 % SLA, Always On synchronous replicas (3-4 nodes), local SSD for low-latency IOPS, in-memory OLTP, read-scale-out replicas free. ~3× the cost of GP — justified for tier-1 transactional workloads where downtime is measured in minutes."
      : "General Purpose — 99.99 % SLA, remote premium storage, async backups, single primary (failover to secondary takes 30-60 s). The default for most workloads; step up to Business Critical only when SLA, in-memory OLTP, or read-scale-out replicas are required.";
    push(
      `Azure SQL Database — ${tierLabel}, Gen5, ${sqlVcores} vCore`,
      `azsql-${sqlTier}-gen5-${sqlVcores}vc`,
      rate * 730, "1 Hour", rate, 730,
      `${tierLabel} Gen5 × ${sqlVcores} vCore × $${rate.toFixed(3)}/hr × 730 = $${(rate * 730).toFixed(2)}. Picked because ${sqlFit} What's NOT included: storage at $0.115/GB/mo (GP) or $0.25/GB/mo (BC), long-term backup retention, Azure Hybrid Benefit (SQL Server licence) savings, Hyperscale tier (separate pricing for >4 TB DBs).`,
    );
  }
  if (cosmosMRu > 0) {
    const cost = cosmosMRu * 0.28;
    push(
      `Azure Cosmos DB — Serverless (${cosmosMRu}M RU/mo)`, "cosmos-serverless",
      cost, "1M RU", 0.28, cosmosMRu,
      `Serverless $0.28/M RU × ${cosmosMRu}M = $${cost.toFixed(2)}. Picked because Serverless has no minimum, scales request-by-request, and is cheapest for bursty/unpredictable workloads. Step up to Provisioned Throughput (autoscale) around 200 M RU/mo — at that volume the per-RU rate drops ~50 %. Step further to Provisioned (manual RU/s) once usage is steady and predictable. What's NOT included: storage at $0.25/GB/mo, multi-region writes (2× cost per region), continuous backup ($0.20/GB/mo), Synapse Link.`,
    );
  }
  if (adlsGb > 0) {
    const cost = adlsGb * 0.0184;
    push(
      `ADLS Gen2 — Hot tier × ${adlsGb.toLocaleString()} GB`, "adls-gen2-hot",
      cost, "1 GB", 0.0184, adlsGb,
      `Hot tier $0.0184/GB × ${adlsGb} GB = $${cost.toFixed(2)}. Picked because Hot is the right tier for active datasets accessed daily — immediate read, no rehydration. Step down to Cool tier ($0.0102/GB, 30-day min retention) for monthly-access archives, or Archive tier ($0.00099/GB, 180-day min + 1-15 hr rehydration) for compliance retention. Set lifecycle policies to auto-tier blobs by age. What's NOT included: transactions ($0.0044/10k reads, $0.055/10k writes), egress bandwidth, hierarchical namespace operations.`,
    );
  }
  if (adfUsd > 0) {
    push(
      "Azure Data Factory — orchestration + DIU-hours baseline", "adf-baseline",
      adfUsd, "1/Month", adfUsd, 1,
      `Mixed orchestration runs + DIU-hours + IR baseline = $${adfUsd.toFixed(2)}/mo. Composition: orchestration runs $1/1,000 (~1k runs/mo = $1), data movement ~$0.25/DIU-hour (50 DIU-hours = $12.50), Self-Hosted IR free but adds VM ops burden, Managed VNet IR ~$1.50/hr. Picked because PAYG ADF is right for bursty ETL; switch to Synapse Pipelines if you're already on Synapse (same pricing, unified portal). What's NOT included: SSIS-IR licence ($0.586/hr Standard A4), per-activity charges above the baseline, Mapping Data Flow execution.`,
    );
  }
  if (ehTu > 0) {
    const cost = ehTu * 0.03 * 730;
    push(
      `Event Hubs — Standard ${ehTu} Throughput Unit${ehTu === 1 ? "" : "s"}`, `event-hubs-std-${ehTu}tu`,
      cost, "1 Hour", 0.03, 730 * ehTu,
      `Standard ${ehTu} TU × $0.03/hr × 730 = $${cost.toFixed(2)}. 1 TU = 1 MB/s ingress / 2 MB/s egress / 84 GB capture. Picked because Standard is the default for most streaming workloads — Kafka protocol, 7-day retention, capture to Blob. Step up to Premium ($0.50/PU/hr) when you need <10 ms latency, geo-disaster recovery, or dynamic throughput. Step further to Dedicated for >40 TU sustained — flat-rate cluster reservation. Auto-Inflate (free) scales up to 20 TU automatically.`,
    );
  }
  if (redis !== "off") {
    const t = REDIS[redis];
    const redisFit: Record<Exclude<NonNullable<DataPlatformParams["redisTier"]>, "off">, string> = {
      basic_c0:    "Basic C0 (250 MB) — single-node, NO SLA, NO failover. Dev/test only; will lose all keys on Azure-maintenance restart.",
      basic_c1:    "Basic C1 (1 GB) — same story as C0 with more memory. Dev/test only.",
      standard_c1: "Standard C1 (1 GB) — primary + replica with automatic failover, 99.9 % SLA. Production default for session cache / rate limiting.",
      premium_p1:  "Premium P1 (6 GB) — clustering, geo-replication, persistence (AOF/RDB), VNet injection, zone redundancy. Required for >1 GB datasets, multi-region active reads, or compliance.",
    };
    push(
      `Azure Cache for Redis — ${t.label}`, `redis-${redis}`,
      t.rate * 730, "1 Hour", t.rate, 730,
      `${t.label} × $${t.rate.toFixed(3)}/hr × 730 = $${(t.rate * 730).toFixed(2)}. Picked because ${redisFit[redis]} Step up from Basic→Standard for any prod workload (HA is essential), and Standard→Premium when dataset >1 GB or you need clustering / geo. What's NOT included: data egress, Azure Cache for Redis Enterprise tier (separate pricing, RediSearch/JSON/etc.).`,
    );
  }
  return lines;
}
