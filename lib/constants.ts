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

// Region display names follow Microsoft's official Azure portal naming
// (https://learn.microsoft.com/en-us/azure/reliability/regions-list).
// No emoji, no geo prefix, no city tag — just the canonical display name.
export const REGION_LABELS: Record<string, string> = {
  // Americas
  eastus: "East US",
  eastus2: "East US 2",
  westus: "West US",
  westus2: "West US 2",
  westus3: "West US 3",
  centralus: "Central US",
  southcentralus: "South Central US",
  northcentralus: "North Central US",
  westcentralus: "West Central US",
  canadacentral: "Canada Central",
  canadaeast: "Canada East",
  brazilsouth: "Brazil South",
  mexicocentral: "Mexico Central",
  chilecentral: "Chile Central",
  // Europe
  northeurope: "North Europe",
  westeurope: "West Europe",
  uksouth: "UK South",
  ukwest: "UK West",
  francecentral: "France Central",
  francesouth: "France South",
  germanywestcentral: "Germany West Central",
  germanynorth: "Germany North",
  switzerlandnorth: "Switzerland North",
  switzerlandwest: "Switzerland West",
  norwayeast: "Norway East",
  norwaywest: "Norway West",
  swedencentral: "Sweden Central",
  swedensouth: "Sweden South",
  polandcentral: "Poland Central",
  italynorth: "Italy North",
  spaincentral: "Spain Central",
  // Middle East & Africa
  uaenorth: "UAE North",
  uaecentral: "UAE Central",
  qatarcentral: "Qatar Central",
  israelcentral: "Israel Central",
  southafricanorth: "South Africa North",
  southafricawest: "South Africa West",
  // Asia Pacific
  southeastasia: "Southeast Asia",
  eastasia: "East Asia",
  japaneast: "Japan East",
  japanwest: "Japan West",
  australiaeast: "Australia East",
  australiasoutheast: "Australia Southeast",
  australiacentral: "Australia Central",
  australiacentral2: "Australia Central 2",
  koreacentral: "Korea Central",
  koreasouth: "Korea South",
  centralindia: "Central India",
  southindia: "South India",
  westindia: "West India",
  jioindiacentral: "Jio India Central",
  jioindiawest: "Jio India West",
  malaysiawest: "Malaysia West",
  indonesiacentral: "Indonesia Central",
  newzealandnorth: "New Zealand North",
  taiwannorth: "Taiwan North",
};

export function regionLabel(arm: string): string {
  return REGION_LABELS[arm] ?? arm;
}

// Microsoft's geography grouping. Source:
//   https://learn.microsoft.com/en-us/azure/reliability/regions-list
// Used to render the region picker with <optgroup> headers so the
// 50+ entry list stays scannable on a phone-sized native select.
export type AzureGeography = "Americas" | "Europe" | "Middle East & Africa" | "Asia Pacific";

export const REGION_GEOGRAPHY: Record<string, AzureGeography> = {
  // Americas
  eastus: "Americas", eastus2: "Americas",
  westus: "Americas", westus2: "Americas", westus3: "Americas",
  centralus: "Americas", southcentralus: "Americas",
  northcentralus: "Americas", westcentralus: "Americas",
  canadacentral: "Americas", canadaeast: "Americas",
  brazilsouth: "Americas", mexicocentral: "Americas",
  chilecentral: "Americas",
  // Europe
  northeurope: "Europe", westeurope: "Europe",
  uksouth: "Europe", ukwest: "Europe",
  francecentral: "Europe", francesouth: "Europe",
  germanywestcentral: "Europe", germanynorth: "Europe",
  switzerlandnorth: "Europe", switzerlandwest: "Europe",
  norwayeast: "Europe", norwaywest: "Europe",
  swedencentral: "Europe", swedensouth: "Europe",
  polandcentral: "Europe", italynorth: "Europe",
  spaincentral: "Europe",
  // Middle East & Africa
  uaenorth: "Middle East & Africa", uaecentral: "Middle East & Africa",
  qatarcentral: "Middle East & Africa", israelcentral: "Middle East & Africa",
  southafricanorth: "Middle East & Africa", southafricawest: "Middle East & Africa",
  // Asia Pacific
  southeastasia: "Asia Pacific", eastasia: "Asia Pacific",
  japaneast: "Asia Pacific", japanwest: "Asia Pacific",
  australiaeast: "Asia Pacific", australiasoutheast: "Asia Pacific",
  australiacentral: "Asia Pacific", australiacentral2: "Asia Pacific",
  koreacentral: "Asia Pacific", koreasouth: "Asia Pacific",
  centralindia: "Asia Pacific", southindia: "Asia Pacific", westindia: "Asia Pacific",
  jioindiacentral: "Asia Pacific", jioindiawest: "Asia Pacific",
  malaysiawest: "Asia Pacific", indonesiacentral: "Asia Pacific",
  newzealandnorth: "Asia Pacific", taiwannorth: "Asia Pacific",
};

export const GEOGRAPHY_ORDER: AzureGeography[] = [
  "Americas",
  "Europe",
  "Middle East & Africa",
  "Asia Pacific",
];

/** Returns regions grouped by Azure geography in canonical order, preserving
 *  the order regions appear in AZURE_REGIONS within each group. */
export function regionsByGeography(): Array<{ geography: AzureGeography; regions: readonly string[] }> {
  const buckets: Record<AzureGeography, string[]> = {
    "Americas": [],
    "Europe": [],
    "Middle East & Africa": [],
    "Asia Pacific": [],
  };
  for (const r of AZURE_REGIONS) {
    const g = REGION_GEOGRAPHY[r];
    if (g) buckets[g].push(r);
  }
  return GEOGRAPHY_ORDER.map((g) => ({ geography: g, regions: buckets[g] }));
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
