// The Cost Race "Mimic lane": the CHEAP lane. Replays a workflow that was taught ONCE, deterministically
// over Browserbase — ~0 LLM tokens on the happy path. It only spends a model when the page changes: on
// the break round it re-grounds the renamed element by intent (a REAL brain heal), then re-caches the new
// selector so subsequent rounds are free again. Mirror of runtime/stagehand-lane.ts (open/runRound/close)
// so /api/race drives both lanes the same way. Self-contained — does NOT touch player.ts.
//
// Token accounting: heal() goes through brain/anthropic.completeJSON, which fires onUsage(); we subscribe
// for the duration of a round to attribute those (and only those) tokens to this lane's meter.
import Browserbase from "@browserbasehq/sdk";
import { chromium, type Browser, type Page } from "playwright";
import type { RunEvent, DataRow, Workflow, WorkflowStep } from "../shared/types";
import { heal } from "../brain/heal";
import { onUsage } from "../brain/anthropic";
import { cost } from "./metrics";
import { breakElement, type BreakSpec } from "./breaker";

const STEP_TIMEOUT = 15_000;
const MAX_HEAL_ATTEMPTS = 2;

export interface MimicLaneConfig {
  /** The pre-taught workflow to replay (the PRISTINE original; cloned fresh each round). */
  workflow: Workflow;
  /** Warmed burner Browserbase Context id (auth reuse → no login on stage). Omit for a no-auth smoke. */
  contextId?: string;
  /** Residential proxy — match the Stagehand lane so both look like the same kind of user. Default true. */
  proxies?: boolean;
  /** What the breaker renames on the break round (the heal target). Omit → no break. */
  breakSpec?: BreakSpec;
}

export interface MimicRoundResult {
  ok: boolean;
  tokensIn: number;
  tokensOut: number;
  ms: number;
}

/**
 * One reusable Browserbase session replayed across N rounds. open() once (boots the cloud browser +
 * reuses the warmed Context), runRound() per lead, close() at the end. Deterministic replay → no LLM
 * per round, so the meter stays flat — except the one break round, where it heals once and re-caches.
 */
export class MimicLane {
  private bb: Browserbase | null = null;
  private browser: Browser | null = null;
  private page: Page | null = null;
  private sessionId?: string;
  liveViewUrl?: string;

  constructor(private cfg: MimicLaneConfig) {}

  async open(): Promise<{ liveViewUrl?: string }> {
    const apiKey = process.env.BROWSERBASE_API_KEY;
    if (!apiKey) throw new Error("BROWSERBASE_API_KEY unset (Mimic lane needs the cloud)");
    this.bb = new Browserbase({ apiKey });
    const projectId = await resolveProjectId(this.bb);

    const session = await this.bb.sessions.create({
      projectId,
      proxies: this.cfg.proxies ?? true,
      browserSettings: {
        viewport: { width: 1280, height: 800 },
        // No advancedStealth — Enterprise-only (403 on Dev). Basic fingerprinting + residential proxy.
        solveCaptchas: true,
        // Reuse the warmed burner auth; persist:false so concurrent lanes can't corrupt the Context.
        ...(this.cfg.contextId ? { context: { id: this.cfg.contextId, persist: false } } : {}),
      },
    });
    this.sessionId = session.id;
    this.browser = await chromium.connectOverCDP(session.connectUrl);
    this.page = this.browser.contexts()[0].pages()[0];
    const links = await this.bb.sessions.debug(session.id);
    this.liveViewUrl = links.debuggerFullscreenUrl;
    return { liveViewUrl: this.liveViewUrl };
  }

