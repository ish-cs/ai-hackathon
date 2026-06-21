import Anthropic from "@anthropic-ai/sdk";

// One swappable constant. Opus 4.8 is the default (best re-grounding accuracy).
// If the live heal is too slow on stage, drop to "claude-haiku-4-5" here — nothing else changes.
export const MODEL = "claude-opus-4-8";

// Lazy so importing the Brain doesn't require a key — the server boots without one,
// and only structure()/heal() fail (loudly) if ANTHROPIC_API_KEY is missing.
let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic(); // reads ANTHROPIC_API_KEY; throws clearly if absent
  return _client;
}

// ---- Token-usage side-channel (Cost Race meter) ----
// completeJSON's return type stays `Promise<T>`, so structure()/heal() and every other brain caller
// are UNCHANGED. The real per-call usage is exposed here instead, for runtime/metrics.ts to price.
export interface TokenUsage {
  tokensIn: number;
  tokensOut: number;
  model: string;
}
/** Usage of the most recent completeJSON call. Read it right after awaiting structure()/heal(). */
export let lastUsage: TokenUsage = { tokensIn: 0, tokensOut: 0, model: MODEL };
type UsageListener = (u: TokenUsage) => void;
const usageListeners = new Set<UsageListener>();
/** Subscribe to per-call token usage for the Cost Race meter. Returns an unsubscribe fn. */
export function onUsage(fn: UsageListener): () => void {
  usageListeners.add(fn);
  return () => void usageListeners.delete(fn);
}

export interface JSONCallOpts {
  system: string;
  user: string;
  /** JSON Schema the model's output is constrained to (output_config.format). */
  schema: Record<string, unknown>;
  /** Thinking depth / token spend. structure → "high"; heal → "medium" for speed. */
  effort?: "low" | "medium" | "high" | "max";
  maxTokens?: number;
}

/**
 * Call Claude and get back JSON validated against `schema`.
 * Uses structured outputs (output_config.format) so the response is guaranteed-parseable.
 */
export async function completeJSON<T>(opts: JSONCallOpts): Promise<T> {
  const res = await client().messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 8192,
    thinking: { type: "adaptive" },
    output_config: {
      effort: opts.effort ?? "high",
      format: { type: "json_schema", schema: opts.schema },
    },
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });

  // Record REAL usage for the Cost Race meter (additive — does not change what we return).
  lastUsage = {
    tokensIn: res.usage?.input_tokens ?? 0,
    tokensOut: res.usage?.output_tokens ?? 0,
    model: MODEL,
  };
  for (const fn of usageListeners) fn(lastUsage);

  const block = res.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Claude returned no text block (stop_reason: " + res.stop_reason + ")");
  }
  return JSON.parse(block.text) as T;
}
