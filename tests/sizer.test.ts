import { describe, expect, it } from "vitest";
import {
  isNonProd,
  isSqlServer,
  osIsWindows,
  recommendDisk,
  recommendDiskTier,
  recommendVm,
} from "@/lib/sizer";
import type { InventoryItem } from "@/lib/models";

function vm(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    name: "vm1",
    vcpu: 4,
    memoryGb: 16,
    storageGb: 100,
    os: "Linux",
    environment: "prod",
    powerstate: "poweredOn",
    notes: "",
    disks: [],
    ...overrides,
  };
}

describe("environment detection", () => {
  it("treats 'prod' as production", () => {
    expect(isNonProd(vm({ environment: "prod" }))).toBe(false);
  });

  it("detects UAT in environment field", () => {
    expect(isNonProd(vm({ environment: "uat" }))).toBe(true);
  });

  it("detects 'dev' in VM name even when env is missing", () => {
    expect(isNonProd(vm({ name: "myapp-dev-01", environment: "" }))).toBe(true);
  });
});

describe("os detection", () => {
  it("recognizes Windows variants", () => {
    expect(osIsWindows("Windows Server 2019")).toBe(true);
    expect(osIsWindows("Microsoft Windows 11")).toBe(true);
    expect(osIsWindows("RHEL 8")).toBe(false);
    expect(osIsWindows("")).toBe(false);
  });
});

describe("SQL Server detection", () => {
  it("flags VMs named '*sql*'", () => {
    expect(isSqlServer(vm({ name: "prod-mssql-01" }))).toBe(true);
    expect(isSqlServer(vm({ name: "sql-cluster-01" }))).toBe(true);
  });
  it("does NOT flag generic 'db' names (could be Oracle/Postgres/Mongo)", () => {
    expect(isSqlServer(vm({ name: "prod-db-01" }))).toBe(false);
    expect(isSqlServer(vm({ name: "prod-postgres-01" }))).toBe(false);
  });
});

describe("recommendVm", () => {
  it("picks an exact match in 1:1 mode", () => {
    const sku = recommendVm(vm({ vcpu: 4, memoryGb: 16 }), 1.0, 2, "normal");
    expect(sku.armName).toBe("Standard_D4s_v5");
  });

  it("routes memory-heavy (ratio>=6) to E-series in normal mode", () => {
    // 4 vCPU + 32 GB → ratio 8 — should pick E, not D
    const sku = recommendVm(vm({ vcpu: 4, memoryGb: 32 }), 1.0, 2, "normal");
    expect(sku.armName).toBe("Standard_E4s_v5");
  });

  it("routes non-prod to Burstable in saving mode", () => {
    const sku = recommendVm(
      vm({ vcpu: 2, memoryGb: 8, environment: "dev" }),
      1.0,
      2,
      "saving",
    );
    expect(sku.family).toBe("burstable");
  });

  it("avoids Burstable in high_perf mode even for tiny VMs", () => {
    const sku = recommendVm(vm({ vcpu: 2, memoryGb: 8 }), 1.0, 2, "high_perf");
    expect(sku.family).not.toBe("burstable");
  });

  it("scales up when no SKU fits exactly", () => {
    const sku = recommendVm(vm({ vcpu: 5, memoryGb: 16 }), 1.0, 2, "normal");
    // 5 vCPU doesn't match any catalog entry exactly — should pick smallest covering
    expect(sku.vcpu).toBeGreaterThanOrEqual(5);
  });
});

describe("recommendDisk", () => {
  it("rounds up to the next ladder rung", () => {
    expect(recommendDisk(100, "Premium SSD").sku).toBe("P10"); // 128 GiB
    expect(recommendDisk(128, "Premium SSD").sku).toBe("P10");
    expect(recommendDisk(129, "Premium SSD").sku).toBe("P15"); // 256 GiB
  });

  it("applies the right tier prefix", () => {
    expect(recommendDisk(100, "Premium SSD").sku).toMatch(/^P/);
    expect(recommendDisk(100, "Standard SSD").sku).toMatch(/^E/);
    expect(recommendDisk(100, "Standard HDD").sku).toMatch(/^S/);
  });
});

describe("recommendDiskTier", () => {
  it("routes DB workloads to Premium SSD", () => {
    expect(recommendDiskTier(vm({ name: "prod-mssql-01" }))).toBe("Premium SSD");
    expect(recommendDiskTier(vm({ name: "prod-postgres-db" }))).toBe("Premium SSD");
  });

  it("routes backup/archive/log workloads to Standard HDD", () => {
    expect(recommendDiskTier(vm({ name: "backup-svr-01" }))).toBe("Standard HDD");
    expect(recommendDiskTier(vm({ name: "log-archive-01" }))).toBe("Standard HDD");
  });

  it("falls back to default for generic VMs", () => {
    expect(recommendDiskTier(vm({ name: "vm-001" }))).toBe("Standard SSD");
  });

  it("user-flagged DB rows route to Premium SSD even when the name doesn't say so", () => {
    // The Stage 2 inventory checkbox sets hasDb=true. That should win
    // over name-based detection (which would otherwise miss "erp-app-01").
    expect(recommendDiskTier(vm({ name: "erp-app-01", hasDb: true }))).toBe("Premium SSD");
  });

  it("hasDb=true overrides an HDD-leaning name", () => {
    // Edge case: a VM named "logserver-01" that ALSO runs a database.
    // User flag wins over the HDD token hint.
    expect(recommendDiskTier(vm({ name: "logserver-01", hasDb: true }))).toBe("Premium SSD");
  });
});
