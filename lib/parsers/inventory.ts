import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { getClient } from "../anthropic";
import type { DiskItem, InventoryItem } from "../models";
import { accumulate, deltaFromMessage, emptyUsage, type UsageTotal } from "../usage";
import { prepareChunks, type UploadChunk } from "./content";

const SYSTEM_PROMPT = `You are an expert data engineer specializing in IT infrastructure inventory discovery.

You will be given the FULL contents of a file describing a workload. The file may be:
- A row-per-VM spreadsheet (RVTools vInfo, Azure Migrate inventory)
- A pivoted / key-value spreadsheet layout (one column holds keys like
  "Processor / RAM / Disk", an adjacent column holds the values)
- Free-text spec sheet ("2 x Xeon Gold 6346 (16 Cores) … RAM: 256 GB … 4 x 1.9TB SSD")
- A PDF, Word, image, or freeform text

Your job: extract every distinct server / VM mentioned, with normalized fields, and return the list via the 'submit_inventory' tool.

CRITICAL — read the VALUES, not just the labels:
- For pivoted layouts: scan EVERY column to the right of the keys column,
  even if its column header is blank or auto-named like "Column B". The
  preview generator pads the header row to the widest data row so the
  values are always present in the table — they will NOT be missing
  from your input.
- The values column is the one with numbers and SKU strings (e.g. "16",
  "64 GB", "Xeon Gold 6346"); the keys column has labels like
  "Processor", "RAM", "Disk".
- If a sheet has multiple value columns adjacent to one key column,
  each value column is a separate server — extract them all.
- For images: zoom mentally on every column you can see. Do not assume
  the right-hand column is missing just because it's narrow or visually
  separated — re-read the pixels before defaulting to zeros.
- NEVER return vcpu=0, memory_gb=0, or storage_gb=0 silently. If you
  truly cannot find the value, set the field to 0 AND write a short
  note explaining what was missing so the user can fix the upload.

Conversion rules:
- vCPU = total cores. If only "2 x 16-core CPUs" is given, vCPU = 32.
- memory_gb: convert MB/MiB to GB (divide by 1024). GiB ~= GB.
- storage_gb: sum of all disk capacities in GB. Convert TB → GB by ×1024.
- disks: when the source has per-disk rows (RVTools vDisk, Azure Migrate disks),
  populate one entry per disk. When only a single total is given, leave disks=[].
- os: best-guess family from any OS string. Default 'Linux' if absent.
- environment: 'prod' unless name/tag implies dev/test/uat/staging/sit/qa/preprod/sandbox.
- powerstate: 'poweredOn' / 'poweredOff' / 'unknown'.
- workload: best-guess role — 'sql' | 'web' | 'app' | 'cache' | 'queue' | 'file' | 'ad' | 'general'.
- needs_ha: TRUE when the source document indicates this workload should run in a high-availability topology. Look for phrases like 'active-active', 'active-passive', 'active/standby', 'cluster', 'failover', 'load balanced', 'redundant', 'HA pair', 'primary/secondary', 'highly available', or naming conventions like '-ha-', '-prim-', '-sec-', '-node1/node2'. Defaults to FALSE if not indicated.

JUSTIFY YOUR PICKS — every item MUST include:
- sizing_rationale: ≤120 chars explaining the VM-shape choice from the SPEC numbers. Tie cpu+memory+workload to an Azure VM family: D/Dv5 = general-purpose (memory/vCPU ≈ 4:1); E/Ev5 = memory-optimised (>6:1 ratio, RAM-heavy DBs); B = burstable for steady low load / non-prod; F = compute-optimised (<2:1 ratio, CPU-heavy batch); NC = GPU. Example: "8 vCPU + 32 GB, mem/cpu=4:1 → D8s v5 general-purpose; prod tier so D-series over B-series."
- service_rationale: ≤120 chars explaining the recommended_azure_service mapping from the WORKLOAD. Why this Azure service rather than the obvious alternative. Example: "Domain controller — Azure VM rather than App Service because Active Directory needs a domain-joined Windows host." Or: "Stateless web tier — App Service P1v3 rather than VM because no OS-level customisation needed and auto-scale is built-in."
Default to "" only if the source genuinely gives no signal.

Do NOT invent VMs. Do NOT skip VMs. If a VM has missing fields, set the field to a sensible default and mention it in 'notes'.

You MUST respond by calling 'submit_inventory'.`;

