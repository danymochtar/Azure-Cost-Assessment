// Anthropic API usage accumulator.
//
// Each Messages.create response includes `usage.input_tokens` /
// `usage.output_tokens` (plus optional cache hit/miss counters). We
// convert those into USD via Anthropic's published list rates so the
// app can show the user exactly what an assessment cost on the AI side.
//
// Source: https://www.anthropic.com/pricing (late 2025).

export type ModelKey = "haiku" | "sonnet" | "opus" | "other";

const PRICING_PER_MILLION_TOKENS: Record<ModelKey, {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}> = {
  haiku:  { input: 1.00,  output: 5.00,  cacheWrite: 1.25,  cacheRead: 0.10 },
  sonnet: { input: 3.00,  output: 15.00, cacheWrite: 3.75,  cacheRead: 0.30 },
  opus:   { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  other:  { input: 0,     output: 0,     cacheWrite: 0,     cacheRead: 0     },
};

export function modelKey(m: string | undefined | null): ModelKey {
  const s = (m ?? "").toLowerCase();
  if (s.includes("haiku")) return "haiku";
  if (s.includes("sonnet")) return "sonnet";
  if (s.includes("opus")) return "opus";
  return "other";
}

export interface UsageDelta {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export function costUsd(d: UsageDelta): number {
  const p = PRICING_PER_MILLION_TOKENS[modelKey(d.model)];
  const cw = d.cacheCreationInputTokens ?? 0;
  const cr = d.cacheReadInputTokens ?? 0;
  return (
    (d.inputTokens / 1_000_000) * p.input +
    (d.outputTokens / 1_000_000) * p.output +
    (cw / 1_000_000) * p.cacheWrite +
    (cr / 1_000_000) * p.cacheRead
  );
}

export interface ModelUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  costUsd: number;
}

export interface UsageTotal {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  costUsd: number;
  byModel: Record<ModelKey, ModelUsage>;
}

function emptyModelUsage(): ModelUsage {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    costUsd: 0,
  };
}

export function emptyUsage(): UsageTotal {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    costUsd: 0,
    byModel: {
      haiku: emptyModelUsage(),
      sonnet: emptyModelUsage(),
      opus: emptyModelUsage(),
      other: emptyModelUsage(),
    },
  };
}

export function accumulate(total: UsageTotal, delta: UsageDelta): UsageTotal {
  const k = modelKey(delta.model);
  const c = costUsd(delta);
  const cw = delta.cacheCreationInputTokens ?? 0;
  const cr = delta.cacheReadInputTokens ?? 0;
  total.inputTokens += delta.inputTokens;
  total.outputTokens += delta.outputTokens;
  total.cacheCreationInputTokens += cw;
  total.cacheReadInputTokens += cr;
  total.costUsd += c;
  const m = total.byModel[k];
  m.calls += 1;
  m.inputTokens += delta.inputTokens;
  m.outputTokens += delta.outputTokens;
  m.cacheCreationInputTokens += cw;
  m.cacheReadInputTokens += cr;
  m.costUsd += c;
  return total;
}

export function mergeUsage(a: UsageTotal, b: UsageTotal): UsageTotal {
  const out = emptyUsage();
  out.inputTokens = a.inputTokens + b.inputTokens;
  out.outputTokens = a.outputTokens + b.outputTokens;
  out.cacheCreationInputTokens = a.cacheCreationInputTokens + b.cacheCreationInputTokens;
  out.cacheReadInputTokens = a.cacheReadInputTokens + b.cacheReadInputTokens;
  out.costUsd = a.costUsd + b.costUsd;
  for (const k of Object.keys(out.byModel) as ModelKey[]) {
    const am = a.byModel[k];
    const bm = b.byModel[k];
    out.byModel[k] = {
      calls: am.calls + bm.calls,
      inputTokens: am.inputTokens + bm.inputTokens,
      outputTokens: am.outputTokens + bm.outputTokens,
      cacheCreationInputTokens: am.cacheCreationInputTokens + bm.cacheCreationInputTokens,
      cacheReadInputTokens: am.cacheReadInputTokens + bm.cacheReadInputTokens,
      costUsd: am.costUsd + bm.costUsd,
    };
  }
  return out;
}

// Pull the usage payload off a Messages.create response. The SDK
// surfaces these as snake_case from the JSON wire format.
export function deltaFromMessage(
  resp: {
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number | null;
      cache_read_input_tokens?: number | null;
    };
  },
  fallbackModel?: string,
): UsageDelta {
  const u = resp.usage ?? {};
  return {
    model: resp.model ?? fallbackModel ?? "",
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
  };
}
