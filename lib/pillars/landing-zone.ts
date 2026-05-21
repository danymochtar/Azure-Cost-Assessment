// Azure CAF "Landing Zone" platform components.
//
// CAF / Enterprise-Scale recommends every Azure tenant deploy a platform
// landing zone (hub) before lighting up application workloads. The hub is
// shared across every Solution Area — lift-shift, modernization, data &
// AI all sit on top of the same Bastion / Firewall / Log Analytics /
// Defender / ExpressRoute / DDoS substrate.
//
// Three opinionated tiers are exposed in Stage 3 so the BOM reflects
// real-world hub cost (not just the workload VMs):
//   - basic       — POC / small dev workload. Bastion + Key Vault + LA + free Defender.
//   - standard    — production hub-spoke. Adds Firewall Std, VPN, App GW WAF v2, Sentinel.
//   - enterprise  — full ALZ. Firewall Premium, ExpressRoute, DDoS Network Protection,
//                   private endpoints.
//
// Prices below are East US 2 USD list rates (Microsoft public retail, late
// 2025). They are deliberately encoded as flat baselines per line — not
// Retail API lookups — because:
//   1) hub cost is far less elastic than per-VM cost; ±10% accuracy is fine,
//   2) the components span ~15 different filter shapes (Bastion SKU,
//      Firewall hour + data-processed, ExpressRoute port + egress) that
//      Retail API integration would balloon code with little gain.
// Each line carries an explicit assumption string so customers can refine
// per-region or per-usage in their own export.
//
// Reference: https://learn.microsoft.com/azure/cloud-adoption-framework/ready/landing-zone/

import { type BomLine, emptyBomLine, type InventoryItem } from "../models";
import { isSqlServer } from "../sizer";

export type LandingZoneTier = "none" | "basic" | "standard" | "enterprise";

export const LANDING_ZONE_LABELS: Record<LandingZoneTier, string> = {
  none: "No platform Landing Zone",
  basic: "Basic — POC / small workload",
  standard: "Standard — hub-spoke production",
  enterprise: "Enterprise-scale — full CAF ALZ",
};

export const LANDING_ZONE_DESCRIPTIONS: Record<LandingZoneTier, string> = {
  none: "Workload-only estimate. Use when the platform hub is already deployed and billed separately.",
  basic: "Bastion Basic, Key Vault, Log Analytics (5 GB), Defender for Cloud Foundational CSPM (free), 1× Standard Public IP. Suitable for POC, sandbox, single-subscription dev environments.",
  standard: "Adds hub-spoke: Azure Firewall Standard, Bastion Standard, VPN Gateway VpnGw1, App Gateway WAF v2, Sentinel PAYG (50 GB), 50 GB Log Analytics, Private DNS zones. Defender CSPM + Defender for Servers P1 + Resource Manager + Storage + Key Vault (CWP) scale with the inventory. Recommended production baseline.",
  enterprise: "Full ALZ: Firewall Premium (replaces Std), ExpressRoute circuit + gateway, DDoS Network Protection, 10× Private Endpoints. Defender for Servers upgrades to P2 (adds agentless scanning, FIM, JIT, free DNS), plus Defender for SQL on Machines (scaled to DB-hosting VMs), Containers, and App Service. Required for regulated / multi-region landings.",
};

// Microsoft Defender for Cloud public retail prices (USD, late 2025).
// Per-resource plans scale with the workload inventory at pricing time.
// Sources: https://azure.microsoft.com/pricing/details/defender-for-cloud/
const DEFENDER_PRICES = {
  cspmPerResource: 5.00,         // Defender CSPM, per billable resource/mo
  resourceManager: 4.00,         // Per subscription/mo
  serversP1: 5.00,               // Per server/mo (EDR + recommendations)
  serversP2: 15.00,              // Per server/mo (P1 + agentless, FIM, JIT, free DNS)
  storagePerAccount: 10.00,      // Per storage account/mo (excl. malware scan GB)
  sqlOnMachinePerServer: 15.00,  // Per SQL Server VM/mo
  keyVaultPerVault: 2.00,        // Per vault/mo
  containersPerVCore: 7.00,      // Per Kubernetes vCore/mo
  appServicePerApp: 14.60,       // $0.02/hr × 730 ≈ $14.60/App/mo
} as const;

