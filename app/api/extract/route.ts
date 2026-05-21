import { NextResponse } from "next/server";
import { extractInventory } from "@/lib/parsers/inventory";
import type { InventoryItem, Notice } from "@/lib/models";
import { emptyUsage, mergeUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 300;

// Trim an AI-generated summary to a short headline (first sentence, no
// trailing prose). Keeps the per-file warning banner scannable while the
// full text stays available as `detail` for the curious / debugging.
function shortHeadline(text: string, max = 140): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  const sentenceEnd = cleaned.search(/[.!?]\s/);
  if (sentenceEnd > 0 && sentenceEnd < max) return cleaned.slice(0, sentenceEnd + 1);
  return `${cleaned.slice(0, max - 1).trimEnd()}…`;
}

function modelShort(m?: string): string | undefined {
  if (!m) return undefined;
  if (m.includes("haiku")) return "Haiku";
  if (m.includes("sonnet")) return "Sonnet";
  if (m.includes("opus")) return "Opus";
  return m;
}

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
    const notices: Notice[] = [];
    let usage = emptyUsage();

    const results = await Promise.allSettled(
      blobs.map(async (f) => ({ name: f.name, r: await extractInventory(f.data, f.name) })),
    );

    for (let i = 0; i < results.length; i += 1) {
      const result = results[i];
      const name = blobs[i].name;
      if (result.status === "rejected") {
        const err = result.reason as Error;
        notices.push({
          severity: "error",
          source: name,
          title: `Extraction failed: ${err.message}`,
        });
        continue;
      }
      const r = result.value.r;
      usage = mergeUsage(usage, r.usage);
      for (const it of r.items) {
        const k = (it.name ?? "").trim().toLowerCase();
        if (k && seen.has(k)) continue;
        if (k) seen.add(k);
        merged.push(it);
      }

      // Full failure across the cascade is the only thing the user MUST
      // act on — flag it as an error so it surfaces above the fold.
      if (r.mode === "failed") {
        notices.push({
          severity: "error",
          source: name,
          title: "Extractor returned no usable result — re-share with cell values populated.",
          detail: r.summary || undefined,
        });
        continue;
      }

      // Quality miss: items came back but most have zero specs. Still
      // worth surfacing prominently because pricing will be wrong.
      const broken = r.items.filter((it) => it.vcpu === 0 && it.memoryGb === 0).length;
      const brokenRatio = r.items.length === 0 ? 0 : broken / r.items.length;
      if (brokenRatio >= 0.5 && r.items.length > 0) {
        notices.push({
          severity: "warning",
          source: name,
          title: `${broken} of ${r.items.length} extracted items are missing vCPU/memory — pricing will be inaccurate.`,
          detail: r.summary || undefined,
        });
      } else if (r.summary) {
        // Healthy extraction: keep the AI's summary as an info pill with
        // a short headline; the full text lives in `detail`.
        notices.push({
          severity: "info",
          source: name,
          title: shortHeadline(r.summary),
          detail: r.summary.length > 140 ? r.summary : undefined,
        });
      }

      // Model escalation is purely informational — it tells the user the
      // cascade kicked in, but the result is fine.
      const mShort = modelShort(r.modelUsed);
      if (mShort && r.modelUsed !== "claude-haiku-4-5") {
        notices.push({
          severity: "info",
          source: name,
          title: `Escalated to ${mShort}.`,
        });
      }
    }

    return NextResponse.json({ items: merged, notices, usage });
  } catch (e) {
    const err = e as Error;
    return NextResponse.json({ error: `${err.name}: ${err.message}` }, { status: 500 });
  }
}
