import type { ComputeMode } from "./models";

export const AZURE_REGIONS = [
  "eastus", "eastus2", "westus", "westus2", "westus3", "centralus",
  "southcentralus", "northcentralus", "westcentralus",
  "canadacentral", "canadaeast", "brazilsouth", "mexicocentral", "chilecentral",
  "northeurope", "westeurope", "uksouth", "ukwest",
  "francecentral", "francesouth",
  "germanywestcentral", "germanynorth",
  "switzerlandnorth", "switzerlandwest",
  "norwayeast", "norwaywest",
  "swedencentral", "swedensouth",
  "polandcentral", "italynorth", "spaincentral",
  "uaenorth", "uaecentral", "qatarcentral", "israelcentral",
  "southafricanorth", "southafricawest",
  "southeastasia", "eastasia",
  "japaneast", "japanwest",
  "australiaeast", "australiasoutheast", "australiacentral", "australiacentral2",
  "koreacentral", "koreasouth",
  "centralindia", "southindia", "westindia",
  "jioindiacentral", "jioindiawest",
  "malaysiawest", "indonesiacentral", "newzealandnorth", "taiwannorth",
] as const;

export const DEFAULT_REGION = "malaysiawest";
export const DEFAULT_CURRENCY = "USD";

export const REGION_FALLBACKS: Record<string, string[]> = {
  malaysiawest: ["southeastasia"],
};

export const REGION_LABELS: Record<string, string> = {
  eastus: "🌎 Americas — East US (Virginia)",
  eastus2: "🌎 Americas — East US 2 (Virginia)",
  westus: "🌎 Americas — West US (California)",
  westus2: "🌎 Americas — West US 2 (Washington)",
  westus3: "🌎 Americas — West US 3 (Arizona)",
  centralus: "🌎 Americas — Central US (Iowa)",
  southcentralus: "🌎 Americas — South Central US (Texas)",
  northcentralus: "🌎 Americas — North Central US (Illinois)",
  westcentralus: "🌎 Americas — West Central US (Wyoming)",
  canadacentral: "🌎 Americas — Canada Central (Toronto)",
  canadaeast: "🌎 Americas — Canada East (Quebec)",
  brazilsouth: "🌎 Americas — Brazil South (São Paulo)",
  mexicocentral: "🌎 Americas — Mexico Central",
  chilecentral: "🌎 Americas — Chile Central",
  northeurope: "🇪🇺 Europe — North Europe (Ireland)",
  westeurope: "🇪🇺 Europe — West Europe (Netherlands)",
  uksouth: "🇪🇺 Europe — UK South (London)",
  ukwest: "🇪🇺 Europe — UK West (Cardiff)",
  francecentral: "🇪🇺 Europe — France Central (Paris)",
  francesouth: "🇪🇺 Europe — France South (Marseille)",
  germanywestcentral: "🇪🇺 Europe — Germany West Central (Frankfurt)",
  germanynorth: "🇪🇺 Europe — Germany North (Berlin)",
  switzerlandnorth: "🇪🇺 Europe — Switzerland North (Zurich)",
  switzerlandwest: "🇪🇺 Europe — Switzerland West (Geneva)",
  norwayeast: "🇪🇺 Europe — Norway East (Oslo)",
  norwaywest: "🇪🇺 Europe — Norway West (Stavanger)",
  swedencentral: "🇪🇺 Europe — Sweden Central (Gävle)",
  swedensouth: "🇪🇺 Europe — Sweden South (Malmö)",
  polandcentral: "🇪🇺 Europe — Poland Central (Warsaw)",
  italynorth: "🇪🇺 Europe — Italy North (Milan)",
  spaincentral: "🇪🇺 Europe — Spain Central (Madrid)",
  uaenorth: "🌍 MEA — UAE North (Dubai)",
  uaecentral: "🌍 MEA — UAE Central (Abu Dhabi)",
  qatarcentral: "🌍 MEA — Qatar Central (Doha)",
  israelcentral: "🌍 MEA — Israel Central",
  southafricanorth: "🌍 MEA — South Africa North (Johannesburg)",
  southafricawest: "🌍 MEA — South Africa West (Cape Town)",
  southeastasia: "🌏 APAC — Southeast Asia (Singapore)",
  eastasia: "🌏 APAC — East Asia (Hong Kong)",
  japaneast: "🌏 APAC — Japan East (Tokyo)",
  japanwest: "🌏 APAC — Japan West (Osaka)",
  australiaeast: "🌏 APAC — Australia East (NSW)",
  australiasoutheast: "🌏 APAC — Australia Southeast (Victoria)",
  australiacentral: "🌏 APAC — Australia Central (Canberra)",
  australiacentral2: "🌏 APAC — Australia Central 2 (Canberra)",
  koreacentral: "🌏 APAC — Korea Central (Seoul)",
  koreasouth: "🌏 APAC — Korea South (Busan)",
  centralindia: "🌏 APAC — Central India (Pune)",
  southindia: "🌏 APAC — South India (Chennai)",
  westindia: "🌏 APAC — West India (Mumbai)",
  jioindiacentral: "🌏 APAC — Jio India Central",
  jioindiawest: "🌏 APAC — Jio India West",
  malaysiawest: "🌏 APAC — Malaysia West (Kuala Lumpur)",
  indonesiacentral: "🌏 APAC — Indonesia Central (Jakarta)",
  newzealandnorth: "🌏 APAC — New Zealand North (Auckland)",
  taiwannorth: "🌏 APAC — Taiwan North (Taipei)",
};

export function regionLabel(arm: string): string {
  return REGION_LABELS[arm] ?? arm;
}

export const COMPUTE_MODE_LABELS: Record<ComputeMode, string> = {
  saving: "💰 Saving — Burstable / Basic / Serverless",
  normal: "⚖ Normal — Production-grade general purpose",
  high_perf: "🚀 High Performance — Premium / Memory-Optimised",
};

export const DEFAULT_COMPUTE_MODE: ComputeMode = "normal";

export const PRICING_MODE_LABELS: Record<string, string> = {
  payg: "Pay-as-you-go",
  sp_1y: "Savings Plan (1 year)",
  sp_3y: "Savings Plan (3 years)",
  ri_1y: "Reserved Instance (1 year)",
  ri_3y: "Reserved Instance (3 years)",
};

export const HOURS_PER_MONTH = 730;
