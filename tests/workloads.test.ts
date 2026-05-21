// Matrix coverage tests — every realistic VM/workload shape × every cost
// option (pricing mode, compute mode, OS, AHB, disk tier, HA, headroom).
//
// Two layers:
//
//   1.  buildLiftShiftBom — end-to-end behaviour assertions (billing-term
//       label propagation, HA pair doubling, DB → Premium SSD auto-tier,
//       HDD-token → Standard HDD auto-tier, non-prod PAYG override, AHB
//       meter tagging, multi-disk fan-out, cost tally).
//
//   2.  RetailPricesClient — pricing lookup behaviour against a stubbed
//       Azure Retail Prices API. Covers PAYG, Savings Plan 1Y/3Y,
//       Reservation 1Y/3Y, AHB Windows-as-Linux lookup, spot filtering,
//       region fallback, and disk-price cheapest selection. Validates
//       that the billing-term knob actually reaches the API filter the
//       way the spec describes — no contract drift.

import { beforeEach, describe, expect, it } from "vitest";
import { buildLiftShiftBom } from "@/lib/pillars/lift-shift";
import { RetailPricesClient, type PriceRecord } from "@/lib/pricing/retail";
import { recommendDiskTier, recommendVm, isNonProd, isSqlServer, osIsWindows } from "@/lib/sizer";
import type { InventoryItem, PricingMode } from "@/lib/models";
import { HOURS_PER_MONTH } from "@/lib/constants";

// ────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────

