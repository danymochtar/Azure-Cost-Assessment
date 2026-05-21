export type ComputeMode = "saving" | "normal" | "high_perf";

export type PricingMode = "payg" | "sp_1y" | "sp_3y" | "ri_1y" | "ri_3y";

export interface DiskItem {
  label: string;
  sizeGb: number;
  tier?: string;
}

export interface InventoryItem {
  name: string;
  vcpu: number;
  memoryGb: number;
  storageGb: number;
  os: string;
  environment: string;
  powerstate: string;
  notes: string;
  disks: DiskItem[];
  workload?: string;
  recommendedAzureService?: string;
  /** True when the server runs a database (SQL Server, Postgres, etc.).
   *  Drives disk-tier auto-routing (Premium SSD) and future SQL Server
   *  licensing decisions. Pre-filled from the AI's workload hint and
   *  user-editable via the inventory table checkbox in Stage 2. */
  hasDb?: boolean;
  /** True when this workload needs high availability — pricing
   *  multiplies the VM compute by 2 and adds a shared Standard Load
   *  Balancer line in the BOM. The AI sets this when the source doc
   *  hints at active-active / cluster / failover / load-balanced
   *  topology; users can override via the Stage 2 checkbox. */
  hasHa?: boolean;
}

export interface BomLine {
  category: string;
  resource: string;
  sku: string;
  meter: string;
  region: string;
  /** Source VM / workload names that this BOM line represents — so a
   *  grouped "D8s v5 (Windows) x8" line can list the eight underlying
   *  hostnames. Empty for platform components (Landing Zone, ASR) that
   *  aren't tied to a specific workload. */
  workloadNames?: string[];
  quantity: number;
  unit: string;
  unitPrice: number;
  monthlyCost: number;
  currency: string;
  source: string;
  productId: string;
  skuId: string;
  meterId: string;
  serviceName: string;
  customName: string;
  resourceCount: number;
  billingTerm: string;
  assumption: string;
}

export function emptyBomLine(): BomLine {
  return {
    category: "",
    resource: "",
    sku: "",
    meter: "",
    region: "",
    quantity: 0,
    unit: "",
    unitPrice: 0,
    monthlyCost: 0,
    currency: "USD",
    source: "",
    productId: "",
    skuId: "",
    meterId: "",
    serviceName: "",
    customName: "",
    resourceCount: 1,
    billingTerm: "PAYG",
    assumption: "",
    workloadNames: [],
  };
}

export type WorkloadType =
  | "infra_lift_shift"
  | "infra_modernization"
  | "data_platform"
  | "ai_application"
  | "azure_security"
  | "hybrid_multicloud"
  | "m365_and_others"
  | "mixed"
  | "unknown";

/** UI-facing notice with severity so the page can size the banner to
 *  match the message: errors need full attention, warnings are worth
 *  reading, info is just an FYI (model escalation, region fallback).
 *  `detail` is optional long-form text — UI keeps it collapsed by
 *  default so the page doesn't get drowned in AI-generated prose. */
export interface Notice {
  severity: "error" | "warning" | "info";
  source?: string;
  title: string;
  detail?: string;
}

export interface AssessmentProfile {
  workloadType: WorkloadType;
  confidence: number;
  complexity: "simple" | "moderate" | "complex";
  needsVmExtraction: boolean;
  suggestedComponents: string[];
  signals: string[];
  summary: string;
}
