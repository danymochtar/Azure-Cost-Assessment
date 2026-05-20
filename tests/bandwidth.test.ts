import { describe, expect, it } from "vitest";
import { computeTieredEgress } from "@/lib/pricing/bandwidth";

describe("computeTieredEgress", () => {
  it("returns zero when total <= free allowance", () => {
    const r = computeTieredEgress(50, 0.087);
    expect(r.monthlyCost).toBe(0);
    expect(r.weightedRate).toBe(0);
  });

  it("returns zero when rate is zero", () => {
    const r = computeTieredEgress(1000, 0);
    expect(r.monthlyCost).toBe(0);
  });

  it("bills first tier rate from 100 GB to 10 TB cleanly", () => {
    // 1100 GB total = 100 free + 1000 billable at full rate
    const r = computeTieredEgress(1100, 0.087);
    expect(r.monthlyCost).toBeCloseTo(1000 * 0.087, 3);
    expect(r.breakdown).toHaveLength(1);
    expect(r.breakdown[0].gb).toBe(1000);
    expect(r.breakdown[0].rate).toBeCloseTo(0.087, 6);
  });

  it("crosses into tier 2 at 10 TB", () => {
    // 15 TB = 15_000 GB total → 100 free + 10_000 at tier1 + 4_900 at tier2
    const r = computeTieredEgress(15_100, 0.087);
    const expected = 10_000 * 0.087 + 5_000 * 0.087 * 0.954;
    expect(r.monthlyCost).toBeCloseTo(expected, 1);
    expect(r.breakdown).toHaveLength(2);
  });

  it("matches the Python reference scenario: 10 TB egress total", () => {
    // Reference from scripts/verify_calculations.py — 10 TB total (~$867)
    // Free 100 GB + 9_900 GB at $0.087
    const r = computeTieredEgress(10_000, 0.087);
    expect(r.monthlyCost).toBeCloseTo(9_900 * 0.087, 2);
  });
});