  async runRound(
    row: DataRow,
    run: number,
    emit: (e: RunEvent) => void,
    opts: { breakNow?: boolean } = {},
  ): Promise<MimicRoundResult> {
    const page = this.page;
    if (!page) throw new Error("MimicLane.runRound called before open()");
    emit({ kind: "run_start", lane: "mimic", workflowId: this.cfg.workflow.workflowId, row });

    const wf = structuredClone(this.cfg.workflow); // fresh selectors each round; a heal mutates the clone
    let tokensIn = 0;
    let tokensOut = 0;
    const unsub = onUsage((u) => {
      tokensIn += u.tokensIn; // brain heal() tokens land here — the only completeJSON calls in this round
      tokensOut += u.tokensOut;
    });

    let ok = true;
    const start = Date.now();
    try {
      await page.goto(wf.startUrl, { timeout: STEP_TIMEOUT * 3 });
      // Simulate the redesign BEFORE the steps run, so the recorded selector misses and the heal fires.
      if (opts.breakNow && this.cfg.breakSpec) {
        const r = await breakElement(page, this.cfg.breakSpec);
        emit({ kind: "step", lane: "mimic", result: stepResult(wf, "break", r.ok ? "ok" : "failed", r.detail, 0) });
      }

      for (const step of wf.steps) {
        const value = valueFor(step, row);
        const t0 = Date.now();
        try {
          await execute(page, step, step.selector, value);
          emit({ kind: "step", lane: "mimic", result: stepResult(wf, step.stepId, "ok", step.selector, Date.now() - t0) });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          emit({ kind: "step", lane: "mimic", result: stepResult(wf, step.stepId, "failed", step.selector, Date.now() - t0, error) });
          const recovered = await tryHeal(page, wf, step, value, emit);
          if (!recovered) { ok = false; break; }
          emit({ kind: "step", lane: "mimic", result: stepResult(wf, step.stepId, "healed", step.selector, Date.now() - t0) });
        }
      }
    } catch (err) {
      ok = false;
      emit({ kind: "step", lane: "mimic", result: stepResult(wf, "nav", "failed", wf.startUrl, Date.now() - start, (err as Error).message) });
    }
    unsub();
    const ms = Date.now() - start;

    emit({ kind: "metrics", lane: "mimic", run, phase: "running", tokensIn, tokensOut, ms, costUsd: cost(tokensIn, tokensOut) });
    emit({ kind: "run_done", lane: "mimic", workflowId: wf.workflowId, ok });
    return { ok, tokensIn, tokensOut, ms };
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => {});
    this.browser = null;
    this.page = null;
  }
}

// --- replay primitives (local copies; player.ts's are coupled to the split-screen lanes) ---

function valueFor(step: WorkflowStep, row: DataRow): string | null {
  if (step.valueFrom) return row[step.valueFrom] ?? null;
  return step.valueLiteral;
}

async function execute(page: Page, step: WorkflowStep, selector: string, value: string | null): Promise<void> {
  switch (step.action) {
    case "input":
      await page.fill(selector, value ?? "", { timeout: STEP_TIMEOUT });
      break;
    case "select":
      await page.selectOption(selector, value ?? "", { timeout: STEP_TIMEOUT });
      break;
    case "click":
    case "submit":
      await page.click(selector, { timeout: STEP_TIMEOUT });
      break;
    case "navigate":
      await page.goto(value ?? step.selector, { timeout: STEP_TIMEOUT * 3 });
      break;
    case "switchTab":
      break; // single-page race lane — no tab routing
  }
}

/** Re-ground a failed step by intent, retry, verify — bounded attempts. Emits a heal RunEvent. */
async function tryHeal(
  page: Page,
  wf: Workflow,
  step: WorkflowStep,
  value: string | null,
  emit: (e: RunEvent) => void,
): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_HEAL_ATTEMPTS; attempt++) {
    const dom = await liveDom(page);
    const result = await heal({ workflowId: wf.workflowId, step, liveDom: dom });
    emit({ kind: "heal", lane: "mimic", result });
    if (!result.healed || !result.newSelector) continue;
    try {
      await execute(page, step, result.newSelector, value); // retry with the re-grounded selector
    } catch {
      continue; // still wrong — heal again
    }
    step.selector = result.newSelector; // re-cache: subsequent rounds use the fixed selector → free again
    return true;
  }
  return false;
}

/** Best-effort current DOM for the healer — cap size so the prompt stays small. */
async function liveDom(page: Page): Promise<string> {
  try {
    return (await page.content()).slice(0, 8000);
  } catch {
    return "";
  }
}

// stepResult tailored to the race lane (no screenshots; tab/dom fields the UI doesn't need here).
function stepResult(wf: Workflow, stepId: string, status: "ok" | "failed" | "healed", selector: string, tookMs: number, error?: string) {
  return {
    workflowId: wf.workflowId,
    stepId,
    status,
    attemptedSelector: selector,
    error: error ?? null,
    liveDom: null,
    screenshotUrl: null,
    tookMs,
  };
}

// Browserbase needs a projectId; resolve once (env override, else first project on the key).
async function resolveProjectId(bb: Browserbase): Promise<string> {
  if (process.env.BROWSERBASE_PROJECT_ID) return process.env.BROWSERBASE_PROJECT_ID;
  const list = (await bb.projects.list()) as unknown;
  const arr = Array.isArray(list) ? list : ((list as { data?: unknown[] }).data ?? []);
  const id = (arr[0] as { id?: string } | undefined)?.id;
  if (!id) throw new Error("No Browserbase project found for this API key");
  return id;
}