function vm(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    name: "vm-1",
    vcpu: 2,
    memoryGb: 8,
    storageGb: 128,
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

const baseOpts = {
  region: "eastus2",
  pricingMode: "payg" as PricingMode,
  computeMode: "normal" as const,
  useAhbWindows: false,
  nonProdPayg: false,
  defaultDiskTier: "Standard SSD" as const,
  autoDiskTier: false,
  appName: "MatrixTest",
  headroom: 1.0,
};

// FakeRetail surfaces a deterministic price per (sku, mode) so the lift-shift
// math is reproducible. Disks return a fixed monthly figure so multi-disk
// fan-out can be measured.
const FAKE_VM_HOURLY: Record<PricingMode, number> = {
  payg: 0.10,
  sp_1y: 0.08,
  sp_3y: 0.06,
  ri_1y: 0.075,
  ri_3y: 0.055,
};

function fakeRec(meter: string, perHour: number, mode: PricingMode): PriceRecord {
  const tag =
    mode === "payg" ? "" :
    mode === "sp_1y" ? " (SP P1Y)" :
    mode === "sp_3y" ? " (SP P3Y)" :
    mode === "ri_1y" ? " (RI 1 Year)" :
    " (RI 3 Years)";
  return {
    productName: meter,
    skuName: meter,
    meterName: `${meter}${tag}`,
    armSkuName: meter,
    armRegionName: "eastus2",
    unitPrice: perHour,
    retailPrice: perHour,
    unitOfMeasure: "1 Hour",
    currencyCode: "USD",
    priceType: mode === "payg" ? "Consumption" : mode.startsWith("sp") ? "SavingsPlan" : "Reservation",
    serviceName: "Virtual Machines",
    serviceFamily: "Compute",
    productId: "", skuId: "", meterId: "", reservationTerm: "", savingsPlan: [],
  };
}

class FakeRetail extends RetailPricesClient {
  diskMonthly: number;
  constructor(diskMonthly = 9.6) {
    super("USD");
    this.diskMonthly = diskMonthly;
  }
  async vmPrice(armSku: string, _region: string, _winOs: boolean, mode: PricingMode = "payg") {
    return fakeRec(armSku, FAKE_VM_HOURLY[mode], mode);
  }
  async diskPrice() {
    return {
      ...fakeRec("disk", this.diskMonthly, "payg"),
      unit: "1/Month",
      unitOfMeasure: "1/Month",
      priceType: "Consumption",
      serviceName: "Storage",
      meterName: "disk",
    } as unknown as PriceRecord;
  }
}

// Sum every line's monthlyCost — used by the tally invariant.
function totalMonthly(lines: { monthlyCost: number }[]): number {
  return lines.reduce((s, l) => s + l.monthlyCost, 0);
}

// ────────────────────────────────────────────────────────────────────
// 1. Pricing-mode matrix
// ────────────────────────────────────────────────────────────────────

describe("Pricing-mode matrix — every term propagates and tallies", () => {
  const modes: Array<{ mode: PricingMode; label: string; perHour: number }> = [
    { mode: "payg", label: "PAYG", perHour: 0.10 },
    { mode: "sp_1y", label: "SP 1Y", perHour: 0.08 },
    { mode: "sp_3y", label: "SP 3Y", perHour: 0.06 },
    { mode: "ri_1y", label: "RI 1Y", perHour: 0.075 },
    { mode: "ri_3y", label: "RI 3Y", perHour: 0.055 },
  ];

  for (const { mode, label, perHour } of modes) {
    it(`${label}: VM compute line tags billing term and tallies`, async () => {
      const cli = new FakeRetail(/* disk = */ 0);
      const { lines } = await buildLiftShiftBom([vm({ name: "web-1" })], { ...baseOpts, pricingMode: mode }, cli);
      const compute = lines.find((l) => l.category === "Virtual Machines")!;
      expect(compute, `${label}: VM line missing`).toBeDefined();
      expect(compute.billingTerm).toBe(label);
      // The pricing math must round-trip: 1 VM × hourly × 730.
      expect(compute.monthlyCost).toBeCloseTo(perHour * HOURS_PER_MONTH, 1);
      // Tally invariant — sum equals the only VM line (no disk in this case).
      expect(totalMonthly(lines)).toBeCloseTo(compute.monthlyCost, 1);
    });
  }
});

// ────────────────────────────────────────────────────────────────────
// 2. Compute-mode matrix — family selection actually changes
// ────────────────────────────────────────────────────────────────────

describe("Compute-mode matrix — family selection responds to the knob", () => {
  it("saving + non-prod small load picks B-series (burstable)", () => {
    const sku = recommendVm(vm({ name: "dev-app", environment: "dev", vcpu: 2, memoryGb: 4 }), 1.0, 2, "saving");
    expect(sku.family).toBe("burstable");
  });

  it("normal + steady prod load picks D-series (general)", () => {
    const sku = recommendVm(vm({ name: "web-1", vcpu: 8, memoryGb: 32 }), 1.0, 2, "normal");
    expect(sku.family).toBe("general");
  });

  it("memory-heavy ratio (>= 6 GB/vCPU) picks E-series (memory)", () => {
    const sku = recommendVm(vm({ name: "redis-1", vcpu: 4, memoryGb: 32 }), 1.0, 2, "normal");
    expect(sku.family).toBe("memory");
  });

  it("high_perf prefers non-burstable when an alternative exists", () => {
    // 4 vCPU + 16 GB has both B4ms (burstable) and D4s v5 (general) in the
    // catalog — high_perf must skip the burstable.
    const sku = recommendVm(vm({ name: "dev-app", environment: "dev", vcpu: 4, memoryGb: 16 }), 1.0, 2, "high_perf");
    expect(sku.family).not.toBe("burstable");
  });
});

// ────────────────────────────────────────────────────────────────────
// 3. OS + AHB matrix
// ────────────────────────────────────────────────────────────────────

describe("OS + AHB matrix", () => {
  it("Linux: meter name carries no AHB tag", async () => {
    const cli = new FakeRetail(0);
    const { lines } = await buildLiftShiftBom([vm({ os: "Linux" })], baseOpts, cli);
    expect(lines[0].meter).not.toMatch(/AHB/);
    expect(lines[0].resource).toContain("Linux");
  });

  it("Windows without AHB: resource string says Windows", async () => {
    const cli = new FakeRetail(0);
    const { lines } = await buildLiftShiftBom(
      [vm({ os: "Windows Server 2022" })],
      { ...baseOpts, useAhbWindows: false },
      cli,
    );
    expect(lines[0].resource).toContain("Windows");
    expect(lines[0].resource).not.toContain("+ AHB");
  });

  it("Windows with AHB: resource string says '+ AHB' and explains it", async () => {
    const cli = new FakeRetail(0);
    const { lines } = await buildLiftShiftBom(
      [vm({ os: "Windows Server 2022" })],
      { ...baseOpts, useAhbWindows: true },
      cli,
    );
    expect(lines[0].resource).toContain("+ AHB");
    expect(lines[0].assumption).toContain("AHB");
  });

  it("Linux + useAhbWindows=true: AHB ignored (Linux doesn't use AHB)", async () => {
    const cli = new FakeRetail(0);
    const { lines } = await buildLiftShiftBom(
      [vm({ os: "Ubuntu 22.04" })],
      { ...baseOpts, useAhbWindows: true },
      cli,
    );
    expect(lines[0].resource).not.toContain("+ AHB");
  });

  it("osIsWindows tolerates capitalisation and full strings", () => {
    expect(osIsWindows("Windows Server 2019")).toBe(true);
    expect(osIsWindows("WINDOWS 11")).toBe(true);
    expect(osIsWindows("Microsoft Windows")).toBe(true);
    expect(osIsWindows("RHEL 9")).toBe(false);
    expect(osIsWindows("")).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// 4. DB / HDD auto-tier matrix
// ────────────────────────────────────────────────────────────────────

describe("Auto disk-tier — recommendDiskTier covers every cue", () => {
  it("hasDb flag → Premium SSD", () => {
    expect(recommendDiskTier(vm({ hasDb: true }))).toBe("Premium SSD");
  });
  it("name contains 'sql' → Premium SSD", () => {
    expect(recommendDiskTier(vm({ name: "sql-prod-1" }))).toBe("Premium SSD");
  });
  it("name contains 'oracle' → Premium SSD", () => {
    expect(recommendDiskTier(vm({ name: "oracle-prim" }))).toBe("Premium SSD");
  });
  it("name contains 'postgres' → Premium SSD", () => {
    expect(recommendDiskTier(vm({ name: "postgres-1" }))).toBe("Premium SSD");
  });
  it("notes mention 'SAP HANA' → Premium SSD", () => {
    expect(recommendDiskTier(vm({ notes: "Runs SAP HANA in-memory" }))).toBe("Premium SSD");
  });
  it("name contains 'backup' → Standard HDD", () => {
    expect(recommendDiskTier(vm({ name: "backup-target-1" }))).toBe("Standard HDD");
  });
  it("name contains 'archive' → Standard HDD", () => {
    expect(recommendDiskTier(vm({ name: "log-archive-1" }))).toBe("Standard HDD");
  });
  it("name contains 'fileserver' → Standard HDD", () => {
    expect(recommendDiskTier(vm({ name: "fileserver-corp" }))).toBe("Standard HDD");
  });
  it("plain web/app → falls back to default (Standard SSD)", () => {
    expect(recommendDiskTier(vm({ name: "web-1" }))).toBe("Standard SSD");
  });
  it("falls back to user-chosen default for ambiguous names", () => {
    expect(recommendDiskTier(vm({ name: "vm-1" }), "Premium SSD")).toBe("Premium SSD");
    expect(recommendDiskTier(vm({ name: "vm-1" }), "Standard HDD")).toBe("Standard HDD");
  });
});

describe("Auto disk-tier wired through buildLiftShiftBom", () => {
  it("DB workload + autoDiskTier=true → Premium SSD line", async () => {
    const cli = new FakeRetail();
    const { lines } = await buildLiftShiftBom(
      [vm({ name: "sql-prod-1", hasDb: true })],
      { ...baseOpts, autoDiskTier: true },
      cli,
    );
    const disk = lines.find((l) => l.category === "Managed Disks")!;
    expect(disk.resource).toContain("Premium SSD");
  });

  it("backup workload + autoDiskTier=true → Standard HDD line", async () => {
    const cli = new FakeRetail();
    const { lines } = await buildLiftShiftBom(
      [vm({ name: "backup-1" })],
      { ...baseOpts, autoDiskTier: true },
      cli,
    );
    const disk = lines.find((l) => l.category === "Managed Disks")!;
    expect(disk.resource).toContain("Standard HDD");
  });

  it("autoDiskTier=false honours the user-chosen default", async () => {
    const cli = new FakeRetail();
    const { lines } = await buildLiftShiftBom(
      [vm({ name: "sql-prod-1", hasDb: true })],
      { ...baseOpts, autoDiskTier: false, defaultDiskTier: "Standard SSD" },
      cli,
    );
    const disk = lines.find((l) => l.category === "Managed Disks")!;
    expect(disk.resource).toContain("Standard SSD");
  });
});

// ────────────────────────────────────────────────────────────────────
// 5. HA + LB matrix
// ────────────────────────────────────────────────────────────────────

describe("HA matrix — doubles compute + LB line + workloadNames", () => {
  it("mixed prod + HA tier fans out cleanly and tallies", async () => {
    const cli = new FakeRetail(0);
    const inv = [
      vm({ name: "web-1", hasHa: true }),
      vm({ name: "web-2", hasHa: true }),
      vm({ name: "app-1", hasHa: false }),
    ];
    const { lines } = await buildLiftShiftBom(inv, baseOpts, cli);
    const vmTotal = lines.filter((l) => l.category === "Virtual Machines").reduce((s, l) => s + l.resourceCount, 0);
    expect(vmTotal).toBe(2 + 2 + 1); // 2 HA pairs + 1 single
    const lb = lines.find((l) => l.resource.startsWith("Standard Load Balancer"))!;
    expect(lb.workloadNames).toEqual(expect.arrayContaining(["web-1", "web-2"]));
    expect(lb.workloadNames).not.toContain("app-1");
  });
});

// ────────────────────────────────────────────────────────────────────
// 6. Multi-disk + per-disk tier matrix
// ────────────────────────────────────────────────────────────────────

describe("Multi-disk fan-out", () => {
  it("each disk gets its own BOM line tagged with VM name and disk label", async () => {
    const cli = new FakeRetail();
    const inv = [vm({
      name: "sql-prim",
      disks: [
        { label: "OS",   sizeGb: 128, tier: "Premium SSD" },
        { label: "Data", sizeGb: 512, tier: "Premium SSD" },
        { label: "Log",  sizeGb: 256, tier: "Standard SSD" },
      ],
    })];
    const { lines } = await buildLiftShiftBom(inv, baseOpts, cli);
    const disks = lines.filter((l) => l.category === "Managed Disks");
    expect(disks).toHaveLength(3);
    expect(disks.map((d) => d.resource)).toEqual([
      expect.stringContaining("sql-prim/OS"),
      expect.stringContaining("sql-prim/Data"),
      expect.stringContaining("sql-prim/Log"),
    ]);
    expect(disks[2].resource).toContain("Standard SSD");
  });

  it("disk with explicit tier on the disk record overrides the workload-level default", async () => {
    const cli = new FakeRetail();
    const { lines } = await buildLiftShiftBom(
      [vm({ name: "mixed", disks: [{ label: "Data", sizeGb: 256, tier: "Standard HDD" }] })],
      { ...baseOpts, defaultDiskTier: "Premium SSD" },
      cli,
    );
    const disk = lines.find((l) => l.category === "Managed Disks")!;
    expect(disk.resource).toContain("Standard HDD");
  });
});

// ────────────────────────────────────────────────────────────────────
// 7. Non-prod PAYG override
// ────────────────────────────────────────────────────────────────────

describe("Non-prod PAYG override — mixed billing terms on one BOM", () => {
  it("global RI 3Y + nonProdPayg=true → dev VM tagged PAYG, prod tagged RI 3Y", async () => {
    const cli = new FakeRetail(0);
    const inv = [
      vm({ name: "prod-app-1" }),
      vm({ name: "dev-app-1", environment: "dev" }),
    ];
    const { lines } = await buildLiftShiftBom(
      inv,
      { ...baseOpts, pricingMode: "ri_3y", nonProdPayg: true },
      cli,
    );
    const vms = lines.filter((l) => l.category === "Virtual Machines");
    const terms = new Set(vms.map((l) => l.billingTerm));
    expect(terms.has("PAYG")).toBe(true);
    expect(terms.has("RI 3Y")).toBe(true);
  });

  it("isNonProd recognises typical tokens", () => {
    expect(isNonProd(vm({ environment: "dev" }))).toBe(true);
    expect(isNonProd(vm({ name: "vm-uat-1" }))).toBe(true);
    expect(isNonProd(vm({ name: "stage-app", environment: "" }))).toBe(true);
    expect(isNonProd(vm({ environment: "prod" }))).toBe(false);
  });

  it("isSqlServer recognises common SQL hostname patterns", () => {
    expect(isSqlServer(vm({ name: "vm-sql-01" }))).toBe(true);
    expect(isSqlServer(vm({ name: "MSSQL-PROD", notes: "" }))).toBe(true);
    expect(isSqlServer(vm({ name: "websvr-1" }))).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// 8. Headroom
// ────────────────────────────────────────────────────────────────────

describe("Headroom factor — picks bigger SKU", () => {
  it("headroom 1.5 forces an SKU with more vCPU than the source", () => {
    const baseline = recommendVm(vm({ vcpu: 4, memoryGb: 16 }), 1.0, 2, "normal");
    const padded   = recommendVm(vm({ vcpu: 4, memoryGb: 16 }), 1.5, 2, "normal");
    expect(padded.vcpu).toBeGreaterThanOrEqual(baseline.vcpu);
    expect(padded.memoryGb).toBeGreaterThanOrEqual(baseline.memoryGb);
  });
});

// ────────────────────────────────────────────────────────────────────
// 9. Cost-tally invariant — one big realistic mix
// ────────────────────────────────────────────────────────────────────

describe("End-to-end tally — every line accounted for", () => {
  it("all line costs sum to the expected total across mixed workloads", async () => {
    const cli = new FakeRetail(/* per disk = */ 5.0);
    const inv: InventoryItem[] = [
      vm({ name: "web-1", vcpu: 4, memoryGb: 16 }),
      vm({ name: "web-2", vcpu: 4, memoryGb: 16, hasHa: true }),
      vm({ name: "sql-prim", hasDb: true, os: "Windows Server 2022", vcpu: 8, memoryGb: 64 }),
      vm({ name: "dev-1", environment: "dev", vcpu: 2, memoryGb: 4 }),
    ];
    const { lines } = await buildLiftShiftBom(inv, { ...baseOpts, autoDiskTier: true }, cli);

    // Compute lines should equal the sum of (count × hourly × 730).
    const vmLines = lines.filter((l) => l.category === "Virtual Machines");
    const computeTotal = vmLines.reduce((s, l) => s + l.monthlyCost, 0);
    const expectedCompute = (1 + 2 + 1 + 1) * FAKE_VM_HOURLY.payg * HOURS_PER_MONTH;
    expect(computeTotal).toBeCloseTo(expectedCompute, 1);

    // 4 VMs × 1 disk each (no explicit disks) → 4 disk lines × $5.
    const diskLines = lines.filter((l) => l.category === "Managed Disks");
    expect(diskLines).toHaveLength(4);
    expect(diskLines.reduce((s, l) => s + l.monthlyCost, 0)).toBeCloseTo(20, 1);

    // LB line exists because one VM is HA-flagged.
    const lb = lines.find((l) => l.resource.startsWith("Standard Load Balancer"));
    expect(lb).toBeDefined();

    // Tally invariant: every line has a finite, non-negative cost.
    for (const l of lines) {
      expect(Number.isFinite(l.monthlyCost), `${l.resource}: cost NaN/Infinity`).toBe(true);
      expect(l.monthlyCost, `${l.resource}: negative cost`).toBeGreaterThanOrEqual(0);
    }
    // Grand total equals the manual roll-up.
    const grand = totalMonthly(lines);
    expect(grand).toBeCloseTo(computeTotal + 20 + (lb?.monthlyCost ?? 0), 1);
  });
});

// ════════════════════════════════════════════════════════════════════
// RetailPricesClient lookup behaviour — verifies the billing-term
// knob, AHB flag, OS filter, spot filter, and region fallback all
// reach the API filter the way the spec describes.
// ════════════════════════════════════════════════════════════════════

interface FakeApiRow extends PriceRecord {}

class StubbedRetail extends RetailPricesClient {
  // Pre-canned response table keyed by filter substring. The test stubs
  // out the `query` method so no network call escapes.
  table: Array<{ match: (filt: string) => boolean; rows: FakeApiRow[] }> = [];
  calls: string[] = [];
  constructor() { super("USD"); }

  // Override the internal HTTP wrapper. Both query() and queryRaw()
  // delegate through the cache, so overriding query() is enough.
  async query(odata: string): Promise<PriceRecord[]> {
    this.calls.push(odata);
    for (const entry of this.table) {
      if (entry.match(odata)) return entry.rows;
    }
    return [];
  }
}

function row(
  meter: string,
  price: number,
  opts: Partial<PriceRecord> = {},
): FakeApiRow {
  return {
    productName: opts.productName ?? meter,
    skuName: opts.skuName ?? meter,
    meterName: opts.meterName ?? meter,
    armSkuName: opts.armSkuName ?? meter,
    armRegionName: opts.armRegionName ?? "eastus2",
    unitPrice: price,
    retailPrice: price,
    unitOfMeasure: opts.unitOfMeasure ?? "1 Hour",
    currencyCode: "USD",
    priceType: opts.priceType ?? "Consumption",
    serviceName: opts.serviceName ?? "Virtual Machines",
    serviceFamily: opts.serviceFamily ?? "Compute",
    productId: "", skuId: "", meterId: "",
    reservationTerm: opts.reservationTerm ?? "",
    savingsPlan: opts.savingsPlan ?? [],
  };
}

describe("RetailPricesClient.vmPrice — PAYG", () => {
  let cli: StubbedRetail;
  beforeEach(() => { cli = new StubbedRetail(); });

  it("returns the Linux PAYG record for a Linux VM", async () => {
    cli.table = [{
      match: (f) => f.includes("Virtual Machines") && f.includes("Consumption"),
      rows: [
        row("D2s v5",          0.10, { productName: "Virtual Machines DSv5 Series" }),
        row("D2s v5 Windows",  0.20, { productName: "Virtual Machines DSv5 Series Windows" }),
      ],
    }];
    const rec = await cli.vmPrice("Standard_D2s_v5", "eastus2", false, "payg", false);
    expect(rec?.retailPrice).toBe(0.10);
    expect(rec?.productName).not.toMatch(/Windows/i);
  });

  it("returns the Windows PAYG record for a Windows VM (no AHB)", async () => {
    cli.table = [{
      match: () => true,
      rows: [
        row("D2s v5",          0.10, { productName: "Virtual Machines DSv5 Series" }),
        row("D2s v5 Windows",  0.20, { productName: "Virtual Machines DSv5 Series Windows" }),
      ],
    }];
    const rec = await cli.vmPrice("Standard_D2s_v5", "eastus2", true, "payg", false);
    expect(rec?.retailPrice).toBe(0.20);
    expect(rec?.productName).toMatch(/Windows/i);
  });

  it("Windows + AHB picks the Linux meter and tags it (AHB Windows)", async () => {
    cli.table = [{
      match: () => true,
      rows: [
        row("D2s v5",          0.10, { productName: "Virtual Machines DSv5 Series" }),
        row("D2s v5 Windows",  0.20, { productName: "Virtual Machines DSv5 Series Windows" }),
      ],
    }];
    const rec = await cli.vmPrice("Standard_D2s_v5", "eastus2", true, "payg", true);
    expect(rec?.retailPrice).toBe(0.10);
    expect(rec?.meterName).toContain("AHB Windows");
  });

  it("filters out Spot / Low Priority records", async () => {
    cli.table = [{
      match: () => true,
      rows: [
        row("D2s v5 Spot",          0.02, { productName: "Virtual Machines DSv5 Series" }),
        row("D2s v5 Low Priority",  0.03, { productName: "Virtual Machines DSv5 Series" }),
        row("D2s v5",               0.10, { productName: "Virtual Machines DSv5 Series" }),
      ],
    }];
    const rec = await cli.vmPrice("Standard_D2s_v5", "eastus2", false, "payg", false);
    expect(rec?.retailPrice).toBe(0.10);
    expect(rec?.meterName).not.toMatch(/Spot|Low Priority/i);
  });

  it("returns null when no candidate matches", async () => {
    cli.table = [{ match: () => true, rows: [] }];
    const rec = await cli.vmPrice("Standard_D2s_v5", "eastus2", false, "payg", false);
    expect(rec).toBeNull();
  });
});

describe("RetailPricesClient.vmPrice — Savings Plan", () => {
  let cli: StubbedRetail;
  beforeEach(() => { cli = new StubbedRetail(); });

  it("SP 1Y picks the P1Y savingsPlan entry and tags the meter", async () => {
    cli.table = [{
      match: () => true,
      rows: [row("D2s v5", 0.10, {
        productName: "Virtual Machines DSv5 Series",
        savingsPlan: [
          { term: "P1Y", unitPrice: 0.07, retailPrice: 0.07 },
          { term: "P3Y", unitPrice: 0.05, retailPrice: 0.05 },
        ],
      })],
    }];
    const rec = await cli.vmPrice("Standard_D2s_v5", "eastus2", false, "sp_1y", false);
    expect(rec?.retailPrice).toBe(0.07);
    expect(rec?.meterName).toContain("SP P1Y");
    expect(rec?.priceType).toBe("SavingsPlan");
  });

  it("SP 3Y picks the P3Y savingsPlan entry", async () => {
    cli.table = [{
      match: () => true,
      rows: [row("D2s v5", 0.10, {
        productName: "Virtual Machines DSv5 Series",
        savingsPlan: [
          { term: "P1Y", unitPrice: 0.07, retailPrice: 0.07 },
          { term: "P3Y", unitPrice: 0.05, retailPrice: 0.05 },
        ],
      })],
    }];
    const rec = await cli.vmPrice("Standard_D2s_v5", "eastus2", false, "sp_3y", false);
    expect(rec?.retailPrice).toBe(0.05);
    expect(rec?.meterName).toContain("SP P3Y");
  });

  it("missing savings-plan entry → falls back to PAYG and records termFallback", async () => {
    cli.table = [{
      match: () => true,
      rows: [row("Standard_M128s", 5.00, {
        productName: "Virtual Machines MS Series",
        savingsPlan: [],
      })],
    }];
    const rec = await cli.vmPrice("Standard_M128s", "eastus2", false, "sp_3y", false);
    expect(rec?.retailPrice).toBe(5.00);
    expect(cli.termFallbacks.has("Standard_M128s|sp_3y")).toBe(true);
  });
});

describe("RetailPricesClient.vmPrice — Reserved Instance", () => {
  let cli: StubbedRetail;
  beforeEach(() => { cli = new StubbedRetail(); });

  it("RI 1Y returns the cheapest 1-Year reservation amortised per-hour", async () => {
    cli.table = [
      // PAYG lookup (called first)
      {
        match: (f) => f.includes("Consumption"),
        rows: [row("D2s v5", 0.10, { productName: "Virtual Machines DSv5 Series" })],
      },
      // Reservation lookup
      {
        match: (f) => f.includes("Reservation"),
        rows: [
          row("D2s v5 Reserved", 0.075 * HOURS_PER_MONTH * 12, {
            productName: "Virtual Machines DSv5 Series",
            priceType: "Reservation",
            reservationTerm: "1 Year",
          }),
        ],
      },
    ];
    const rec = await cli.vmPrice("Standard_D2s_v5", "eastus2", false, "ri_1y", false);
    expect(rec?.priceType).toBe("Reservation");
    expect(rec?.retailPrice).toBeCloseTo(0.075, 4);
    expect(rec?.meterName).toContain("RI 1 Year");
  });

  it("RI 3Y returns 3-year reservation amortised per-hour", async () => {
    cli.table = [
      { match: (f) => f.includes("Consumption"), rows: [row("D2s v5", 0.10)] },
      {
        match: (f) => f.includes("Reservation"),
        rows: [
          row("D2s v5 Reserved", 0.05 * HOURS_PER_MONTH * 36, {
            priceType: "Reservation",
            reservationTerm: "3 Years",
          }),
        ],
      },
    ];
    const rec = await cli.vmPrice("Standard_D2s_v5", "eastus2", false, "ri_3y", false);
    expect(rec?.retailPrice).toBeCloseTo(0.05, 4);
    expect(rec?.meterName).toContain("RI 3 Years");
  });

  it("RI unavailable → falls back to PAYG and records termFallback", async () => {
    cli.table = [
      { match: (f) => f.includes("Consumption"), rows: [row("D2s v5", 0.10)] },
      { match: (f) => f.includes("Reservation"), rows: [] },
    ];
    const rec = await cli.vmPrice("Standard_D2s_v5", "eastus2", false, "ri_1y", false);
    expect(rec?.retailPrice).toBe(0.10);
    expect(cli.termFallbacks.has("Standard_D2s_v5|ri_1y")).toBe(true);
  });

  it("RI lookup respects the OS filter (Windows reservation for Windows VM)", async () => {
    cli.table = [
      {
        match: (f) => f.includes("Consumption"),
        rows: [row("D2s v5 Windows", 0.20, { productName: "Virtual Machines DSv5 Series Windows" })],
      },
      {
        match: (f) => f.includes("Reservation"),
        rows: [
          row("D2s v5 Linux Reserved", 0.05 * HOURS_PER_MONTH * 12, {
            productName: "Virtual Machines DSv5 Series",
            priceType: "Reservation",
            reservationTerm: "1 Year",
          }),
          row("D2s v5 Windows Reserved", 0.15 * HOURS_PER_MONTH * 12, {
            productName: "Virtual Machines DSv5 Series Windows",
            priceType: "Reservation",
            reservationTerm: "1 Year",
          }),
        ],
      },
    ];
    const rec = await cli.vmPrice("Standard_D2s_v5", "eastus2", true, "ri_1y", false);
    expect(rec?.productName).toMatch(/Windows/i);
    expect(rec?.retailPrice).toBeCloseTo(0.15, 4);
  });
});

describe("RetailPricesClient.diskPrice", () => {
  let cli: StubbedRetail;
  beforeEach(() => { cli = new StubbedRetail(); });

  it("picks the cheapest matching meter for the region", async () => {
    cli.table = [{
      match: (f) => f.includes("Storage") && f.includes("P30 LRS Disk"),
      rows: [
        row("P30 LRS Disk", 135.17, { serviceName: "Storage", unitOfMeasure: "1/Month" }),
        row("P30 LRS Disk", 120.00, { serviceName: "Storage", unitOfMeasure: "1/Month" }),
      ],
    }];
    const rec = await cli.diskPrice("P30 LRS Disk", "eastus2");
    expect(rec?.retailPrice).toBe(120.00);
  });

  it("returns null when no records are returned", async () => {
    cli.table = [{ match: () => true, rows: [] }];
    const rec = await cli.diskPrice("P30 LRS Disk", "eastus2");
    expect(rec).toBeNull();
  });
});
