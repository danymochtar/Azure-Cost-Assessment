import { NextResponse } from "next/server";
import { buildLiftShiftBom, type LiftShiftOptions } from "@/lib/pillars/lift-shift";
import type { InventoryItem } from "@/lib/models";
import { RetailPricesClient } from "@/lib/pricing/retail";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { items: InventoryItem[]; options: LiftShiftOptions };
    if (!body?.items?.length) return NextResponse.json({ error: "No items" }, { status: 400 });

    const client = new RetailPricesClient(body.options.appName ? "USD" : "USD");
    const { lines } = await buildLiftShiftBom(body.items, body.options, client);

    const warnings: string[] = [];
    if (client.fallbacksUsed.size > 0) {
      warnings.push(
        `Regional fallbacks used: ${[...client.fallbacksUsed].join(", ")}. ` +
          "Deploy region remains your primary selection; only the pricing lookup was redirected.",
      );
    }
    if (client.termFallbacks.size > 0) {
      warnings.push(
        `${client.termFallbacks.size} SKU(s) have no RI/SP meter in this region — those lines were priced at PAYG.`,
      );
    }
    if (client.lastError) warnings.push(client.lastError);

    return NextResponse.json({ lines, warnings });
  } catch (e) {
    const err = e as Error;
    return NextResponse.json({ error: `${err.name}: ${err.message}` }, { status: 500 });
  }
}
