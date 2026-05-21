// Azure CAF "Landing Zone" platform components.
//
// CAF / Enterprise-Scale recommends every Azure tenant deploy a platform
// landing zone (hub) before lighting up application workloads. The hub is
// shared across every Solution Area — lift-shift, modernization, data &
// AI all sit on top of the same Bastion / Firewall / Log Analytics /
// Defender / ExpressRoute / DDoS substrate.
//
// Three opinionated tiers are exposed in Stage 3:
//   - basic       — POC / small workload. Public IP + VPN + App GW + Defender Servers P1.
//   - standard    — production hub-spoke. Adds Bastion Std, Firewall Std, Key Vault,
//                   Private DNS, plus Defender CSPM/CWP scaled by inventory.
//   - enterprise  — full ALZ. Firewall Premium, ExpressRoute, DDoS Network Protection,
//                   Private Endpoints, Sentinel + Log Analytics SOC, Servers P2.
//
// Each tier expands into a SET of component ids (see LZ_TIER_COMPONENTS).
// The UI surfaces a "Customize components" checkbox that lets the user
// pick exactly which ids to include — so a Standard customer can drop
// VPN Gateway, or a Basic customer can add Sentinel, without abandoning
// the tier-as-shorthand mental model.
//
// Prices are East US 2 USD list rates (Microsoft public retail, late
// 2025). Each line carries an explicit assumption string so customers
// can refine per-region or per-usage in their own export.
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
  basic: "Standard Public IP, VPN Gateway VpnGw1 (S2S to on-prem), Application Gateway WAF v2, and Defender for Servers Plan 1 scaled by VM count. Minimum hybrid hub for POC / small workload.",
  standard: "Adds hub-spoke: Azure Bastion Standard, Azure Firewall Standard (+ data processed), Key Vault, Private DNS zones. Defender CSPM + Resource Manager + Storage + Key Vault CWP plans scale with the inventory; Servers stays on Plan 1. SOC (Sentinel + Log Analytics) joins at Enterprise. Recommended production baseline.",
  enterprise: "Full ALZ: Firewall Premium (replaces Std), ExpressRoute circuit + gateway, DDoS Network Protection, 10× Private Endpoints. Defender for Servers upgrades to P2 (adds agentless scanning, FIM, JIT, free DNS), plus Defender for SQL on Machines (scaled to DB-hosting VMs), Containers, and App Service. Required for regulated / multi-region landings.",
};

// ────────────────────────────────────────────────────────────────────
// Component catalogue
// ────────────────────────────────────────────────────────────────────

export type LzCategory = "Networking" | "Security" | "Management" | "Defender for Cloud";

export interface LzComponent {
  id: string;
  category: LzCategory;
  label: string;
  description: string;
}

