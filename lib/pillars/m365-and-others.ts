// M365 & Others parametric pricing.
//
// M365 Backup/Archive, SharePoint Premium AI Builder, Copilot Studio.
// User-driven — all knobs default to a small-team baseline.

import { type BomLine, emptyBomLine } from "../models";

export interface M365AndOthersParams {
  /** M365 Backup user count. 0 drops the line. */
  m365BackupUsers?: number;
  /** M365 Archive GB stored. 0 drops the line. */
  m365ArchiveGb?: number;
  /** SharePoint Premium AI Builder — millions of credits. 0 drops. */
  sharePointAiBuilderMillionsCredits?: number;
  /** Copilot Studio message-pack count (25k messages each). 0 drops. */
  copilotStudioPackCount?: number;
}

export function buildM365AndOthersBom(
  region: string,
  appName: string,
  params: M365AndOthersParams = {},
): BomLine[] {
  const backupUsers = params.m365BackupUsers ?? 100;
  const archiveGb = params.m365ArchiveGb ?? 1000;
  const aiBuilderM = params.sharePointAiBuilderMillionsCredits ?? 1;
  const copilotPacks = params.copilotStudioPackCount ?? 1;

  const lines: BomLine[] = [];
  const tag = "(M365 & Others — global retail; tune user / message counts)";

  const push = (
    resource: string, sku: string, monthlyCost: number,
    unit: string, unitPrice: number, quantity: number, assumption: string,
  ) => {
    lines.push({
      ...emptyBomLine(),
      category: "M365 & Others", resource, sku, meter: sku, region,
      quantity, unit, unitPrice,
      monthlyCost: Math.round(monthlyCost * 100) / 100,
      currency: "USD", source: "m365-and-others-baseline",
      serviceName: "M365 & Others",
      customName: appName ? `${appName}-m365` : "M365 & Others",
      resourceCount: 1, billingTerm: "PAYG",
      assumption: `${assumption} ${tag}`,
    });
  };

  if (backupUsers > 0) {
    const cost = backupUsers * 3.5;
    push(
      `Microsoft 365 Backup — ${backupUsers} user${backupUsers === 1 ? "" : "s"}`, "m365-backup",
      cost, "1/Month", 3.5, backupUsers,
      `$3.50/user/mo × ${backupUsers} = $${cost.toFixed(2)}. Picked because native M365 retention covers operational recovery (item-level restore within 30-93 days) but NOT ransomware-grade backup, accidental tenant-wide deletion, or 7-year compliance archives — that gap is exactly what M365 Backup fills. Step away when your compliance regime allows native Recoverable Items + Litigation Hold for everyone. What's NOT included: long-term immutable copies to third-party vaults, restore-test exercises, BYO-storage targets (everything stays in MS cloud).`,
    );
  }
  if (archiveGb > 0) {
    const cost = archiveGb * 0.05;
    push(
      `Microsoft 365 Archive — ${archiveGb.toLocaleString()} GB`, "m365-archive",
      cost, "1 GB", 0.05, archiveGb,
      `$0.05/GB/mo × ${archiveGb} GB = $${cost.toFixed(2)}. Picked because Archive is for inactive SharePoint sites (last modified >90 days ago) — pricing is ~6× cheaper than active SharePoint storage ($0.30/GB/mo). Pattern: keep active sites in standard storage; auto-archive aged sites; rehydrate only when needed at $0.60/GB. Step away if rehydration would be frequent — at >5 % monthly access, active storage is cheaper overall. What's NOT included: reactivation egress, third-party archival tools, Purview retention policy execution.`,
    );
  }
  if (aiBuilderM > 0) {
    const cost = aiBuilderM * 500;
    push(
      `SharePoint Premium — ${aiBuilderM}M AI Builder credits`, "sharepoint-premium-aibuilder",
      cost, "1M credits", 500, aiBuilderM,
      `$500/M credits × ${aiBuilderM}M = $${cost.toFixed(2)}. Picked because AI Builder credits power document translation, image extraction (OCR), prompt-based workflows in Power Platform / SharePoint — typical consumption: 200 credits per document translation, 100 per OCR, 20 per LLM prompt call. Step away to Azure OpenAI direct ($2.50/M tokens GPT-4o, equivalent to ~10k credits at 4 credits/token) when you're hitting millions of calls — direct API is ~5-10× cheaper at scale. What's NOT included: SharePoint Premium licence prerequisite (~$5/user/mo), Power Automate premium connectors.`,
    );
  }
  if (copilotPacks > 0) {
    const cost = copilotPacks * 200;
    push(
      `Copilot Studio — ${copilotPacks} message pack${copilotPacks === 1 ? "" : "s"} (${copilotPacks * 25}k msgs/mo)`,
      "copilot-studio",
      cost, "1/Month", 200, copilotPacks,
      `$200/25k messages × ${copilotPacks} packs = $${cost.toFixed(2)}. Picked message-pack pricing because it's reserved capacity — effective rate $0.008/msg vs PAYG at $0.01/msg, ~20 % cheaper. Use packs when monthly volume is predictable (>20k msgs/mo); use PAYG ($0.01/message) for pilot bots or unpredictable bursty traffic. Step toward Azure OpenAI direct when you're building chat UI yourself and don't need Copilot Studio's no-code authoring + connectors. What's NOT included: data sources (Dataverse, third-party connectors), Power Platform per-user licence prerequisite.`,
    );
  }
  return lines;
}
