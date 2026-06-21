import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import type { DataRow, RawTrace, RunEvent, WorkflowStep } from "../shared/types";
import { structure } from "../brain/structure";
import { lastUsage } from "../brain/anthropic";
import { saveWorkflow, getWorkflow, listWorkflows, getHistory, saveTrace } from "../brain/store";
import { Recorder } from "./recorder";
import { replay, closeLiveBrowsers } from "./player";
import { stripSwitchTabs, applyTabs, breakForDemo, mergeHeal } from "./multitab";
import { StagehandLane } from "./stagehand-lane";
import { MimicLane } from "./mimic-lane";
import { cost } from "./metrics";
import { initSentry } from "./sentry";

initSentry();

const app = express();
app.use(express.json({ limit: "5mb" }));

const __dirname = dirname(fileURLToPath(import.meta.url));
const webDir = join(__dirname, "..", "web");
app.use(express.static(webDir));
app.get("/mock", (_req, res) => res.sendFile(join(webDir, "mock.html")));

const recorder = new Recorder();

// ---- WebSocket event bus (Runtime → Web live feed) ----
const server = createServer(app);
const wss = new WebSocketServer({ server });
const clients = new Set<WebSocket>();
wss.on("connection", (ws) => {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
});
function broadcast(event: RunEvent): void {
  const msg = JSON.stringify(event);
  for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.send(msg);
}

