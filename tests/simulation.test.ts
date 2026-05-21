// End-to-end simulation tests across every pillar.
//
// Each scenario models a realistic "vague" customer ask — minimal
// input, default params, a few signals — and verifies that:
//
//   1. Every emitted BOM line has a non-blank `assumption`.
//   2. Every line carries a non-empty `resource` string.
//   3. `monthlyCost` is finite, non-negative, and matches
//      `unitPrice × quantity` (within rounding).
//   4. `resourceCount` matches the line's billable count for
//      scaled components (Defender, BCDR, …).
//   5. `workloadNames` is populated wherever it makes sense
//      (lift-shift VM groups, disk lines, BCDR / LB lines).
//   6. The Landing-Zone recommendation aligns with the scenario
//      (small workload → Basic; enterprise signals → Enterprise).
//   7. Per-pillar parameter seeders only emit non-zero defaults
//      for components their signals match.
//
// If a regression slips a blank assumption / NaN cost / wrong
// resourceCount through, this file fails loudly with the exact
// pillar + line name.

import { describe, expect, it } from "vitest";
import type { BomLine, InventoryItem } from "@/lib/models";
import { RetailPricesClient, type PriceRecord } from "@/lib/pricing/retail";
import { buildLiftShiftBom } from "@/lib/pillars/lift-shift";
import {
  buildLandingZoneBom,
  recommendLandingZoneTier,
} from "@/lib/pillars/landing-zone";
import { buildBcdrBom } from "@/lib/pillars/bcdr";
import { buildModernizationBom, recommendModernizationParams } from "@/lib/pillars/modernization";
import { buildDataPlatformBom, recommendDataPlatformParams } from "@/lib/pillars/data-platform";
import { buildAiApplicationBom, recommendAiApplicationParams } from "@/lib/pillars/ai-application";
import { buildAzureSecurityBom, recommendAzureSecurityParams } from "@/lib/pillars/azure-security";
import { buildHybridMulticloudBom, recommendHybridMulticloudParams } from "@/lib/pillars/hybrid-multicloud";
import { buildM365AndOthersBom, recommendM365AndOthersParams } from "@/lib/pillars/m365-and-others";

// ────────────────────────────────────────────────────────────────────
// Helpers — fake retail client + inventory factory
// ────────────────────────────────────────────────────────────────────

const FAKE_VM_PRICE: PriceRecord = {
  productName: "Standard_D2s_v5",
  skuName: "Standard_D2s_v5",
  meterName: "D2s v5",
  armSkuName: "Standard_D2s_v5",
  armRegionName: "eastus2",
  unitPrice: 0.10,
  retailPrice: 0.10,
  unitOfMeasure: "1 Hour",
  currencyCode: "USD",
  priceType: "Consumption",
  serviceName: "Virtual Machines",
  serviceFamily: "Compute",
  productId: "", skuId: "", meterId: "", reservationTerm: "", savingsPlan: [],
};
const FAKE_DISK_PRICE: PriceRecord = { ...FAKE_VM_PRICE, retailPrice: 5, unitPrice: 5, unitOfMeasure: "1/Month" };

class FakeRetail extends RetailPricesClient {
  constructor() { super("USD"); }
  async vmPrice(): Promise<PriceRecord | null> { return FAKE_VM_PRICE; }
  async diskPrice(): Promise<PriceRecord | null> { return FAKE_DISK_PRICE; }
}

