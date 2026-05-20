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
}

export interface BomLine {
  category: string;
  resource: string;
  sku: string;
  meter: string;
  region: string;
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

export interface AssessmentProfile {
  workloadType: WorkloadType;
  confidence: number;
  complexity: "simple" | "moderate" | "complex";
  needsVmExtraction: boolean;
  suggestedComponents: string[];
  signals: string[];
  summary: string;
}
