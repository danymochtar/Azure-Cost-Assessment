import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { getClient } from "../anthropic";
import type { DiskItem, InventoryItem } from "../models";
import { prepare } from "./content";

const SYSTEM_PROMPT = `You are an expert data engineer specializing in IT infrastructure inventory discovery.

You will be given the FULL contents of a file describing a workload. The file may be:
- A row-per-VM spreadsheet (RVTools vInfo, Azure Migrate inventory)
- A pivoted / key-value spreadsheet layout (one column holds keys like
  "Processor / RAM / Disk", an adjacent column holds the values)
- Free-text spec sheet ("2 x Xeon Gold 6346 (16 Cores) … RAM: 256 GB … 4 x 1.9TB SSD")
- A PDF, Word, image, or freeform text

Your job: extract every distinct server / VM mentioned, with normalized fields, and return the list via the 'submit_inventory' tool.

CRITICAL — read the VALUES, not just the labels:
- For pivoted layouts: scan both columns. The values column is the one
  with numbers and SKU strings (e.g. "16", "64 GB", "Xeon Gold 6346");
  the keys column has labels like "Processor", "RAM", "Disk".
- If a sheet has multiple value columns adjacent to one key column,
  each value column is a separate server — extract them all.
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
 * read the values (pivoted layouts, badly-merged headers, etc.). We
 * also treat zero items as incomplete (the file might still have
 * extractable data with a stronger model).
 */
function looksIncomplete(items: InventoryItem[]): boolean {
  if (items.length === 0) return true;
  const broken = items.filter((i) => i.vcpu === 0 && i.memoryGb === 0).length;
  return broken / items.length >= 0.5;
}

/** Why we think a particular result was incomplete — used to seed the next pass. */
function incompleteReason(items: InventoryItem[]): string {
  if (items.length === 0) return "extractor returned zero items";
  const broken = items.filter((i) => i.vcpu === 0 && i.memoryGb === 0).length;
  return `${broken} of ${items.length} extracted items have vcpu=0 and memory_gb=0`;
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

/**
 * Extract VM inventory with a quality-gated model cascade:
 *
 *   1. Haiku 4.5  — fast + cheap. Almost always good for clean RVTools / CSV.
 *   2. Sonnet 4.6 — escalate when Haiku returns zeros (pivoted layouts,
 *                   merged headers, key-value sheets).
 *   3. Opus 4.7   — escalate when Sonnet also returns zeros (very complex
 *                   PDFs / free-text spec sheets / mixed pivoted+narrative).
 *
 * Each retry includes a hint about WHY the previous attempt was deemed
 * incomplete, so the stronger model knows what to look for.
 *
 * Transient errors (529, 5xx, network blips) also fall through to the
 * next model in the cascade — same as the prior `callWithCascade` policy.
 *
 * Returns the BEST result seen, even if Opus also came back incomplete
 * (the assumption sheet in Excel will surface zero-value fields).
 */
export async function extractInventory(
  data: Buffer,
  filename: string,
  apiKey?: string,
): Promise<ExtractionResult> {
  const uc = await prepare(data, filename, null);
  const client = getClient(apiKey);

  let best: { items: InventoryItem[]; summary: string; modelUsed: string } | null = null;
  const escalations: string[] = [];

  for (let i = 0; i < EXTRACTION_CASCADE.length; i += 1) {
    const model = EXTRACTION_CASCADE[i];
    const retryHint = best ? incompleteReason(best.items) : "";

    try {
      const r = await callExtractor(client, model, uc.contentBlocks, filename, uc.textSummary, retryHint);
      if (!r) {
        escalations.push(`${model}: no tool_use block`);
        continue;
      }
      // Always remember the latest non-null result so we can fall back to
      // the best-effort output even if all three passes are incomplete.
      best = { ...r, modelUsed: model };
      if (!looksIncomplete(r.items)) {
        if (i > 0) escalations.push(`succeeded on ${model} after ${i} earlier attempt(s)`);
        return {
          items: r.items,
          summary: r.summary,
          mode: "direct",
          modelUsed: model,
          escalations: escalations.length ? escalations : undefined,
        };
      }
      escalations.push(`${model}: ${incompleteReason(r.items)}`);
    } catch (e) {
      if (isTransient(e)) {
        escalations.push(`${model}: transient ${(e as Error).message}`);
        continue;
      }
      // Hard error — surface it
      throw e;
    }
  }

  if (best) {
    return {
      items: best.items,
      summary: best.summary,
      mode: "direct",
      modelUsed: best.modelUsed,
      escalations,
    };
  }
  return {
    items: [],
    summary: "Extractor returned no usable result across Haiku → Sonnet → Opus.",
    mode: "failed",
    escalations,
  };
}
