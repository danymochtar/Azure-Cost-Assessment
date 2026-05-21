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

export interface LandingZoneRecommendation {
  tier: LandingZoneTier;
  reason: string;
}

/**
 * Decide which Landing Zone tier the assessment should default to,
 * based on the AI classifier's complexity verdict plus the extracted
 * inventory shape. Implements the Microsoft CAF "right-size the hub"
 * heuristic so the user lands on a sensible default at Stage 3 —
 * they can still override.
 *
 * Two enterprise signals → Enterprise (full ALZ — DDoS, ExpressRoute,
 * Firewall Premium, Sentinel/SOC). One signal or moderate footprint →
 * Standard (production hub-spoke, the CAF default). Tiny footprint
 * with no HA / BCDR / security pillar → Basic (Bastion + VPN + App GW
 * + Defender Servers P1 only).
 */
export function recommendLandingZoneTier(input: {
  complexity?: "simple" | "moderate" | "complex";
  vmCount: number;
  haVmCount: number;
  sqlVmCount: number;
  enableBcdr: boolean;
  activePillars?: Iterable<string>;
}): LandingZoneRecommendation {
  const pillars = new Set(input.activePillars ?? []);

  const enterpriseSignals: string[] = [];
  if (input.complexity === "complex") {
    enterpriseSignals.push("classifier flagged the workload as complex");
  }
  if (input.vmCount >= 25) {
    enterpriseSignals.push(`${input.vmCount} VMs in scope (≥25 amortises Firewall Premium + DDoS)`);
  }
  if (input.enableBcdr) {
    enterpriseSignals.push("BCDR with Site Recovery is enabled (multi-region landing)");
  }
  if (input.haVmCount >= 3) {
    enterpriseSignals.push(`${input.haVmCount} HA-flagged workloads (mission-critical pattern)`);
  }
  if (input.sqlVmCount >= 3) {
    enterpriseSignals.push(`${input.sqlVmCount} DB-hosting VMs (regulated data stack — Defender for SQL + ExpressRoute justified)`);
  }
  if (pillars.has("azure_security")) {
    enterpriseSignals.push("Azure Security pillar in scope (full SOC = Sentinel + Defender CSPM)");
  }
  if (pillars.has("hybrid_multicloud")) {
    enterpriseSignals.push("Hybrid Multicloud scope (Arc cross-cloud needs the full hub)");
  }

  if (enterpriseSignals.length >= 2) {
    return {
      tier: "enterprise",
      reason: `Enterprise tier — ${enterpriseSignals.join("; ")}.`,
    };
  }

  // Basic — tiny footprint, no HA, no regulated workloads.
  const tinyFootprint =
    input.vmCount > 0 &&
    input.vmCount <= 5 &&
    input.complexity !== "complex" &&
    input.haVmCount === 0 &&
    input.sqlVmCount === 0 &&
    !input.enableBcdr &&
    !pillars.has("azure_security") &&
    !pillars.has("hybrid_multicloud");
  if (tinyFootprint) {
    return {
      tier: "basic",
      reason: `Basic tier — ${input.vmCount} VM${input.vmCount === 1 ? "" : "s"}, no HA / BCDR / regulated workloads, so the Public IP + VPN + App GW + Defender Servers P1 hub is enough.`,
    };
  }

  // Standard — CAF default for production hub-spoke.
  return {
    tier: "standard",
    reason: enterpriseSignals.length === 1
      ? `Standard tier — one enterprise signal (${enterpriseSignals[0]}) but not enough to justify Firewall Premium + DDoS yet. Step up to Enterprise if a second signal lands.`
      : "Standard tier — production hub-spoke default per CAF. Bastion Std + Firewall Std + Key Vault + Defender CSPM/Servers/Storage scaled to your inventory.",
  };
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
  /** How many distinct resources this line represents (e.g. 5 for
   *  "Defender Servers × 5 VMs"). Defaults to 1 for fixed-quantity
   *  hub components like Bastion. Displayed in the BOM table Qty col. */
  resourceCount?: number;
}

