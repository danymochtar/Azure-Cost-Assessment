// AI Application parametric pricing.
//
// Use-case driven: OpenAI model + per-month input/output token volume,
// embeddings, AI Search tier, ML compute hours, Doc Intelligence pages.
// East US 2 USD list rates, late 2025.

import { type BomLine, emptyBomLine } from "../models";

export type OpenAiModel =
  | "gpt-4o" | "gpt-4o-mini" | "gpt-4.1" | "gpt-4.1-mini"
  | "o1" | "o1-mini" | "o3-mini";

export interface AiApplicationParams {
  /** OpenAI chat model + monthly token volumes (millions). 0/0 drops the line. */
  openAiModel?: OpenAiModel;
  openAiInputTokensMillions?: number;
  openAiOutputTokensMillions?: number;
  /** Cached input tokens (millions). Most models cache at 10× cheaper. */
  openAiCachedInputTokensMillions?: number;
  /** Embeddings (text-embedding-3-small) volume per month (millions). 0 drops. */
  embeddingsTokensMillions?: number;
  /** AI Search SKU. "off" drops the line. */
  aiSearchTier?: "off" | "basic" | "s1" | "s2" | "s3";
  aiSearchPartitions?: number;
  /** Azure ML compute SKU + monthly hours. 0 hours drops the line. */
  mlComputeSku?: "D4s_v5" | "D8s_v5" | "D16s_v5" | "NC4as_T4_v3" | "NC24ads_A100_v4";
  mlComputeHoursMonth?: number;
  /** Document Intelligence — prebuilt model pages per month (k). 0 drops. */
  docIntelligencePagesK?: number;
}

// Public Azure OpenAI per-1M-token rates (late 2025). Inputs / outputs
// / cached-input keyed by model id.
const OPENAI: Record<OpenAiModel, { input: number; output: number; cachedInput: number }> = {
  "gpt-4o":      { input: 2.50,  output: 10.00, cachedInput: 1.25 },
  "gpt-4o-mini": { input: 0.15,  output: 0.60,  cachedInput: 0.075 },
  "gpt-4.1":     { input: 2.00,  output: 8.00,  cachedInput: 0.50 },
  "gpt-4.1-mini":{ input: 0.40,  output: 1.60,  cachedInput: 0.10 },
  "o1":          { input: 15.00, output: 60.00, cachedInput: 7.50 },
  "o1-mini":     { input: 3.00,  output: 12.00, cachedInput: 1.50 },
  "o3-mini":     { input: 1.10,  output: 4.40,  cachedInput: 0.55 },
};

const AI_SEARCH_HOURLY: Record<Exclude<NonNullable<AiApplicationParams["aiSearchTier"]>, "off">, { rate: number; label: string }> = {
  basic: { rate: 0.108, label: "Basic" },
  s1:    { rate: 0.342, label: "Standard S1" },
  s2:    { rate: 1.36,  label: "Standard S2" },
  s3:    { rate: 2.72,  label: "Standard S3" },
};
const ML_COMPUTE_HOURLY: Record<NonNullable<AiApplicationParams["mlComputeSku"]>, number> = {
  D4s_v5: 0.192, D8s_v5: 0.384, D16s_v5: 0.768,
  NC4as_T4_v3: 0.526, NC24ads_A100_v4: 3.673,
};

export function buildAiApplicationBom(
  region: string,
  appName: string,
  params: AiApplicationParams = {},
): BomLine[] {
  const model = params.openAiModel ?? "gpt-4o";
  const inM = params.openAiInputTokensMillions ?? 5;
  const outM = params.openAiOutputTokensMillions ?? 1;
  const cachedM = params.openAiCachedInputTokensMillions ?? 0;
  const embM = params.embeddingsTokensMillions ?? 50;
  const search = params.aiSearchTier ?? "s1";
  const searchParts = params.aiSearchPartitions ?? 1;
  const mlSku = params.mlComputeSku ?? "D8s_v5";
  const mlHours = params.mlComputeHoursMonth ?? 120;
  const docPagesK = params.docIntelligencePagesK ?? 50;

  const lines: BomLine[] = [];
  const tag = "(AI Application — tune to actual token / page volume)";

  const push = (
    resource: string, sku: string, monthlyCost: number,
    unit: string, unitPrice: number, quantity: number, assumption: string,
  ) => {
    lines.push({
      ...emptyBomLine(),
      category: "AI Application", resource, sku, meter: sku, region,
      quantity, unit, unitPrice,
      monthlyCost: Math.round(monthlyCost * 100) / 100,
      currency: "USD", source: "ai-application-baseline",
      serviceName: "AI Application",
      customName: appName ? `${appName}-ai` : "AI Application",
      resourceCount: 1, billingTerm: "PAYG",
      assumption: `${assumption} ${tag}`,
    });
  };

  if (inM > 0 || outM > 0 || cachedM > 0) {
    const r = OPENAI[model];
    const cost = inM * r.input + outM * r.output + cachedM * r.cachedInput;
    push(
      `Azure OpenAI — ${model} (${inM}M in + ${outM}M out${cachedM ? ` + ${cachedM}M cached` : ""})`,
      `aoai-${model}`,
      cost, "1M tokens", r.input, inM + outM + cachedM,
      `${inM}M × $${r.input}/M (in) + ${outM}M × $${r.output}/M (out)${cachedM ? ` + ${cachedM}M × $${r.cachedInput}/M (cached)` : ""} = $${cost.toFixed(2)}.`,
    );
  }
  if (embM > 0) {
    const cost = embM * 0.02;
    push(
      `Azure OpenAI — text-embedding-3-small (${embM}M tokens/mo)`, "aoai-embedding-3-small",
      cost, "1M tokens", 0.02, embM,
      `Embeddings for RAG / vector search. $0.02/1M tokens × ${embM}M.`,
    );
  }
  if (search !== "off" && searchParts > 0) {
    const t = AI_SEARCH_HOURLY[search];
    const cost = t.rate * 730 * searchParts;
    push(
      `Azure AI Search — ${t.label}${searchParts > 1 ? ` × ${searchParts} partitions` : ""}`,
      `ai-search-${search}-x${searchParts}`,
      cost, "1 Hour", t.rate, 730 * searchParts,
      `${t.label} ($${t.rate.toFixed(3)}/hr) × ${searchParts} partition${searchParts === 1 ? "" : "s"} × 730 hrs. Vector search included.`,
    );
  }
  if (mlHours > 0) {
    const rate = ML_COMPUTE_HOURLY[mlSku];
    const cost = rate * mlHours;
    push(
      `Azure Machine Learning — Standard_${mlSku} compute (${mlHours}h/mo)`,
      `azureml-${mlSku.toLowerCase()}`,
      cost, "1 Hour", rate, mlHours,
      `${mlSku} ($${rate.toFixed(3)}/hr) × ${mlHours} hrs. ${mlSku.startsWith("NC") ? "GPU compute — set hours carefully." : "Training / inference baseline."}`,
    );
  }
  if (docPagesK > 0) {
    const cost = docPagesK * 1.5;
    push(
      `Document Intelligence — prebuilt (${docPagesK}k pages/mo)`, "doc-intelligence",
      cost, "1k pages", 1.5, docPagesK,
      `Prebuilt model $1.50/1k pages × ${docPagesK}k. Custom training extra.`,
    );
  }
  return lines;
}
