// Cost-race metrics — ck's lane. Pricing + pure helpers for the on-screen meter.
//
// The `metrics` RunEvent + `Lane` type now live in shared/types.ts (Ishaan's seam) — this file no
// longer defines its own event shape; producers build the shared event and price it with cost() here.
// Brain (Mimic) token counts come from brain/anthropic.ts `onUsage()` / `lastUsage`; Stagehand reports
// its own usage in runtime/stagehand-lane.ts. cost() is the single $/token source of truth.

// $/million tokens for claude-opus-4-8 (list price; matches runtime/stagehand-lane.ts PRICE so both
// lanes are priced identically). Update here if Anthropic pricing changes — this is the source of truth.
export const PRICE_IN_PER_MTOK = 5.0;
export const PRICE_OUT_PER_MTOK = 25.0;

/** Dollar cost of one LLM call given its token usage. */
export function cost(tokensIn: number, tokensOut: number): number {
  return (tokensIn / 1e6) * PRICE_IN_PER_MTOK + (tokensOut / 1e6) * PRICE_OUT_PER_MTOK;
}

/** Linear projection: extrapolate a cumulative cost measured over `runsRun` rounds to `runsTarget`. */
export function project(cumulativeCostUsd: number, runsRun: number, runsTarget: number): number {
  if (runsRun <= 0) return 0;
  return (cumulativeCostUsd / runsRun) * runsTarget;
}

/**
 * Break-even: how many runs until Mimic's one-time teaching cost is repaid by the per-run saving
 * over Stagehand. Returns Infinity if Mimic isn't cheaper per run (shouldn't happen in the demo).
 */
export function breakEven(teachingCostUsd: number, stagehandPerRunUsd: number, mimicPerRunUsd: number): number {
  const saving = stagehandPerRunUsd - mimicPerRunUsd;
  if (saving <= 0) return Infinity;
  return teachingCostUsd / saving;
}
