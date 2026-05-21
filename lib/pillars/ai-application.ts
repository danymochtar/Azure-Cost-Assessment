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
    const modelFit: Record<OpenAiModel, string> = {
      "gpt-4o-mini":  "gpt-4o-mini — cheapest production-quality model (~17× cheaper than 4o on input). Use for classification, extraction, simple summarisation, RAG answer generation at high volume. 128k context. Not great for multi-step reasoning or precise math.",
      "gpt-4o":       "gpt-4o — general-purpose flagship; multi-modal (text + image input). Use for summarisation, complex Q&A, code, vision tasks. 128k context. Step down to 4o-mini for high-volume simple tasks; step up to o1 for reasoning-heavy work (planning, math).",
      "gpt-4.1":      "gpt-4.1 — long-context (1M tokens) and improved instruction-following. Use when you need to feed entire codebases / large docs in one shot. Slightly cheaper than 4o on input. Not multi-modal.",
      "gpt-4.1-mini": "gpt-4.1-mini — long-context (1M tokens) at a fraction of 4.1's cost. Use for batch document analysis at scale where 4o-mini's context is too small.",
      "o1":           "o1 — reasoning model with internal chain-of-thought. Use for complex math, multi-step planning, scientific problems. Much slower (~30 s) and ~6× the cost of 4o. Don't use for simple chat — wasted spend.",
      "o1-mini":      "o1-mini — cheaper reasoning model. Use for code / math at scale where o1's quality isn't required. ~4× the cost of 4o-mini but with planning capability.",
      "o3-mini":      "o3-mini — newest reasoning model, cheaper than o1-mini with comparable quality on STEM tasks. Default choice for reasoning workloads in 2026.",
    };
    push(
      `Azure OpenAI — ${model} (${inM}M in + ${outM}M out${cachedM ? ` + ${cachedM}M cached` : ""})`,
      `aoai-${model}`,
      cost, "1M tokens", r.input, inM + outM + cachedM,
      `${inM}M × $${r.input}/M (in) + ${outM}M × $${r.output}/M (out)${cachedM ? ` + ${cachedM}M × $${r.cachedInput}/M (cached)` : ""} = $${cost.toFixed(2)}. Picked because ${modelFit[model]} Prompt caching cuts repeated-prefix input cost ~10×; if your app re-sends a system prompt every call, enable it. What's NOT included: fine-tuning training/hosting, Provisioned Throughput Units (PTUs — reserved capacity for sub-second latency SLA), content filter add-ons.`,
    );
  }
  if (embM > 0) {
    const cost = embM * 0.02;
    push(
      `Azure OpenAI — text-embedding-3-small (${embM}M tokens/mo)`, "aoai-embedding-3-small",
      cost, "1M tokens", 0.02, embM,
      `Embeddings for RAG / vector search. $0.02/M tokens × ${embM}M = $${cost.toFixed(2)}. Picked text-embedding-3-small because at 1,536 dimensions it's the cost/quality sweet spot for most RAG. Step up to 3-large ($0.13/M, 3,072 dims) when retrieval precision matters more than cost — typical breakeven is when re-indexing cost is amortised over months of queries. What's NOT included: vector storage in AI Search (priced separately on the index size), re-indexing cost on document updates.`,
    );
  }
  if (search !== "off" && searchParts > 0) {
    const t = AI_SEARCH_HOURLY[search];
    const cost = t.rate * 730 * searchParts;
    const searchFit: Record<Exclude<NonNullable<AiApplicationParams["aiSearchTier"]>, "off">, string> = {
      basic: "Basic — 2 GB storage, 50k documents max, 3 indexes. Dev/test or very small RAG apps only.",
      s1:    "S1 — 25 GB / partition, ~15M docs / partition, 12 indexes. Default for small-to-medium prod RAG. Add partitions to scale storage; add replicas to scale QPS / HA.",
      s2:    "S2 — 100 GB / partition, ~60M docs, 12 indexes. Step up from S1 when index size exceeds ~20 GB or you need >12 indexes (S2 raises the limit to higher).",
      s3:    "S3 — 200 GB / partition, ~200M docs. Enterprise scale; usually requires partitioning by tenant or domain.",
    };
    push(
      `Azure AI Search — ${t.label}${searchParts > 1 ? ` × ${searchParts} partitions` : ""}`,
      `ai-search-${search}-x${searchParts}`,
      cost, "1 Hour", t.rate, 730 * searchParts,
      `${t.label} × $${t.rate.toFixed(3)}/hr × 730 × ${searchParts} partition${searchParts === 1 ? "" : "s"} = $${cost.toFixed(2)}. Picked because ${searchFit[search]} Vector search included on all tiers (no extra cost). Add REPLICAS (separate line, not partitions) for HA — 2 replicas gives 99.9 % SLA, 3 gives 99.95 %. Semantic ranking is extra at $1/1k queries. What's NOT included: skillset enrichment (OCR, KeyPhrase via Cognitive Services), semantic ranker over the free quota, integrated data sources.`,
    );
  }
  if (mlHours > 0) {
    const rate = ML_COMPUTE_HOURLY[mlSku];
    const cost = rate * mlHours;
    const mlFit: Record<NonNullable<AiApplicationParams["mlComputeSku"]>, string> = {
      D4s_v5:         "D4s_v5 (4 vCPU CPU) — classical ML on tabular data, small-scale training (<1M rows), inference for non-GPU models.",
      D8s_v5:         "D8s_v5 (8 vCPU CPU) — larger feature engineering, pandas / scikit-learn training, batch inference at modest throughput.",
      D16s_v5:        "D16s_v5 (16 vCPU CPU) — heavy parallel scikit-learn / XGBoost; if you reach for 16 vCPUs, often a GPU is cheaper per training run.",
      NC4as_T4_v3:    "NC4as_T4_v3 (1× T4 GPU, 4 vCPU) — entry GPU for inference / fine-tuning small models (BERT-base, ResNet). T4 lacks bf16; not great for LLM fine-tuning.",
      NC24ads_A100_v4: "NC24ads_A100_v4 (1× A100 80 GB GPU) — LLM fine-tuning, large model training (7B-13B parameter range). Consider Spot instances (~60-80 % discount) for non-interactive training jobs.",
    };
    push(
      `Azure Machine Learning — Standard_${mlSku} compute (${mlHours}h/mo)`,
      `azureml-${mlSku.toLowerCase()}`,
      cost, "1 Hour", rate, mlHours,
      `${mlSku} × $${rate.toFixed(3)}/hr × ${mlHours} hrs = $${cost.toFixed(2)}. Picked because ${mlFit[mlSku]} ${mlSku.startsWith("NC") ? "GPU spend can spiral fast — set hours carefully and enable auto-scale-to-zero on the cluster." : "CPU compute auto-scales to zero between jobs."} What's NOT included: managed online endpoints (separate compute), data egress, model registry storage, prompt-flow tracing ingestion.`,
    );
  }
  if (docPagesK > 0) {
    const cost = docPagesK * 1.5;
    push(
      `Document Intelligence — prebuilt (${docPagesK}k pages/mo)`, "doc-intelligence",
      cost, "1k pages", 1.5, docPagesK,
      `Prebuilt $1.50/1k pages × ${docPagesK}k = $${cost.toFixed(2)}. Picked prebuilt because invoice / receipt / ID / business-card models cover most standard layouts without training. Step up to custom-trained models ($50 training + $50/1k inference) when documents have non-standard layouts; step further to layout-only ($10/1k) when you just need bounding boxes for downstream LLM extraction. What's NOT included: custom model training time, storage of training docs, queue throughput beyond the tier's TPS limit.`,
    );
  }
  return lines;
}
