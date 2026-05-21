import { describe, expect, it } from "vitest";
import { buildBcdrBom } from "@/lib/pillars/bcdr";
import type { InventoryItem } from "@/lib/models";

function mkVm(name: string, storageGb = 200, hasHa = false): InventoryItem {
  return {
    name,
    vcpu: 2,
    memoryGb: 4,
    storageGb,
    os: "Linux",
    environment: "prod",
    powerstate: "poweredOn",
    notes: "",
    disks: [],
    hasDb: false,
    hasHa,
  };
}

describe("buildBcdrBom", () => {
  it("returns nothing for an empty inventory", () => {
    expect(buildBcdrBom([], { region: "eastus2", appName: "Demo" })).toEqual([]);
  });

  it("emits protected-instance + replica disk + cache lines", () => {
    const lines = buildBcdrBom(
      [mkVm("v1", 100), mkVm("v2", 200)],
      { region: "eastus2", appName: "Demo" },
    );
    expect(lines).toHaveLength(3);
    const license = lines.find((l) => l.resource.includes("Protected Instance License"));
    expect(license).toBeDefined();
    expect(license!.quantity).toBe(2);
    expect(license!.monthlyCost).toBe(2 * 25);

    const disks = lines.find((l) => l.resource.startsWith("Replica disks"));
    expect(disks!.quantity).toBe(300);
    expect(disks!.monthlyCost).toBeCloseTo(300 * 0.075, 2);

    const cache = lines.find((l) => l.resource.startsWith("Cache storage"));
    expect(cache!.monthlyCost).toBeCloseTo(2 * 1.5, 2);
  });

  it("tags every line with source=bcdr-baseline and the app name", () => {
    const lines = buildBcdrBom([mkVm("v1", 50)], { region: "eastus2", appName: "ERPSuite" });
    for (const l of lines) {
      expect(l.source).toBe("bcdr-baseline");
      expect(l.customName).toContain("ERPSuite");
    }
  });
});
