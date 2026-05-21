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
      `$3.50/user/mo for Exchange + OneDrive + SharePoint backup × ${backupUsers}.`,
    );
  }
  if (archiveGb > 0) {
    const cost = archiveGb * 0.05;
    push(
      `Microsoft 365 Archive — ${archiveGb.toLocaleString()} GB`, "m365-archive",
      cost, "1 GB", 0.05, archiveGb,
      `$0.05/GB/mo for archived SharePoint sites (after 90-day cold period). Reactivation $0.60/GB.`,
    );
  }
  if (aiBuilderM > 0) {
    const cost = aiBuilderM * 500;
    push(
      `SharePoint Premium — ${aiBuilderM}M AI Builder credits`, "sharepoint-premium-aibuilder",
      cost, "1M credits", 500, aiBuilderM,
      `$500/M AI Builder credits × ${aiBuilderM}M. Document translation, image extraction, prompt-based workflows.`,
    );
  }
  if (copilotPacks > 0) {
    const cost = copilotPacks * 200;
    push(
      `Copilot Studio — ${copilotPacks} message pack${copilotPacks === 1 ? "" : "s"} (${copilotPacks * 25}k msgs/mo)`,
      "copilot-studio",
      cost, "1/Month", 200, copilotPacks,
      `$200/25k messages/mo × ${copilotPacks} packs. PAYG also available at $0.01/message.`,
    );
  }
  return lines;
}
