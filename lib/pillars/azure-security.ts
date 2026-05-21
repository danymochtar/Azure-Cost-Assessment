// Azure Security pillar baseline pricing.
//
// Defender CSPM / CWP plans land on the Landing Zone tier (see
// lib/pillars/landing-zone.ts) so this module covers the security
// components OUTSIDE the LZ scope: WAF policies, Private Link, Purview,
// PIM, third-party Marketplace SOC integrations. East US 2 USD list
// rates, late 2025.

import { type BomLine, emptyBomLine } from "../models";

interface Preset {
  resource: string;
  sku: string;
  monthlyCost: number;
  unit: string;
  unitPrice: number;
  quantity: number;
  assumption: string;
}

const PRESETS: Preset[] = [
  {
    resource: "Microsoft Entra ID P2 — 50 users",
    sku: "entra-p2",
    monthlyCost: 450.00, unit: "1/Month", unitPrice: 9.00, quantity: 50,
    assumption: "$9/user/mo × 50 users. Includes Conditional Access, PIM, Identity Protection. Drop to P1 ($6/user) if PIM not required.",
  },
  {
    resource: "Microsoft Purview — Data Map (capacity unit)",
    sku: "purview-capacity-unit",
    monthlyCost: 411.00, unit: "1 Hour", unitPrice: 0.563, quantity: 730,
    assumption: "1 capacity unit ($0.563/hr × 730 = $411). Add per-asset metadata scan charges (~$1 per 1M scanned).",
  },
  {
    resource: "Azure Web Application Firewall — policy (prevention)",
    sku: "waf-policy",
    monthlyCost: 18.00, unit: "1/Month", unitPrice: 18.00, quantity: 1,
    assumption: "WAF policy with OWASP managed rule set. Attaches to Front Door / App Gateway; the deployment cost lives on those services.",
  },
  {
    resource: "Private Link — 5 private endpoints",
    sku: "private-link",
    monthlyCost: 36.50, unit: "1 Hour", unitPrice: 0.01, quantity: 3650,
    assumption: "5 endpoints × $0.01/hr × 730 hrs + ~$0.01/GB data processed (excluded; usually small).",
  },
  {
    resource: "Microsoft Sentinel — content hub solutions",
    sku: "sentinel-content-hub",
    monthlyCost: 0.00, unit: "1/Month", unitPrice: 0.00, quantity: 1,
    assumption: "First-party content hub solutions are free; third-party (e.g. Recorded Future, AbuseIPDB) priced per Marketplace listing.",
  },
];

export function buildAzureSecurityBom(region: string, appName: string): BomLine[] {
  const tag = "(Azure Security baseline — East US 2; Defender plans priced via Landing Zone tier)";
  return PRESETS.map((p) => ({
    ...emptyBomLine(),
    category: "Azure Security",
    resource: p.resource,
    sku: p.sku,
    meter: p.sku,
    region,
    quantity: p.quantity,
    unit: p.unit,
    unitPrice: p.unitPrice,
    monthlyCost: Math.round(p.monthlyCost * 100) / 100,
    currency: "USD",
    source: "azure-security-baseline",
    serviceName: "Azure Security",
    customName: appName ? `${appName}-security` : "Azure Security",
    resourceCount: 1,
    billingTerm: "PAYG",
    assumption: `${p.assumption} ${tag}`,
  }));
}
