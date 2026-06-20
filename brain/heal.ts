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

const SYSTEM = `A step in a saved web-automation workflow just failed: its CSS selector no longer matches any element (the site changed — an element was renamed, moved, or restyled).

You are given the step's SEMANTIC intent, its original fallback hints, the action type, and the CURRENT page DOM. Re-find the ONE element that fulfills the intent — by MEANING, not by the stale selector.

Selector rules (newSelector is passed straight to a Playwright page.click/fill/selectOption call, so it MUST be valid):
- Return a STANDARD CSS selector only. No XPath, no :has-text()/:contains()/text= engines, no jQuery extensions — they break or behave inconsistently between click and fill.
- Prefer a selector that survives FUTURE renames: a stable attribute the redesign is unlikely to touch (type, name, role, aria-label, placeholder) beats a volatile #id or visible text. Example: if a "Submit" button was renamed to "Send" but still has type="submit", return button[type="submit"] — not #send-btn.
- The selector MUST match EXACTLY ONE element and be the right KIND for the action: for input/select it must resolve to a form field (input/select/textarea), never a text-containing element; for click/submit, the actionable control.

Return:
- healed: true ONLY if exactly one element clearly fulfills the intent. If nothing clearly matches, or several match ambiguously, return false — do NOT guess.
- newSelector: that standard CSS selector, or null when healed is false.
- reasoning: one sentence tying the element to the intent and why the selector is stable.
- confidence: 0..1 — your certainty this is the right element.`;

/**
 * Re-ground a failed step's element by intent against the live DOM.
 * liveDom is already capped upstream (player.ts trims to the form subtree, 8000 chars).
 * SYSTEM steers to Playwright-valid, rename-resistant selectors (e.g. button[type="submit"]
 * survives the Submit→Send demo break). VALIDATE the live heal latency + accuracy at the event.
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
