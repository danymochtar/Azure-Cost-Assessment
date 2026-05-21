// AI Application baseline pricing.
//
// Models the typical Azure AI stack: Azure OpenAI for LLM inference,
// AI Search as the RAG retrieval layer, Azure ML compute for training
// / hosted models, Cognitive Services baseline. East US 2 USD list
// rates, late 2025. Tokens / users / requests can spike materially —
// these are conservative starting points.

import { type BomLine, emptyBomLine } from "../models";

interface Preset {
  resource: string;
  sku: string;
  monthlyCost: number;
  unit: string;
  unitPrice: number;
  quantity: number;
  assumption: string;
}

const PRESETS: Preset[] = [
  {
    resource: "Azure OpenAI — GPT-4o (5M input + 1M output tokens/mo)",
    sku: "aoai-gpt-4o",
    monthlyCost: 22.50, unit: "1M tokens", unitPrice: 2.50, quantity: 5,
    assumption: "5M input tokens × $2.50/M ($12.50) + 1M output tokens × $10/M ($10). Cached input would be ~$1.25/M. Scale linearly with traffic.",
  },
  {
    resource: "Azure OpenAI — text-embedding-3-small (50M tokens/mo)",
    sku: "aoai-embedding-3-small",
    monthlyCost: 1.00, unit: "1M tokens", unitPrice: 0.02, quantity: 50,
    assumption: "Embeddings for RAG / vector search. $0.02/1M tokens × 50M baseline.",
  },
  {
    resource: "Azure AI Search — Standard S1",
    sku: "ai-search-s1",
    monthlyCost: 250.00, unit: "1 Hour", unitPrice: 0.342, quantity: 730,
    assumption: "Standard S1 ($0.342/hr × 730). 25 GB / partition, 1 partition. Vector search included. Step up to S2/S3 for scale.",
  },
  {
    resource: "Azure Machine Learning — D8s v5 compute (4h/day)",
    sku: "azureml-d8sv5",
    monthlyCost: 46.00, unit: "1 Hour", unitPrice: 0.384, quantity: 120,
    assumption: "D8s v5 ($0.384/hr) × 4h/day × 30 days = 120 hrs. Training / experimentation baseline. GPU compute (NC/ND) would be 5-30× higher.",
  },
  {
    resource: "Document Intelligence (Form Recognizer) — 50k pages/mo",
    sku: "doc-intelligence",
    monthlyCost: 75.00, unit: "1k pages", unitPrice: 1.50, quantity: 50,
    assumption: "Custom model $50/1k pages → use prebuilt at $1.50/1k pages × 50k = $75. Custom training cost extra.",
  },
];

export function buildAiApplicationBom(region: string, appName: string): BomLine[] {
  const tag = "(AI Application baseline — East US 2; tune to actual token / page volume)";
  return PRESETS.map((p) => ({
    ...emptyBomLine(),
    category: "AI Application",
    resource: p.resource,
    sku: p.sku,
    meter: p.sku,
    region,
    quantity: p.quantity,
    unit: p.unit,
    unitPrice: p.unitPrice,
    monthlyCost: Math.round(p.monthlyCost * 100) / 100,
    currency: "USD",
    source: "ai-application-baseline",
    serviceName: "AI Application",
    customName: appName ? `${appName}-ai` : "AI Application",
    resourceCount: 1,
    billingTerm: "PAYG",
    assumption: `${p.assumption} ${tag}`,
  }));
}
