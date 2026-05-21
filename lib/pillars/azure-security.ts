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
    push(
      `Microsoft Entra ID ${t.label} — ${entraUsers} users`, `entra-${entra}`,
      cost, "1/Month", t.rate, entraUsers,
      `$${t.rate.toFixed(2)}/user/mo × ${entraUsers} users. ${entra === "p2" ? "Includes Conditional Access, PIM, Identity Protection." : "Conditional Access + SSPR; PIM requires P2."}`,
    );
  }
  if (purviewCu > 0) {
    const cost = purviewCu * 0.563 * 730;
    push(
      `Microsoft Purview — Data Map (${purviewCu} capacity unit${purviewCu === 1 ? "" : "s"})`, "purview-capacity-unit",
      cost, "1 Hour", 0.563, 730 * purviewCu,
      `${purviewCu} × $0.563/hr × 730. Add per-asset metadata scan charges (~$1 per 1M scanned).`,
    );
  }
  if (wafCount > 0) {
    const cost = wafCount * 18;
    push(
      `Azure Web Application Firewall — ${wafCount} polic${wafCount === 1 ? "y" : "ies"}`, "waf-policy",
      cost, "1/Month", 18, wafCount,
      `WAF policies with OWASP managed rule set. Attaches to Front Door / App Gateway; the deployment cost lives on those services.`,
    );
  }
  if (peCount > 0) {
    const cost = peCount * 0.01 * 730;
    push(
      `Private Link — ${peCount} private endpoint${peCount === 1 ? "" : "s"}`, "private-link",
      cost, "1 Hour", 0.01, 730 * peCount,
      `${peCount} endpoints × $0.01/hr × 730 + ~$0.01/GB data processed (excluded).`,
    );
  }
  return lines;
}