const DiskSchema = z.object({
  label: z.string(),
  size_gb: z.number().nonnegative(),
  tier: z.string().default(""),
});

const ItemSchema = z.object({
  name: z.string(),
  vcpu: z.number().int().nonnegative(),
  memory_gb: z.number().nonnegative(),
  storage_gb: z.number().nonnegative(),
  disks: z.array(DiskSchema).default([]),
  os: z.string().default("Linux"),
  environment: z.string().default("prod"),
  powerstate: z.string().default("poweredOn"),
  workload: z.string().default("general"),
  recommended_azure_service: z.string().default("Azure Virtual Machine"),
  notes: z.string().default(""),
  needs_ha: z.boolean().default(false),
  sizing_rationale: z.string().default(""),
  service_rationale: z.string().default(""),
});

const ExtractionSchema = z.object({
  items: z.array(ItemSchema),
  summary: z.string().default(""),
});

const TOOL_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          vcpu: { type: "integer", minimum: 0 },
          memory_gb: { type: "number", minimum: 0 },
          storage_gb: { type: "number", minimum: 0 },
          disks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                size_gb: { type: "number", minimum: 0 },
                tier: { type: "string" },
              },
              required: ["label", "size_gb"],
            },
          },
          os: { type: "string" },
          environment: { type: "string" },
          powerstate: { type: "string" },
          workload: { type: "string" },
          recommended_azure_service: { type: "string" },
          notes: { type: "string" },
          needs_ha: { type: "boolean", description: "True when the source doc indicates this workload runs in an HA topology (cluster, active-active, active-passive, load-balanced, redundant, failover)." },
          sizing_rationale: { type: "string", description: "≤120 chars: why this VM shape from the SPEC. Tie cpu+memory+workload to an Azure VM family." },
          service_rationale: { type: "string", description: "≤120 chars: why this Azure service from the WORKLOAD, vs the obvious alternative." },
        },
        required: ["name", "vcpu", "memory_gb", "storage_gb"],
      },
    },
    summary: { type: "string" },
  },
  required: ["items"],
};

export interface ExtractionResult {
  items: InventoryItem[];
  summary: string;
  mode: "direct" | "failed";
  modelUsed?: string;
  escalations?: string[]; // human-readable trail of which models were tried
  usage: UsageTotal;
}

// Escalation cascade. Cheap first, expensive only when needed.
const EXTRACTION_CASCADE = [
  "claude-haiku-4-5",
  "claude-sonnet-4-6",
  "claude-opus-4-7",
] as const;

/**
 * Heuristic: are the extracted items obviously broken?
 *
 * An "incomplete" extraction is one where most items came back with
 * vcpu=0 AND memory_gb=0 — i.e. Claude saw the row labels but couldn't
 * read the values (pivoted layouts, badly-merged headers, etc.).
 *
 * Zero items is more nuanced:
 *   - For a SMALL text / pasted-content input (< ~1500 chars), zero
 *     items is almost always definitive — the user pasted an intro
 *     sentence or a note with no spec table. Escalating to Sonnet /
 *     Opus would just burn tokens to get the same "nothing here"
 *     answer. Trust Haiku.
 *   - For spreadsheets, PDFs, images, or large text — zero items
 *     might be a real Haiku miss (pivoted layout, OCR failure on a
 *     screenshot, etc.) and IS worth escalating.
 */
// Headers / sheet-name tokens that look "VM-shaped" — if a chunk's
// preview text mentions any of these we expect VMs to be extractable.
// Sheets with NONE of these (Notes, Cover, ReadMe, ChangeLog tabs) get
// Haiku's 0-item verdict trusted so we don't burn Sonnet+Opus calls.
const VM_HINT_RE = /\b(vcpu|cpu|core|memory|ram|gb|mb|mib|disk|storage|server|host|vm|hostname|powerstate|virtual\s*machine|os|operating\s*system)\b/i;

