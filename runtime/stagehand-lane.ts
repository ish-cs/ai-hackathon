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
  /** Resume a pre-warmed keepAlive session by id (stable IP, already logged in). Wins over contextId —
   *  the one-session approach for live LinkedIn (avoids the per-session IP rotation that gets us logged out). */
  sessionId?: string;
  /** Residential proxy — needed to look like a real user on LinkedIn. Default true. */
  proxies?: boolean;
  /** Advanced Stealth (Verified mode) — ENTERPRISE-only, so OFF by default. Basic fingerprinting + proxy otherwise. */
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
      // sessionId → RESUME a pre-warmed keepAlive session (one stable IP, already logged in); this is the
      // one-session fix for live LinkedIn. Otherwise create a fresh session, optionally reusing a Context.
      ...(this.cfg.sessionId
        ? { browserbaseSessionID: this.cfg.sessionId }
        : {
            browserbaseSessionCreateParams: {
              projectId,
              proxies: this.cfg.proxies ?? true, // residential proxy → looks like a real user
              browserSettings: {
                viewport: { width: 1280, height: 800 },
                // advancedStealth (Verified mode) is ENTERPRISE-only → 403 on Dev/Scale. Only when enabled.
                ...(this.cfg.stealth ? { advancedStealth: true } : {}),
                solveCaptchas: true,
                // Reuse the warmed burner auth read-only so concurrent lanes can't corrupt the Context.
                ...(this.cfg.contextId ? { context: { id: this.cfg.contextId, persist: false } } : {}),
              },
            },
          }),
    });
    await this.sh.init();
    this.liveViewUrl = await debugUrl(apiKey, this.sh.browserbaseSessionID);
    return { liveViewUrl: this.liveViewUrl };
  }

  async runRound(row: DataRow, run: number, emit: (e: RunEvent) => void): Promise<StagehandRoundResult> {
    if (!this.sh) throw new Error("StagehandLane.runRound called before open()");
    emit({ kind: "run_start", lane: "stagehand", workflowId: "stagehand", row });

    // Reuse the agent's MOST-RECENT tab (it likely ended on a LinkedUp tab it opened) and navigate THAT
    // back to the sheet; close the rest. Keeping the latest page alive avoids leaving the next
    // agent.execute bound to a dead tab — the cause of the round-2+ 0-token no-ops.
    const all = this.sh.context.pages();
    const page = all[all.length - 1] ?? (await this.sh.context.newPage());
    for (const p of all) if (p !== page) await p.close().catch(() => {});

    // Keep the live-view attached as the agent churns tabs (sheet → LinkedUp). The feed iframe is pinned to
    // a tab; when the agent opens/closes tabs the old feed dies ("WebSocket disconnected"). Re-emit the
    // ACTIVE (newest) tab's feed at lead start AND whenever the agent opens a tab → the panel stays live.
    const sessionId = this.sh.browserbaseSessionID;
    const apiKey = process.env.BROWSERBASE_API_KEY;
    const reattach = async (): Promise<void> => {
      if (!apiKey || !sessionId) return;
      try {
        const links = await new Browserbase({ apiKey }).sessions.debug(sessionId);
        const tabs = (links as { pages?: Array<{ debuggerFullscreenUrl?: string }> }).pages;
        const url = tabs?.[tabs.length - 1]?.debuggerFullscreenUrl ?? links.debuggerFullscreenUrl;
        if (url) emit({ kind: "liveview", lane: "stagehand", url });
      } catch { /* the feed is cosmetic — never fail a round over it */ }
    };
    const onNewTab = (): void => void reattach();
    // V3Context doesn't type Playwright's event emitter; reach it defensively (no-op if absent) so the
    // lead-start re-attach below still always runs — that alone keeps the feed off the disconnect dialog.
    const ctx = this.sh.context as unknown as { on?: (e: string, f: () => void) => void; off?: (e: string, f: () => void) => void };
    ctx.on?.("page", onNewTab);

    let ok = false;
    let message = "";
    let tokensIn = 0;
    let tokensOut = 0;
    const start = Date.now();
    try {
      await page.goto(this.cfg.startUrl); // fresh start each round → the agent re-reasons from scratch
      await reattach(); // attach this lead's feed (the previous lead's tab may have closed)
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
    } finally {
      ctx.off?.("page", onNewTab); // stop following this lead's tab opens
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
