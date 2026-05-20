import { NextResponse } from "next/server";
import { extractInventory } from "@/lib/parsers/inventory";
import type { InventoryItem } from "@/lib/models";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const blobs: Array<{ name: string; data: Buffer }> = [];
    for (const [, value] of form.entries()) {
      if (value instanceof Blob) {
        const name = "name" in value && typeof value.name === "string" ? value.name : "upload";
        const buf = Buffer.from(await value.arrayBuffer());
        blobs.push({ name, data: buf });
      }
    }
    if (blobs.length === 0) return NextResponse.json({ error: "No files in form" }, { status: 400 });

    const seen = new Set<string>();
    const merged: InventoryItem[] = [];
    const warnings: string[] = [];

    const results = await Promise.allSettled(
      blobs.map(async (f) => ({ name: f.name, r: await extractInventory(f.data, f.name) })),
    );

    for (let i = 0; i < results.length; i += 1) {
      const result = results[i];
      const name = blobs[i].name;
      if (result.status === "rejected") {
        const err = result.reason as Error;
        warnings.push(`${name}: extraction failed — ${err.name}: ${err.message}`);
        continue;
      }
      const r = result.value.r;
      for (const it of r.items) {
        const k = (it.name ?? "").trim().toLowerCase();
        if (k && seen.has(k)) continue;
        if (k) seen.add(k);
        merged.push(it);
      }
      if (r.summary) warnings.push(`${name}: ${r.summary}`);
    }

    return NextResponse.json({ items: merged, warnings });
  } catch (e) {
    const err = e as Error;
    return NextResponse.json({ error: `${err.name}: ${err.message}` }, { status: 500 });
  }
}
