import { describe, expect, it } from "vitest";
import { cheapestNonzero, pickBySubstring, pickExcluding } from "@/lib/pricing/picker";
import type { PriceRecord } from "@/lib/pricing/retail";

function rec(meter: string, price: number, product = ""): PriceRecord {
  return {
    productName: product,
    skuName: meter,
    meterName: meter,
    armSkuName: meter,
    armRegionName: "eastus",
    unitPrice: price,
    retailPrice: price,
    unitOfMeasure: "1 Hour",
    currencyCode: "USD",
    priceType: "Consumption",
    serviceName: "Test",
    serviceFamily: "",
    productId: "",
    skuId: "",
    meterId: "",
    reservationTerm: "",
    savingsPlan: [],
  };
}

describe("cheapestNonzero", () => {
  it("returns null on empty input", () => {
    expect(cheapestNonzero([])).toBeNull();
  });

  it("skips $0 free-tier meters when paid meters exist", () => {
    const records = [rec("Free Tier", 0), rec("Standard", 5), rec("Premium", 10)];
    const chosen = cheapestNonzero(records);
    expect(chosen?.meterName).toBe("Standard");
  });

  it("falls back to $0 only when every record is $0", () => {
    const records = [rec("Free A", 0), rec("Free B", 0)];
    const chosen = cheapestNonzero(records);
    expect(chosen).not.toBeNull();
    expect(chosen?.retailPrice).toBe(0);
  });
});

describe("pickBySubstring", () => {
  it("filters by substring case-insensitively", () => {
    const records = [
      rec("D2s v5 PAYG", 0.10),
      rec("D4s v5 PAYG", 0.20),
      rec("E2s v5 PAYG", 0.15),
    ];
    expect(pickBySubstring(records, "D4s")?.meterName).toBe("D4s v5 PAYG");
  });

  it("falls back to unfiltered when nothing matches", () => {
    const records = [rec("A", 1), rec("B", 2)];
    expect(pickBySubstring(records, "nope")?.meterName).toBe("A");
  });
});

describe("pickExcluding", () => {
  it("picks base meter when both base and CU exist (WAF v2 case)", () => {
    const records = [
      rec("Application Gateway WAF v2 Gateway", 0.443),
      rec("Application Gateway WAF v2 Gateway Capacity Unit", 0.0144),
    ];
    const chosen = pickExcluding(records, "waf v2 gateway", "capacity unit", "data");
    expect(chosen?.meterName).toBe("Application Gateway WAF v2 Gateway");
  });

  it("falls back to inclusion-only when exclusion is too aggressive", () => {
    const records = [rec("WAF v2 Capacity Unit", 0.0144)];
    const chosen = pickExcluding(records, "waf v2", "capacity unit");
    // Exclusion eliminates everything → falls back to inclusion-only
    expect(chosen?.meterName).toBe("WAF v2 Capacity Unit");
  });
});
