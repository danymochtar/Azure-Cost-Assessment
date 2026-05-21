import { describe, expect, it } from "vitest";
import { buildModernizationBom } from "@/lib/pillars/modernization";
import { buildDataPlatformBom } from "@/lib/pillars/data-platform";
import { buildAiApplicationBom } from "@/lib/pillars/ai-application";
import { buildAzureSecurityBom } from "@/lib/pillars/azure-security";
import { buildHybridMulticloudBom } from "@/lib/pillars/hybrid-multicloud";
import { buildM365AndOthersBom } from "@/lib/pillars/m365-and-others";
import type { InventoryItem } from "@/lib/models";

function mkVm(name: string, hasDb = false): InventoryItem {
  return {
    name, vcpu: 2, memoryGb: 4, storageGb: 64,
    os: "Linux", environment: "prod", powerstate: "poweredOn",
    notes: "", disks: [], hasDb, hasHa: false,
  };
}

describe("Solution Area pillar baselines", () => {
  it.each([
    ["Infra Modernization", () => buildModernizationBom("eastus2", "Demo"), "Infra Modernization", "modernization-baseline"],
    ["Data Platform",       () => buildDataPlatformBom("eastus2", "Demo"), "Data Platform", "data-platform-baseline"],
    ["AI Application",      () => buildAiApplicationBom("eastus2", "Demo"), "AI Application", "ai-application-baseline"],
    ["Azure Security",      () => buildAzureSecurityBom("eastus2", "Demo"), "Azure Security", "azure-security-baseline"],
    ["M365 & Others",       () => buildM365AndOthersBom("eastus2", "Demo"), "M365 & Others", "m365-and-others-baseline"],
  ])("%s emits non-empty BOM tagged with the right source + category", (_label, build, category, source) => {
    const lines = build();
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l.category).toBe(category);
      expect(l.source).toBe(source);
      expect(l.region).toBe("eastus2");
    }
    const total = lines.reduce((s, l) => s + l.monthlyCost, 0);
    expect(total).toBeGreaterThan(0);
  });

  it("Hybrid Multicloud scales Arc SQL PAYG by DB-flagged VMs in the inventory", () => {
    const lines = buildHybridMulticloudBom(
      [mkVm("sql-1", true), mkVm("sql-2", true), mkVm("web", false)],
      "eastus2", "Demo",
    );
    const arcSql = lines.find((l) => l.resource.startsWith("Arc-enabled SQL Server PAYG"));
    expect(arcSql).toBeDefined();
    expect(arcSql!.resource).toContain("2 vCores");
  });

  describe("Parametric pricing", () => {
    it("AI Application scales linearly with OpenAI token volume", () => {
      const lo = buildAiApplicationBom("eastus2", "Demo", { openAiInputTokensMillions: 1, openAiOutputTokensMillions: 0, embeddingsTokensMillions: 0, aiSearchTier: "off", mlComputeHoursMonth: 0, docIntelligencePagesK: 0 });
      const hi = buildAiApplicationBom("eastus2", "Demo", { openAiInputTokensMillions: 10, openAiOutputTokensMillions: 0, embeddingsTokensMillions: 0, aiSearchTier: "off", mlComputeHoursMonth: 0, docIntelligencePagesK: 0 });
      const sum = (xs: { monthlyCost: number }[]) => xs.reduce((s,l)=>s+l.monthlyCost,0);
      expect(sum(hi)).toBeCloseTo(sum(lo) * 10, 2);
    });

    it("Data Platform Fabric F64 costs ~32× more than F2", () => {
      const f2 = buildDataPlatformBom("eastus2", "Demo", { fabricCapacity: "F2", sqlDbTier: "off", cosmosMillionRuPerMonth: 0, adlsGb: 0, dataFactoryUsd: 0, eventHubsTu: 0, redisTier: "off" });
      const f64 = buildDataPlatformBom("eastus2", "Demo", { fabricCapacity: "F64", sqlDbTier: "off", cosmosMillionRuPerMonth: 0, adlsGb: 0, dataFactoryUsd: 0, eventHubsTu: 0, redisTier: "off" });
      expect(f64[0].monthlyCost).toBeCloseTo(f2[0].monthlyCost * 32, 0);
    });

    it("Azure Security drops Entra line when tier is 'off'", () => {
      const off = buildAzureSecurityBom("eastus2", "Demo", { entraIdTier: "off" });
      expect(off.find((l) => l.resource.startsWith("Microsoft Entra ID"))).toBeUndefined();
    });

    it("Modernization drops Front Door when tier is 'off'", () => {
      const off = buildModernizationBom("eastus2", "Demo", { frontDoorTier: "off" });
      expect(off.find((l) => l.resource.startsWith("Azure Front Door"))).toBeUndefined();
    });

    it("M365 & Others scales linearly with backup user count", () => {
      const ten  = buildM365AndOthersBom("eastus2","Demo",{ m365BackupUsers: 10, m365ArchiveGb: 0, sharePointAiBuilderMillionsCredits: 0, copilotStudioPackCount: 0 });
      const hund = buildM365AndOthersBom("eastus2","Demo",{ m365BackupUsers: 100, m365ArchiveGb: 0, sharePointAiBuilderMillionsCredits: 0, copilotStudioPackCount: 0 });
      expect(hund[0].monthlyCost).toBeCloseTo(ten[0].monthlyCost * 10, 2);
    });
  });

  it("every baseline line carries a non-empty assumption (audit trail in Excel)", () => {
    for (const lines of [
      buildModernizationBom("eastus2", "Demo"),
      buildDataPlatformBom("eastus2", "Demo"),
      buildAiApplicationBom("eastus2", "Demo"),
      buildAzureSecurityBom("eastus2", "Demo"),
      buildHybridMulticloudBom([mkVm("v")], "eastus2", "Demo"),
      buildM365AndOthersBom("eastus2", "Demo"),
    ]) {
      for (const l of lines) {
        expect(l.assumption).toBeTruthy();
        expect(l.sku).toBeTruthy();
      }
    }
  });
});