// Assumed counts for resources we don't yet model in the inventory.
// Adjustable by tier so Standard/Enterprise track realistic hub baselines.
const DEFENDER_ASSUMED_COUNTS: Record<LandingZoneTier, {
  storageAccounts: number;
  keyVaults: number;
  containerVCores: number;
  appServices: number;
}> = {
  none:       { storageAccounts: 0,  keyVaults: 0, containerVCores: 0, appServices: 0 },
  basic:      { storageAccounts: 0,  keyVaults: 0, containerVCores: 0, appServices: 0 },
  standard:   { storageAccounts: 5,  keyVaults: 1, containerVCores: 0, appServices: 0 },
  enterprise: { storageAccounts: 10, keyVaults: 2, containerVCores: 6, appServices: 2 },
};

export interface InventorySummary {
  vmCount: number;
  sqlVmCount: number;
}

export function summariseInventory(items: InventoryItem[]): InventorySummary {
  let vmCount = 0;
  let sqlVmCount = 0;
  for (const item of items) {
    vmCount += 1;
    if (item.hasDb || isSqlServer(item)) sqlVmCount += 1;
  }
  return { vmCount, sqlVmCount };
}

interface LzPresetLine {
  category: string;
  resource: string;
  sku: string;
  monthlyCost: number;
  unit: string;
  unitPrice: number;
  quantity: number;
  assumption: string;
}

const BASIC: LzPresetLine[] = [
  {
    category: "Landing Zone · Identity",
    resource: "Microsoft Entra ID — Free tier",
    sku: "entra-free",
    monthlyCost: 0, unit: "1/Month", unitPrice: 0, quantity: 1,
    assumption: "Free directory tier covers SSO + basic IAM for the LZ. Entra ID P1/P2 priced separately when MFA / Conditional Access / PIM is needed.",
  },
  {
    category: "Landing Zone · Management",
    resource: "Log Analytics workspace — 5 GB/mo ingestion",
    sku: "log-analytics-pay-as-you-go",
    monthlyCost: 12, unit: "1/Month", unitPrice: 12, quantity: 1,
    assumption: "5 GB/mo platform logs at $2.30/GB after the 5 GB free quota → ~$12 with short retention. Scale with workload growth.",
  },
  {
    category: "Landing Zone · Security",
    resource: "Microsoft Defender for Cloud — Free CSPM",
    sku: "defender-free",
    monthlyCost: 0, unit: "1/Month", unitPrice: 0, quantity: 1,
    assumption: "Free CSPM (security recommendations + secure score) included. Defender Servers/SQL/Storage plans priced per resource elsewhere.",
  },
  {
    category: "Landing Zone · Security",
    resource: "Azure Key Vault — Standard",
    sku: "keyvault-std",
    monthlyCost: 3, unit: "1/Month", unitPrice: 3, quantity: 1,
    assumption: "Standard vault. ~30k operations/month × $0.03/10k ≈ $0.10; padded to $3 to cover certificate ops and a small managed-HSM allowance.",
  },
  {
    category: "Landing Zone · Networking",
    resource: "Azure Bastion — Basic",
    sku: "bastion-basic",
    monthlyCost: 140, unit: "1 Hour", unitPrice: 0.19, quantity: 730,
    assumption: "Bastion Basic deployment-hour $0.19 × 730 hrs = $138.70. Single-instance internal RDP/SSH only (no host scaling).",
  },
  {
    category: "Landing Zone · Networking",
    resource: "Public IP — Standard × 1",
    sku: "public-ip-std",
    monthlyCost: 4, unit: "1 Hour", unitPrice: 0.005, quantity: 730,
    assumption: "Static Standard Public IP × 1 at $0.005/hr × 730 ≈ $3.65. Outbound IP for the hub.",
  },
];