function looksIncomplete(items: InventoryItem[], chunk: UploadChunk): boolean {
  if (items.length === 0) {
    const block = chunk.contentBlocks[0];
    const isSmallText =
      (chunk.kind === "text" || chunk.filename.startsWith("pasted-content-")) &&
      block?.type === "text" &&
      block.text.length < 1500;
    if (isSmallText) return false;
    // Per-sheet chunks where the preview has no VM-shaped headers — a
    // Notes / Cover / ChangeLog tab. Trust Haiku's 0 verdict; escalating
    // would waste Sonnet + Opus tokens on a sheet that genuinely has no
    // VMs. Only fires on spreadsheet chunks (PDFs / images / large text
    // still escalate as before).
    if (chunk.kind === "spreadsheet" && block?.type === "text") {
      const preview = block.text.slice(0, 4000); // first ~4k chars covers headers + first rows
      if (!VM_HINT_RE.test(preview)) return false;
    }
    return true;
  }
  const broken = items.filter((i) => i.vcpu === 0 && i.memoryGb === 0).length;
  return broken / items.length >= 0.5;
}

/** Why we think a particular result was incomplete — used to seed the next pass. */
function incompleteReason(items: InventoryItem[]): string {
  if (items.length === 0) return "extractor returned zero items";
  const broken = items.filter((i) => i.vcpu === 0 && i.memoryGb === 0).length;
  return `${broken} of ${items.length} extracted items have vcpu=0 and memory_gb=0`;
}

const DB_HINT_RE = /\b(sql|mssql|postgres|mysql|mariadb|oracle|mongo|cassandra|hana|cockroach|db2|sybase|redis)\b/i;

function detectDb(workload: string | undefined, name: string, notes: string): boolean {
  if (workload === "sql" || workload === "db") return true;
  const hay = `${name} ${notes}`;
  return DB_HINT_RE.test(hay);
}

// Heuristics for the AI's needs_ha output. Catches the obvious naming
// patterns even when the model forgot to set the flag.
const HA_HINT_RE =
  /\b(active[-\s\/]?active|active[-\s\/]?passive|active[-\s\/]?standby|cluster(?:ed|ing)?|failover|loadbalanc|load[-\s]?balanc|redundan|h[\W_]?a[\W_]|highly\s*available|high\s*availability|primary[-\s]?secondary|hot[-\s]?(?:standby|spare))\b/i;

function detectHa(modelFlag: boolean, name: string, notes: string, workload: string): boolean {
  if (modelFlag) return true;
  const hay = `${name} ${notes} ${workload}`;
  return HA_HINT_RE.test(hay);
}

function mapItems(parsed: z.infer<typeof ExtractionSchema>): InventoryItem[] {
  return parsed.items.map((i) => {
    const disks: DiskItem[] = i.disks.map((d) => ({
      label: d.label,
      sizeGb: d.size_gb,
      tier: d.tier || undefined,
    }));
    return {
      name: i.name,
      vcpu: i.vcpu,
      memoryGb: i.memory_gb,
      storageGb: i.storage_gb,
      os: i.os,
      environment: i.environment,
      powerstate: i.powerstate,
      notes: i.notes,
      disks,
      workload: i.workload,
      recommendedAzureService: i.recommended_azure_service,
      sizingRationale: i.sizing_rationale || undefined,
      serviceRationale: i.service_rationale || undefined,
      hasDb: detectDb(i.workload, i.name, i.notes),
      hasHa: detectHa(i.needs_ha, i.name, i.notes, i.workload),
    };
  });
}

