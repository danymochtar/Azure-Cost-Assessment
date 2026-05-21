import { z } from "zod";
import { callWithCascade, getClient, HAIKU_TO_OPUS, type ModelId } from "../anthropic";
import type { AssessmentProfile, WorkloadType } from "../models";
import { accumulate, deltaFromMessage, emptyUsage, type UsageTotal } from "../usage";
import { prepare } from "./content";

export interface FileBlob {
  name: string;
  data: Buffer;
}

const SYSTEM_PROMPT = `You are an Azure solution architect triaging an uploaded file to decide which Azure pillar's cost assessment to run.

Inspect the file preview (sheet names / column headers / a few sample rows / PDF pages / image / document text) and classify its workload intent into ONE of these pillars (or 'mixed' / 'unknown'):

- infra_lift_shift — per-VM / per-server inventory (RVTools vInfo, infra list, spec sheet with CPU/RAM/disk per host). Goal: right-size Azure VMs + managed disks + landing zone. Signals: columns like 'vCPU / Memory / Provisioned MiB', rows per host, phrases like 'migration', 'lift-and-shift', powerstate fields.
- infra_modernization — application-layer modernization (containerize, move to PaaS). Goal: App Service / AKS / Container Apps / API Management / Front Door / ACR. Signals: 'refactor', 'containerize', 'AKS', 'microservices', 'App Service', architecture diagrams without per-host sizing.
- data_platform — data warehouse / lakehouse / streaming / analytics. Goal: Microsoft Fabric, Synapse, Databricks, Azure SQL DB, Cosmos DB, ADLS Gen2, Data Factory, Event Hubs, Power BI.
- ai_application — AI / ML application design. Goal: Azure OpenAI, AI Search, Azure ML, GPU fine-tuning, Cognitive Services.
- azure_security — security / SOC / governance. Goal: Defender suite, Microsoft Sentinel, Log Analytics ingestion + retention, WAF, Private Link, Purview, PIM.
- hybrid_multicloud — Azure Arc + Defender across on-prem / AWS / GCP; Arc-enabled SQL Server or Windows Server licensing.
- m365_and_others — M365 Backup / Archive, SharePoint Premium / Syntex, Copilot Studio, generic Azure-marketplace SaaS.
- mixed — multiple pillars genuinely first-class.
- unknown — cannot classify confidently.

Rules:
1. Pick the MOST SPECIFIC single pillar when possible. Only use 'mixed' when multiple pillars are clearly first-class.
2. needs_vm_extraction=true ONLY when the file contains per-VM rows that justify running the expensive Sonnet extractor.
3. signals — short phrases quoting evidence ("column 'SIEM EPS'", "sheet 'Model Inventory'", "mentions 'RAG pipeline'").
4. Keep summary to one short sentence.
5. reasoning — 1–2 sentences a customer architect could defend to a stakeholder. Tie the evidence in 'signals' to why this pillar fits AND why the other pillars don't (e.g. "Per-VM specs with powerstate and provisioned MiB columns match the lift-and-shift fingerprint; no PaaS or modernization signals like 'AKS', 'App Service', or 'containerize'."). Keep it under 240 characters.

You MUST respond by calling the 'submit_classification' tool with the result.`;

const ClassificationSchema = z.object({
  workload_type: z.enum([
    "infra_lift_shift",
    "infra_modernization",
    "data_platform",
    "ai_application",
    "azure_security",
    "hybrid_multicloud",
    "m365_and_others",
    "mixed",
    "unknown",
  ]),
  confidence: z.number().min(0).max(1),
  complexity: z.enum(["simple", "moderate", "complex"]).default("moderate"),
  needs_vm_extraction: z.boolean().default(false),
  suggested_components: z.array(z.string()).default([]),
  signals: z.array(z.string()).default([]),
  summary: z.string().default(""),
  reasoning: z.string().default(""),
});

const TOOL_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    workload_type: {
      type: "string",
      enum: [
        "infra_lift_shift", "infra_modernization", "data_platform",
        "ai_application", "azure_security", "hybrid_multicloud",
        "m365_and_others", "mixed", "unknown",
      ],
      description: "Primary Azure pillar this workload maps to.",
    },
    confidence: { type: "number", minimum: 0, maximum: 1, description: "0..1 confidence in the classification." },
    complexity: { type: "string", enum: ["simple", "moderate", "complex"] },
    needs_vm_extraction: { type: "boolean", description: "True only when per-VM extraction is justified." },
    suggested_components: { type: "array", items: { type: "string" } },
    signals: { type: "array", items: { type: "string" } },
    summary: { type: "string", description: "One short sentence summary." },
    reasoning: { type: "string", description: "1-2 sentences a customer architect could defend: why this pillar fits AND why the others don't. <240 chars." },
  },
  required: ["workload_type", "confidence"],
};