// ---- Record ----
app.post("/api/record/start", async (req, res) => {
  try {
    // Record against the URL the UI asks for (e.g. the LeadSheet), falling back to MOCK_URL then the
    // local mock. Recording is local, so any public/local URL is reachable.
    const url = req.body.url ?? process.env.MOCK_URL ?? "http://localhost:3000/mock";
    const { liveViewUrl } = await recorder.start(url);
    // Browserbase: push the record live-view to the UI so the user can teach inside the iframe.
    // Local: liveViewUrl is undefined → no event → the OS record window is used as before.
    if (liveViewUrl) broadcast({ kind: "liveview", lane: "record", url: liveViewUrl });
    res.json({ recording: true, liveViewUrl });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post("/api/record/stop", async (req, res) => {
  try {
    const trace = await recorder.stop(req.body.task ?? "untitled task");
    await saveTrace(trace);
    res.json(trace);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---- Structure + store ----
app.post("/api/workflows", async (req, res) => {
  try {
    const trace = req.body as RawTrace;
    // Structure WITHOUT the switchTab actions (brain stays untouched), then stamp per-step tabs and
    // re-insert the switchTab steps in the runtime so the player can route a multi-tab replay.
    const wf = await structure(stripSwitchTabs(trace));
    // Capture the structure() call's REAL token usage = Mimic's one-time "teaching" cost, and stamp it
    // on the workflow so /api/race can show it as run 0 (the meter's elevated starting point). lastUsage
    // is the most-recent completeJSON usage; structure() is the only model call between here and now.
    const tabbed = applyTabs(wf, trace) as typeof wf & { teachingTokensIn?: number; teachingTokensOut?: number };
    tabbed.teachingTokensIn = lastUsage.tokensIn;
    tabbed.teachingTokensOut = lastUsage.tokensOut;
    await saveWorkflow(tabbed);
    res.json(tabbed);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get("/api/workflows", async (_req, res) => {
  res.json(await listWorkflows());
});

app.get("/api/workflows/:id", async (req, res) => {
  const wf = await getWorkflow(req.params.id);
  if (!wf) return res.status(404).json({ error: "not found" });
  res.json(wf);
});

// Agent-memory trail: every version ever saved to Redis (workflow:{id}:history). Feeds the memory panel.
app.get("/api/workflows/:id/history", async (req, res) => {
  res.json(await getHistory(req.params.id));
});

// ---- Replay: runs BOTH lanes (control dies | healing survives) for the split-screen kill shot ----
// Both lanes start from the PRISTINE original (version 1, from history), deep-cloned, EVERY run.
// Why this matters: the healing lane writes its re-grounded selector back to Redis (the agent-memory
// trail). If the control lane re-read the LIVE workflow, then after the first heal it would inherit
// that cured selector and stop crashing — the split-screen would only work once. Reading v1 keeps
// control brittle so the kill shot is repeatable; heal write-backs still accrue in history.
app.post("/api/replay", async (req, res) => {
  const { workflowId, row, breakSite } = req.body as { workflowId: string; row: DataRow; breakSite?: boolean };
  const history = await getHistory(workflowId);
  const pristine = history.length ? history[0].wf : await getWorkflow(workflowId);
  if (!pristine) return res.status(404).json({ error: "workflow not found" });

  await closeLiveBrowsers(); // reap the PREVIOUS run's lingering result windows before opening this run's

  let control = structuredClone(pristine); // never healed — always hits the brittle selector
  let healing = structuredClone(pristine); // re-grounds live every run; write-back logs to history
  healing.version = history.length; // onHeal bumps this → monotonic v2, v3, … in the memory trail

  // ENGINE=browserbase: a SINGLE-PAGE workflow recorded against the operator's localhost can't be
  // reached by the cloud browser, so swap a localhost startUrl for the public MOCK_URL. A multi-tab
  // workflow's startUrl is its own page (e.g. the public LeadSheet) — never replace it with the mock.
  const isMultiTab = pristine.steps.some((s) => s.action === "switchTab");
  const isLocalHost = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(pristine.startUrl);
  const base = process.env.MOCK_URL && isLocalHost && !isMultiTab ? process.env.MOCK_URL : pristine.startUrl;
  control.startUrl = base;
  healing.startUrl = base;

  // Demo "break the site": multi-tab → rename the LinkedIn Send (+ open the broken page directly);
  // single-page → rename the form Submit. The healer must re-ground the renamed control by intent.
  if (breakSite) {
    control = breakForDemo(control);
    healing = breakForDemo(healing);
  }

  const [controlOk, healingOk] = await Promise.all([
    replay(control, row, { heal: false, lane: "control", emit: broadcast }),
    replay(healing, row, {
      heal: true,
      lane: "healing",
      emit: broadcast,
      onHeal: async (wf) => {
        wf.version += 1;
        // Persist the heal onto the PRISTINE structure, not the broken demo-harness copy (dropped
        // opener click / ?break=1 switchTab URL), so the saved workflow + memory trail stay clean.
        await saveWorkflow(mergeHeal(pristine, wf));
      },
    }),
  ]);

  res.json({ control: controlOk, healing: healingOk });
});

// ---- Cost race: REAL Stagehand (pure-LLM) vs Mimic (taught-once deterministic) over Browserbase ----
// N rounds, break at round K. Stagehand pays full LLM cost EVERY round; Mimic is ~0 except one heal at
// the break (then re-caches → free again). Both lanes report REAL token usage → the meter is real.
// Config via env so the live-LinkedIn details (workflow id, burner Contexts, break target) stay out of
// code: DEMO_WORKFLOW_ID, STAGEHAND_INSTRUCTION, DEMO_START_URL, BURNER_CONTEXT_STAGEHAND/_MIMIC,
// BREAK_SELECTOR + BREAK_NEW_ID/_TEXT, RACE_ROUNDS/_BREAK_AT.
// The LeadSheet the race scans top-down (mirrors the first rows of mock-public/leads.js + their statuses).
// status: "none" = not contacted (the race messages these); "msg"/"reply" = already contacted (skipped).
// row = the lead's position in the LinkedUp list (leads.js order) → the Mimic click retarget targets it.
// First FOUR uncontacted → a 4-round race: rounds 1-2 normal, round 3 the break, round 4 the recovery.
const DEMO_LEADS = [
  { name: "Sarah Chen", role: "VP Engineering", company: "Acme", status: "none" },
  { name: "Marcus Lee", role: "Head of Product", company: "Globex", status: "none" },
  { name: "Priya Patel", role: "CTO", company: "Initech", status: "none" },
  { name: "Diego Alvarez", role: "Director of Sales", company: "Umbrella", status: "none" },
  { name: "Hana Suzuki", role: "Founder", company: "Hooli", status: "msg" },
].map((l, i) => ({ ...l, row: i + 1, message: `Hi ${l.name}, I came across your work as ${l.role} at ${l.company} and would love to connect about what your team is building.` }));

// Manual stepping: Start opens both cloud lanes ONCE; each "Run round" click runs ONE lead on BOTH lanes
// and then waits. The presenter paces the demo on stage — narrate the cost gap, the break, the heal — which
// an internal auto-loop makes impossible. The session below holds the two open lanes between clicks.
interface ActiveRace {
  stagehand: StagehandLane;
  mimic: MimicLane;
  queue: typeof DEMO_LEADS;
  // Recorded clicks re-pointed per lead (live refs into workflow.steps). resultClick = the LinkedUp
  // "Message" button (#li-results … div:nth-of-type(N)); sheetRowClick = the LeadSheet row (sheet workflow
  // only). Keyed off the selector, not the tab, so both the parody (LinkedUp-only) and sheet flows work.
  resultClick?: WorkflowStep;
  sheetRowClick?: WorkflowStep;
  baseResult: string;
  baseSheetRow: string;
  run: number; // leads contacted so far
  breakAt: number; // round whose LinkedUp Send gets renamed → Mimic heals
  busy: boolean; // a round is mid-flight (reject overlapping clicks)
}
let activeRace: ActiveRace | null = null;

async function closeRace(): Promise<void> {
  if (!activeRace) return;
  const r = activeRace;
  activeRace = null; // null FIRST so a failing close can't strand the session
  await Promise.all([r.stagehand.close(), r.mimic.close()]).catch(() => {});
}

// Open both lanes once, emit the teaching (run-0) baseline, and park the session ready to step.
app.post("/api/race/start", async (req, res) => {
  const body = (req.body ?? {}) as { workflowId?: string };
  const workflowId = body.workflowId ?? process.env.DEMO_WORKFLOW_ID;
  if (!workflowId) return res.status(400).json({ error: "no workflowId (set DEMO_WORKFLOW_ID or pass workflowId)" });
  const history = await getHistory(workflowId);
  const workflow = history.length ? history[0].wf : await getWorkflow(workflowId);
  if (!workflow) return res.status(404).json({ error: "workflow not found" });

  await closeRace(); // never leak a prior cloud session

  const instruction = process.env.STAGEHAND_INSTRUCTION ?? workflow.task;
  const startUrl = process.env.DEMO_START_URL ?? workflow.startUrl;
  const breakSpec = process.env.BREAK_SELECTOR
    ? { selector: process.env.BREAK_SELECTOR, newId: process.env.BREAK_NEW_ID, newText: process.env.BREAK_NEW_TEXT }
    : undefined;

  // The race scans the LeadSheet top-down and contacts every "not contacted" row.
  const queue = DEMO_LEADS.filter((l) => l.status === "none");
  const breakAt = Math.min(3, queue.length); // break the LinkedUp Send on the 3rd lead → heal, then recover

  // stealth:false — advancedStealth/Verified is Enterprise-only (403 on our Dev plan). We run basic
  // fingerprinting + residential proxy, which held up through Context warming + reuse.
  const stagehand = new StagehandLane({ startUrl, instruction, contextId: process.env.STAGEHAND_CONTEXT_ID, stealth: false, maxSteps: 18, breakSpec });
  const mimic = new MimicLane({ workflow, contextId: process.env.MIMIC_CONTEXT_ID, breakSpec });
  try {
    const [s, m] = await Promise.all([stagehand.open(), mimic.open()]);
    if (s.liveViewUrl) broadcast({ kind: "liveview", lane: "stagehand", url: s.liveViewUrl });
    if (m.liveViewUrl) broadcast({ kind: "liveview", lane: "mimic", url: m.liveViewUrl });

    // Teaching (run 0): Mimic's ONE-TIME cost = the structure() call that compiled the demonstration,
    // captured + persisted on the workflow at record time. Emitting it starts Mimic's meter elevated — the
    // honest "paid once, then free". Stagehand has no teaching → starts at 0.
    const teach = workflow as { teachingTokensIn?: number; teachingTokensOut?: number };
    if (teach.teachingTokensIn != null) {
      const tin = teach.teachingTokensIn, tout = teach.teachingTokensOut ?? 0;
      broadcast({ kind: "metrics", lane: "mimic", run: 0, phase: "teaching", tokensIn: tin, tokensOut: tout, ms: 0, costUsd: cost(tin, tout) });
    }
    broadcast({ kind: "metrics", lane: "stagehand", run: 0, phase: "teaching", tokensIn: 0, tokensOut: 0, ms: 0, costUsd: 0 });

    // Identify the row-dependent clicks by what they target (not tab #) so this works for the LinkedUp-only
    // parody AND the multi-tab sheet flow. Both list leads in the same order → re-point per lead's row.
    const resultClick = workflow.steps.find((st) => st.action === "click" && /#li-results/.test(st.selector ?? ""));
    const sheetRowClick = workflow.steps.find((st) => st.action === "click" && /tr:nth-of-type/.test(st.selector ?? ""));
    activeRace = {
      stagehand, mimic, queue, resultClick, sheetRowClick,
      baseResult: resultClick?.selector ?? "",
      baseSheetRow: sheetRowClick?.selector ?? "",
      run: 0, breakAt, busy: false,
    };
    res.json({ ok: true, rounds: queue.length, breakAt });
  } catch (e) {
    await Promise.all([stagehand.close(), mimic.close()]).catch(() => {});
    console.error("[race] start failed:", (e as Error).message);
    res.status(500).json({ error: (e as Error).message });
  }
});

// Run exactly ONE lead on BOTH lanes, then wait for the next click. Coupled (both advance together) so the
// presenter narrates the same lead side by side; per-lane timers still report each lane's real elapsed time.
app.post("/api/race/step", async (_req, res) => {
  const r = activeRace;
  if (!r) return res.status(400).json({ error: "no active race — POST /api/race/start first" });
  if (r.busy) return res.status(409).json({ error: "a round is still running" });
  if (r.run >= r.queue.length) {
    await closeRace();
    return res.json({ run: r.run, rounds: r.queue.length, breakAt: r.breakAt, brokeThisRound: false, done: true });
  }

  r.busy = true;
  const n = r.run + 1;
  const lead = r.queue[r.run];
  // The site stays redesigned from the break round onward (it doesn't un-redesign). So every round at or
  // past breakAt is "broken": Stagehand re-reasons at full cost AGAIN (it never learns), while Mimic — which
  // persisted its heal on the first break round — replays the learned selector for ~0 tokens. That contrast
  // (expensive forever vs. learned once) is the round-4 payoff.
  const brokeThisRound = n >= r.breakAt;

  // Per-lane stopwatch: broadcast start/stop around each lane's round so the UI ticks live then freezes ✓.
  const timed = async <T>(lane: "stagehand" | "mimic", fn: () => Promise<T>): Promise<T> => {
    broadcast({ kind: "timer", lane, state: "start" });
    const t0 = Date.now();
    try {
      return await fn();
    } finally {
      broadcast({ kind: "timer", lane, state: "stop", elapsedMs: Date.now() - t0 });
    }
  };

  // Lanes are independent: a Stagehand crash (e.g. its cloud session expired during a long narration pause)
  // must NOT block Mimic or stall the race. allSettled → both lanes attempted, then advance regardless.
  const [sRes, mRes] = await Promise.allSettled([
    timed("stagehand", async () => {
      console.log(`[race] stagehand → ${lead.name}${brokeThisRound ? " (BREAK)" : ""}`);
      const sr = await r.stagehand.runRound({ name: lead.name, role: lead.role, company: lead.company }, n, broadcast, { breakNow: brokeThisRound });
      console.log(`[race] stagehand ${lead.name} done: ok=${sr.ok} tokIn=${sr.tokensIn}`);
      return sr;
    }),
    timed("mimic", () => {
      // Mutate the source selectors right before runRound clones them (sync until its first await) → the
      // clone messages THIS lead's row. Only the FIRST div:nth-of-type (the result index) is rewritten.
      if (r.resultClick) r.resultClick.selector = r.baseResult.replace(/div:nth-of-type\(\d+\)/, `div:nth-of-type(${lead.row})`);
      if (r.sheetRowClick) r.sheetRowClick.selector = r.baseSheetRow.replace(/tr:nth-of-type\(\d+\)/, `tr:nth-of-type(${lead.row})`);
      console.log(`[race] mimic → ${lead.name} (li div${lead.row})${brokeThisRound ? " (BREAK)" : ""}`);
      // Row key MUST match the workflow's parameter name ("messageBody") or valueFor() returns undefined
      // and the compose box fills empty. (This is the long-standing DataRow↔param-name footgun.)
      return r.mimic.runRound({ messageBody: lead.message }, n, broadcast, { breakNow: brokeThisRound });
    }),
  ]);
  if (sRes.status === "rejected") console.error("[race] stagehand round failed:", String(sRes.reason).slice(0, 160));
  if (mRes.status === "rejected") console.error("[race] mimic round failed:", String(mRes.reason).slice(0, 160));
  r.run = n; // the round was attempted on both lanes → advance so the presenter can keep stepping
  r.busy = false;

  const done = r.run >= r.queue.length;
  if (done) await closeRace();
  res.json({ run: r.run, rounds: r.queue.length, breakAt: r.breakAt, brokeThisRound, done });
});

const PORT = Number(process.env.PORT ?? 3000);
server.listen(PORT, () => console.log(`[mimic] http://localhost:${PORT}`));
