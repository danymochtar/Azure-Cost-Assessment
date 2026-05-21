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

import { type BomLine, emptyBomLine } from "../models";

export type LandingZoneTier = "none" | "basic" | "standard" | "enterprise";

export const LANDING_ZONE_LABELS: Record<LandingZoneTier, string> = {
  none: "No platform Landing Zone",
  basic: "Basic — POC / small workload",
  standard: "Standard — hub-spoke production",
  enterprise: "Enterprise-scale — full CAF ALZ",
};

export const LANDING_ZONE_DESCRIPTIONS: Record<LandingZoneTier, string> = {
  none: "Workload-only estimate. Use when the platform hub is already deployed and billed separately.",
  basic: "Bastion Basic, Key Vault, Log Analytics (5 GB), Defender Free, 1× Standard Public IP. Suitable for POC, sandbox, single-subscription dev environments.",
  standard: "Adds hub-spoke: Azure Firewall Standard, Bastion Standard, VPN Gateway VpnGw1, App Gateway WAF v2, Sentinel PAYG (50 GB), 50 GB Log Analytics, Private DNS zones. Recommended production baseline.",
  enterprise: "Full ALZ: Firewall Premium (replaces Std), ExpressRoute circuit + gateway, DDoS Network Protection, 10× Private Endpoints. Required for regulated / multi-region landings.",
};

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
  // Inherits Basic except Bastion upgrades to Standard.
  ...BASIC.filter((l) => !l.resource.startsWith("Azure Bastion")),
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

export function buildLandingZoneBom(
  tier: LandingZoneTier,
  region: string,
  appName: string,
): BomLine[] {
  const preset = PRESETS[tier] ?? [];
  const tag = `(CAF ALZ ${tier} tier — East US 2 baseline; refine per-region usage)`;
  return preset.map((l) => ({
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
  }));
}
