import { NextResponse } from "next/server";
import { extractInventory } from "@/lib/parsers/inventory";
import type { InventoryItem } from "@/lib/models";

export const runtime = "nodejs";
export const maxDuration = 300;

interface FilePayload {
  name: string;
  data: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { files: FilePayload[] };
    const files = body?.files ?? [];
    if (files.length === 0) return NextResponse.json({ error: "No files" }, { status: 400 });

    const seen = new Set<string>();
    const merged: InventoryItem[] = [];
    const warnings: string[] = [];

    for (const f of files) {
      try {
        const buf = Buffer.from(f.data, "base64");
        const r = await extractInventory(buf, f.name);
        for (const it of r.items) {
          const k = (it.name ?? "").trim().toLowerCase();
          if (k && seen.has(k)) continue;
          if (k) seen.add(k);
          merged.push(it);
        }
        if (r.summary) warnings.push(`${f.name}: ${r.summary}`);
      } catch (e) {
        const err = e as Error;
        warnings.push(`${f.name}: extraction failed — ${err.name}: ${err.message}`);
      }
    }

    return NextResponse.json({ items: merged, warnings });
  } catch (e) {
    const err = e as Error;
    return NextResponse.json({ error: `${err.name}: ${err.message}` }, { status: 500 });
  }
}
