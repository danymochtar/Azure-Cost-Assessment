import { HOURS_PER_MONTH, REGION_FALLBACKS } from "../constants";
import type { PricingMode } from "../models";

const ENDPOINT = "https://prices.azure.com/api/retail/prices";

export interface SavingsPlanEntry {
  term: string;
  unitPrice: number;
  retailPrice: number;
}

export interface PriceRecord {
  productName: string;
  skuName: string;
  meterName: string;
  armSkuName: string;
  armRegionName: string;
  unitPrice: number;
  retailPrice: number;
  unitOfMeasure: string;
  currencyCode: string;
  priceType: string;
  serviceName: string;
  serviceFamily: string;
  productId: string;
  skuId: string;
  meterId: string;
  reservationTerm: string;
  savingsPlan: SavingsPlanEntry[];
}

interface BillingTermCfg {
  label: string;
  hoursPerTerm: number | null;
  spTerm: string | null;
  riTerm: string | null;
}

export const BILLING_TERMS: Record<PricingMode, BillingTermCfg> = {
  payg: { label: "Pay-as-you-go", hoursPerTerm: null, spTerm: null, riTerm: null },
  sp_1y: { label: "Savings Plan (1 year)", hoursPerTerm: null, spTerm: "P1Y", riTerm: null },
  sp_3y: { label: "Savings Plan (3 years)", hoursPerTerm: null, spTerm: "P3Y", riTerm: null },
  ri_1y: { label: "Reserved Instance (1 year)", hoursPerTerm: HOURS_PER_MONTH * 12, spTerm: null, riTerm: "1 Year" },
  ri_3y: { label: "Reserved Instance (3 years)", hoursPerTerm: HOURS_PER_MONTH * 36, spTerm: null, riTerm: "3 Years" },
};

function recordFromApi(item: Record<string, unknown>): PriceRecord {
  const spRaw = (item.savingsPlan as Array<Record<string, unknown>> | undefined) ?? [];
  const sp: SavingsPlanEntry[] = spRaw.map((s) => ({
    term: String(s.term ?? ""),
    unitPrice: Number(s.unitPrice ?? 0),
    retailPrice: Number(s.retailPrice ?? 0),
  }));
  return {
    productName: String(item.productName ?? ""),
    skuName: String(item.skuName ?? ""),
    meterName: String(item.meterName ?? ""),
    armSkuName: String(item.armSkuName ?? ""),
    armRegionName: String(item.armRegionName ?? ""),
    unitPrice: Number(item.unitPrice ?? 0),
    retailPrice: Number(item.retailPrice ?? 0),
    unitOfMeasure: String(item.unitOfMeasure ?? ""),
    currencyCode: String(item.currencyCode ?? "USD"),
    priceType: String(item.type ?? ""),
    serviceName: String(item.serviceName ?? ""),
    serviceFamily: String(item.serviceFamily ?? ""),
    productId: String(item.productId ?? ""),
    skuId: String(item.skuId ?? ""),
    meterId: String(item.meterId ?? ""),
    reservationTerm: String(item.reservationTerm ?? ""),
    savingsPlan: sp,
  };
}

export class RetailPricesClient {
  readonly currency: string;
  readonly timeoutMs: number;
  private cache = new Map<string, PriceRecord[]>();
  lastError: string | null = null;
  fallbacksUsed = new Set<string>();
  termFallbacks = new Set<string>();

  constructor(currency = "USD", timeoutMs = 30000) {
    this.currency = currency;
    this.timeoutMs = timeoutMs;
  }

