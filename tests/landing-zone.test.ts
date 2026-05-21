import { describe, expect, it } from "vitest";
import {
  buildLandingZoneBom,
  LANDING_ZONE_LABELS,
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

  it("standard replaces Bastion Basic with Bastion Standard", () => {
    const lines = buildLandingZoneBom("standard", "eastus2", "demo");
    const bastion = lines.filter((l) => l.resource.startsWith("Azure Bastion"));
    expect(bastion).toHaveLength(1);
    expect(bastion[0].resource).toContain("Standard");
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
    it("adds no Defender lines at 'basic' beyond the Foundational CSPM (free)", () => {
      const lines = buildLandingZoneBom("basic", "eastus2", "demo", [mkVm("vm1")]);
      const paidDefender = lines.filter(
        (l) =>
          l.resource.startsWith("Microsoft Defender") &&
          !l.resource.includes("Free"),
      );
      expect(paidDefender).toHaveLength(0);
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

    it("drops the free CSPM informational line once paid CSPM is included", () => {
      const lines = buildLandingZoneBom("standard", "eastus2", "demo", [mkVm("v1")]);
      const freeCspm = lines.find((l) => l.resource.includes("Defender for Cloud — Free"));
      expect(freeCspm).toBeUndefined();
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
});
