import { NextResponse } from "next/server";
import { z } from "zod";
import { buildLiftShiftBom, type LiftShiftOptions } from "@/lib/pillars/lift-shift";
import type { InventoryItem } from "@/lib/models";
import { RetailPricesClient } from "@/lib/pricing/retail";

export const runtime = "nodejs";
export const maxDuration = 60;

const DiskSchema = z.object({
  label: z.string(),
  sizeGb: z.number().nonnegative(),
  tier: z.string().optional(),
});

const ItemSchema = z.object({
  name: z.string().min(1),
  vcpu: z.number().int().nonnegative(),
  memoryGb: z.number().nonnegative(),
  storageGb: z.number().nonnegative(),
  os: z.string(),
  environment: z.string(),
  powerstate: z.string(),
  notes: z.string(),
  disks: z.array(DiskSchema).default([]),
  workload: z.string().optional(),
  recommendedAzureService: z.string().optional(),
});

const OptionsSchema = z.object({
  region: z.string().min(1),
  pricingMode: z.enum(["payg", "sp_1y", "sp_3y", "ri_1y", "ri_3y"]),
  computeMode: z.enum(["saving", "normal", "high_perf"]),
  useAhbWindows: z.boolean(),
  nonProdPayg: z.boolean(),
  defaultDiskTier: z.enum(["Premium SSD", "Standard SSD", "Standard HDD"]),
  autoDiskTier: z.boolean(),
  appName: z.string(),
  headroom: z.number().min(1.0).max(2.0),
});

const BodySchema = z.object({
  items: z.array(ItemSchema).min(1),
  options: OptionsSchema,
});

export async function POST(req: Request) {
  try {
    const body = BodySchema.parse(await req.json());
    const client = new RetailPricesClient("USD");
    const { lines } = await buildLiftShiftBom(
      body.items as InventoryItem[],
      body.options as LiftShiftOptions,
      client,
    );

    const warnings: string[] = [];
    if (client.fallbacksUsed.size > 0) {
      warnings.push(
        `Regional pricing fallbacks used: ${[...client.fallbacksUsed].join(", ")}. ` +
          "Deploy region remains your primary selection; only the pricing lookup was redirected.",
      );
    }
    if (client.termFallbacks.size > 0) {
      warnings.push(
        `${client.termFallbacks.size} SKU(s) have no RI/SP meter in this region — affected lines are tagged "PAYG (... unavailable)" in the Billing column.`,
      );
    }
    if (client.lastError) warnings.push(client.lastError);

    return NextResponse.json({ lines, warnings });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request body", details: e.issues }, { status: 400 });
    }
    const err = e as Error;
    return NextResponse.json({ error: `${err.name}: ${err.message}` }, { status: 500 });
  }
}