const STANDARD: LzPresetLine[] = [
  // Inherits Basic except: Bastion upgrades to Standard, and the
  // Foundational-CSPM placeholder drops out (paid Defender CSPM
  // supersedes it via buildDefenderLines).
  ...BASIC.filter(
    (l) =>
      !l.resource.startsWith("Azure Bastion") &&
      !l.resource.includes("Defender for Cloud — Free"),
  ),
  {
    category: "Landing Zone · Networking",
    resource: "Azure Bastion — Standard",
    sku: "bastion-standard",
    monthlyCost: 220, unit: "1 Hour", unitPrice: 0.30, quantity: 730,
    assumption: "Bastion Standard $0.30/hr × 730 = $219 (host pool + 2 scale units assumed). Supports host scaling, native client, and IP-based connections.",
  },
  {
    category: "Landing Zone · Networking",
    resource: "Azure Firewall — Standard (deployment)",
    sku: "firewall-std-deploy",
    monthlyCost: 912, unit: "1 Hour", unitPrice: 1.25, quantity: 730,
    assumption: "Standard hub firewall deployment $1.25/hr × 730 = $912.50. Cluster of 2 underlying instances managed by Azure.",
  },
  {
    category: "Landing Zone · Networking",
    resource: "Azure Firewall — Data processed (1 TB/mo)",
    sku: "firewall-std-data",
    monthlyCost: 16, unit: "1 GB", unitPrice: 0.016, quantity: 1024,
    assumption: "1,024 GB × $0.016/GB. Tune to actual east-west + egress volume — many hub workloads land closer to 5–20 TB/mo.",
  },
  {
    category: "Landing Zone · Networking",
    resource: "VPN Gateway — VpnGw1 (S2S to on-prem)",
    sku: "vpn-vpngw1",
    monthlyCost: 140, unit: "1 Hour", unitPrice: 0.19, quantity: 730,
    assumption: "VpnGw1 ~$0.19/hr × 730 = $138.70. Egress to on-prem extra at $0.035–$0.087/GB (zone-dependent).",
  },
  {
    category: "Landing Zone · Networking",
    resource: "Application Gateway WAF v2 — small (2 capacity units)",
    sku: "appgw-waf-v2",
    monthlyCost: 247, unit: "1 Hour", unitPrice: 0.338, quantity: 730,
    assumption: "Fixed $0.246/hr × 730 = $180 + 2 capacity units × $0.0144/hr × 730 = $21. Add WAF policy charges for OWASP rule sets.",
  },
  {
    category: "Landing Zone · Networking",
    resource: "Private DNS Zones × 5",
    sku: "private-dns",
    monthlyCost: 3, unit: "1/Month", unitPrice: 0.50, quantity: 5,
    assumption: "5 zones × $0.50/zone = $2.50. ~1 M queries/mo at $0.40/M ≈ $0.40. Add zones for each private endpoint family in use.",
  },
  {
    category: "Landing Zone · Security",
    resource: "Microsoft Sentinel — PAYG (50 GB/mo)",
    sku: "sentinel-payg",
    monthlyCost: 230, unit: "1 GB", unitPrice: 4.60, quantity: 50,
    assumption: "50 GB ingestion × $4.60/GB (Sentinel + Log Analytics combined). Defender data sources flow in free where eligible.",
  },
  {
    category: "Landing Zone · Management",
    resource: "Log Analytics workspace — 50 GB/mo (upgrade)",
    sku: "log-analytics-50gb",
    monthlyCost: 115, unit: "1 GB", unitPrice: 2.30, quantity: 50,
    assumption: "50 GB × $2.30/GB after free quota ≈ $115. Replaces the 5 GB Basic-tier line.",
  },
];

