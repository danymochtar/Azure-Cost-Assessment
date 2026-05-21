import { describe, expect, it } from "vitest";
import { buildModernizationBom, recommendModernizationParams } from "@/lib/pillars/modernization";
import { buildDataPlatformBom, recommendDataPlatformParams } from "@/lib/pillars/data-platform";
import { buildAiApplicationBom, recommendAiApplicationParams } from "@/lib/pillars/ai-application";
import { buildAzureSecurityBom, recommendAzureSecurityParams } from "@/lib/pillars/azure-security";
import { buildHybridMulticloudBom, recommendHybridMulticloudParams } from "@/lib/pillars/hybrid-multicloud";
import { buildM365AndOthersBom, recommendM365AndOthersParams } from "@/lib/pillars/m365-and-others";
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

  describe("Justification — assumption shape regression guard", () => {
    // Every emitted line on every active pillar must defend its SKU pick.
    // The "Picked because" + exclusion markers are the contract: if they
    // regress, the BOM stops being defensible to a customer architect.
    const samples: Array<[string, () => Array<{ assumption: string; resource: string }>]> = [
      ["modernization", () => buildModernizationBom("eastus2", "Demo")],
      ["data-platform", () => buildDataPlatformBom("eastus2", "Demo")],
      ["ai-application", () => buildAiApplicationBom("eastus2", "Demo")],
      ["azure-security", () => buildAzureSecurityBom("eastus2", "Demo")],
      ["hybrid-multicloud", () => buildHybridMulticloudBom([mkVm("v", true)], "eastus2", "Demo")],
      ["m365-and-others", () => buildM365AndOthersBom("eastus2", "Demo")],
    ];
    for (const [name, build] of samples) {
      it(`${name} — every line says "Picked because" with an exclusions note`, () => {
        const lines = build();
        expect(lines.length).toBeGreaterThan(0);
        for (const l of lines) {
          // Allow inter-word phrasing: "Picked because", "Picked X because",
          // "Picked over Y because", etc.
          expect(l.assumption, `"${l.resource}" assumption missing Picked-because justification`)
            .toMatch(/Picked\s+(?:[\w-]+\s+){0,6}because/i);
          expect(l.assumption, `"${l.resource}" assumption missing exclusion / step-guidance marker`)
            .toMatch(/(NOT included|Includes|Step \w+|Add-on)/i);
        }
      });
    }
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

  describe("Signal-driven parameter defaults", () => {
    it("Modernization with no container signal → AKS + ACR + Container Apps all zero", () => {
      const p = recommendModernizationParams(["app_service"]);
      expect(p.aksNodeCount).toBe(0);
      expect(p.acrTier).toBe("off");
      expect(p.containerAppsBaselineUsd).toBe(0);
      // App Service still seeded since the signal matched.
      expect(p.appServiceInstances).toBe(3);

      const lines = buildModernizationBom("eastus2", "Demo", p);
      expect(lines.find((l) => l.resource.startsWith("AKS"))).toBeUndefined();
      expect(lines.find((l) => l.resource.includes("Container Registry"))).toBeUndefined();
      expect(lines.find((l) => l.resource.startsWith("App Service Plan"))).toBeDefined();
    });

    it("Modernization with aks signal → AKS + ACR seeded", () => {
      const p = recommendModernizationParams(["aks"]);
      expect(p.aksNodeCount).toBe(3);
      expect(p.acrTier).toBe("standard");
    });

    it("Data Platform with no analytics signal → Fabric / SQL / Cosmos all off", () => {
      const p = recommendDataPlatformParams([]);
      expect(p.fabricCapacity).toBe("off");
      expect(p.sqlDbTier).toBe("off");
      expect(p.cosmosMillionRuPerMonth).toBe(0);
      expect(p.adlsGb).toBe(0);
      expect(p.redisTier).toBe("off");
    });

    it("Data Platform with fabric + azure_sql_db signals → seeds both", () => {
      const p = recommendDataPlatformParams(["fabric", "azure_sql_db"]);
      expect(p.fabricCapacity).toBe("F2");
      expect(p.sqlDbTier).toBe("gp");
      expect(p.cosmosMillionRuPerMonth).toBe(0); // no cosmos signal
    });

    it("AI Application with no AI signal → all volumes zero", () => {
      const p = recommendAiApplicationParams([]);
      expect(p.openAiInputTokensMillions).toBe(0);
      expect(p.openAiOutputTokensMillions).toBe(0);
      expect(p.aiSearchTier).toBe("off");
      expect(p.mlComputeHoursMonth).toBe(0);
    });

    it("AI Application with gpu_vm signal → GPU SKU + non-zero ML hours", () => {
      const p = recommendAiApplicationParams(["gpu_vm", "fine_tuning"]);
      expect(p.mlComputeSku).toBe("NC4as_T4_v3");
      expect(p.mlComputeHoursMonth).toBeGreaterThan(0);
    });

    it("Azure Security defaults: Entra P1 always; Purview/WAF/Private Link signal-gated", () => {
      expect(recommendAzureSecurityParams([]).entraIdTier).toBe("p1");
      expect(recommendAzureSecurityParams(["pim"]).entraIdTier).toBe("p2");
      expect(recommendAzureSecurityParams([]).purviewCapacityUnits).toBe(0);
      expect(recommendAzureSecurityParams(["purview"]).purviewCapacityUnits).toBe(1);
    });

    it("Hybrid Multicloud defaults zero out without arc/defender_multicloud signal", () => {
      expect(recommendHybridMulticloudParams([]).multicloudServerCount).toBe(0);
      expect(recommendHybridMulticloudParams(["defender_multicloud"]).multicloudServerCount).toBe(5);
    });

    it("M365 & Others stay empty without m365 signals", () => {
      const p = recommendM365AndOthersParams([]);
      expect(p.m365BackupUsers).toBe(0);
      expect(p.m365ArchiveGb).toBe(0);
      expect(p.copilotStudioPackCount).toBe(0);
    });
  });
});
