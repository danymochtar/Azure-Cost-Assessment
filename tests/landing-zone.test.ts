import { describe, expect, it } from "vitest";
import {
  buildLandingZoneBom,
  buildLandingZoneBomFromComponents,
  LANDING_ZONE_LABELS,
  LZ_COMPONENTS,
  LZ_TIER_COMPONENTS,
  recommendLandingZoneTier,
  summariseInventory,
  type LandingZoneTier,
} from "@/lib/pillars/landing-zone";
import type { InventoryItem } from "@/lib/models";

function mkVm(name: string, opts: Partial<InventoryItem> = {}): InventoryItem {
  return {
    name,
    vcpu: 2,
    memoryGb: 4,
    storageGb: 64,
    os: "Linux",
    environment: "prod",
    powerstate: "poweredOn",
    notes: "",
    disks: [],
    hasDb: false,
    ...opts,
  };
}

describe("buildLandingZoneBom", () => {
  it("returns no lines when tier is 'none'", () => {
    expect(buildLandingZoneBom("none", "eastus2", "demo")).toEqual([]);
  });

  it("returns more lines as tier escalates", () => {
    const basic = buildLandingZoneBom("basic", "eastus2", "demo");
    const standard = buildLandingZoneBom("standard", "eastus2", "demo");
    const enterprise = buildLandingZoneBom("enterprise", "eastus2", "demo");
    expect(basic.length).toBeGreaterThan(0);
    expect(standard.length).toBeGreaterThan(basic.length);
    expect(enterprise.length).toBeGreaterThan(standard.length);
  });

  it("rolls up to a higher monthly total at higher tiers", () => {
    const sum = (tier: LandingZoneTier) =>
      buildLandingZoneBom(tier, "eastus2", "demo").reduce((s, l) => s + l.monthlyCost, 0);
    expect(sum("standard")).toBeGreaterThan(sum("basic"));
    expect(sum("enterprise")).toBeGreaterThan(sum("standard"));
  });

  it("standard introduces Bastion Standard (Basic ships no Bastion)", () => {
    const basic = buildLandingZoneBom("basic", "eastus2", "demo");
    expect(basic.find((l) => l.resource.startsWith("Azure Bastion"))).toBeUndefined();
    const std = buildLandingZoneBom("standard", "eastus2", "demo");
    const bastion = std.filter((l) => l.resource.startsWith("Azure Bastion"));
    expect(bastion).toHaveLength(1);
    expect(bastion[0].resource).toContain("Standard");
  });

  it("basic contains exactly the 4 components per spec: Public IP, VPN, App GW, Defender Servers P1", () => {
    const lines = buildLandingZoneBom("basic", "eastus2", "demo", [mkVm("v1")]);
    expect(lines).toHaveLength(4);
    expect(lines.find((l) => l.resource.startsWith("Public IP"))).toBeDefined();
    expect(lines.find((l) => l.resource.startsWith("VPN Gateway"))).toBeDefined();
    expect(lines.find((l) => l.resource.startsWith("Application Gateway"))).toBeDefined();
    expect(lines.find((l) => l.resource.includes("Defender for Servers Plan 1"))).toBeDefined();
  });

  it("enterprise replaces Firewall Standard with Premium", () => {
    const lines = buildLandingZoneBom("enterprise", "eastus2", "demo");
    const fwDeploy = lines.filter(
      (l) => l.resource.startsWith("Azure Firewall —") && l.resource.includes("deployment"),
    );
    expect(fwDeploy).toHaveLength(1);
    expect(fwDeploy[0].resource).toContain("Premium");
  });

  it("tags lines with the app name and region", () => {
    const lines = buildLandingZoneBom("basic", "westeurope", "ERPSuite");
    for (const l of lines) {
      expect(l.region).toBe("westeurope");
      expect(l.customName).toBe("ERPSuite-LZ");
      expect(l.source).toBe("lz-baseline");
      expect(l.category.startsWith("Landing Zone")).toBe(true);
    }
  });

  it("exposes a label for every tier in the public type", () => {
    const tiers: LandingZoneTier[] = ["none", "basic", "standard", "enterprise"];
    for (const t of tiers) {
      expect(LANDING_ZONE_LABELS[t]).toBeTruthy();
    }
  });

  describe("Defender for Cloud integration", () => {
    it("scales Defender for Servers Plan 1 by VM count at 'basic'", () => {
      const inv = [mkVm("v1"), mkVm("v2"), mkVm("v3")];
      const lines = buildLandingZoneBom("basic", "eastus2", "demo", inv);
      const servers = lines.find((l) => l.resource.includes("Defender for Servers Plan 1"));
      expect(servers).toBeDefined();
      expect(servers!.quantity).toBe(3);
      expect(servers!.monthlyCost).toBe(15);
    });

    it("basic ships ONLY Servers P1 from the Defender suite (no CSPM/ARM/Storage/KV CWP)", () => {
      const lines = buildLandingZoneBom("basic", "eastus2", "demo", [mkVm("v1")]);
      expect(lines.find((l) => l.resource.includes("Defender CSPM"))).toBeUndefined();
      expect(lines.find((l) => l.resource.includes("Defender for Resource Manager"))).toBeUndefined();
      expect(lines.find((l) => l.resource.includes("Defender for Storage"))).toBeUndefined();
      expect(lines.find((l) => l.resource.includes("Defender for Key Vault"))).toBeUndefined();
    });

    it("scales Defender for Servers Plan 1 by VM count at 'standard'", () => {
      const inv = [mkVm("vm1"), mkVm("vm2"), mkVm("vm3")];
      const lines = buildLandingZoneBom("standard", "eastus2", "demo", inv);
      const servers = lines.find((l) => l.resource.includes("Defender for Servers Plan 1"));
      expect(servers).toBeDefined();
      expect(servers!.quantity).toBe(3);
      // $5/VM × 3 = $15
      expect(servers!.monthlyCost).toBe(15);
    });

    it("upgrades to Defender for Servers P2 at 'enterprise' and adds SQL on Machines", () => {
      const inv = [
        mkVm("web1"),
        mkVm("sqlnode1", { hasDb: true }),
        mkVm("sql-prod-2"),
      ];
      const lines = buildLandingZoneBom("enterprise", "eastus2", "demo", inv);
      const p2 = lines.find((l) => l.resource.includes("Defender for Servers Plan 2"));
      const p1 = lines.find((l) => l.resource.includes("Defender for Servers Plan 1"));
      expect(p2).toBeDefined();
      expect(p1).toBeUndefined();
      expect(p2!.monthlyCost).toBe(3 * 15);

      const sql = lines.find((l) => l.resource.includes("Defender for SQL on Machines"));
      expect(sql).toBeDefined();
      // Both hasDb=true and name-matched "sql-prod-2"
      expect(sql!.quantity).toBe(2);
      expect(sql!.monthlyCost).toBe(2 * 15);
    });

    it("includes Defender CSPM, Storage, Key Vault at 'standard'", () => {
      const lines = buildLandingZoneBom("standard", "eastus2", "demo", [mkVm("v1")]);
      expect(lines.find((l) => l.resource.includes("Defender CSPM"))).toBeDefined();
      expect(lines.find((l) => l.resource.includes("Defender for Resource Manager"))).toBeDefined();
      expect(lines.find((l) => l.resource.includes("Defender for Storage"))).toBeDefined();
      expect(lines.find((l) => l.resource.includes("Defender for Key Vault"))).toBeDefined();
    });

    it("adds Defender for Containers and App Service only at 'enterprise'", () => {
      const std = buildLandingZoneBom("standard", "eastus2", "demo", [mkVm("v1")]);
      const ent = buildLandingZoneBom("enterprise", "eastus2", "demo", [mkVm("v1")]);
      expect(std.find((l) => l.resource.includes("Defender for Containers"))).toBeUndefined();
      expect(std.find((l) => l.resource.includes("Defender for App Service"))).toBeUndefined();
      expect(ent.find((l) => l.resource.includes("Defender for Containers"))).toBeDefined();
      expect(ent.find((l) => l.resource.includes("Defender for App Service"))).toBeDefined();
    });

    it("summariseInventory counts SQL-named VMs as DB-bearing", () => {
      const s = summariseInventory([
        mkVm("web"),
        mkVm("sql-prod-1"),
        mkVm("apphost", { hasDb: true }),
      ]);
      expect(s.vmCount).toBe(3);
      expect(s.sqlVmCount).toBe(2);
    });
  });

  describe("Customize components", () => {
    it("LZ_TIER_COMPONENTS only references ids that exist in LZ_COMPONENTS", () => {
      const valid = new Set(LZ_COMPONENTS.map((c) => c.id));
      for (const tier of ["basic", "standard", "enterprise"] as const) {
        for (const id of LZ_TIER_COMPONENTS[tier]) {
          expect(valid.has(id)).toBe(true);
        }
      }
    });

    it("buildLandingZoneBomFromComponents respects an explicit picked set", () => {
      const inv = [mkVm("v1")];
      const picked = ["nw-public-ip-std", "def-servers-p2"]; // mix preset + scaled
      const lines = buildLandingZoneBomFromComponents(picked, "eastus2", "Demo", inv);
      expect(lines).toHaveLength(2);
      expect(lines.find((l) => l.resource.startsWith("Public IP"))).toBeDefined();
      const p2 = lines.find((l) => l.resource.includes("Servers Plan 2"));
      expect(p2).toBeDefined();
      expect(p2!.monthlyCost).toBe(15);
    });

    it("dropping nw-vpn-vpngw1 from Standard removes the VPN line", () => {
      const tier: LandingZoneTier = "standard";
      const customised = LZ_TIER_COMPONENTS[tier].filter((id) => id !== "nw-vpn-vpngw1");
      const lines = buildLandingZoneBomFromComponents(
        customised, "eastus2", "Demo", [mkVm("v1")], undefined, tier,
      );
      expect(lines.find((l) => l.resource.startsWith("VPN Gateway"))).toBeUndefined();
    });

    it("adding sec-sentinel-payg to Basic surfaces the Sentinel line", () => {
      const tier: LandingZoneTier = "basic";
      const customised = [...LZ_TIER_COMPONENTS[tier], "sec-sentinel-payg"];
      const lines = buildLandingZoneBomFromComponents(
        customised, "eastus2", "Demo", [mkVm("v1")], undefined, tier,
      );
      const sentinel = lines.find((l) => l.resource.startsWith("Microsoft Sentinel"));
      expect(sentinel).toBeDefined();
      expect(sentinel!.monthlyCost).toBe(230);
    });

    it("landingZoneParams overrides default quantities", () => {
      const tier: LandingZoneTier = "enterprise";
      const lines = buildLandingZoneBomFromComponents(
        ["nw-firewall-prem-data", "sec-sentinel-payg", "mgmt-log-analytics-50gb"],
        "eastus2", "Demo", [mkVm("v1")],
        { firewallDataGbPerMonth: 5120, sentinelGbPerMonth: 100, logAnalyticsGbPerMonth: 100 },
        tier,
      );
      const fwData = lines.find((l) => l.resource.includes("Premium data processed"));
      expect(fwData!.monthlyCost).toBeCloseTo(5120 * 0.016, 2);
      const sentinel = lines.find((l) => l.resource.startsWith("Microsoft Sentinel"));
      expect(sentinel!.monthlyCost).toBeCloseTo(100 * 4.6, 2);
      const la = lines.find((l) => l.resource.startsWith("Log Analytics"));
      expect(la!.monthlyCost).toBeCloseTo(100 * 2.3, 2);
    });
  });

  describe("recommendLandingZoneTier — auto-default", () => {
    it("small workload (≤5 VMs, no HA, no BCDR) → Basic", () => {
      const r = recommendLandingZoneTier({
        complexity: "simple", vmCount: 3, sqlVmCount: 0, haVmCount: 0, enableBcdr: false,
      });
      expect(r.tier).toBe("basic");
      expect(r.reason).toMatch(/Basic tier/);
    });

    it("complex classifier verdict alone → Standard (1 signal)", () => {
      const r = recommendLandingZoneTier({
        complexity: "complex", vmCount: 8, sqlVmCount: 0, haVmCount: 0, enableBcdr: false,
      });
      expect(r.tier).toBe("standard");
      expect(r.reason).toMatch(/Standard tier/);
    });

    it("complex + BCDR enabled → Enterprise (2 signals)", () => {
      const r = recommendLandingZoneTier({
        complexity: "complex", vmCount: 8, sqlVmCount: 0, haVmCount: 0, enableBcdr: true,
      });
      expect(r.tier).toBe("enterprise");
      expect(r.reason).toMatch(/Enterprise tier/);
    });

    it("≥25 VMs alone → still Standard (1 signal); add HA pairs → Enterprise", () => {
      expect(recommendLandingZoneTier({
        complexity: "moderate", vmCount: 40, sqlVmCount: 0, haVmCount: 0, enableBcdr: false,
      }).tier).toBe("standard");
      expect(recommendLandingZoneTier({
        complexity: "moderate", vmCount: 40, sqlVmCount: 0, haVmCount: 3, enableBcdr: false,
      }).tier).toBe("enterprise");
    });

    it("Azure Security + Hybrid Multicloud scope → Enterprise", () => {
      const r = recommendLandingZoneTier({
        complexity: "moderate", vmCount: 10, sqlVmCount: 0, haVmCount: 0, enableBcdr: false,
        activePillars: ["azure_security", "hybrid_multicloud"],
      });
      expect(r.tier).toBe("enterprise");
    });

    it("mid-size production workload defaults to Standard", () => {
      const r = recommendLandingZoneTier({
        complexity: "moderate", vmCount: 12, sqlVmCount: 1, haVmCount: 1, enableBcdr: false,
      });
      expect(r.tier).toBe("standard");
    });
  });
});