export const LZ_COMPONENTS: LzComponent[] = [
  // Networking
  { id: "nw-public-ip-std",        category: "Networking", label: "Standard Public IP × 1",                   description: "Static Standard Public IP for the hub outbound path." },
  { id: "nw-vpn-vpngw1",           category: "Networking", label: "VPN Gateway VpnGw1 (S2S to on-prem)",      description: "Hybrid site-to-site VPN gateway connecting the hub to the on-premises network." },
  { id: "nw-appgw-waf-v2",         category: "Networking", label: "Application Gateway WAF v2 (small)",       description: "Internet-facing L7 ingress with WAF. Sized at 2 capacity units." },
  { id: "nw-bastion-std",          category: "Networking", label: "Azure Bastion — Standard",                 description: "Browser-based RDP/SSH to VMs without exposing public IPs. Supports host scaling." },
  { id: "nw-firewall-std-deploy",  category: "Networking", label: "Azure Firewall — Standard (deployment)",   description: "Hub firewall. Mutually exclusive with Firewall Premium." },
  { id: "nw-firewall-std-data",    category: "Networking", label: "Azure Firewall — Std data processed",      description: "Data processed by the Standard firewall. Default 1 TB/mo." },
  { id: "nw-firewall-prem-deploy", category: "Networking", label: "Azure Firewall — Premium (deployment)",    description: "Premium firewall with IDPS, TLS inspection, URL filtering. Replaces Standard." },
  { id: "nw-firewall-prem-data",   category: "Networking", label: "Azure Firewall — Premium data processed",  description: "Data processed by the Premium firewall. Default 1 TB/mo." },
  { id: "nw-private-dns",          category: "Networking", label: "Private DNS Zones",                        description: "Hub-managed private DNS zones for private endpoints. Default 5 zones." },
  { id: "nw-expressroute-circuit", category: "Networking", label: "ExpressRoute Circuit — Std 1 Gbps",        description: "Metered Standard ExpressRoute circuit, 1 Gbps." },
  { id: "nw-expressroute-gw",      category: "Networking", label: "ExpressRoute Gateway — ErGw1AZ",           description: "Terminates the ExpressRoute circuit inside the hub VNet." },
  { id: "nw-private-endpoints",    category: "Networking", label: "Private Endpoints",                        description: "Private endpoints into PaaS services. Default 10." },

  // Security (non-Defender)
  { id: "sec-key-vault-std",       category: "Security",   label: "Azure Key Vault — Standard",               description: "Hub-managed secrets / certs / TLS keys." },
  { id: "sec-ddos-network",        category: "Security",   label: "Azure DDoS Network Protection",            description: "Tenant-wide DDoS Network Protection plan." },
  { id: "sec-sentinel-payg",       category: "Security",   label: "Microsoft Sentinel — PAYG",                description: "Cloud-native SIEM/SOAR. Default ingestion 50 GB/mo." },

  // Management
  { id: "mgmt-log-analytics-50gb", category: "Management", label: "Log Analytics workspace",                  description: "Central observability workspace. Default 50 GB/mo ingestion." },

  // Defender for Cloud
  { id: "def-cspm",                category: "Defender for Cloud", label: "Defender CSPM (paid)",             description: "Attack-path analysis, agentless vuln scanning, regulatory compliance. Scaled by billable resources (VMs + storage + KV)." },
  { id: "def-resource-manager",    category: "Defender for Cloud", label: "Defender for Resource Manager",    description: "Per-subscription plan detecting suspicious ARM operations." },
  { id: "def-servers-p1",          category: "Defender for Cloud", label: "Defender for Servers — Plan 1",    description: "EDR-focused: Defender for Endpoint, alerts, software inventory. Per VM." },
  { id: "def-servers-p2",          category: "Defender for Cloud", label: "Defender for Servers — Plan 2",    description: "P1 + agentless scanning, FIM, JIT, free DNS, 500 MB Sentinel ingestion. Per VM." },
  { id: "def-sql-on-machines",     category: "Defender for Cloud", label: "Defender for SQL on Machines",     description: "SQL Server / Postgres / MySQL on VMs. Scaled by DB-flagged VM count." },
  { id: "def-storage",             category: "Defender for Cloud", label: "Defender for Storage",             description: "Storage account threat detection. Default 5–10 accounts per tier." },
  { id: "def-keyvault",            category: "Defender for Cloud", label: "Defender for Key Vault",           description: "Anomalous Key Vault access patterns. Default 1–2 vaults per tier." },
  { id: "def-containers",          category: "Defender for Cloud", label: "Defender for Containers",          description: "Kubernetes hardening + runtime threat detection. Default 6 vCores." },
  { id: "def-app-service",         category: "Defender for Cloud", label: "Defender for App Service",         description: "App Service threat detection. Default 2 apps." },
];

const LZ_COMPONENT_INDEX: Map<string, LzComponent> = new Map(LZ_COMPONENTS.map((c) => [c.id, c]));

export function getLzComponent(id: string): LzComponent | undefined {
  return LZ_COMPONENT_INDEX.get(id);
}