const ENTERPRISE: LzPresetLine[] = [
  // Inherits Standard except Firewall upgrades to Premium.
  ...STANDARD.filter((l) => !l.resource.startsWith("Azure Firewall — Standard")),
  {
    category: "Landing Zone · Networking",
    resource: "Azure Firewall — Premium (deployment)",
    sku: "firewall-prem-deploy",
    monthlyCost: 1752, unit: "1 Hour", unitPrice: 2.40, quantity: 730,
    assumption: "Premium $2.40/hr × 730 = $1,752. Adds IDPS, TLS inspection, URL filtering. Replaces Firewall Standard.",
  },
  {
    category: "Landing Zone · Networking",
    resource: "ExpressRoute Circuit — Standard 1 Gbps (metered)",
    sku: "expressroute-std-1gbps",
    monthlyCost: 400, unit: "1/Month", unitPrice: 400, quantity: 1,
    assumption: "Metered Standard 1 Gbps circuit ≈ $400/mo port. Outbound zone-egress charged per GB extra; Premium add-on (global reach + larger routes) priced separately.",
  },
  {
    category: "Landing Zone · Networking",
    resource: "ExpressRoute Gateway — ErGw1AZ",
    sku: "expressroute-gw-ergw1az",
    monthlyCost: 330, unit: "1 Hour", unitPrice: 0.45, quantity: 730,
    assumption: "ErGw1AZ $0.45/hr × 730 = $328.50. Terminates the ExpressRoute circuit inside the hub VNet.",
  },
  {
    category: "Landing Zone · Security",
    resource: "Azure DDoS Network Protection",
    sku: "ddos-network",
    monthlyCost: 2944, unit: "1/Month", unitPrice: 2944, quantity: 1,
    assumption: "Tenant-level $2,944/mo flat covering the first 100 protected public IPs (each additional IP $30/mo).",
  },
  {
    category: "Landing Zone · Networking",
    resource: "Private Endpoints × 10",
    sku: "private-endpoint",
    monthlyCost: 73, unit: "1 Hour", unitPrice: 0.01, quantity: 7300,
    assumption: "10 endpoints × $0.01/hr × 730 = $73 + ~100 GB data processed at $0.01/GB ≈ $1. Scale with the number of PaaS services brought private.",
  },
];

const PRESETS: Record<LandingZoneTier, LzPresetLine[]> = {
  none: [],
  basic: BASIC,
  standard: STANDARD,
  enterprise: ENTERPRISE,
};

function presetToBomLine(
  l: LzPresetLine,
  region: string,
  appName: string,
  tag: string,
): BomLine {
  return {
    ...emptyBomLine(),
    category: l.category,
    resource: l.resource,
    sku: l.sku,
    meter: l.sku,
    region,
    quantity: l.quantity,
    unit: l.unit,
    unitPrice: l.unitPrice,
    monthlyCost: Math.round(l.monthlyCost * 100) / 100,
    currency: "USD",
    source: "lz-baseline",
    serviceName: l.category.replace(/^Landing Zone · /, ""),
    customName: appName ? `${appName}-LZ` : "Landing Zone",
    resourceCount: 1,
    billingTerm: "PAYG",
    assumption: `${l.assumption} ${tag}`,
  };
}

