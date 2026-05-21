import { describe, expect, it } from "vitest";
import { accumulate, costUsd, deltaFromMessage, emptyUsage, mergeUsage, modelKey } from "@/lib/usage";

describe("modelKey", () => {
  it("recognises haiku / sonnet / opus regardless of suffix", () => {
    expect(modelKey("claude-haiku-4-5")).toBe("haiku");
    expect(modelKey("claude-sonnet-4-6")).toBe("sonnet");
    expect(modelKey("claude-opus-4-7")).toBe("opus");
    expect(modelKey("CLAUDE-OPUS-4-7-PREVIEW")).toBe("opus");
    expect(modelKey("")).toBe("other");
  });
});

describe("costUsd", () => {
  it("applies per-million-token list rates", () => {
    // Haiku: $1/M input, $5/M output. 1M+1M = $6.
    expect(costUsd({ model: "claude-haiku-4-5", inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(6, 5);
    // Sonnet: $3/M input, $15/M output.
    expect(costUsd({ model: "claude-sonnet-4-6", inputTokens: 100_000, outputTokens: 50_000 })).toBeCloseTo(0.3 + 0.75, 5);
    // Opus: $15/M input, $75/M output.
    expect(costUsd({ model: "claude-opus-4-7", inputTokens: 10_000, outputTokens: 5_000 })).toBeCloseTo(0.15 + 0.375, 5);
  });

  it("rates cache reads at ~10x cheaper than fresh input", () => {
    const fresh = costUsd({ model: "claude-haiku-4-5", inputTokens: 1_000_000, outputTokens: 0 });
    const cached = costUsd({ model: "claude-haiku-4-5", inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 1_000_000 });
    expect(cached).toBeLessThan(fresh);
    expect(fresh / cached).toBeCloseTo(10, 0);
  });
});

describe("accumulate / mergeUsage", () => {
  it("aggregates by model and grand total", () => {
    const u = emptyUsage();
    accumulate(u, { model: "claude-haiku-4-5", inputTokens: 1000, outputTokens: 500 });
    accumulate(u, { model: "claude-haiku-4-5", inputTokens: 2000, outputTokens: 1000 });
    accumulate(u, { model: "claude-sonnet-4-6", inputTokens: 500, outputTokens: 200 });
    expect(u.byModel.haiku.calls).toBe(2);
    expect(u.byModel.haiku.inputTokens).toBe(3000);
    expect(u.byModel.sonnet.calls).toBe(1);
    expect(u.inputTokens).toBe(3500);
    expect(u.outputTokens).toBe(1700);
    expect(u.costUsd).toBeGreaterThan(0);
  });

  it("mergeUsage combines two totals without mutating either", () => {
    const a = emptyUsage();
    accumulate(a, { model: "claude-haiku-4-5", inputTokens: 100, outputTokens: 50 });
    const b = emptyUsage();
    accumulate(b, { model: "claude-opus-4-7", inputTokens: 200, outputTokens: 100 });
    const merged = mergeUsage(a, b);
    expect(merged.byModel.haiku.calls).toBe(1);
    expect(merged.byModel.opus.calls).toBe(1);
    expect(a.byModel.opus.calls).toBe(0); // a not mutated
  });
});

describe("deltaFromMessage", () => {
  it("reads snake_case fields off a Messages.create response", () => {
    const d = deltaFromMessage({
      model: "claude-haiku-4-5",
      usage: {
        input_tokens: 1500,
        output_tokens: 200,
        cache_read_input_tokens: 8000,
        cache_creation_input_tokens: 0,
      },
    });
    expect(d.model).toBe("claude-haiku-4-5");
    expect(d.inputTokens).toBe(1500);
    expect(d.outputTokens).toBe(200);
    expect(d.cacheReadInputTokens).toBe(8000);
  });

  it("falls back to the provided model when the response omits it", () => {
    const d = deltaFromMessage({ usage: { input_tokens: 10, output_tokens: 1 } }, "claude-sonnet-4-6");
    expect(d.model).toBe("claude-sonnet-4-6");
  });
});