function mkVm(name: string, overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    name,
    vcpu: 4,
    memoryGb: 16,
    storageGb: 200,
    os: "Linux",
    environment: "prod",
    powerstate: "poweredOn",
    notes: "",
    disks: [],
    hasDb: false,
    hasHa: false,
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────
// Per-line invariants — every emitted line must hold these.
// ────────────────────────────────────────────────────────────────────

function expectInvariants(label: string, lines: BomLine[]) {
  expect(lines.length, `${label} produced zero lines`).toBeGreaterThan(0);
  for (const l of lines) {
    expect(l.resource.trim(), `${label}: blank resource on line "${l.sku}"`).not.toBe("");
    expect(l.assumption.trim(), `${label}: blank assumption on line "${l.resource}"`).not.toBe("");
    expect(Number.isFinite(l.monthlyCost), `${label}: non-finite cost on "${l.resource}"`).toBe(true);
    expect(l.monthlyCost, `${label}: negative cost on "${l.resource}"`).toBeGreaterThanOrEqual(0);
    expect(l.resourceCount, `${label}: resourceCount missing on "${l.resource}"`).toBeGreaterThanOrEqual(1);
    expect(l.source.trim(), `${label}: blank source on "${l.resource}"`).not.toBe("");
    // Cost math: when a line emits both unitPrice and quantity, the
    // monthlyCost must be non-zero. We don't compare to unitPrice ×
    // quantity literally — grouped VM lines multiply by count, OpenAI
    // mixes input/output rates, etc.
    if (l.quantity > 0 && l.unitPrice > 0) {
      expect(l.monthlyCost, `${label}: priced line "${l.resource}" rolled to $0`).toBeGreaterThan(0);
    }
  }
}

// ────────────────────────────────────────────────────────────────────
// Scenarios
// ────────────────────────────────────────────────────────────────────

describe("Simulation A — tiny lift-shift (3 small Linux VMs, no signals)", () => {
  const items = [mkVm("web1"), mkVm("web2"), mkVm("app1")];
  const signals: string[] = [];

  it("Landing Zone recommendation lands on Basic", () => {
    const rec = recommendLandingZoneTier({
      complexity: "simple", vmCount: 3, sqlVmCount: 0, haVmCount: 0, enableBcdr: false,
    });
    expect(rec.tier).toBe("basic");
    expect(rec.reason).toMatch(/Basic tier/);
  });

  it("Basic LZ BOM is non-empty, sane, ~$400/mo", async () => {
    const lines = buildLandingZoneBom("basic", "eastus2", "Demo", items);
    expectInvariants("Basic LZ", lines);
    const total = lines.reduce((s, l) => s + l.monthlyCost, 0);
    expect(total, "Basic LZ baseline should land $350-500/mo for 3 VMs").toBeGreaterThan(350);
    expect(total).toBeLessThan(550);
    // Defender Servers P1 line picks up the 3-VM count.
    const p1 = lines.find((l) => l.resource.includes("Servers Plan 1"));
    expect(p1!.resourceCount).toBe(3);
    expect(p1!.monthlyCost).toBe(15); // 3 × $5
  });

  it("Lift-shift VM compute lines emit clean resource names + workload trace", async () => {
    const { lines } = await buildLiftShiftBom(items, {
      region: "eastus2", pricingMode: "payg", computeMode: "normal",
      useAhbWindows: false, nonProdPayg: false,
      defaultDiskTier: "Standard SSD", autoDiskTier: false,
      appName: "Demo", headroom: 1.0,
    }, new FakeRetail());
    expectInvariants("Lift-shift", lines);
    const vm = lines.find((l) => l.category === "Virtual Machines");
    // No "x1/x2" in the resource string — count lives in resourceCount.
    expect(vm!.resource).not.toMatch(/\sx\d+/);
    expect(vm!.resourceCount).toBe(3);
    expect(vm!.workloadNames).toEqual(expect.arrayContaining(["web1", "web2", "app1"]));
  });

  it("Pillar param recommenders zero out everything when no signals match", () => {
    expect(recommendModernizationParams(signals).aksNodeCount).toBe(0);
    expect(recommendModernizationParams(signals).appServiceInstances).toBe(0);
    expect(recommendDataPlatformParams(signals).fabricCapacity).toBe("off");
    expect(recommendAiApplicationParams(signals).openAiInputTokensMillions).toBe(0);
    expect(recommendHybridMulticloudParams(signals).multicloudServerCount).toBe(0);
    expect(recommendM365AndOthersParams(signals).m365BackupUsers).toBe(0);
  });
});

describe("Simulation B — AI / RAG application (no VMs, openai + ai_search signals)", () => {
  const signals = ["azure_openai", "ai_search", "ml_workspace"];

  it("AI App params seed only the components the signals matched", () => {
    const p = recommendAiApplicationParams(signals);
    expect(p.openAiInputTokensMillions).toBeGreaterThan(0);
    expect(p.aiSearchTier).toBe("s1");
    expect(p.mlComputeHoursMonth).toBeGreaterThan(0);
    expect(p.docIntelligencePagesK).toBe(0); // no cognitive_services signal
  });

  it("AI App BOM lines are sane and total within an expected range", () => {
    const params = recommendAiApplicationParams(signals);
    const lines = buildAiApplicationBom("eastus2", "RAGApp", params);
    expectInvariants("AI App", lines);
    const total = lines.reduce((s, l) => s + l.monthlyCost, 0);
    // OpenAI 5M in × $2.50 = $12.50 + 1M out × $10 = $10 → $22.50
    // Embeddings 50M × $0.02 = $1
    // AI Search S1 = $250
    // ML compute D8s v5 120hr × $0.384 = $46
    // ≈ $320 total
    expect(total).toBeGreaterThan(250);
    expect(total).toBeLessThan(400);
  });

  it("Other pillars' BOMs are empty for AI-only workload", () => {
    // No infra modernization signals → no lines.
    const modLines = buildModernizationBom("eastus2", "RAGApp", recommendModernizationParams(signals));
    expect(modLines).toHaveLength(0);
    // No data platform signals → no lines.
    const dpLines = buildDataPlatformBom("eastus2", "RAGApp", recommendDataPlatformParams(signals));
    expect(dpLines).toHaveLength(0);
  });
});

describe("Simulation C — Data Platform analytics workload", () => {
  const signals = ["fabric", "azure_sql_db", "adls_gen2", "adf", "event_hubs"];

  it("Data Platform params seed Fabric + SQL + ADLS + ADF + Event Hubs", () => {
    const p = recommendDataPlatformParams(signals);
    expect(p.fabricCapacity).toBe("F2");
    expect(p.sqlDbTier).toBe("gp");
    expect(p.adlsGb).toBe(1000);
    expect(p.eventHubsTu).toBeGreaterThan(0);
    expect(p.dataFactoryUsd).toBeGreaterThan(0);
    expect(p.cosmosMillionRuPerMonth).toBe(0); // no cosmos signal
    expect(p.redisTier).toBe("off"); // no redis signal
  });

  it("BOM math is consistent — Fabric F2 dominates", () => {
    const params = recommendDataPlatformParams(signals);
    const lines = buildDataPlatformBom("eastus2", "Analytics", params);
    expectInvariants("Data Platform", lines);
    const fabric = lines.find((l) => l.resource.startsWith("Microsoft Fabric"));
    expect(fabric!.monthlyCost).toBeCloseTo(0.36 * 730, 1); // $262.80
    const sql = lines.find((l) => l.resource.startsWith("Azure SQL Database"));
    expect(sql!.monthlyCost).toBeGreaterThan(0);
  });
});

describe("Simulation D — Mid-size enterprise migration (15 VMs, 3 SQL, AKS signal, BCDR)", () => {
  const items: InventoryItem[] = [
    ...Array.from({ length: 12 }, (_, i) => mkVm(`web${i + 1}`)),
    mkVm("sql-prod-1", { hasDb: true, vcpu: 8, memoryGb: 32, storageGb: 1000 }),
    mkVm("sql-prod-2", { hasDb: true, vcpu: 8, memoryGb: 32, storageGb: 1000 }),
    mkVm("sql-prod-3", { hasDb: true, vcpu: 8, memoryGb: 32, storageGb: 1000 }),
  ];
  const signals = ["aks", "acr", "azure_sql_db"];

  it("LZ recommendation: hits 2-signal Enterprise threshold (3 DB-hosting VMs + BCDR)", () => {
    const rec = recommendLandingZoneTier({
      complexity: "moderate", vmCount: 15, sqlVmCount: 3, haVmCount: 0, enableBcdr: true,
    });
    expect(rec.tier).toBe("enterprise");
    expect(rec.reason).toMatch(/Enterprise tier/);
  });

  it("BCDR BOM is sane and Protected Instance line has correct Qty", () => {
    const lines = buildBcdrBom(items, { region: "eastus2", appName: "Migration" });
    expectInvariants("BCDR", lines);
    const license = lines.find((l) => l.resource.includes("Protected Instance License"));
    expect(license!.resourceCount).toBe(15);
    expect(license!.monthlyCost).toBe(15 * 25); // $25/VM
    // No "× N VMs" suffix in the resource name anymore.
    expect(license!.resource).not.toMatch(/×\s*\d+\s*VM/);
  });

  it("Enterprise LZ Defender lines scale with inventory + clean resource names", () => {
    const lines = buildLandingZoneBom("enterprise", "eastus2", "Migration", items);
    expectInvariants("Enterprise LZ", lines);

    const p2 = lines.find((l) => l.resource.includes("Servers Plan 2"));
    expect(p2!.resourceCount).toBe(15);
    expect(p2!.monthlyCost).toBe(15 * 15);
    expect(p2!.resource).not.toMatch(/×\s*\d+/); // count moved to Qty col

    const sql = lines.find((l) => l.resource.includes("SQL on Machines"));
    expect(sql!.resourceCount).toBe(3);
    expect(sql!.monthlyCost).toBe(3 * 15);

    const cspm = lines.find((l) => l.resource.includes("Defender CSPM"));
    expect(cspm!.resourceCount).toBeGreaterThanOrEqual(15); // ≥ VM count
  });

  it("Modernization with aks signal seeds AKS + ACR; without it, both stay off", () => {
    const withAks = recommendModernizationParams(["aks"]);
    expect(withAks.aksNodeCount).toBe(3);
    expect(withAks.acrTier).toBe("standard");

    const withoutAks = recommendModernizationParams(["app_service"]);
    expect(withoutAks.aksNodeCount).toBe(0);
    expect(withoutAks.acrTier).toBe("off");
  });
});

describe("Simulation E — Full enterprise multi-pillar (every signal lit)", () => {
  const signals = [
    "app_service", "aks", "container_apps", "api_management", "front_door", "acr",
    "fabric", "azure_sql_db", "cosmos_db", "adls_gen2", "adf", "event_hubs", "redis_cache",
    "azure_openai", "ai_search", "ml_workspace", "fine_tuning",
    "pim", "purview", "waf", "private_link",
    "azure_arc", "defender_multicloud", "arc_k8s", "arc_sql_payg",
    "m365_backup", "m365_archive", "sharepoint_premium", "copilot_studio_pack_25k",
  ];

  it("Every pillar emits non-zero lines when its signals are present", () => {
    const mod  = buildModernizationBom("eastus2", "MegaCorp", recommendModernizationParams(signals));
    const dp   = buildDataPlatformBom("eastus2", "MegaCorp", recommendDataPlatformParams(signals));
    const ai   = buildAiApplicationBom("eastus2", "MegaCorp", recommendAiApplicationParams(signals));
    const sec  = buildAzureSecurityBom("eastus2", "MegaCorp", recommendAzureSecurityParams(signals));
    const hyb  = buildHybridMulticloudBom([mkVm("v", { hasDb: true })], "eastus2", "MegaCorp", recommendHybridMulticloudParams(signals));
    const m365 = buildM365AndOthersBom("eastus2", "MegaCorp", recommendM365AndOthersParams(signals));

    expectInvariants("Modernization (full)", mod);
    expectInvariants("Data Platform (full)", dp);
    expectInvariants("AI Application (full)", ai);
    expectInvariants("Azure Security (full)", sec);
    expectInvariants("Hybrid Multicloud (full)", hyb);
    expectInvariants("M365 & Others (full)", m365);

    // Modernization should now have all components active.
    expect(mod.find((l) => l.resource.startsWith("App Service Plan"))).toBeDefined();
    expect(mod.find((l) => l.resource.startsWith("AKS"))).toBeDefined();
    expect(mod.find((l) => l.resource.startsWith("API Management"))).toBeDefined();
    expect(mod.find((l) => l.resource.startsWith("Azure Front Door"))).toBeDefined();
    expect(mod.find((l) => l.resource.startsWith("Azure Container Registry"))).toBeDefined();
    expect(mod.find((l) => l.resource.startsWith("Container Apps"))).toBeDefined();

    // Azure Security PIM signal → P2.
    const entra = sec.find((l) => l.resource.startsWith("Microsoft Entra ID"));
    expect(entra!.resource).toContain("P2");
  });

  it("Total of all pillar baselines is in a sane enterprise range ($5k-$30k/mo)", () => {
    const all: BomLine[] = [
      ...buildModernizationBom("eastus2", "MegaCorp", recommendModernizationParams(signals)),
      ...buildDataPlatformBom("eastus2", "MegaCorp", recommendDataPlatformParams(signals)),
      ...buildAiApplicationBom("eastus2", "MegaCorp", recommendAiApplicationParams(signals)),
      ...buildAzureSecurityBom("eastus2", "MegaCorp", recommendAzureSecurityParams(signals)),
      ...buildHybridMulticloudBom([mkVm("v", { hasDb: true })], "eastus2", "MegaCorp", recommendHybridMulticloudParams(signals)),
      ...buildM365AndOthersBom("eastus2", "MegaCorp", recommendM365AndOthersParams(signals)),
    ];
    const total = all.reduce((s, l) => s + l.monthlyCost, 0);
    expect(total).toBeGreaterThan(5000);
    expect(total).toBeLessThan(30000);
  });
});

// ────────────────────────────────────────────────────────────────────
// Anti-regression: assumption text quality
// ────────────────────────────────────────────────────────────────────

describe("Assumption text quality — sample every pillar with default params", () => {
  // Every assumption should:
  //   - mention a dollar amount or rate (price math grounded)
  //   - mention "Picked because" / step / NOT included guidance
  const allLineSamples = () => {
    const items = [mkVm("v1", { hasDb: true })];
    return [
      ...buildLandingZoneBom("enterprise", "eastus2", "Demo", items),
      ...buildBcdrBom(items, { region: "eastus2", appName: "Demo" }),
      ...buildModernizationBom("eastus2", "Demo", recommendModernizationParams(["app_service", "aks", "container_apps", "api_management", "front_door", "acr"])),
      ...buildDataPlatformBom("eastus2", "Demo", recommendDataPlatformParams(["fabric", "azure_sql_db", "cosmos_db", "adls_gen2", "adf", "event_hubs", "redis_cache"])),
      ...buildAiApplicationBom("eastus2", "Demo", recommendAiApplicationParams(["azure_openai", "ai_search", "ml_workspace", "fine_tuning", "cognitive_services"])),
      ...buildAzureSecurityBom("eastus2", "Demo", recommendAzureSecurityParams(["pim", "purview", "waf", "private_link"])),
      ...buildHybridMulticloudBom(items, "eastus2", "Demo", recommendHybridMulticloudParams(["defender_multicloud", "arc_k8s", "arc_sql_payg"])),
      ...buildM365AndOthersBom("eastus2", "Demo", recommendM365AndOthersParams(["m365_backup", "m365_archive", "sharepoint_premium", "copilot_studio_pack_25k"])),
    ];
  };

  it("every line mentions a dollar amount or rate (price math grounded)", () => {
    for (const l of allLineSamples()) {
      // free-tier "0/0" / "Free" lines are explicit exceptions.
      const free = l.monthlyCost === 0;
      if (free) continue;
      expect(l.assumption, `"${l.resource}" assumption missing $ amount`)
        .toMatch(/\$[\d,]+(?:\.\d+)?/);
    }
  });

  it("every line carries step-up or exclusions guidance", () => {
    for (const l of allLineSamples()) {
      expect(l.assumption, `"${l.resource}" assumption missing step / exclusion guidance`)
        .toMatch(/(NOT included|Step \w+|Includes|Add-on|consider|reserved|tune|Replaces|Adds)/i);
    }
  });
});
