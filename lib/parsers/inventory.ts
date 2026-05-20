import { z } from "zod";
import { callWithCascade, getClient, SONNET_TO_OPUS, type ModelId } from "../anthropic";
import type { DiskItem, InventoryItem } from "../models";
import { prepare } from "./content";

const SYSTEM_PROMPT = `You are an expert data engineer specializing in IT infrastructure inventory discovery.

You will be given the FULL contents of a file describing a workload. The file may be:
- A row-per-VM spreadsheet (RVTools vInfo, Azure Migrate inventory)
- A pivoted / key-value spreadsheet layout
- Free-text spec sheet ("2 x Xeon Gold 6346 (16 Cores) … RAM: 256 GB … 4 x 1.9TB SSD")
- A PDF, Word, image, or freeform text

Your job: extract every distinct server / VM mentioned, with normalized fields, and return the list via the 'submit_inventory' tool.

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
}

export async function extractInventory(
  data: Buffer,
  filename: string,
  apiKey?: string,
): Promise<ExtractionResult> {
  const uc = await prepare(data, filename, null);
  const client = getClient(apiKey);

  const invoke = async (model: ModelId) => {
    return client.messages.create({
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
            ...uc.contentBlocks,
            {
              type: "text",
              text: `File: ${filename}\nSummary: ${uc.textSummary}\n\nExtract every VM / server you can identify and submit them via the submit_inventory tool.`,
            },
          ],
        },
      ],
    });
  };

  const response = await callWithCascade({ cascade: SONNET_TO_OPUS, invoke });
  const toolBlock = response.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    return { items: [], summary: "Extractor returned no tool_use block.", mode: "failed" };
  }
  const parsed = ExtractionSchema.parse(toolBlock.input);

  const items: InventoryItem[] = parsed.items.map((i) => {
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

  return { items, summary: parsed.summary, mode: "direct" };
}
