// M365 & Others baseline pricing.
//
// Covers Microsoft 365 Backup/Archive, SharePoint Premium, Copilot
// Studio messages, and generic Azure Marketplace SaaS line items.
// East US 2 / global USD list rates, late 2025. User counts default
// to 100 — override in the customer's own export.

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
    resource: "Microsoft 365 Backup — 100 users",
    sku: "m365-backup",
    monthlyCost: 350.00, unit: "1/Month", unitPrice: 3.50, quantity: 100,
    assumption: "$3.50/user/mo for Exchange + OneDrive + SharePoint backup. Default 100 users; scale linearly.",
  },
  {
    resource: "Microsoft 365 Archive — 1 TB inactive data",
    sku: "m365-archive",
    monthlyCost: 35.84, unit: "1 GB", unitPrice: 0.05, quantity: 1024 / 1.43,
    assumption: "$0.05/GB/mo for archived SharePoint sites (after the 90-day cold period). Reactivation $0.60/GB.",
  },
  {
    resource: "SharePoint Premium — 1M AI Builder credits",
    sku: "sharepoint-premium-aibuilder",
    monthlyCost: 500.00, unit: "1M credits", unitPrice: 500, quantity: 1,
    assumption: "$500/M AI Builder credits. Document translation, image extraction, prompt-based workflows.",
  },
  {
    resource: "Copilot Studio — 25k messages/mo",
    sku: "copilot-studio-25k",
    monthlyCost: 200.00, unit: "1/Month", unitPrice: 200, quantity: 1,
    assumption: "Copilot Studio message pack $200/25k messages/mo. PAYG also available at $0.01/message.",
  },
];

export function buildM365AndOthersBom(region: string, appName: string): BomLine[] {
  const tag = "(M365 & Others baseline — global retail; tune user counts)";
  return PRESETS.map((p) => ({
    ...emptyBomLine(),
    category: "M365 & Others",
    resource: p.resource,
    sku: p.sku,
    meter: p.sku,
    region,
    quantity: p.quantity,
    unit: p.unit,
    unitPrice: p.unitPrice,
    monthlyCost: Math.round(p.monthlyCost * 100) / 100,
    currency: "USD",
    source: "m365-and-others-baseline",
    serviceName: "M365 & Others",
    customName: appName ? `${appName}-m365` : "M365 & Others",
    resourceCount: 1,
    billingTerm: "PAYG",
    assumption: `${p.assumption} ${tag}`,
  }));
}