// Tier → default component-id set. The UI starts the customise checklist
// from this and lets the user toggle on/off from there.
export const LZ_TIER_COMPONENTS: Record<LandingZoneTier, string[]> = {
  none: [],
  basic: ["nw-public-ip-std", "nw-vpn-vpngw1", "nw-appgw-waf-v2", "def-servers-p1"],
  standard: [
    "nw-public-ip-std", "nw-vpn-vpngw1", "nw-appgw-waf-v2",
    "nw-bastion-std", "nw-firewall-std-deploy", "nw-firewall-std-data", "nw-private-dns",
    "sec-key-vault-std",
    "def-cspm", "def-resource-manager", "def-servers-p1", "def-storage", "def-keyvault",
  ],
  enterprise: [
    "nw-public-ip-std", "nw-vpn-vpngw1", "nw-appgw-waf-v2",
    "nw-bastion-std", "nw-private-dns",
    "nw-firewall-prem-deploy", "nw-firewall-prem-data",
    "nw-expressroute-circuit", "nw-expressroute-gw", "nw-private-endpoints",
    "sec-key-vault-std", "sec-ddos-network", "sec-sentinel-payg",
    "mgmt-log-analytics-50gb",
    "def-cspm", "def-resource-manager", "def-servers-p2",
    "def-sql-on-machines", "def-storage", "def-keyvault", "def-containers", "def-app-service",
  ],
};

// ────────────────────────────────────────────────────────────────────
// Quantity defaults & pricing
// ────────────────────────────────────────────────────────────────────

export interface LandingZoneParams {
  firewallDataGbPerMonth?: number;
  privateDnsZoneCount?: number;
  privateEndpointCount?: number;
  storageAccountCount?: number;
  keyVaultCount?: number;
  containerVCoreCount?: number;
  appServiceCount?: number;
  sentinelGbPerMonth?: number;
  logAnalyticsGbPerMonth?: number;
}

interface ResolvedParams {
  firewallDataGbPerMonth: number;
  privateDnsZoneCount: number;
  privateEndpointCount: number;
  storageAccountCount: number;
  keyVaultCount: number;
  containerVCoreCount: number;
  appServiceCount: number;
  sentinelGbPerMonth: number;
  logAnalyticsGbPerMonth: number;
}

function resolveParams(p: LandingZoneParams | undefined, tier: LandingZoneTier): ResolvedParams {
  const enterprise = tier === "enterprise";
  const standard = tier === "standard";
  return {
    firewallDataGbPerMonth: p?.firewallDataGbPerMonth ?? 1024,
    privateDnsZoneCount: p?.privateDnsZoneCount ?? 5,
    privateEndpointCount: p?.privateEndpointCount ?? 10,
    storageAccountCount: p?.storageAccountCount ?? (enterprise ? 10 : standard ? 5 : 0),
    keyVaultCount: p?.keyVaultCount ?? (enterprise ? 2 : standard ? 1 : 0),
    containerVCoreCount: p?.containerVCoreCount ?? (enterprise ? 6 : 0),
    appServiceCount: p?.appServiceCount ?? (enterprise ? 2 : 0),
    sentinelGbPerMonth: p?.sentinelGbPerMonth ?? 50,
    logAnalyticsGbPerMonth: p?.logAnalyticsGbPerMonth ?? 50,
  };
}

const DEFENDER_PRICES = {
  cspmPerResource: 5.00,
  resourceManager: 4.00,
  serversP1: 5.00,
  serversP2: 15.00,
  storagePerAccount: 10.00,
  sqlOnMachinePerServer: 15.00,
  keyVaultPerVault: 2.00,
  containersPerVCore: 7.00,
  appServicePerApp: 14.60,
} as const;

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

// ────────────────────────────────────────────────────────────────────
// Line builders — one function per component id
// ────────────────────────────────────────────────────────────────────

interface LineMeta {
  category: string;
  resource: string;
  sku: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  monthlyCost: number;
  assumption: string;
}

// id → (params, inventory) ⇒ LineMeta | null
type LineFactory = (p: ResolvedParams, inv: InventorySummary) => LineMeta | null;

