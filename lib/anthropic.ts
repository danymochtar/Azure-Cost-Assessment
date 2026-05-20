import Anthropic from "@anthropic-ai/sdk";

export const HAIKU_TO_OPUS = [
  "claude-haiku-4-5",
  "claude-sonnet-4-6",
  "claude-opus-4-7",
] as const;

export const SONNET_TO_OPUS = [
  "claude-sonnet-4-6",
  "claude-opus-4-7",
] as const;

export type ModelId = (typeof HAIKU_TO_OPUS)[number];

export function getClient(apiKey?: string): Anthropic {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set. Configure it in env or pass it via the request.");
  return new Anthropic({ apiKey: key, maxRetries: 4 });
}

interface CallOpts<T> {
  cascade: readonly ModelId[];
  invoke: (model: ModelId) => Promise<T>;
}

export async function callWithCascade<T>({ cascade, invoke }: CallOpts<T>): Promise<T> {
  let lastErr: unknown;
  for (const model of cascade) {
    try {
      return await invoke(model);
    } catch (err) {
      const e = err as { status?: number; name?: string };
      const transient = e?.status === 502 || e?.status === 503 || e?.status === 504 || e?.status === 529;
      if (transient || e?.name === "APIConnectionError") {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  if (lastErr) throw lastErr;
  throw new Error("callWithCascade: empty cascade");
}
