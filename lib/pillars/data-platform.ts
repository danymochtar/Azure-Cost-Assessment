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
    push(
      `Microsoft Fabric — ${fabric} capacity`, `fabric-${fabric.toLowerCase()}`,
      rate * 730, "1 Hour", rate, 730,
      `${fabric} ($${rate.toFixed(2)}/hr × 730) supports Power BI, Synapse engines, Data Factory, Eventstream.`,
    );
  }
  if (sqlTier !== "off" && sqlVcores > 0) {
    const gpHourlyPerVcore = 0.254;
    const bcHourlyPerVcore = 0.684;
    const rate = (sqlTier === "bc" ? bcHourlyPerVcore : gpHourlyPerVcore) * sqlVcores;
    const tierLabel = sqlTier === "bc" ? "Business Critical" : "General Purpose";
    push(
      `Azure SQL Database — ${tierLabel}, Gen5, ${sqlVcores} vCore`,
      `azsql-${sqlTier}-gen5-${sqlVcores}vc`,
      rate * 730, "1 Hour", rate, 730,
      `${tierLabel} Gen5 × ${sqlVcores} vCore × $${rate.toFixed(3)}/hr × 730. Storage $0.115/GB extra.`,
    );
  }
  if (cosmosMRu > 0) {
    const cost = cosmosMRu * 0.28;
    push(
      `Azure Cosmos DB — Serverless (${cosmosMRu}M RU/mo)`, "cosmos-serverless",
      cost, "1M RU", 0.28, cosmosMRu,
      `Serverless $0.28/M RU × ${cosmosMRu}M + $0.25/GB storage (excluded).`,
    );
  }
  if (adlsGb > 0) {
    const cost = adlsGb * 0.0184;
    push(
      `ADLS Gen2 — Hot tier × ${adlsGb.toLocaleString()} GB`, "adls-gen2-hot",
      cost, "1 GB", 0.0184, adlsGb,
      `Hot tier $0.0184/GB × ${adlsGb} GB. Transactions $0.0044/10k reads, $0.055/10k writes.`,
    );
  }
  if (adfUsd > 0) {
    push(
      "Azure Data Factory — orchestration + DIU-hours baseline", "adf-baseline",
      adfUsd, "1/Month", adfUsd, 1,
      `Mixed orchestration runs + DIU-hours + IR baseline = $${adfUsd.toFixed(2)}/mo.`,
    );
  }
  if (ehTu > 0) {
    const cost = ehTu * 0.03 * 730;
    push(
      `Event Hubs — Standard ${ehTu} Throughput Unit${ehTu === 1 ? "" : "s"}`, `event-hubs-std-${ehTu}tu`,
      cost, "1 Hour", 0.03, 730 * ehTu,
      `Standard ${ehTu} TU × $0.03/hr × 730. 1 TU = 1 MB/s ingress, 2 MB/s egress.`,
    );
  }
  if (redis !== "off") {
    const t = REDIS[redis];
    push(
      `Azure Cache for Redis — ${t.label}`, `redis-${redis}`,
      t.rate * 730, "1 Hour", t.rate, 730,
      `${t.label} ($${t.rate.toFixed(3)}/hr × 730).`,
    );
  }
  return lines;
}
