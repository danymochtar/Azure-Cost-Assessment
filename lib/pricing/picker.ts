import type { PriceRecord } from "./retail";

export function cheapestNonzero(records: PriceRecord[]): PriceRecord | null {
  if (records.length === 0) return null;
  const nonZero = records.filter((r) => r.retailPrice > 0);
  const pool = nonZero.length > 0 ? nonZero : records;
  return pool.reduce((a, b) => (a.retailPrice <= b.retailPrice ? a : b));
}

export function pickBySubstring(records: PriceRecord[], substr: string): PriceRecord | null {
  const s = substr.toLowerCase();
  const matches = records.filter(
    (r) => r.meterName.toLowerCase().includes(s) || r.productName.toLowerCase().includes(s),
  );
  return cheapestNonzero(matches.length > 0 ? matches : records);
}

export function pickBySubstrings(records: PriceRecord[], ...substrs: string[]): PriceRecord | null {
  const subs = substrs.map((s) => s.toLowerCase());
  const matches = records.filter((r) => {
    const m = r.meterName.toLowerCase();
    return subs.every((s) => m.includes(s));
  });
  return cheapestNonzero(matches.length > 0 ? matches : records);
}

export function pickExcluding(
  records: PriceRecord[],
  mustInclude: string,
  ...excludeTokens: string[]
): PriceRecord | null {
  const inc = mustInclude.toLowerCase();
  const excl = excludeTokens.map((t) => t.toLowerCase());
  const matches = records.filter((r) => {
    const m = r.meterName.toLowerCase();
    return m.includes(inc) && !excl.some((e) => m.includes(e));
  });
  if (matches.length > 0) return cheapestNonzero(matches);
  const fallback = records.filter((r) => r.meterName.toLowerCase().includes(inc));
  return cheapestNonzero(fallback);
}
