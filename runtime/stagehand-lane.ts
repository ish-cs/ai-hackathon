// The Cost Race "Stagehand lane": a pure-LLM browser agent that runs the SAME cold-outreach task as
// Mimic, but re-reasons every step EVERY run — so it pays full LLM cost forever. Drives real LinkedIn
// over Browserbase (Advanced Stealth + residential proxy + a warmed burner Context for auth reuse) and
// emits REAL per-run token/time metrics for the on-screen meter. This is the EXPENSIVE lane; the
// contrast vs Mimic's ~0-token deterministic replay is the entire demo.
//
// Foundation proven in ../stagehand-spike.ts (Stagehand v3 inits on our Browserbase, completes an
// agent task, reports real usage). brain/* is untouched — this lane lives entirely in the runtime.
import { Stagehand } from "@browserbasehq/stagehand";
import Browserbase from "@browserbasehq/sdk";
import type { RunEvent, DataRow } from "../shared/types";

const MODEL = "anthropic/claude-opus-4-8"; // Stagehand wants the AI-SDK "provider/model" form

// claude-opus-4-8 list price ($/Mtok). Mirror of runtime/metrics.ts so the lane is self-contained for
// smoke tests; ck's metrics.ts is the source of truth once integrated (it can re-price from raw tokens).
const PRICE = { inPerM: 5.0, outPerM: 25.0 };
const priceUsd = (tin: number, tout: number) => (tin / 1e6) * PRICE.inPerM + (tout / 1e6) * PRICE.outPerM;

export interface StagehandLaneConfig {
  /** Where the task begins each round (live LinkedIn URL, or the LinkedUp parody as fallback). */
  startUrl: string;
  /** Natural-language task. Use %name% / %role% / %company% for per-row variables. */
  instruction: string;
  /** Warmed burner Browserbase Context id (auth reuse → no login on stage). Omit for a benign smoke. */
  contextId?: string;
  /** Residential proxy — needed to look like a real user on LinkedIn. Default true. */
  proxies?: boolean;
  /** Advanced Stealth / Verified mode (bot-detection evasion; needs Scale/Dev plan). Default true. */
  stealth?: boolean;
  /** Cap the agent's steps per round. Default 25. */
  maxSteps?: number;
}

export interface StagehandRoundResult {
  ok: boolean;
  tokensIn: number;
  tokensOut: number;
  ms: number;
  message: string;
}

/**
 * One reusable Stagehand session run across N rounds. open() once (boots the cloud browser + reuses the
 * warmed Context), runRound() per lead, close() at the end. Each round re-runs the LLM agent from
 * scratch — no action cache — so the meter climbs every round.
 */
export class StagehandLane {
  private sh: Stagehand | null = null;
  liveViewUrl?: string;

  constructor(private cfg: StagehandLaneConfig) {}

  async open(): Promise<{ liveViewUrl?: string }> {
    const apiKey = process.env.BROWSERBASE_API_KEY;
    if (!apiKey) throw new Error("BROWSERBASE_API_KEY unset (Stagehand lane needs the cloud)");
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY unset (Stagehand's LLM)");
    const projectId = await resolveProjectId(apiKey);

    this.sh = new Stagehand({
      env: "BROWSERBASE",
      apiKey,
      projectId,
      model: MODEL, // LLM reads ANTHROPIC_API_KEY from env
      serverCache: false, // no action caching → the honest "pure-LLM-every-step" expensive lane
      verbose: 1,
      browserbaseSessionCreateParams: {
        projectId,
        proxies: this.cfg.proxies ?? true, // residential proxy → looks like a real user
        browserSettings: {
          viewport: { width: 1280, height: 800 },
          advancedStealth: this.cfg.stealth ?? true, // bot-detection evasion
          solveCaptchas: true,
          // Reuse the warmed burner LinkedIn auth so there's no login on stage. persist:false → read
          // the auth, never write back, so concurrent lanes can't corrupt the warmed Context.
          ...(this.cfg.contextId ? { context: { id: this.cfg.contextId, persist: false } } : {}),
        },
      },
    });
    await this.sh.init();
    this.liveViewUrl = await debugUrl(apiKey, this.sh.browserbaseSessionID);
    return { liveViewUrl: this.liveViewUrl };
  }

  async runRound(row: DataRow, run: number, emit: (e: RunEvent) => void): Promise<StagehandRoundResult> {
    if (!this.sh) throw new Error("StagehandLane.runRound called before open()");
    emit({ kind: "run_start", lane: "stagehand", workflowId: "stagehand", row });

    const page = this.sh.context.pages()[0] ?? (await this.sh.context.newPage());
    let ok = false;
    let message = "";
    let tokensIn = 0;
    let tokensOut = 0;
    const start = Date.now();
    try {
      await page.goto(this.cfg.startUrl); // fresh start each round → the agent re-reasons from scratch
      const agent = this.sh.agent({ model: MODEL, mode: "dom" });
      const result = await agent.execute({
        instruction: this.cfg.instruction,
        variables: row, // %name%/%role%/%company% resolved from the lead row
        maxSteps: this.cfg.maxSteps ?? 25,
      });
      ok = result.success;
      message = String(result.message ?? "");
      tokensIn = result.usage?.input_tokens ?? 0;
      tokensOut = result.usage?.output_tokens ?? 0;
    } catch (e) {
      message = (e as Error).message; // a misclick/failure stays in the demo (it helps us); just report it
    }
    const ms = Date.now() - start;

    emit({
      kind: "metrics",
      lane: "stagehand",
      run,
      phase: "running",
      tokensIn,
      tokensOut,
      ms,
      costUsd: priceUsd(tokensIn, tokensOut),
    });
    emit({ kind: "run_done", lane: "stagehand", workflowId: "stagehand", ok });
    return { ok, tokensIn, tokensOut, ms, message };
  }

  async close(): Promise<void> {
    await this.sh?.close().catch(() => {});
    this.sh = null;
  }
}

// --- helpers ---

// Browserbase needs a projectId; our .env carries only the API key, so resolve once via the SDK.
// Handles array OR paginated {data} list shapes. Set BROWSERBASE_PROJECT_ID to skip the lookup.
async function resolveProjectId(apiKey: string): Promise<string> {
  if (process.env.BROWSERBASE_PROJECT_ID) return process.env.BROWSERBASE_PROJECT_ID;
  const list = (await new Browserbase({ apiKey }).projects.list()) as unknown;
  const arr = Array.isArray(list) ? list : ((list as { data?: unknown[] }).data ?? []);
  const id = (arr[0] as { id?: string } | undefined)?.id;
  if (!id) throw new Error("No Browserbase project found for this API key");
  return id;
}

// Per-session live-view URL for the UI iframe (same call runtime/browser.ts uses).
async function debugUrl(apiKey: string, sessionId?: string): Promise<string | undefined> {
  if (!sessionId) return undefined;
  try {
    const links = await new Browserbase({ apiKey }).sessions.debug(sessionId);
    return links.debuggerFullscreenUrl;
  } catch {
    return undefined;
  }
}
