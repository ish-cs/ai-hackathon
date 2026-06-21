// Cost-race metrics — ck's lane. Pure helpers + the metrics event shape the UI consumes.
//
// SEAM NOTE: `MetricsEvent` below is the shape we will move into shared/types.ts once Ishaan acks
// (see DOCS/plans/2026-06-20-cost-race-ishaan-brief.md). Kept ck-local for now so we don't solo-edit
// the shared seam. The web client reads it as plain JSON, so this stays the single source of truth.

/** Per-run cost sample, emitted by each lane (Stagehand's agent / Mimic's structure+heal). */
export interface MetricsEvent {
  kind: "metrics";
  lane: "stagehand" | "mimic";
  /** 0 = teaching (run 0), 1..N = running rounds. */
  run: number;
  phase: "teaching" | "running";
  tokensIn: number;
  tokensOut: number;
  ms: number;
  costUsd: number;
}

/** Browserbase live-view for a race lane (parallels the existing RunEvent liveview, new lanes). */
export interface RaceLiveViewEvent {
  kind: "liveview";
  lane: "stagehand" | "mimic";
  url: string;
}

/** Anything ck's /api/race broadcasts on top of the existing RunEvent union. */
export type RaceEvent = MetricsEvent | RaceLiveViewEvent;

// $/million tokens. CONFIRM current published price for claude-opus-4-8 before the demo
// (open coordination item #4 in the Ishaan brief). Placeholder = Claude Opus historical rates.
export const PRICE_IN_PER_MTOK = 15;
export const PRICE_OUT_PER_MTOK = 75;

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
