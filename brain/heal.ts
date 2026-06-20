import type { HealRequest, HealResult } from "../shared/types";
import { completeJSON } from "./anthropic";

type HealOutput = {
  healed: boolean;
  newSelector: string | null;
  reasoning: string;
  confidence: number;
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    healed: { type: "boolean" },
    newSelector: { type: ["string", "null"] },
    reasoning: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["healed", "newSelector", "reasoning", "confidence"],
};

const SYSTEM = `A step in a saved web-automation workflow just failed because its CSS selector no longer matches anything on the page (the site changed — an element was renamed or moved).

You are given the step's SEMANTIC intent, its original fallback hints, and the CURRENT page DOM. Re-find the element by what it MEANS, not by the stale selector.

Return:
- healed: true if you can confidently identify the element that fulfills the step's intent in the current DOM, false otherwise.
- newSelector: a precise CSS selector for that element (prefer #id, then [name=...], then a stable attribute/text-based selector). null if not healed.
- reasoning: one sentence on why this element matches the intent.
- confidence: 0..1.

Be conservative: if nothing clearly matches the intent, return healed:false rather than guessing.`;

/**
 * Re-ground a failed step's element by intent against the live DOM.
 * TODO(brain): cap liveDom size before sending; rehearse against the exact demo break.
 */
export async function heal(req: HealRequest): Promise<HealResult> {
  const user = [
    `Step intent: ${req.step.intent}`,
    `Original selector (now broken): ${req.step.selector}`,
    `Fallback hints: ${JSON.stringify(req.step.fallbackHints)}`,
    `Action type: ${req.step.action}`,
    ``,
    `Current page DOM:`,
    req.liveDom,
  ].join("\n");

  const out = await completeJSON<HealOutput>({
    system: SYSTEM,
    user,
    schema: SCHEMA,
    effort: "medium", // heal is on the live demo path — favor speed
    maxTokens: 2048,
  });

  return {
    stepId: req.step.stepId,
    healed: out.healed,
    newSelector: out.newSelector,
    reasoning: out.reasoning,
    confidence: out.confidence,
    timestamp: Date.now(),
  };
}
