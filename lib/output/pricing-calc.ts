import type { BomLine } from "../models";

export function buildPricingCalculatorImport(
  lines: BomLine[],
  region: string,
  currency: string,
): string {
  const totalMonthlyCost = lines.reduce((s, l) => s + l.monthlyCost, 0);
  const payload = {
    schemaVersion: "1",
    generator: "azure-cost-assessment",
    region,
    currency,
    totalMonthlyCost: Math.round(totalMonthlyCost * 100) / 100,
    items: lines.map((l) => ({
      category: l.category,
      resource: l.resource,
      sku: l.sku,
      meter: l.meter,
      region: l.region,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: l.unitPrice,
      monthlyCost: l.monthlyCost,
      productId: l.productId,
      skuId: l.skuId,
      meterId: l.meterId,
      source: l.source,
    })),
  };
  return JSON.stringify(payload, null, 2);
}