// id → (params, inventory) ⇒ LineMeta | null
type LineFactory = (p: ResolvedParams, inv: InventorySummary) => LineMeta | null;

const FACTORIES: Record<string, LineFactory> = {
  "nw-public-ip-std": () => ({
    category: "Landing Zone · Networking",
    resource: "Public IP — Standard × 1",
    sku: "public-ip-std",
    unit: "1 Hour", unitPrice: 0.005, quantity: 730, monthlyCost: 4,
    assumption: "Static Standard Public IP × 1 at $0.005/hr × 730 ≈ $3.65. Picked Standard because Basic IP is retired for new deployments. Step up to a /28 IP Prefix when you need ≥16 static IPs (cheaper than 16 individual IPs). NOT included: outbound data transfer, NAT Gateway charges if you front the IP with one.",
  }),
  "nw-vpn-vpngw1": () => ({
    category: "Landing Zone · Networking",
    resource: "VPN Gateway — VpnGw1 (S2S to on-prem)",
    sku: "vpn-vpngw1",
    unit: "1 Hour", unitPrice: 0.19, quantity: 730, monthlyCost: 140,
    assumption: "VpnGw1 ~$0.19/hr × 730 = $138.70. Picked VpnGw1 because it's the entry-level S2S gateway supporting 650 Mbps + 250 P2S clients — sufficient for most spoke connectivity. Step up to VpnGw2/3/4/5 for higher throughput (1/1.25/5/10 Gbps), or to ExpressRoute Gateway for private connectivity. NOT included: egress to on-prem ($0.035–$0.087/GB), point-to-site connection hours.",
  }),
  "nw-appgw-waf-v2": () => ({
    category: "Landing Zone · Networking",
    resource: "Application Gateway WAF v2 — small (2 capacity units)",
    sku: "appgw-waf-v2",
    unit: "1 Hour", unitPrice: 0.338, quantity: 730, monthlyCost: 247,
    assumption: "Fixed $0.246/hr × 730 = $180 + 2 capacity units × $0.0144/hr × 730 = $21 = ~$247/mo. Picked WAF v2 over Standard v2 because OWASP managed rules ship out of the box. Step up the capacity unit count when sustained throughput exceeds ~10 RPS per unit. NOT included: WAF policy charges for custom rule sets, processed-data egress, certificate management.",
  }),
  "nw-bastion-std": () => ({
    category: "Landing Zone · Networking",
    resource: "Azure Bastion — Standard",
    sku: "bastion-standard",
    unit: "1 Hour", unitPrice: 0.30, quantity: 730, monthlyCost: 220,
    assumption: "Bastion Standard $0.30/hr × 730 = $219 (host pool + 2 scale units assumed). Picked Standard over Basic because Basic blocks host scaling and native-client RDP/SSH. Step up to Premium for shareable links + session recording. NOT included: outbound data transfer past the 5 GB free tier ($0.087/GB).",
  }),
  "nw-firewall-std-deploy": () => ({
    category: "Landing Zone · Networking",
    resource: "Azure Firewall — Standard (deployment)",
    sku: "firewall-std-deploy",
    unit: "1 Hour", unitPrice: 1.25, quantity: 730, monthlyCost: 912,
    assumption: "Standard hub firewall deployment $1.25/hr × 730 = $912.50. Picked Standard because it covers L3-L7 filtering + threat intelligence — sufficient for most non-regulated workloads. Step up to Premium for IDPS, TLS inspection, URL filtering, web categories. NOT included: data processed at $0.016/GB (separate line); zone redundancy is included.",
  }),
  "nw-firewall-std-data": (p) => {
    const gb = p.firewallDataGbPerMonth;
    return {
      category: "Landing Zone · Networking",
      resource: `Azure Firewall — Std data processed (${gb.toLocaleString()} GB/mo)`,
      sku: "firewall-std-data",
      unit: "1 GB", unitPrice: 0.016, quantity: gb, monthlyCost: gb * 0.016,
      assumption: `${gb.toLocaleString()} GB × $0.016/GB. Picked Standard data rate ($0.016/GB) — same as Premium per-GB. Step up the data parameter to match observed east-west + egress volume; typical 50-VM hub lands closer to 3-10 TB/mo. NOT included: per-GB NAT charges (Standard hub uses Firewall's built-in NAT free).`,
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
      assumption: `${gb.toLocaleString()} GB × $0.016/GB. Premium firewall data billed at the same per-GB rate as Standard — the premium fee lives on the deployment hours. Step up the data parameter when TLS inspection or large east-west traffic pushes throughput past the default 1 TB/mo. NOT included: IDPS signature updates (free), URL filtering category lookups (free).`,
    };
  },
  "nw-private-dns": (p) => {
    const n = p.privateDnsZoneCount;
    return {
      category: "Landing Zone · Networking",
      resource: `Private DNS Zones × ${n}`,
      sku: "private-dns",
      unit: "1/Month", unitPrice: 0.50, quantity: n, monthlyCost: n * 0.5,
      assumption: `${n} zones × $0.50/zone. Picked dedicated zones because Private Endpoints need one zone per PaaS service family (privatelink.blob.core.windows.net, privatelink.database.windows.net, etc.). Step up the zone count by one per new PaaS family. NOT included: query charges ($0.40/1M after 1B free queries).`,
    };
  },
  "nw-expressroute-circuit": () => ({
    category: "Landing Zone · Networking",
    resource: "ExpressRoute Circuit — Standard 1 Gbps (metered)",
    sku: "expressroute-std-1gbps",
    unit: "1/Month", unitPrice: 400, quantity: 1, monthlyCost: 400,
    assumption: "Metered Standard 1 Gbps circuit ≈ $400/mo port. Picked metered over unlimited because most hybrid workloads stay under 5 TB/mo where metered is cheaper. Step up to the Premium add-on for global reach + larger route limits, or to unlimited billing when sustained egress > 10 TB/mo. NOT included: outbound zone-egress charged per GB; Premium add-on priced separately.",
  }),
  "nw-expressroute-gw": () => ({
    category: "Landing Zone · Networking",
    resource: "ExpressRoute Gateway — ErGw1AZ",
    sku: "expressroute-gw-ergw1az",
    unit: "1 Hour", unitPrice: 0.45, quantity: 730, monthlyCost: 330,
    assumption: "ErGw1AZ $0.45/hr × 730 = $328.50. Picked ErGw1AZ as the smallest zone-redundant SKU — handles 1 Gbps throughput. Step up to ErGw2AZ ($0.90/hr) for 2 Gbps or ErGw3AZ for 10 Gbps. NOT included: FastPath ($0.25/hr extra), data egress at the circuit level.",
  }),
  "nw-private-endpoints": (p) => {
    const n = p.privateEndpointCount;
    return {
      category: "Landing Zone · Networking",
      resource: `Private Endpoints × ${n}`,
      sku: "private-endpoint",
      unit: "1 Hour", unitPrice: 0.01, quantity: n * 730, monthlyCost: n * 0.01 * 730,
      assumption: `${n} endpoints × $0.01/hr × 730 ≈ $${(n * 7.3).toFixed(2)}/mo. Picked Private Endpoints because they pin PaaS access to the VNet (no public exposure) — required for compliance landings. Step up the count as new PaaS resources (Storage, SQL, Key Vault, ACR) come online; one endpoint per resource per subnet. NOT included: data-processed charge ($0.01/GB inbound + $0.01/GB outbound — usually a single-digit dollar adder), Private DNS zones (separate line).`,
    };
  },
  "sec-key-vault-std": () => ({
    category: "Landing Zone · Security",
    resource: "Azure Key Vault — Standard",
    sku: "keyvault-std",
    unit: "1/Month", unitPrice: 3, quantity: 1, monthlyCost: 3,
    assumption: "Standard vault for hub-managed secrets / certs / TLS. ~30k operations/month × $0.03/10k ≈ $0.10; padded to $3 for HSM-backed key allowance. Picked Standard because Premium ($1/key/mo + HSM ops) is only needed for FIPS 140-2 Level 2 or BYOK-into-Premium-SSD scenarios. Step up to Premium when you need HSM-backed keys for regulated workloads (PCI / FedRAMP / customer-managed keys). NOT included: certificate renewal fees from public CAs, advanced threat protection ($0.02/10k operations add-on).",
  }),
  "sec-ddos-network": () => ({
    category: "Landing Zone · Security",
    resource: "Azure DDoS Network Protection",
    sku: "ddos-network",
    unit: "1/Month", unitPrice: 2944, quantity: 1, monthlyCost: 2944,
    assumption: "Tenant-level $2,944/mo flat covering the first 100 protected public IPs (each additional IP $30/mo). Picked Network Protection because it covers an entire VNet (vs IP Protection which is per-IP, only cheaper below ~15 IPs). Step up to IP Protection only if you have <5 internet-facing IPs and want per-resource billing. NOT included: cost-protection SLA credits, rapid-response engagement (free with Network Protection but requires opening a ticket).",
  }),
  "sec-sentinel-payg": (p) => {
    const gb = p.sentinelGbPerMonth;
    return {
      category: "Landing Zone · Security",
      resource: `Microsoft Sentinel — PAYG (${gb} GB/mo)`,
      sku: "sentinel-payg",
      unit: "1 GB", unitPrice: 4.60, quantity: gb, monthlyCost: gb * 4.6,
      assumption: `${gb} GB ingestion × $4.60/GB (Sentinel + Log Analytics combined). Picked PAYG because Commitment Tiers only break even above ~100 GB/day (~3 TB/mo). Step up to a Commitment Tier (100 GB/day → $123/day flat, ~17% discount) once steady-state ingestion is predictable. NOT included: longer retention beyond 90 days ($0.10/GB/mo archive), Defender for Cloud free-eligible data flows automatically.`,
    };
  },
  "mgmt-log-analytics-50gb": (p) => {
    const gb = p.logAnalyticsGbPerMonth;
    return {
      category: "Landing Zone · Management",
      resource: `Log Analytics workspace — ${gb} GB/mo`,
      sku: "log-analytics",
      unit: "1 GB", unitPrice: 2.30, quantity: gb, monthlyCost: gb * 2.3,
      assumption: `${gb} GB × $2.30/GB after the 5 GB free quota. Picked PAYG because Commitment Tiers only break even at ≥100 GB/day. Step up to a Commitment Tier once steady-state ingestion is predictable, or layer Basic Logs ($0.50/GB ingestion + $0.005/GB query) for verbose / low-query telemetry. NOT included: extended retention beyond 31 days ($0.10/GB/mo), data export to Storage / Event Hub ($0.10/GB).`,
    };
  },
  "def-cspm": (p, inv) => {
    const billable = inv.vmCount + p.storageAccountCount + p.keyVaultCount;
    if (billable === 0) return null;
    return {
      category: "Landing Zone · Security",
      resource: "Microsoft Defender CSPM (paid)",
      sku: "defender-cspm",
      unit: "1/Month", unitPrice: DEFENDER_PRICES.cspmPerResource, quantity: billable,
      monthlyCost: billable * DEFENDER_PRICES.cspmPerResource,
      resourceCount: billable,
      assumption: `${billable} billable resource${billable === 1 ? "" : "s"} × $${DEFENDER_PRICES.cspmPerResource.toFixed(2)}/mo (VMs ${inv.vmCount} + storage accounts ${p.storageAccountCount} + key vaults ${p.keyVaultCount}). Picked paid CSPM because Foundational CSPM (free) lacks attack-path analysis, agentless scanning, and regulatory compliance dashboards. Step up to Defender CSPM for any compliance-driven landing (PCI/ISO/SOC2); stay on Foundational only for sandboxes. NOT included: data-plane workload plans (Servers/Storage/SQL — those are separate lines).`,
    };
  },
  "def-resource-manager": () => ({
    category: "Landing Zone · Security",
    resource: "Microsoft Defender for Resource Manager",
    sku: "defender-arm",
    unit: "1/Month", unitPrice: DEFENDER_PRICES.resourceManager, quantity: 1,
    monthlyCost: DEFENDER_PRICES.resourceManager,
    resourceCount: 1,
    assumption: `Per-subscription plan at $${DEFENDER_PRICES.resourceManager.toFixed(2)}/mo. Picked because it's the only ARM-control-plane detection (privilege escalation, suspicious template deploys, key exfiltration via Run Command). Step up by enabling on every prod subscription — the plan is cheap and noise-free. NOT included: response automation (wire Logic Apps / Sentinel playbooks separately).`,
  }),
  "def-servers-p1": (_p, inv) => {
    if (inv.vmCount === 0) return null;
    return {
      category: "Landing Zone · Security",
      resource: "Microsoft Defender for Servers Plan 1 (P1)",
      sku: "defender-servers-p1",
      unit: "1/Month", unitPrice: DEFENDER_PRICES.serversP1, quantity: inv.vmCount,
      monthlyCost: inv.vmCount * DEFENDER_PRICES.serversP1,
      resourceCount: inv.vmCount,
      assumption: `$${DEFENDER_PRICES.serversP1.toFixed(2)}/VM/mo × ${inv.vmCount} VM${inv.vmCount === 1 ? "" : "s"}. Picked P1 because it bundles Defender for Endpoint (MDE) EDR at ~half the price of standalone MDE for Servers licensing. Step up to P2 for agentless disk scanning, file-integrity monitoring (FIM), JIT VM access, and free Defender for DNS — required for most regulated landings. NOT included: vulnerability assessment for unmanaged servers, Arc-enabled non-Azure VM coverage costs the same.`,
    };
  },
  "def-servers-p2": (_p, inv) => {
    if (inv.vmCount === 0) return null;
    return {
      category: "Landing Zone · Security",
      resource: "Microsoft Defender for Servers Plan 2 (P2)",
      sku: "defender-servers-p2",
      unit: "1/Month", unitPrice: DEFENDER_PRICES.serversP2, quantity: inv.vmCount,
      monthlyCost: inv.vmCount * DEFENDER_PRICES.serversP2,
      resourceCount: inv.vmCount,
      assumption: `$${DEFENDER_PRICES.serversP2.toFixed(2)}/VM/mo × ${inv.vmCount} VM${inv.vmCount === 1 ? "" : "s"}. Picked P2 because it adds agentless disk scanning, FIM, JIT VM access, regulatory compliance dashboards, and free Defender for DNS — the enterprise baseline. Step down to P1 only for cost-sensitive dev/test where EDR alone is enough. NOT included: SQL on Machines (separate line), workload-specific add-ons.`,
    };
  },
  "def-sql-on-machines": (_p, inv) => {
    if (inv.sqlVmCount === 0) return null;
    return {
      category: "Landing Zone · Security",
      resource: "Microsoft Defender for SQL on Machines",
      sku: "defender-sql-on-machines",
      unit: "1/Month", unitPrice: DEFENDER_PRICES.sqlOnMachinePerServer, quantity: inv.sqlVmCount,
      monthlyCost: inv.sqlVmCount * DEFENDER_PRICES.sqlOnMachinePerServer,
      resourceCount: inv.sqlVmCount,
      assumption: `$${DEFENDER_PRICES.sqlOnMachinePerServer.toFixed(2)}/server/mo × ${inv.sqlVmCount} SQL-bearing VM${inv.sqlVmCount === 1 ? "" : "s"}. Picked Defender for SQL on Machines because SQL Server hosted on IaaS isn't covered by Defender for Servers' SQL detections. Step up by also enabling Defender for SQL on managed Azure SQL DBs / MIs (priced separately per DTU/vCore). NOT included: TDE / Always Encrypted (those are SQL features, not threat-detection).`,
    };
  },
  "def-storage": (p) => {
    const n = p.storageAccountCount > 0 ? p.storageAccountCount : 1;
    return {
      category: "Landing Zone · Security",
      resource: "Microsoft Defender for Storage",
      sku: "defender-storage",
      unit: "1/Month", unitPrice: DEFENDER_PRICES.storagePerAccount, quantity: n,
      monthlyCost: n * DEFENDER_PRICES.storagePerAccount,
      resourceCount: n,
      assumption: `$${DEFENDER_PRICES.storagePerAccount.toFixed(2)}/storage account/mo × ${n}. Picked per-storage-account plan because the per-transaction plan (legacy) costs more above ~1M ops/mo. Step up by enabling malware scanning ($0.15/GB scanned, with a daily/monthly cap) on accounts that ingest user uploads. NOT included: data-plane Azure Storage costs, sensitive-data discovery (covered by Defender CSPM).`,
    };
  },
  "def-keyvault": (p) => {
    const n = p.keyVaultCount > 0 ? p.keyVaultCount : 1;
    return {
      category: "Landing Zone · Security",
      resource: "Microsoft Defender for Key Vault",
      sku: "defender-keyvault",
      unit: "1/Month", unitPrice: DEFENDER_PRICES.keyVaultPerVault, quantity: n,
      monthlyCost: n * DEFENDER_PRICES.keyVaultPerVault,
      resourceCount: n,
      assumption: `$${DEFENDER_PRICES.keyVaultPerVault.toFixed(2)}/vault/mo × ${n}. Picked per-vault plan because the legacy per-transaction model overshot once vaults exceeded ~5M ops/mo. Step up by enabling on every vault holding production secrets / certs — the alert noise is low and integrates with Sentinel. NOT included: Key Vault data-plane operation charges, HSM-backed key pricing (Premium SKU only).`,
    };
  },
  "def-containers": (p) => {
    const n = p.containerVCoreCount > 0 ? p.containerVCoreCount : 1;
    return {
      category: "Landing Zone · Security",
      resource: "Microsoft Defender for Containers",
      sku: "defender-containers",
      unit: "1/Month", unitPrice: DEFENDER_PRICES.containersPerVCore, quantity: n,
      monthlyCost: n * DEFENDER_PRICES.containersPerVCore,
      resourceCount: n,
      assumption: `$${DEFENDER_PRICES.containersPerVCore.toFixed(2)}/Kubernetes vCore/mo × ${n}. Picked vCore-based pricing because it scales linearly with cluster size (no per-pod overhead). Step up the vCore count as the AKS node pool grows; Arc-enabled K8s on-prem clusters use the same meter. NOT included: registry-side scanning is included for ACR Premium but a separate Defender add-on for non-ACR registries; runtime EDR for non-K8s containers needs Defender for App Service or Servers.`,
    };
  },
  "def-app-service": (p) => {
    const n = p.appServiceCount > 0 ? p.appServiceCount : 1;
    return {
      category: "Landing Zone · Security",
      resource: "Microsoft Defender for App Service",
      sku: "defender-app-service",
      unit: "1/Month", unitPrice: DEFENDER_PRICES.appServicePerApp, quantity: n,
      monthlyCost: n * DEFENDER_PRICES.appServicePerApp,
      resourceCount: n,
      assumption: `$${DEFENDER_PRICES.appServicePerApp.toFixed(2)}/App Service/mo × ${n}. Picked because App Service workloads aren't covered by Defender for Servers (PaaS host fleet is Microsoft-managed). Step up by enabling on every prod web app — particularly those accepting file uploads or admin portals. NOT included: WAF (Front Door / App Gateway), upstream DDoS protection.`,
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
    resourceCount: meta.resourceCount ?? 1,
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
