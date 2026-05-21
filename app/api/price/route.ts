import { NextResponse } from "next/server";
import { z } from "zod";
import { buildLiftShiftBom, type LiftShiftOptions } from "@/lib/pillars/lift-shift";
import {
  buildLandingZoneBom,
  buildLandingZoneBomFromComponents,
  type LandingZoneTier,
} from "@/lib/pillars/landing-zone";
import { buildBcdrBom } from "@/lib/pillars/bcdr";
import type { InventoryItem, Notice } from "@/lib/models";
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
  hasDb: z.boolean().optional(),
  hasHa: z.boolean().optional(),
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
  landingZoneTier: z.enum(["none", "basic", "standard", "enterprise"]).default("none"),
  enableBcdr: z.boolean().default(false),
  // When `landingZoneComponents` is present (length > 0) the route uses
  // the explicit id list instead of the tier preset — that's how the
  // "Customize components" UI surfaces its picks.
  landingZoneComponents: z.array(z.string()).optional(),
  landingZoneParams: z.object({
    firewallDataGbPerMonth: z.number().nonnegative().optional(),
    privateDnsZoneCount: z.number().int().nonnegative().optional(),
    privateEndpointCount: z.number().int().nonnegative().optional(),
    storageAccountCount: z.number().int().nonnegative().optional(),
    keyVaultCount: z.number().int().nonnegative().optional(),
    containerVCoreCount: z.number().int().nonnegative().optional(),
    appServiceCount: z.number().int().nonnegative().optional(),
    sentinelGbPerMonth: z.number().nonnegative().optional(),
    logAnalyticsGbPerMonth: z.number().nonnegative().optional(),
  }).optional(),
});

const BodySchema = z.object({
  items: z.array(ItemSchema).min(1),
  options: OptionsSchema,
});

export async function POST(req: Request) {
  try {
    const body = BodySchema.parse(await req.json());
    const client = new RetailPricesClient("USD");
    const { lines: workloadLines } = await buildLiftShiftBom(
      body.items as InventoryItem[],
      body.options as LiftShiftOptions,
      client,
    );
    const lzLines = body.options.landingZoneComponents && body.options.landingZoneComponents.length > 0
      ? buildLandingZoneBomFromComponents(
          body.options.landingZoneComponents,
          body.options.region,
          body.options.appName,
          body.items as InventoryItem[],
          body.options.landingZoneParams,
          body.options.landingZoneTier as LandingZoneTier,
        )
      : buildLandingZoneBom(
          body.options.landingZoneTier as LandingZoneTier,
          body.options.region,
          body.options.appName,
          body.items as InventoryItem[],
          body.options.landingZoneParams,
        );
    const bcdrLines = body.options.enableBcdr
      ? buildBcdrBom(body.items as InventoryItem[], {
          region: body.options.region,
          appName: body.options.appName,
        })
      : [];
    const lines = [...lzLines, ...workloadLines, ...bcdrLines];

    const notices: Notice[] = [];
    if (client.fallbacksUsed.size > 0) {
      notices.push({
        severity: "info",
        title: `Regional pricing fallback used (${[...client.fallbacksUsed].join(", ")}).`,
        detail:
          "Deploy region remains your primary selection; only the pricing lookup was redirected to a nearby region where Microsoft publishes the meter.",
      });
    }
    if (client.termFallbacks.size > 0) {
      notices.push({
        severity: "info",
        title: `${client.termFallbacks.size} SKU(s) have no RI/SP meter here — billed at PAYG.`,
        detail: `Affected lines are tagged "PAYG (... unavailable)" in the Billing column.`,
      });
    }
    if (client.lastError) {
      notices.push({ severity: "warning", title: client.lastError });
    }

    return NextResponse.json({ lines, notices });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request body", details: e.issues }, { status: 400 });
    }
    const err = e as Error;
    return NextResponse.json({ error: `${err.name}: ${err.message}` }, { status: 500 });
  }
}
