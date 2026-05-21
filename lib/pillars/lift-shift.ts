import { HOURS_PER_MONTH } from "../constants";
import { type BomLine, emptyBomLine, type ComputeMode, type InventoryItem, type PricingMode } from "../models";
import { pickBySubstring } from "../pricing/picker";
import { RetailPricesClient } from "../pricing/retail";
import {
  isNonProd,
  isSqlServer,
  osIsWindows,
  recommendDisk,
  recommendDiskTier,
  recommendVm,
} from "../sizer";

export interface LiftShiftOptions {
  region: string;
  pricingMode: PricingMode;
  computeMode: ComputeMode;
  useAhbWindows: boolean;
  nonProdPayg: boolean;
  defaultDiskTier: "Premium SSD" | "Standard SSD" | "Standard HDD";
  autoDiskTier: boolean;
  appName: string;
  headroom: number;
}

interface VmGroupKey {
  arm: string;
  display: string;
  os: string;
  env: string;
  billing: PricingMode;
  ahb: boolean;
}

function groupKey(k: VmGroupKey): string {
  return [k.arm, k.os, k.env, k.billing, k.ahb ? "1" : "0"].join("|");
}

function billingForVm(
  item: InventoryItem,
  globalMode: PricingMode,
  nonProdPayg: boolean,
): PricingMode {
  if (globalMode === "payg") return "payg";
  if (nonProdPayg && isNonProd(item)) return "payg";
  return globalMode;
}

function billingTermLabel(mode: PricingMode): string {
  if (mode === "payg") return "PAYG";
  if (mode === "sp_1y") return "SP 1Y";
  if (mode === "sp_3y") return "SP 3Y";
  if (mode === "ri_1y") return "RI 1Y";
  if (mode === "ri_3y") return "RI 3Y";
  return "PAYG";
}