  async query(odataFilter: string, maxPages = 3): Promise<PriceRecord[]> {
    const key = `${this.currency}|${odataFilter}|${maxPages}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const results = await this.queryRaw(odataFilter, maxPages);

    if (results.length === 0) {
      const m = /armRegionName\s+eq\s+'([a-z0-9]+)'/i.exec(odataFilter);
      if (m) {
        const primary = m[1].toLowerCase();
        for (const fallback of REGION_FALLBACKS[primary] ?? []) {
          const altFilter = odataFilter.replace(
            `armRegionName eq '${primary}'`,
            `armRegionName eq '${fallback}'`,
          );
          const alt = await this.queryRaw(altFilter, maxPages);
          if (alt.length > 0) {
            this.fallbacksUsed.add(`${primary}->${fallback}`);
            this.cache.set(key, alt);
            return alt;
          }
        }
      }
    }

    this.cache.set(key, results);
    return results;
  }

  private async queryRaw(odataFilter: string, maxPages: number): Promise<PriceRecord[]> {
    const params = new URLSearchParams({ currencyCode: this.currency, $filter: odataFilter });
    let url: string | null = `${ENDPOINT}?${params.toString()}`;
    const out: PriceRecord[] = [];
    let pages = 0;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      while (url && pages < maxPages) {
        const resp = await fetch(url, { signal: controller.signal });
        if (!resp.ok) {
          this.lastError = `Retail Prices API HTTP ${resp.status} for filter '${odataFilter}'`;
          return out;
        }
        const data: { Items?: Record<string, unknown>[]; NextPageLink?: string } = await resp.json();
        for (const item of data.Items ?? []) out.push(recordFromApi(item));
        url = data.NextPageLink ?? null;
        pages += 1;
      }
    } catch (err) {
      this.lastError = `Retail Prices API error for '${odataFilter}': ${(err as Error).message}`;
      return out;
    } finally {
      clearTimeout(timer);
    }
    return out;
  }

  async vmPrice(
    armSkuName: string,
    region: string,
    osIsWindows: boolean,
    pricingMode: PricingMode = "payg",
    useAhb = false,
  ): Promise<PriceRecord | null> {
    const term = BILLING_TERMS[pricingMode] ?? BILLING_TERMS.payg;
    const effectiveWindowsForLookup = osIsWindows && !useAhb;
    const payg = await this.vmPayg(armSkuName, region, effectiveWindowsForLookup);

    const tagAhb = (rec: PriceRecord | null): PriceRecord | null => {
      if (!rec || !(useAhb && osIsWindows)) return rec;
      return { ...rec, meterName: `${rec.meterName} (AHB Windows)` };
    };

    if (pricingMode === "payg") return tagAhb(payg);

    if (term.spTerm) {
      if (!payg) return null;
      const sp = payg.savingsPlan.find((s) => s.term === term.spTerm);
      if (sp) {
        return tagAhb({
          ...payg,
          retailPrice: sp.retailPrice,
          unitPrice: sp.unitPrice,
          meterName: `${payg.meterName} (SP ${term.spTerm})`,
          priceType: "SavingsPlan",
        });
      }
      this.termFallbacks.add(`${armSkuName}|${pricingMode}`);
      return tagAhb(payg);
    }

    if (term.riTerm) {
      const filt =
        `serviceName eq 'Virtual Machines' ` +
        `and armRegionName eq '${region}' ` +
        `and armSkuName eq '${armSkuName}' ` +
        `and priceType eq 'Reservation'`;
      const records = await this.query(filt, 5);
      const isWindowsRec = (r: PriceRecord) => r.productName.toLowerCase().includes("windows");
      const candidates = records.filter(
        (r) => r.reservationTerm === term.riTerm && isWindowsRec(r) === effectiveWindowsForLookup,
      );
      if (candidates.length === 0) {
        this.termFallbacks.add(`${armSkuName}|${pricingMode}`);
        return tagAhb(payg);
      }
      const chosen = candidates.reduce((a, b) => (a.retailPrice <= b.retailPrice ? a : b));
      const hoursPerTerm = term.hoursPerTerm ?? 1;
      const perHour = chosen.retailPrice / hoursPerTerm;
      return tagAhb({
        ...chosen,
        retailPrice: perHour,
        unitPrice: perHour,
        meterName: `${chosen.meterName} (RI ${term.riTerm})`,
        priceType: "Reservation",
      });
    }

    return tagAhb(payg);
  }

  private async vmPayg(armSkuName: string, region: string, osIsWindows: boolean): Promise<PriceRecord | null> {
    const filt =
      `serviceName eq 'Virtual Machines' ` +
      `and armRegionName eq '${region}' ` +
      `and armSkuName eq '${armSkuName}' ` +
      `and priceType eq 'Consumption'`;
    const records = await this.query(filt, 5);
    const isWindowsRec = (r: PriceRecord) => r.productName.toLowerCase().includes("windows");
    const isSpotOrLow = (r: PriceRecord) => {
      const m = `${r.meterName} ${r.skuName}`.toLowerCase();
      return m.includes("spot") || m.includes("low priority");
    };
    const candidates = records.filter((r) => !isSpotOrLow(r) && isWindowsRec(r) === osIsWindows);
    if (candidates.length === 0) return null;
    return candidates.reduce((a, b) => (a.retailPrice <= b.retailPrice ? a : b));
  }

  async diskPrice(meterName: string, region: string): Promise<PriceRecord | null> {
    const filt =
      `serviceName eq 'Storage' ` +
      `and armRegionName eq '${region}' ` +
      `and meterName eq '${meterName}'`;
    const recs = await this.query(filt);
    if (recs.length === 0) return null;
    return recs.reduce((a, b) => (a.retailPrice <= b.retailPrice ? a : b));
  }
}
