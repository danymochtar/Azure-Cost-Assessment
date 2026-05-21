import { describe, expect, it } from "vitest";
import { buildLiftShiftBom } from "@/lib/pillars/lift-shift";
import { RetailPricesClient, type PriceRecord } from "@/lib/pricing/retail";
import type { InventoryItem } from "@/lib/models";

function mkVm(name: string, hasHa = false): InventoryItem {
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
    hasHa,
  };
}

// Stub retail client so tests don't hit the network. Returns a fixed
// per-hour price so VM-line totals are deterministic.
const fakeVmRecord: PriceRecord = {
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
  productId: "",
  skuId: "",
  meterId: "",
  reservationTerm: "",
  savingsPlan: [],
};
class FakeRetail extends RetailPricesClient {
  constructor() { super("USD"); }
  async vmPrice(): Promise<PriceRecord | null> {
    return fakeVmRecord;
  }
  async diskPrice(): Promise<PriceRecord | null> { return null; }
}

const baseOpts = {
  region: "eastus2",
  pricingMode: "payg" as const,
  computeMode: "normal" as const,
  useAhbWindows: false,
  nonProdPayg: false,
  defaultDiskTier: "Standard SSD" as const,
  autoDiskTier: false,
  appName: "Demo",
  headroom: 1.0,
};

describe("HA flag", () => {
  it("doubles the VM compute line for HA-flagged workloads", async () => {
    const cli = new FakeRetail();
    const { lines: noHa } = await buildLiftShiftBom([mkVm("solo", false)], baseOpts, cli);
    const { lines: ha } = await buildLiftShiftBom([mkVm("solo", true)], baseOpts, cli);

    const vmNoHa = noHa.find((l) => l.category === "Virtual Machines");
    const vmHa = ha.find((l) => l.category === "Virtual Machines");
    expect(vmNoHa!.resource).toContain("x1");
    expect(vmHa!.resource).toContain("x2");
    expect(vmHa!.monthlyCost).toBeCloseTo(2 * vmNoHa!.monthlyCost, 2);
  });

  it("emits a Standard Load Balancer line when any VM is HA", async () => {
    const cli = new FakeRetail();
    const { lines } = await buildLiftShiftBom(
      [mkVm("web", true), mkVm("app", false), mkVm("sql", true)],
      baseOpts, cli,
    );
    const lb = lines.find((l) => l.resource.startsWith("Standard Load Balancer"));
    expect(lb).toBeDefined();
    expect(lb!.resource).toContain("2 workloads");
  });

  it("emits no Load Balancer line when nothing is HA", async () => {
    const cli = new FakeRetail();
    const { lines } = await buildLiftShiftBom([mkVm("solo", false)], baseOpts, cli);
    expect(lines.find((l) => l.resource.startsWith("Standard Load Balancer"))).toBeUndefined();
  });
});