export async function buildLiftShiftBom(
  items: InventoryItem[],
  opts: LiftShiftOptions,
  client?: RetailPricesClient,
): Promise<{ lines: BomLine[]; vmCount: number; totalStorageGb: number }> {
  const cli = client ?? new RetailPricesClient();
  const lines: BomLine[] = [];

  // Group VMs by (SKU recommendation, OS, env, billing, AHB)
  const groups = new Map<
    string,
    { meta: VmGroupKey; count: number; sample: InventoryItem; vcpu: number; memoryGb: number }
  >();
  // Each HA-flagged VM expands to 2 instances at compute time so the
  // BOM reflects the active/standby (or active/active) pair the AI
  // detected. Disks stay 1:1 — the replica is the same logical disk.
  let haPairCount = 0;
  for (const item of items) {
    const sku = recommendVm(item, opts.headroom, 2, opts.computeMode);
    const billing = billingForVm(item, opts.pricingMode, opts.nonProdPayg);
    const ahb = opts.useAhbWindows && osIsWindows(item.os);
    const meta: VmGroupKey = {
      arm: sku.armName,
      display: sku.display,
      os: osIsWindows(item.os) ? "Windows" : "Linux",
      env: isNonProd(item) ? "non-prod" : "prod",
      billing,
      ahb,
    };
    const k = groupKey(meta);
    const haUnits = item.hasHa ? 2 : 1;
    if (item.hasHa) haPairCount += 1;
    const existing = groups.get(k);
    if (existing) {
      existing.count += haUnits;
    } else {
      groups.set(k, { meta, count: haUnits, sample: item, vcpu: sku.vcpu, memoryGb: sku.memoryGb });
    }
  }

  // VM compute lines
  for (const g of groups.values()) {
    // Snapshot term fallback set so we can tell whether THIS lookup triggered one.
    const fallbackKeyBefore = cli.termFallbacks.has(`${g.meta.arm}|${g.meta.billing}`);
    const rec = await cli.vmPrice(
      g.meta.arm,
      opts.region,
      g.meta.os === "Windows",
      g.meta.billing,
      g.meta.ahb,
    );
    const fellBackToPayg =
      !fallbackKeyBefore &&
      g.meta.billing !== "payg" &&
      cli.termFallbacks.has(`${g.meta.arm}|${g.meta.billing}`);
    const effectiveLabel = fellBackToPayg
      ? `PAYG (${billingTermLabel(g.meta.billing)} unavailable in ${opts.region})`
      : billingTermLabel(g.meta.billing);
    const perHour = rec?.retailPrice ?? 0;
    const monthlyPerVm = perHour * HOURS_PER_MONTH;
    const groupMonthly = monthlyPerVm * g.count;
    const line: BomLine = {
      ...emptyBomLine(),
      category: "Virtual Machines",
      resource: `Virtual Machine ${g.meta.display} (${g.meta.os}${g.meta.ahb ? " + AHB" : ""}) x${g.count}`,
      sku: g.meta.arm,
      meter: rec?.meterName ?? "(no retail meter)",
      region: opts.region,
      quantity: HOURS_PER_MONTH,
      unit: "1 Hour",
      unitPrice: perHour,
      monthlyCost: Math.round(groupMonthly * 100) / 100,
      currency: rec?.currencyCode ?? "USD",
      source: rec ? "retail-api" : "fallback",
      productId: rec?.productId ?? "",
      skuId: rec?.skuId ?? "",
      meterId: rec?.meterId ?? "",
      serviceName: "Virtual Machines",
      customName: opts.appName ? `${opts.appName}-${g.meta.display}` : g.meta.display,
      resourceCount: g.count,
      billingTerm: effectiveLabel,
      assumption: rec
        ? `${g.count} x ${perHour.toFixed(4)}/hr x 730 hrs = ${groupMonthly.toFixed(2)}` +
          (g.meta.ahb ? " (AHB: priced as Linux)" : "") +
          (g.meta.env === "non-prod" && opts.nonProdPayg && opts.pricingMode !== "payg"
            ? " (non-prod kept on PAYG)"
            : "") +
          (fellBackToPayg
            ? ` (${billingTermLabel(g.meta.billing)} not offered for this SKU in ${opts.region} — priced at PAYG)`
            : "")
        : `No retail meter found in region ${opts.region}. Line priced at $0.`,
    };
    lines.push(line);
  }

  // Disk lines: per VM, per disk
  let totalStorageGb = 0;
  for (const item of items) {
    const tier = opts.autoDiskTier
      ? recommendDiskTier(item, opts.defaultDiskTier)
      : opts.defaultDiskTier;
    const disks = item.disks.length > 0
      ? item.disks
      : [{ label: "OS+Data", sizeGb: item.storageGb, tier: undefined }];
    for (const d of disks) {
      const effTier = d.tier ?? tier;
      const rec = recommendDisk(d.sizeGb, effTier);
      totalStorageGb += d.sizeGb;
      const priceRec = await cli.diskPrice(rec.meterName, opts.region);
      const monthly = priceRec?.retailPrice ?? 0;
      lines.push({
        ...emptyBomLine(),
        category: "Managed Disks",
        resource: `${rec.sku} (${effTier}) – ${item.name}/${d.label}`,
        sku: rec.sku,
        meter: rec.meterName,
        region: opts.region,
        quantity: 1,
        unit: "1/Month",
        unitPrice: monthly,
        monthlyCost: Math.round(monthly * 100) / 100,
        currency: priceRec?.currencyCode ?? "USD",
        source: priceRec ? "retail-api" : "fallback",
        productId: priceRec?.productId ?? "",
        skuId: priceRec?.skuId ?? "",
        meterId: priceRec?.meterId ?? "",
        serviceName: "Managed Disks",
        customName: opts.appName ? `${opts.appName}-${item.name}` : item.name,
        resourceCount: 1,
        billingTerm: "PAYG",
        assumption: `${d.sizeGb.toFixed(0)} GB → ${rec.sku} (${rec.sizeGib} GiB) ${effTier}`,
      });
    }
  }

  // SQL Server license line (per VM) — quick approximation: $73/vCPU/mo Std for AHB-less prod SQL.
  // Skipped because reliable per-core licensing requires entitlement context; flagged as TODO.

  // One Standard Load Balancer line covers all HA pairs. Real deployments
  // often run multiple LBs per tier (web/app/db) but a single shared
  // baseline is enough for cost-order-of-magnitude visibility.
  if (haPairCount > 0) {
    const monthly = 18.25 + 3.65; // 5 rules + data processed ~50 GB/mo @ $0.005/GB
    lines.push({
      ...emptyBomLine(),
      category: "Networking",
      resource: `Standard Load Balancer (HA front-end for ${haPairCount} workload${haPairCount === 1 ? "" : "s"})`,
      sku: "lb-standard",
      meter: "lb-standard",
      region: opts.region,
      quantity: 1,
      unit: "1/Month",
      unitPrice: monthly,
      monthlyCost: Math.round(monthly * 100) / 100,
      currency: "USD",
      source: "lz-baseline",
      serviceName: "Load Balancer",
      customName: opts.appName ? `${opts.appName}-lb` : "Load Balancer",
      resourceCount: 1,
      billingTerm: "PAYG",
      assumption: `Standard LB ~$18.25/mo (5 rules) + ~$3.65/mo data processed (50 GB × $0.005/GB). Hosts the active/standby (or active/active) front-end for ${haPairCount} HA-flagged workload(s).`,
    });
  }

  return { lines, vmCount: items.length, totalStorageGb };
}