const FACTORIES: Record<string, LineFactory> = {
  "nw-public-ip-std": () => ({
    category: "Landing Zone · Networking",
    resource: "Public IP — Standard × 1",
    sku: "public-ip-std",
    unit: "1 Hour", unitPrice: 0.005, quantity: 730, monthlyCost: 4,
    assumption: "Static Standard Public IP × 1 at $0.005/hr × 730 ≈ $3.65. Outbound IP for the hub.",
  }),
  "nw-vpn-vpngw1": () => ({
    category: "Landing Zone · Networking",
    resource: "VPN Gateway — VpnGw1 (S2S to on-prem)",
    sku: "vpn-vpngw1",
    unit: "1 Hour", unitPrice: 0.19, quantity: 730, monthlyCost: 140,
    assumption: "VpnGw1 ~$0.19/hr × 730 = $138.70. Egress to on-prem extra at $0.035–$0.087/GB (zone-dependent).",
  }),
  "nw-appgw-waf-v2": () => ({
    category: "Landing Zone · Networking",
    resource: "Application Gateway WAF v2 — small (2 capacity units)",
    sku: "appgw-waf-v2",
    unit: "1 Hour", unitPrice: 0.338, quantity: 730, monthlyCost: 247,
    assumption: "Fixed $0.246/hr × 730 = $180 + 2 capacity units × $0.0144/hr × 730 = $21. Add WAF policy charges for OWASP rule sets.",
  }),
  "nw-bastion-std": () => ({
    category: "Landing Zone · Networking",
    resource: "Azure Bastion — Standard",
    sku: "bastion-standard",
    unit: "1 Hour", unitPrice: 0.30, quantity: 730, monthlyCost: 220,
    assumption: "Bastion Standard $0.30/hr × 730 = $219 (host pool + 2 scale units assumed). Supports host scaling, native client, and IP-based connections.",
  }),
  "nw-firewall-std-deploy": () => ({
    category: "Landing Zone · Networking",
    resource: "Azure Firewall — Standard (deployment)",
    sku: "firewall-std-deploy",
    unit: "1 Hour", unitPrice: 1.25, quantity: 730, monthlyCost: 912,
    assumption: "Standard hub firewall deployment $1.25/hr × 730 = $912.50. Cluster of 2 underlying instances managed by Azure.",
  }),
  "nw-firewall-std-data": (p) => {
    const gb = p.firewallDataGbPerMonth;
    return {
      category: "Landing Zone · Networking",
      resource: `Azure Firewall — Std data processed (${gb.toLocaleString()} GB/mo)`,
      sku: "firewall-std-data",
      unit: "1 GB", unitPrice: 0.016, quantity: gb, monthlyCost: gb * 0.016,
      assumption: `${gb.toLocaleString()} GB × $0.016/GB. Adjust the data parameter to match your actual east-west + egress volume.`,
    };
  },
  "nw-firewall-prem-deploy": () => ({
    category: "Landing Zone · Networking",
    resource: "Azure Firewall — Premium (deployment)",
    sku: "firewall-prem-deploy",
    unit: "1 Hour", unitPrice: 2.40, quantity: 730, monthlyCost: 1752,
    assumption: "Premium $2.40/hr × 730 = $1,752. Adds IDPS, TLS inspection, URL filtering. Replaces Firewall Standard.",
  }),
  "nw-firewall-prem-data": (p) => {
    const gb = p.firewallDataGbPerMonth;
    return {
      category: "Landing Zone · Networking",
      resource: `Azure Firewall — Premium data processed (${gb.toLocaleString()} GB/mo)`,
      sku: "firewall-prem-data",
      unit: "1 GB", unitPrice: 0.016, quantity: gb, monthlyCost: gb * 0.016,
      assumption: `${gb.toLocaleString()} GB × $0.016/GB. Premium firewall data is billed at the same per-GB rate as Standard.`,
    };
  },
  "nw-private-dns": (p) => {
    const n = p.privateDnsZoneCount;
    return {
      category: "Landing Zone · Networking",
      resource: `Private DNS Zones × ${n}`,
      sku: "private-dns",
      unit: "1/Month", unitPrice: 0.50, quantity: n, monthlyCost: n * 0.5,
      assumption: `${n} zones × $0.50/zone. Add zones for each private endpoint family in use.`,
    };
  },
  "nw-expressroute-circuit": () => ({
    category: "Landing Zone · Networking",
    resource: "ExpressRoute Circuit — Standard 1 Gbps (metered)",
    sku: "expressroute-std-1gbps",
    unit: "1/Month", unitPrice: 400, quantity: 1, monthlyCost: 400,
    assumption: "Metered Standard 1 Gbps circuit ≈ $400/mo port. Outbound zone-egress charged per GB extra; Premium add-on priced separately.",
  }),
  "nw-expressroute-gw": () => ({
    category: "Landing Zone · Networking",
    resource: "ExpressRoute Gateway — ErGw1AZ",
    sku: "expressroute-gw-ergw1az",
    unit: "1 Hour", unitPrice: 0.45, quantity: 730, monthlyCost: 330,
    assumption: "ErGw1AZ $0.45/hr × 730 = $328.50. Terminates the ExpressRoute circuit inside the hub VNet.",
  }),
  "nw-private-endpoints": (p) => {
    const n = p.privateEndpointCount;
    return {
      category: "Landing Zone · Networking",
      resource: `Private Endpoints × ${n}`,
      sku: "private-endpoint",
      unit: "1 Hour", unitPrice: 0.01, quantity: n * 730, monthlyCost: n * 0.01 * 730,
      assumption: `${n} endpoints × $0.01/hr × 730. Add ~$0.01/GB for data processed (excluded — usually a single-digit dollar adder).`,
    };
  },
  "sec-key-vault-std": () => ({
    category: "Landing Zone · Security",
    resource: "Azure Key Vault — Standard",
    sku: "keyvault-std",
    unit: "1/Month", unitPrice: 3, quantity: 1, monthlyCost: 3,
    assumption: "Standard vault for hub-managed secrets / certs / TLS. ~30k operations/month × $0.03/10k ≈ $0.10; padded to $3 for HSM-backed key allowance.",
  }),
  "sec-ddos-network": () => ({
    category: "Landing Zone · Security",
    resource: "Azure DDoS Network Protection",
    sku: "ddos-network",
    unit: "1/Month", unitPrice: 2944, quantity: 1, monthlyCost: 2944,
    assumption: "Tenant-level $2,944/mo flat covering the first 100 protected public IPs (each additional IP $30/mo).",
  }),
  "sec-sentinel-payg": (p) => {
    const gb = p.sentinelGbPerMonth;
    return {
      category: "Landing Zone · Security",
      resource: `Microsoft Sentinel — PAYG (${gb} GB/mo)`,
      sku: "sentinel-payg",
      unit: "1 GB", unitPrice: 4.60, quantity: gb, monthlyCost: gb * 4.6,
      assumption: `${gb} GB ingestion × $4.60/GB (Sentinel + Log Analytics combined). Defender data sources flow in free where eligible.`,
    };
  },
  "mgmt-log-analytics-50gb": (p) => {
    const gb = p.logAnalyticsGbPerMonth;
    return {
      category: "Landing Zone · Management",
      resource: `Log Analytics workspace — ${gb} GB/mo`,
      sku: "log-analytics",
      unit: "1 GB", unitPrice: 2.30, quantity: gb, monthlyCost: gb * 2.3,
      assumption: `${gb} GB × $2.30/GB after the 5 GB free quota. Scale with workload growth.`,
    };
  },
  "def-cspm": (p, inv) => {
    const billable = inv.vmCount + p.storageAccountCount + p.keyVaultCount;
    if (billable === 0) return null;
    return {
      category: "Landing Zone · Security",
      resource: `Microsoft Defender CSPM × ${billable} billable resource${billable === 1 ? "" : "s"}`,
      sku: "defender-cspm",
      unit: "1/Month", unitPrice: DEFENDER_PRICES.cspmPerResource, quantity: billable,
      monthlyCost: billable * DEFENDER_PRICES.cspmPerResource,
      assumption: `Defender CSPM (paid) at $${DEFENDER_PRICES.cspmPerResource.toFixed(2)}/billable resource. VMs (${inv.vmCount}) + storage accounts (${p.storageAccountCount}) + key vaults (${p.keyVaultCount}). Adds attack path analysis, agentless vulnerability scanning, regulatory compliance.`,
    };
  },
  "def-resource-manager": () => ({
    category: "Landing Zone · Security",
    resource: "Microsoft Defender for Resource Manager × 1 subscription",
    sku: "defender-arm",
    unit: "1/Month", unitPrice: DEFENDER_PRICES.resourceManager, quantity: 1,
    monthlyCost: DEFENDER_PRICES.resourceManager,
    assumption: `Per-subscription plan at $${DEFENDER_PRICES.resourceManager.toFixed(2)}/mo. Detects malicious Resource Manager operations.`,
  }),
  "def-servers-p1": (_p, inv) => {
    if (inv.vmCount === 0) return null;
    return {
      category: "Landing Zone · Security",
      resource: `Microsoft Defender for Servers Plan 1 (P1) × ${inv.vmCount} VM${inv.vmCount === 1 ? "" : "s"}`,
      sku: "defender-servers-p1",
      unit: "1/Month", unitPrice: DEFENDER_PRICES.serversP1, quantity: inv.vmCount,
      monthlyCost: inv.vmCount * DEFENDER_PRICES.serversP1,
      assumption: `$${DEFENDER_PRICES.serversP1.toFixed(2)}/VM/mo × ${inv.vmCount} VMs. EDR-focused: Defender for Endpoint integration, alerts, software inventory.`,
    };
  },
  "def-servers-p2": (_p, inv) => {
    if (inv.vmCount === 0) return null;
    return {
      category: "Landing Zone · Security",
      resource: `Microsoft Defender for Servers Plan 2 (P2) × ${inv.vmCount} VM${inv.vmCount === 1 ? "" : "s"}`,
      sku: "defender-servers-p2",
      unit: "1/Month", unitPrice: DEFENDER_PRICES.serversP2, quantity: inv.vmCount,
      monthlyCost: inv.vmCount * DEFENDER_PRICES.serversP2,
      assumption: `$${DEFENDER_PRICES.serversP2.toFixed(2)}/VM/mo × ${inv.vmCount} VMs. Adds agentless disk scanning, file integrity monitoring, just-in-time VM access, regulatory compliance, free Defender for DNS.`,
    };
  },
  "def-sql-on-machines": (_p, inv) => {
    if (inv.sqlVmCount === 0) return null;
    return {
      category: "Landing Zone · Security",
      resource: `Microsoft Defender for SQL on Machines × ${inv.sqlVmCount} server${inv.sqlVmCount === 1 ? "" : "s"}`,
      sku: "defender-sql-on-machines",
      unit: "1/Month", unitPrice: DEFENDER_PRICES.sqlOnMachinePerServer, quantity: inv.sqlVmCount,
      monthlyCost: inv.sqlVmCount * DEFENDER_PRICES.sqlOnMachinePerServer,
      assumption: `$${DEFENDER_PRICES.sqlOnMachinePerServer.toFixed(2)}/server/mo × ${inv.sqlVmCount} SQL-bearing VMs. Detects SQL-injection, brute-force, anomalous queries.`,
    };
  },
  "def-storage": (p) => {
    const n = p.storageAccountCount > 0 ? p.storageAccountCount : 1;
    return {
      category: "Landing Zone · Security",
      resource: `Microsoft Defender for Storage × ${n} account${n === 1 ? "" : "s"}`,
      sku: "defender-storage",
      unit: "1/Month", unitPrice: DEFENDER_PRICES.storagePerAccount, quantity: n,
      monthlyCost: n * DEFENDER_PRICES.storagePerAccount,
      assumption: `$${DEFENDER_PRICES.storagePerAccount.toFixed(2)}/storage account/mo × ${n}. Malware scanning ($0.15/GB scanned, cappable) priced separately if enabled.`,
    };
  },
  "def-keyvault": (p) => {
    const n = p.keyVaultCount > 0 ? p.keyVaultCount : 1;
    return {
      category: "Landing Zone · Security",
      resource: `Microsoft Defender for Key Vault × ${n} vault${n === 1 ? "" : "s"}`,
      sku: "defender-keyvault",
      unit: "1/Month", unitPrice: DEFENDER_PRICES.keyVaultPerVault, quantity: n,
      monthlyCost: n * DEFENDER_PRICES.keyVaultPerVault,
      assumption: `$${DEFENDER_PRICES.keyVaultPerVault.toFixed(2)}/vault/mo × ${n}. Detects anomalous Key Vault access patterns.`,
    };
  },
  "def-containers": (p) => {
    const n = p.containerVCoreCount > 0 ? p.containerVCoreCount : 1;
    return {
      category: "Landing Zone · Security",
      resource: `Microsoft Defender for Containers × ${n} vCores`,
      sku: "defender-containers",
      unit: "1/Month", unitPrice: DEFENDER_PRICES.containersPerVCore, quantity: n,
      monthlyCost: n * DEFENDER_PRICES.containersPerVCore,
      assumption: `$${DEFENDER_PRICES.containersPerVCore.toFixed(2)}/Kubernetes vCore/mo × ${n}. Adds Kubernetes hardening, vulnerability assessment, runtime threat detection.`,
    };
  },
  "def-app-service": (p) => {
    const n = p.appServiceCount > 0 ? p.appServiceCount : 1;
    return {
      category: "Landing Zone · Security",
      resource: `Microsoft Defender for App Service × ${n} app${n === 1 ? "" : "s"}`,
      sku: "defender-app-service",
      unit: "1/Month", unitPrice: DEFENDER_PRICES.appServicePerApp, quantity: n,
      monthlyCost: n * DEFENDER_PRICES.appServicePerApp,
      assumption: `$${DEFENDER_PRICES.appServicePerApp.toFixed(2)}/App Service/mo × ${n}. Detects suspicious uploads, web shells, anomalous request patterns.`,
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// Public builders
// ────────────────────────────────────────────────────────────────────

function metaToBomLine(meta: LineMeta, region: string, appName: string, tag: string): BomLine {
  return {
    ...emptyBomLine(),
    category: meta.category,
    resource: meta.resource,
    sku: meta.sku,
    meter: meta.sku,
    region,
    quantity: meta.quantity,
    unit: meta.unit,
    unitPrice: meta.unitPrice,
    monthlyCost: Math.round(meta.monthlyCost * 100) / 100,
    currency: "USD",
    source: "lz-baseline",
    serviceName: meta.category.replace(/^Landing Zone · /, ""),
    customName: appName ? `${appName}-LZ` : "Landing Zone",
    resourceCount: 1,
    billingTerm: "PAYG",
    assumption: `${meta.assumption} ${tag}`,
  };
}

export function buildLandingZoneBomFromComponents(
  componentIds: string[],
  region: string,
  appName: string,
  inventory: InventorySummary | InventoryItem[] | undefined,
  params?: LandingZoneParams,
  tierForDefaults: LandingZoneTier = "none",
): BomLine[] {
  const inv: InventorySummary = Array.isArray(inventory)
    ? summariseInventory(inventory)
    : inventory ?? { vmCount: 0, sqlVmCount: 0 };
  const p = resolveParams(params, tierForDefaults);
  const tag = `(CAF ALZ ${tierForDefaults === "none" ? "custom" : tierForDefaults} — East US 2 baseline; refine per-region usage)`;
  const out: BomLine[] = [];
  for (const id of componentIds) {
    const factory = FACTORIES[id];
    if (!factory) continue;
    const meta = factory(p, inv);
    if (!meta) continue;
    out.push(metaToBomLine(meta, region, appName, tag));
  }
  return out;
}

// Convenience wrapper used when the user picks a tier without
// customising — expands the tier's default component list.
export function buildLandingZoneBom(
  tier: LandingZoneTier,
  region: string,
  appName: string,
  inventory?: InventorySummary | InventoryItem[],
  params?: LandingZoneParams,
): BomLine[] {
  if (tier === "none") return [];
  return buildLandingZoneBomFromComponents(
    LZ_TIER_COMPONENTS[tier],
    region,
    appName,
    inventory,
    params,
    tier,
  );
}