async function callExtractor(
  client: Anthropic,
  model: string,
  contentBlocks: Anthropic.Messages.ContentBlockParam[],
  filename: string,
  textSummary: string,
  retryHint: string,
  usage?: UsageTotal,
): Promise<{ items: InventoryItem[]; summary: string } | null> {
  const hint = retryHint
    ? `\n\nNOTE: a previous attempt was incomplete (${retryHint}). Look more carefully at the VALUES side of any pivoted layouts — the numeric specs ARE somewhere in the preview.`
    : "";

  const resp = await client.messages.create({
    model,
    max_tokens: 16000,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: [
      {
        name: "submit_inventory",
        description: "Submit the full extracted VM inventory from the uploaded file.",
        input_schema: TOOL_INPUT_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: "submit_inventory" },
    messages: [
      {
        role: "user",
        content: [
          ...contentBlocks,
          {
            type: "text",
            text: `File: ${filename}\nSummary: ${textSummary}\n\nExtract every VM / server you can identify and submit them via the submit_inventory tool.${hint}`,
          },
        ],
      },
    ],
  });

  if (usage) accumulate(usage, deltaFromMessage(resp, model));
  const toolBlock = resp.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") return null;
  const parsed = ExtractionSchema.parse(toolBlock.input);
  return { items: mapItems(parsed), summary: parsed.summary };
}

function isTransient(e: unknown): boolean {
  const err = e as { status?: number; name?: string };
  return (
    err?.status === 502 ||
    err?.status === 503 ||
    err?.status === 504 ||
    err?.status === 529 ||
    err?.name === "APIConnectionError"
  );
}

function isRateLimit(e: unknown): boolean {
  const err = e as { status?: number };
  return err?.status === 429;
}

/** Sleep helper; resolves after `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Best-effort extraction of the rate-limit retry interval. Anthropic
 * 429s include a `retry-after` header (seconds) plus the message text
 * which mentions tokens-per-minute. We grab the header when present,
 * default to 30 s otherwise. Capped at 90 s so we don't hit the Vercel
 * function timeout while waiting.
 */
function rateLimitSleepMs(e: unknown): number {
  const err = e as { headers?: Record<string, string> };
  const raw = err?.headers?.["retry-after"] ?? err?.headers?.["Retry-After"];
  const n = raw ? parseInt(String(raw), 10) : NaN;
  if (Number.isFinite(n) && n > 0) return Math.min(n, 90) * 1000;
  return 30_000;
}

/**
 * Run one quality-gated cascade (Haiku → Sonnet → Opus) over a single
 * chunk's content blocks. Each retry includes a hint about WHY the
 * previous attempt was incomplete, so the stronger model knows what
 * to look for.
 *
 * On 429 (rate limit) we sleep the suggested retry-after window and
 * try the SAME model again (up to 2 retries) — escalating doesn't
 * help because all three models share the same org-level TPM.
 */
async function extractOneChunk(
  client: Anthropic,
  chunk: UploadChunk,
  trail: string[],
  usage?: UsageTotal,
): Promise<{ items: InventoryItem[]; summary: string; modelUsed: string } | null> {
  let best: { items: InventoryItem[]; summary: string; modelUsed: string } | null = null;
  const labelPrefix = chunk.totalChunks > 1 ? `[${chunk.chunkLabel}] ` : "";

  for (let i = 0; i < EXTRACTION_CASCADE.length; i += 1) {
    const model = EXTRACTION_CASCADE[i];
    const retryHint = best ? incompleteReason(best.items) : "";

    let attempt = 0;
    while (attempt < 3) {
      try {
        const r = await callExtractor(
          client,
          model,
          chunk.contentBlocks,
          chunk.filename,
          chunk.textSummary,
          retryHint,
          usage,
        );
        if (!r) {
          trail.push(`${labelPrefix}${model}: no tool_use block`);
          break; // try next model
        }
        best = { ...r, modelUsed: model };
        if (!looksIncomplete(r.items, chunk)) {
          if (i > 0) trail.push(`${labelPrefix}succeeded on ${model} after ${i} earlier attempt(s)`);
          return best;
        }
        trail.push(`${labelPrefix}${model}: ${incompleteReason(r.items)}`);
        break; // escalate to next model
      } catch (e) {
        if (isRateLimit(e) && attempt < 2) {
          const wait = rateLimitSleepMs(e);
          trail.push(`${labelPrefix}${model}: rate-limited, waiting ${(wait / 1000).toFixed(0)}s before retry`);
          await sleep(wait);
          attempt += 1;
          continue;
        }
        if (isTransient(e)) {
          trail.push(`${labelPrefix}${model}: transient ${(e as Error).message}`);
          break; // try next model in cascade
        }
        throw e;
      }
    }
  }

  return best;
}

/**
 * Extract VM inventory with a quality-gated model cascade across one
 * or more file chunks.
 *
 * Sizing strategy:
 *
 *   1. `prepareChunks` slices spreadsheets larger than 300 rows into
 *      smaller previews so each request stays well under the org's
 *      50,000 input-tokens-per-minute rate limit.
 *   2. Each chunk runs through the Haiku → Sonnet → Opus cascade
 *      independently, escalating only when the chunk's result looks
 *      incomplete (≥50% zeros or no items).
 *   3. Between chunks we sleep 12 s so a 5-chunk file stays comfortably
 *      below the TPM cap (10s gives ~6 cps × ~8k tok/call = 48k TPM).
 *   4. Results from every chunk are concatenated and de-duplicated by
 *      VM name (case-insensitive) — same merge policy used at the
 *      cross-file level in /api/extract/route.ts.
 *
 * Non-spreadsheet files (PDF / DOCX / image / text) bypass chunking
 * and run as a single chunk.
 */
// Empty rows are stripped by the parser, so 500-row chunks comfortably
// fit under Anthropic's 50k input-tokens-per-minute Tier 1 cap for the
// typical RVTools shape (~5-8k tokens per chunk). Halving the inter-
// chunk delay roughly doubles throughput for big files — rate-limit
// 429s still trigger the `Retry-After` sleep in extractOneChunk.
const INTER_CHUNK_DELAY_MS = 6_000;
const ROWS_PER_CHUNK = 500;

export async function extractInventory(
  data: Buffer,
  filename: string,
  apiKey?: string,
): Promise<ExtractionResult> {
  const chunks = await prepareChunks(data, filename, ROWS_PER_CHUNK);
  const client = getClient(apiKey);

  const escalations: string[] = [];
  const merged: InventoryItem[] = [];
  const seen = new Set<string>();
  const usage = emptyUsage();
  let bestSummary = "";
  let bestModelUsed = "";

  if (chunks.length > 1) {
    escalations.push(
      `${filename}: spreadsheet split into ${chunks.length} chunks (${ROWS_PER_CHUNK} rows each) ` +
        `to stay under Anthropic's input-tokens-per-minute rate limit.`,
    );
  }

  for (let ci = 0; ci < chunks.length; ci += 1) {
    const chunk = chunks[ci];

    // Throttle between chunks — first chunk runs immediately.
    if (ci > 0) await sleep(INTER_CHUNK_DELAY_MS);

    let result: { items: InventoryItem[]; summary: string; modelUsed: string } | null;
    try {
      result = await extractOneChunk(client, chunk, escalations, usage);
    } catch (e) {
      escalations.push(`${chunk.chunkLabel ?? `chunk ${ci + 1}`}: hard error ${(e as Error).message}`);
      continue;
    }

    if (!result) {
      escalations.push(`${chunk.chunkLabel ?? `chunk ${ci + 1}`}: no usable result across Haiku → Sonnet → Opus`);
      continue;
    }

    for (const it of result.items) {
      const key = (it.name ?? "").trim().toLowerCase();
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      merged.push(it);
    }
    if (!bestSummary && result.summary) bestSummary = result.summary;
    if (!bestModelUsed) bestModelUsed = result.modelUsed;
    else if (result.modelUsed && result.modelUsed !== bestModelUsed) {
      // Mixed models across chunks — surface that explicitly.
      bestModelUsed = `${bestModelUsed}+${result.modelUsed}`;
    }
  }

  if (merged.length === 0) {
    return {
      items: [],
      summary: "Extractor returned no usable result across Haiku → Sonnet → Opus.",
      mode: "failed",
      escalations,
      usage,
    };
  }

  return {
    items: merged,
    summary:
      chunks.length > 1
        ? `${bestSummary || "Extracted across chunks."} (Merged ${merged.length} unique VMs from ${chunks.length} chunks.)`
        : bestSummary,
    mode: "direct",
    modelUsed: bestModelUsed,
    escalations: escalations.length ? escalations : undefined,
    usage,
  };
}
