// The Cost Race "Mimic lane": the CHEAP lane. Replays a workflow taught ONCE, deterministically over
// Browserbase — ~0 LLM tokens on the happy path. It only spends a model when the page changes: on the
// break round it re-grounds the renamed element by intent (a REAL brain heal), then continues. Mirror of
// runtime/stagehand-lane.ts (open/runRound/close) so /api/race drives both lanes the same way.
//
// MULTI-TAB: the faithful demo starts on the LeadSheet (tab 0, opened once in open() so its status fills
// accumulate across leads), clicks a lead's "Message on LinkedIn" (target=_blank → a LinkedUp popup we
// adopt as tab 1), switches tabs, and messages there. Tab routing + popup adoption is ported from the
// proven runtime/player.ts. brain/* is untouched.
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
 * One reusable Browserbase session replayed across N leads. open() boots the cloud browser + loads the
 * LeadSheet (tab 0); runRound() replays the multi-tab outreach for one lead; close() at the end. Deterministic
 * replay → no LLM per lead, so the meter stays flat — except the break lead, where it heals once.
 */
export class MimicLane {
  private bb: Browserbase | null = null;
  private browser: Browser | null = null;
  private sheet: Page | null = null; // tab 0 — the LeadSheet, persists across leads
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
        ...(this.cfg.contextId ? { context: { id: this.cfg.contextId, persist: false } } : {}),
      },
    });
    this.sessionId = session.id;
    this.browser = await chromium.connectOverCDP(session.connectUrl);
    this.sheet = this.browser.contexts()[0].pages()[0];
    // Load the LeadSheet ONCE — it stays open across leads so its status cells fill cumulatively.
    await this.sheet.goto(this.cfg.workflow.startUrl, { timeout: STEP_TIMEOUT * 3 }).catch(() => {});
    this.liveViewUrl = await this.debugUrl(0);
    return { liveViewUrl: this.liveViewUrl };
  }

  async runRound(
    row: DataRow,
    run: number,
    emit: (e: RunEvent) => void,
    opts: { breakNow?: boolean } = {},
  ): Promise<MimicRoundResult> {
    const sheet = this.sheet;
    if (!sheet) throw new Error("MimicLane.runRound called before open()");
    const context = sheet.context();
    emit({ kind: "run_start", lane: "mimic", workflowId: this.cfg.workflow.workflowId, row });

    const wf = structuredClone(this.cfg.workflow); // fresh selectors each round; a heal mutates the clone
    let tokensIn = 0;
    let tokensOut = 0;
    const unsub = onUsage((u) => {
      tokensIn += u.tokensIn; // brain heal() tokens land here — the only completeJSON calls in this round
      tokensOut += u.tokensOut;
    });

    // Fresh start for this lead: drop any LinkedUp tab the previous lead opened, keep the sheet (tab 0).
    for (const p of context.pages()) if (p !== sheet) await p.close().catch(() => {});

    // Multi-tab routing (ported from player.ts): tab 0 = the sheet; the sheet-click opens LinkedUp, which a
    // switchTab adopts as tab 1. Single-tab workflows keep every step on tab 0 → unchanged behavior.
    const pages = new Map<number, Page>([[0, sheet]]);
    let active: Page = sheet;
    const followTab = async (tabIndex: number): Promise<void> => {
      const url = await this.debugUrl(tabIndex);
      if (url) emit({ kind: "liveview", lane: "mimic", url });
    };
    const focusTab = async (tabIndex: number, page: Page): Promise<void> => {
      active = page;
      await page.bringToFront().catch(() => {});
      await followTab(tabIndex);
    };
    const ensureTab = async (tabIndex: number, url: string | null): Promise<Page> => {
      const existing = pages.get(tabIndex);
      if (existing) return existing;
      const mapped = new Set(pages.values());
      let orphan = context.pages().find((pg) => !mapped.has(pg)); // adopt the popup the sheet-click opened
      if (!orphan) {
        try {
          orphan = await context.waitForEvent("page", { timeout: 2000 });
        } catch {
          /* no popup — open by URL below */
        }
      }
      const adopt = orphan ?? (await context.newPage());
      pages.set(tabIndex, adopt);
      if (!orphan && url) await adopt.goto(url, { timeout: STEP_TIMEOUT * 3 }).catch(() => {});
      try {
        await adopt.waitForLoadState("domcontentloaded", { timeout: STEP_TIMEOUT });
      } catch {
        /* best effort */
      }
      return adopt;
    };

    let ok = true;
    const start = Date.now();
    try {
      await focusTab(0, sheet); // begin on the (already-loaded) sheet

      for (const step of wf.steps) {
        const tab = step.tab ?? 0;
        const t0 = Date.now();

        if (step.action === "switchTab") {
          const p = await ensureTab(tab, step.valueLiteral);
          await focusTab(tab, p);
          emit({ kind: "step", lane: "mimic", result: stepResult(wf, `switch:${tab}`, "ok", step.selector || `tab:${tab}`, Date.now() - t0) });
          continue;
        }

        const page = pages.get(tab) ?? active;
        if (page !== active) await focusTab(tab, page);
        const value = valueFor(step, row);

        // Break: rename the heal target on ITS tab right before its step runs, so the recorded selector
        // misses and the heal fires. Only on the break lead, only the matching element (the LinkedUp Send).
        if (opts.breakNow && this.cfg.breakSpec && step.selector === this.cfg.breakSpec.selector) {
          const r = await breakElement(page, this.cfg.breakSpec);
          emit({ kind: "step", lane: "mimic", result: stepResult(wf, "break", r.ok ? "ok" : "failed", r.detail, 0) });
        }

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
    this.sheet = null;
  }

  /** Per-tab live-view URL for the UI iframe (Browserbase). Falls back to the session-level URL. */
  private async debugUrl(tabIndex: number): Promise<string | undefined> {
    if (!this.bb || !this.sessionId) return undefined;
    try {
      const links = await this.bb.sessions.debug(this.sessionId);
      const tabs = (links as { pages?: Array<{ debuggerFullscreenUrl?: string }> }).pages;
      return tabs?.[tabIndex]?.debuggerFullscreenUrl ?? links.debuggerFullscreenUrl;
    } catch {
      return undefined;
    }
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
      break; // handled in runRound (tab routing), never reaches execute
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
    step.selector = result.newSelector; // re-cache within this lead's run
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
