// Azure Security parametric pricing.
//
// Defender CSPM / CWP plans land on the Landing Zone tier; this module
// covers the components outside that scope: Entra ID licensing,
// Purview, WAF, Private Link, Sentinel content hub. East US 2 USD
// list rates, late 2025.

import { type BomLine, emptyBomLine } from "../models";

export interface AzureSecurityParams {
  /** Entra ID tier and licensed user count. "off" drops the line. */
  entraIdTier?: "off" | "p1" | "p2";
  entraIdUsers?: number;
  /** Purview capacity units. 0 drops the line. */
  purviewCapacityUnits?: number;
  /** WAF policy count. 0 drops the line. */
  wafPolicyCount?: number;
  /** Private endpoints count. 0 drops the line. */
  privateEndpointCount?: number;
}

const ENTRA_USER_RATE: Record<Exclude<NonNullable<AzureSecurityParams["entraIdTier"]>, "off">, { rate: number; label: string }> = {
  p1: { rate: 6.0,  label: "P1" },
  p2: { rate: 9.0,  label: "P2" },
};

/**
 * Derive AzureSecurityParams defaults from classifier signals.
 * Entra P1/P2 always defaults on (every Azure tenant has users to
 * license); Purview/WAF/Private Link only seed when the source
 * mentioned them.
 */
export function recommendAzureSecurityParams(signals: Iterable<string>): AzureSecurityParams {
  const s = new Set(signals);
  return {
    entraIdTier: s.has("pim") ? "p2" : "p1",
    entraIdUsers: 50,
    purviewCapacityUnits: s.has("purview") ? 1 : 0,
    wafPolicyCount: s.has("waf") ? 1 : 0,
    privateEndpointCount: s.has("private_link") ? 5 : 0,
  };
}

export function buildAzureSecurityBom(
  region: string,
  appName: string,
  params: AzureSecurityParams = {},
): BomLine[] {
  const entra = params.entraIdTier ?? "p2";
  const entraUsers = params.entraIdUsers ?? 50;
  const purviewCu = params.purviewCapacityUnits ?? 1;
  const wafCount = params.wafPolicyCount ?? 1;
  const peCount = params.privateEndpointCount ?? 5;

  const lines: BomLine[] = [];
  const tag = "(Azure Security — Defender plans priced via Landing Zone tier)";

  const push = (
    resource: string, sku: string, monthlyCost: number,
    unit: string, unitPrice: number, quantity: number, assumption: string,
  ) => {
    lines.push({
      ...emptyBomLine(),
      category: "Azure Security", resource, sku, meter: sku, region,
      quantity, unit, unitPrice,
      monthlyCost: Math.round(monthlyCost * 100) / 100,
      currency: "USD", source: "azure-security-baseline",
      serviceName: "Azure Security",
      customName: appName ? `${appName}-security` : "Azure Security",
      resourceCount: 1, billingTerm: "PAYG",
      assumption: `${assumption} ${tag}`,
    });
  };

  if (entra !== "off" && entraUsers > 0) {
    const t = ENTRA_USER_RATE[entra];
    const cost = t.rate * entraUsers;
    const entraFit = entra === "p2"
      ? "P2 — required for PIM (just-in-time privileged access), Identity Protection (risk-based Conditional Access), Access Reviews. License only the users who need PIM/IP — usually admins + privileged developers, not the whole tenant."
      : "P1 — Conditional Access, SSPR, group-based licence assignment, Cloud App Discovery. Sufficient for most knowledge workers; step up to P2 only for privileged accounts that need PIM.";
    push(
      `Microsoft Entra ID ${t.label} — ${entraUsers} users`, `entra-${entra}`,
      cost, "1/Month", t.rate, entraUsers,
      `$${t.rate.toFixed(2)}/user/mo × ${entraUsers} users = $${cost.toFixed(2)}. Picked because ${entraFit} Common pattern: P2 for ~10 % of users (admins, devs), P1 for the rest, free tier for guests. What's NOT included: Entra ID External Identities (per-MAU pricing), Entra ID Governance (separate licence for entitlement management / lifecycle workflows), Defender for Identity.`,
    );
  }
  if (purviewCu > 0) {
    const cost = purviewCu * 0.563 * 730;
    push(
      `Microsoft Purview — Data Map (${purviewCu} capacity unit${purviewCu === 1 ? "" : "s"})`, "purview-capacity-unit",
      cost, "1 Hour", 0.563, 730 * purviewCu,
      `${purviewCu} × $0.563/hr × 730 = $${cost.toFixed(2)}. Picked because 1 capacity unit = ~25 concurrent operations + ~10k assets in active catalog. Step up by 1 CU per ~25k additional assets. Pause the capacity off-hours to halve the bill — Purview supports stop/start without losing the catalog. What's NOT included: per-asset metadata scans (~$1/M assets scanned), data-quality rule executions, Insights workspaces, Data Estate Insights (separate SKU).`,
    );
  }
  if (wafCount > 0) {
    const cost = wafCount * 18;
    push(
      `Azure Web Application Firewall — ${wafCount} polic${wafCount === 1 ? "y" : "ies"}`, "waf-policy",
      cost, "1/Month", 18, wafCount,
      `WAF policies with OWASP managed rule set: ${wafCount} × $18/mo = $${cost.toFixed(2)}. Picked Standard WAF policy because the OWASP managed rule set covers the OWASP Top 10 without custom maintenance. Attach to Front Door (global, edge-blocked early) for public-facing ingress; attach to App Gateway (per-app, behind your VNet) for east-west or per-app rule sets. The compute cost lives on the gateway itself — this line is just the policy. What's NOT included: per-rule custom WAF (Premium tiers), bot management add-on, geo-block rule executions over the free quota.`,
    );
  }
  if (peCount > 0) {
    const cost = peCount * 0.01 * 730;
    push(
      `Private Link — ${peCount} private endpoint${peCount === 1 ? "" : "s"}`, "private-link",
      cost, "1 Hour", 0.01, 730 * peCount,
      `${peCount} endpoints × $0.01/hr × 730 = $${cost.toFixed(2)}. Picked because private endpoints are mandatory for PCI / HIPAA / regulated compliance regimes — they remove public-internet exposure from PaaS services. Step down (use service endpoints + NSG instead) if compliance allows; service endpoints are free but only filter at the subnet level, not the resource. What's NOT included: data processed (~$0.01/GB inbound + outbound), Private DNS Zone hosting ($0.50/zone), Private Link Service (separate SKU for publishing your own services).`,
    );
  }
  return lines;
}