const ALIAS_MAP: Record<string, WorkloadType> = {
  vm_inventory: "infra_lift_shift",
  app_modernization: "infra_modernization",
  ai_ml: "ai_application",
  siem_soc: "azure_security",
};

function resolveAlias(t: string): WorkloadType {
  return (ALIAS_MAP[t] ?? t) as WorkloadType;
}

export async function classify(
  data: Buffer,
  filename: string,
  apiKey?: string,
  usage?: UsageTotal,
): Promise<AssessmentProfile> {
  const uc = await prepare(data, filename, 5);
  const client = getClient(apiKey);

  const invoke = async (model: ModelId) => {
    return client.messages.create({
      model,
      max_tokens: 2000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: [
        {
          name: "submit_classification",
          description: "Submit the workload classification.",
          input_schema: TOOL_INPUT_SCHEMA,
        },
      ],
      tool_choice: { type: "tool", name: "submit_classification" },
      messages: [
        {
          role: "user",
          content: [
            ...uc.contentBlocks,
            {
              type: "text",
              text: `File: ${filename}\nSummary: ${uc.textSummary}\n\nClassify the workload based on the content above.`,
            },
          ],
        },
      ],
    });
  };

  const response = await callWithCascade({ cascade: HAIKU_TO_OPUS, invoke });
  if (usage) accumulate(usage, deltaFromMessage(response));
  const toolBlock = response.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error("Classifier did not return a tool_use block");
  }
  const parsed = ClassificationSchema.parse(toolBlock.input);
  return {
    workloadType: resolveAlias(parsed.workload_type),
    confidence: parsed.confidence,
    complexity: parsed.complexity,
    needsVmExtraction: parsed.needs_vm_extraction,
    suggestedComponents: parsed.suggested_components,
    signals: parsed.signals,
    summary: parsed.summary,
    reasoning: parsed.reasoning,
  };
}

export interface ClassificationResult {
  filename: string;
  profile: AssessmentProfile | null;
  error?: string;
}

export async function classifyMany(
  files: FileBlob[],
  apiKey?: string,
): Promise<{ perFile: ClassificationResult[]; aggregate: AssessmentProfile; usage: UsageTotal }> {
  const usage = emptyUsage();
  const perFile = await Promise.all(
    files.map(async (f): Promise<ClassificationResult> => {
      try {
        const profile = await classify(f.data, f.name, apiKey, usage);
        return { filename: f.name, profile };
      } catch (e) {
        return { filename: f.name, profile: null, error: (e as Error).message };
      }
    }),
  );

  const valid = perFile.filter((p): p is ClassificationResult & { profile: AssessmentProfile } =>
    p.profile !== null && p.profile.workloadType !== "unknown",
  );

  // Pick the highest-confidence non-unknown as primary; union suggested components;
  // OR together needs_vm_extraction. Matches the Python aggregation in app.py:670-684.
  let aggregate: AssessmentProfile;
  if (valid.length > 0) {
    const primary = valid.reduce((a, b) =>
      a.profile.confidence >= b.profile.confidence ? a : b,
    );
    const allSuggested = new Set<string>();
    for (const v of valid) {
      for (const c of v.profile.suggestedComponents) allSuggested.add(c);
    }
    aggregate = {
      ...primary.profile,
      suggestedComponents: Array.from(allSuggested).sort(),
      needsVmExtraction: valid.some((v) => v.profile.needsVmExtraction),
    };
  } else {
    aggregate = {
      workloadType: "unknown",
      confidence: 0,
      complexity: "moderate",
      needsVmExtraction: false,
      suggestedComponents: [],
      signals: [],
      summary: "All files failed to classify or returned 'unknown'.",
      reasoning: "No file in the upload set produced a confident pillar match. Re-upload a richer source (RVTools export, spec sheet, architecture diagram) so the classifier has signals to anchor on.",
    };
  }

  return { perFile, aggregate, usage };
}
