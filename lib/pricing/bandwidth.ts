export const FREE_GB_PER_MONTH = 100;

interface Tier {
  ceilingGb: number;
  factor: number;
}

const TIERS: Tier[] = [
  { ceilingGb: 10_000, factor: 1.0 },
  { ceilingGb: 50_000, factor: 0.954 },
  { ceilingGb: 150_000, factor: 0.805 },
  { ceilingGb: 500_000, factor: 0.575 },
  { ceilingGb: Infinity, factor: 0.425 },
];

export interface EgressTierBreakdown {
  label: string;
  gb: number;
  rate: number;
  cost: number;
}

export interface EgressResult {
  monthlyCost: number;
  weightedRate: number;
  breakdown: EgressTierBreakdown[];
}

function tierLabel(lower: number, upper: number): string {
  const fmt = (x: number): string => {
    if (x === Infinity) return "∞";
    if (x >= 1_000_000) return `${(x / 1_000_000).toFixed(0)} PB`;
    if (x >= 1_000) return `${(x / 1_000).toFixed(0)} TB`;
    return `${x.toFixed(0)} GB`;
  };
  return `${fmt(lower)} – ${fmt(upper)}`;
}

export function computeTieredEgress(
  totalGbMonth: number,
  firstTierRate: number,
  freeGb = FREE_GB_PER_MONTH,
): EgressResult {
  if (totalGbMonth <= 0 || firstTierRate <= 0) {
    return { monthlyCost: 0, weightedRate: 0, breakdown: [] };
  }
  const billable = Math.max(0, totalGbMonth - freeGb);
  if (billable === 0) {
    return {
      monthlyCost: 0,
      weightedRate: 0,
      breakdown: [{ label: `0 – ${freeGb.toFixed(0)} GB (free)`, gb: totalGbMonth, rate: 0, cost: 0 }],
    };
  }
  let remaining = billable;
  let total = 0;
  let lower = 0;
  const breakdown: EgressTierBreakdown[] = [];
  for (const t of TIERS) {
    if (remaining <= 0) break;
    const capacity = t.ceilingGb - lower;
    const gb = Math.min(remaining, capacity);
    const rate = firstTierRate * t.factor;
    const cost = gb * rate;
    total += cost;
    breakdown.push({ label: tierLabel(lower, t.ceilingGb), gb, rate, cost });
    remaining -= gb;
    lower = t.ceilingGb;
  }
  const weighted = billable > 0 ? total / billable : 0;
  return { monthlyCost: round(total, 4), weightedRate: round(weighted, 6), breakdown };
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
