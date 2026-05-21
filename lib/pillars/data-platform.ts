// Data Platform baseline pricing.
//
// Covers the common Azure data stack: SQL DB / MI, Cosmos, ADLS Gen2,
// Data Factory, Event Hubs, Microsoft Fabric. East US 2 USD list rates,
// late 2025. Databricks deliberately excluded — too workload-dependent
// (DBU pricing × node hours), customers should layer it on top.

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
    resource: "Azure SQL Database — General Purpose, Gen5, 2 vCore",
    sku: "azsql-gp-gen5-2vcore",
    monthlyCost: 371.10, unit: "1 Hour", unitPrice: 0.508, quantity: 730,
    assumption: "GP 2 vCore × $0.508/hr × 730 (includes 7-day PITR). Add storage at $0.115/GB/mo. Hyperscale / Business Critical price much higher.",
  },
  {
    resource: "Azure Cosmos DB — Serverless (100k RU/mo baseline)",
    sku: "cosmos-serverless",
    monthlyCost: 28.00, unit: "1M RU", unitPrice: 0.28, quantity: 100,
    assumption: "Serverless $0.28 per 1M RU × 100M RU/mo baseline + $0.25/GB storage (~$2.50 for 10 GB). Provisioned throughput priced separately.",
  },
  {
    resource: "ADLS Gen2 — Hot tier × 1 TB",
    sku: "adls-gen2-hot-1tb",
    monthlyCost: 18.40, unit: "1 GB", unitPrice: 0.0184, quantity: 1000,
    assumption: "Hot tier $0.0184/GB/mo × 1,000 GB. Add transaction charges ($0.0044 per 10k read ops, $0.055 per 10k write ops).",
  },
  {
    resource: "Microsoft Fabric — F2 capacity",
    sku: "fabric-f2",
    monthlyCost: 262.80, unit: "1 Hour", unitPrice: 0.360, quantity: 730,
    assumption: "F2 ($0.36/hr) reserved capacity supports Power BI, Synapse engines, Data Factory, Eventstream. Scale to F4/F8 for production.",
  },
  {
    resource: "Azure Data Factory — 1,000 orchestration runs + 50 DIU-hours",
    sku: "adf-baseline",
    monthlyCost: 27.50, unit: "1/Month", unitPrice: 27.50, quantity: 1,
    assumption: "$1/1,000 orchestration runs ($1) + 50 × $0.25/DIU-hr ($12.50) + 50 × $0.28/hr SSIS or self-hosted IR (~$14). Tune to actual ingest cadence.",
  },
  {
    resource: "Event Hubs — Standard 1 Throughput Unit",
    sku: "event-hubs-std-1tu",
    monthlyCost: 21.90, unit: "1 Hour", unitPrice: 0.03, quantity: 730,
    assumption: "Standard 1 TU ($0.03/hr × 730). 1 TU = 1 MB/s ingress, 2 MB/s egress, 84 GB capture. Premium tier from $0.50/PU/hr.",
  },
  {
    resource: "Azure Cache for Redis — Standard C1 (1 GB)",
    sku: "redis-std-c1",
    monthlyCost: 89.00, unit: "1 Hour", unitPrice: 0.122, quantity: 730,
    assumption: "Standard C1 1 GB ($0.122/hr × 730) replicated. Step up to Premium for clustering / Active geo-replication.",
  },
];

export function buildDataPlatformBom(region: string, appName: string): BomLine[] {
  const tag = "(Data Platform baseline — East US 2; tune per workload)";
  return PRESETS.map((p) => ({
    ...emptyBomLine(),
    category: "Data Platform",
    resource: p.resource,
    sku: p.sku,
    meter: p.sku,
    region,
    quantity: p.quantity,
    unit: p.unit,
    unitPrice: p.unitPrice,
    monthlyCost: Math.round(p.monthlyCost * 100) / 100,
    currency: "USD",
    source: "data-platform-baseline",
    serviceName: "Data Platform",
    customName: appName ? `${appName}-data` : "Data Platform",
    resourceCount: 1,
    billingTerm: "PAYG",
    assumption: `${p.assumption} ${tag}`,
  }));
}