// Build the Defender for Cloud CWP/CSPM portion of the landing zone.
// CSPM and per-subscription plans are flat; Servers / SQL on Machines
// scale with the actual workload inventory so a 50-VM enterprise BOM
// reflects ~$750/mo Servers P2, not a static placeholder.
function buildDefenderLines(
  tier: LandingZoneTier,
  region: string,
  appName: string,
  inventory: InventorySummary,
  tag: string,
): BomLine[] {
  if (tier === "none" || tier === "basic") return [];
  const counts = DEFENDER_ASSUMED_COUNTS[tier];
  const { vmCount, sqlVmCount } = inventory;
  const cat = "Landing Zone · Security";
  const lines: LzPresetLine[] = [];

  // CSPM billable resources roughly = VMs + storage accounts + key vaults
  // (the public list is broader but this covers the dominant ones).
  const cspmResources = vmCount + counts.storageAccounts + counts.keyVaults;
  if (cspmResources > 0) {
    lines.push({
      category: cat,
      resource: `Microsoft Defender CSPM × ${cspmResources} billable resource${cspmResources === 1 ? "" : "s"}`,
      sku: "defender-cspm",
      monthlyCost: cspmResources * DEFENDER_PRICES.cspmPerResource,
      unit: "1/Month",
      unitPrice: DEFENDER_PRICES.cspmPerResource,
      quantity: cspmResources,
      assumption: `Defender CSPM (paid) at $${DEFENDER_PRICES.cspmPerResource.toFixed(2)}/billable resource × ${cspmResources} = $${(cspmResources * DEFENDER_PRICES.cspmPerResource).toFixed(2)}. Billable resources cover VMs (${vmCount}), storage accounts (${counts.storageAccounts}), and key vaults (${counts.keyVaults}); SQL/PostgreSQL/MySQL/Synapse also bill when present. Adds attack path analysis, agentless vulnerability scanning, regulatory compliance.`,
    });
  }

  // Defender for Resource Manager — fixed per-subscription.
  lines.push({
    category: cat,
    resource: "Microsoft Defender for Resource Manager × 1 subscription",
    sku: "defender-arm",
    monthlyCost: DEFENDER_PRICES.resourceManager,
    unit: "1/Month",
    unitPrice: DEFENDER_PRICES.resourceManager,
    quantity: 1,
    assumption: `Per-subscription plan at $${DEFENDER_PRICES.resourceManager.toFixed(2)}/mo. Detects malicious Resource Manager operations (suspicious ARM template deployments, unusual privilege grants).`,
  });

  // Defender for Servers — Plan 1 at Standard, Plan 2 at Enterprise.
  if (vmCount > 0) {
    const isP2 = tier === "enterprise";
    const perVm = isP2 ? DEFENDER_PRICES.serversP2 : DEFENDER_PRICES.serversP1;
    const planName = isP2 ? "Plan 2 (P2)" : "Plan 1 (P1)";
    const p2Features = isP2
      ? "Adds agentless disk scanning, file integrity monitoring, just-in-time VM access, regulatory compliance, free Defender for DNS, and 500 MB Sentinel ingestion benefit. "
      : "EDR-focused: Defender for Endpoint integration, alerts, software inventory. ";
    lines.push({
      category: cat,
      resource: `Microsoft Defender for Servers ${planName} × ${vmCount} VM${vmCount === 1 ? "" : "s"}`,
      sku: isP2 ? "defender-servers-p2" : "defender-servers-p1",
      monthlyCost: vmCount * perVm,
      unit: "1/Month",
      unitPrice: perVm,
      quantity: vmCount,
      assumption: `$${perVm.toFixed(2)}/VM/mo × ${vmCount} VMs = $${(vmCount * perVm).toFixed(2)}. ${p2Features}Auto-onboards via Defender for Endpoint — no Log Analytics agent required.`,
    });
  }

  // Defender for SQL on Machines — only meaningful at Enterprise where the
  // ALZ includes DB workloads under tight regulatory oversight. Counts
  // VMs flagged hasDb or named like SQL Server.
  if (tier === "enterprise" && sqlVmCount > 0) {
    lines.push({
      category: cat,
      resource: `Microsoft Defender for SQL on Machines × ${sqlVmCount} server${sqlVmCount === 1 ? "" : "s"}`,
      sku: "defender-sql-on-machines",
      monthlyCost: sqlVmCount * DEFENDER_PRICES.sqlOnMachinePerServer,
      unit: "1/Month",
      unitPrice: DEFENDER_PRICES.sqlOnMachinePerServer,
      quantity: sqlVmCount,
      assumption: `$${DEFENDER_PRICES.sqlOnMachinePerServer.toFixed(2)}/server/mo × ${sqlVmCount} SQL-bearing VMs = $${(sqlVmCount * DEFENDER_PRICES.sqlOnMachinePerServer).toFixed(2)}. Detects SQL-injection, brute-force, anomalous queries against on-VM SQL Server / PostgreSQL / MySQL.`,
    });
  }

  // Defender for Storage — flat per-account; assumed count per tier.
  if (counts.storageAccounts > 0) {
    const cost = counts.storageAccounts * DEFENDER_PRICES.storagePerAccount;
    lines.push({
      category: cat,
      resource: `Microsoft Defender for Storage × ${counts.storageAccounts} account${counts.storageAccounts === 1 ? "" : "s"}`,
      sku: "defender-storage",
      monthlyCost: cost,
      unit: "1/Month",
      unitPrice: DEFENDER_PRICES.storagePerAccount,
      quantity: counts.storageAccounts,
      assumption: `$${DEFENDER_PRICES.storagePerAccount.toFixed(2)}/storage account/mo × ${counts.storageAccounts} accounts (LZ assumption) = $${cost.toFixed(2)}. Malware scanning ($0.15/GB scanned, cappable) priced separately if enabled — tune the assumed account count to your actual storage footprint.`,
    });
  }

  // Defender for Key Vault — flat per-vault.
  if (counts.keyVaults > 0) {
    const cost = counts.keyVaults * DEFENDER_PRICES.keyVaultPerVault;
    lines.push({
      category: cat,
      resource: `Microsoft Defender for Key Vault × ${counts.keyVaults} vault${counts.keyVaults === 1 ? "" : "s"}`,
      sku: "defender-keyvault",
      monthlyCost: cost,
      unit: "1/Month",
      unitPrice: DEFENDER_PRICES.keyVaultPerVault,
      quantity: counts.keyVaults,
      assumption: `$${DEFENDER_PRICES.keyVaultPerVault.toFixed(2)}/vault/mo × ${counts.keyVaults} vault(s). Detects anomalous Key Vault access patterns.`,
    });
  }

  // Defender for Containers — Enterprise tier only, on an assumed cluster.
  if (counts.containerVCores > 0) {
    const cost = counts.containerVCores * DEFENDER_PRICES.containersPerVCore;
    lines.push({
      category: cat,
      resource: `Microsoft Defender for Containers × ${counts.containerVCores} vCores`,
      sku: "defender-containers",
      monthlyCost: cost,
      unit: "1/Month",
      unitPrice: DEFENDER_PRICES.containersPerVCore,
      quantity: counts.containerVCores,
      assumption: `$${DEFENDER_PRICES.containersPerVCore.toFixed(2)}/Kubernetes vCore/mo × ${counts.containerVCores} vCores (small AKS assumption). Adds Kubernetes hardening, vulnerability assessment, runtime threat detection. Remove this line when there's no Kubernetes footprint.`,
    });
  }

  // Defender for App Service — Enterprise tier only, on an assumed app count.
  if (counts.appServices > 0) {
    const cost = counts.appServices * DEFENDER_PRICES.appServicePerApp;
    lines.push({
      category: cat,
      resource: `Microsoft Defender for App Service × ${counts.appServices} app${counts.appServices === 1 ? "" : "s"}`,
      sku: "defender-app-service",
      monthlyCost: cost,
      unit: "1/Month",
      unitPrice: DEFENDER_PRICES.appServicePerApp,
      quantity: counts.appServices,
      assumption: `$${DEFENDER_PRICES.appServicePerApp.toFixed(2)}/App Service/mo ($0.02/hr × 730) × ${counts.appServices} apps (LZ assumption). Detects suspicious uploads, web shells, anomalous request patterns.`,
    });
  }

  return lines.map((l) => presetToBomLine(l, region, appName, tag));
}

export function buildLandingZoneBom(
  tier: LandingZoneTier,
  region: string,
  appName: string,
  inventory?: InventorySummary | InventoryItem[],
): BomLine[] {
  const preset = PRESETS[tier] ?? [];
  const tag = `(CAF ALZ ${tier} tier — East US 2 baseline; refine per-region usage)`;
  const inv: InventorySummary = Array.isArray(inventory)
    ? summariseInventory(inventory)
    : inventory ?? { vmCount: 0, sqlVmCount: 0 };
  const presetLines = preset.map((l) => presetToBomLine(l, region, appName, tag));
  const defenderLines = buildDefenderLines(tier, region, appName, inv, tag);
  return [...presetLines, ...defenderLines];
}
