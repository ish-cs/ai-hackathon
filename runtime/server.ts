import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import type { DataRow, RawTrace, RunEvent } from "../shared/types";
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
const DEMO_LEADS = [
  { name: "Sarah Chen", role: "VP Engineering", company: "Acme", status: "none" },
  { name: "Marcus Lee", role: "Head of Product", company: "Globex", status: "msg" },
  { name: "Priya Patel", role: "CTO", company: "Initech", status: "reply" },
  { name: "Diego Alvarez", role: "Director of Sales", company: "Umbrella", status: "none" },
  { name: "Hana Suzuki", role: "Founder", company: "Hooli", status: "none" },
].map((l, i) => ({ ...l, row: i + 1, message: `Hi ${l.name}, I came across your work as ${l.role} at ${l.company} and would love to connect about what your team is building.` }));

app.post("/api/race", async (req, res) => {
  const body = (req.body ?? {}) as { workflowId?: string; row?: DataRow };
  const workflowId = body.workflowId ?? process.env.DEMO_WORKFLOW_ID;
  if (!workflowId) return res.status(400).json({ error: "no workflowId (set DEMO_WORKFLOW_ID or pass workflowId)" });
  const history = await getHistory(workflowId);
  const workflow = history.length ? history[0].wf : await getWorkflow(workflowId);
  if (!workflow) return res.status(404).json({ error: "workflow not found" });

  const instruction = process.env.STAGEHAND_INSTRUCTION ?? workflow.task;
  const startUrl = process.env.DEMO_START_URL ?? workflow.startUrl;
  const breakSpec = process.env.BREAK_SELECTOR
    ? { selector: process.env.BREAK_SELECTOR, newId: process.env.BREAK_NEW_ID, newText: process.env.BREAK_NEW_TEXT }
    : undefined;

  // The race scans the LeadSheet top-down and contacts every "not contacted" row.
  const queue = DEMO_LEADS.filter((l) => l.status === "none");
  const breakAtLead = Math.min(2, queue.length); // break the LinkedUp Send on the 2nd lead → heal, then recover

  res.json({ ok: true, rounds: queue.length, breakAt: breakAtLead });

  // Orchestrate async; stream every event over the WS. A lane failure is logged, never crashes the server
  // (a Stagehand misclick/timeout is fine — it only strengthens the cost contrast).
  void (async () => {
    // stealth:false — advancedStealth/Verified is Enterprise-only (403 on our Dev plan). We run basic
    // fingerprinting + residential proxy, which held up through Context warming + reuse.
    const stagehand = new StagehandLane({ startUrl, instruction, contextId: process.env.STAGEHAND_CONTEXT_ID, stealth: false, maxSteps: 18 });
    const mimic = new MimicLane({ workflow, contextId: process.env.MIMIC_CONTEXT_ID, breakSpec });
    try {
      const [s, m] = await Promise.all([stagehand.open(), mimic.open()]);
      if (s.liveViewUrl) broadcast({ kind: "liveview", lane: "stagehand", url: s.liveViewUrl });
      if (m.liveViewUrl) broadcast({ kind: "liveview", lane: "mimic", url: m.liveViewUrl });

      // Teaching (run 0): Mimic's ONE-TIME cost = the structure() call that compiled the demonstration,
      // captured + persisted on the workflow at record time (brain side). Emitting it starts Mimic's
      // meter elevated — the honest "paid once, then free". Stagehand has no teaching → starts at 0.
      const teach = workflow as { teachingTokensIn?: number; teachingTokensOut?: number };
      if (teach.teachingTokensIn != null) {
        const tin = teach.teachingTokensIn, tout = teach.teachingTokensOut ?? 0;
        broadcast({ kind: "metrics", lane: "mimic", run: 0, phase: "teaching", tokensIn: tin, tokensOut: tout, ms: 0, costUsd: cost(tin, tout) });
      }
      broadcast({ kind: "metrics", lane: "stagehand", run: 0, phase: "teaching", tokensIn: 0, tokensOut: 0, ms: 0, costUsd: 0 });

      // Mimic replays the recorded multi-tab flow. Two clicks are row-dependent — the sheet's "Message on
      // LinkedIn" link (tab 0) and the LinkedUp Message button (tab 1). Both render leads in the same order,
      // so re-point each to the lead's row index per lead (sheet shows all leads; LinkedUp shows the top 20).
      const sheetClick = workflow.steps.find((st) => st.action === "click" && (st.tab ?? 0) === 0);
      const liClick = workflow.steps.find((st) => st.action === "click" && st.tab === 1);
      const baseSheet = sheetClick?.selector ?? "";
      const baseLi = liClick?.selector ?? "";

      // DECOUPLED lanes: each walks the uncontacted queue at its OWN pace (no per-lead barrier), so the
      // per-lane timer + live-view fill independently — Mimic races through while Stagehand crawls.
      const runLane = async (lane: "stagehand" | "mimic", body: (lead: (typeof queue)[number], n: number) => Promise<unknown>): Promise<void> => {
        broadcast({ kind: "timer", lane, state: "start" });
        const t0 = Date.now();
        for (let n = 1; n <= queue.length; n++) await body(queue[n - 1], n);
        broadcast({ kind: "timer", lane, state: "stop", elapsedMs: Date.now() - t0 });
      };

      await Promise.all([
        runLane("stagehand", async (lead, n) => {
          console.log(`[race] stagehand → ${lead.name}`);
          const r = await stagehand.runRound({ name: lead.name, role: lead.role, company: lead.company }, n, broadcast);
          console.log(`[race] stagehand ${lead.name} done: ok=${r.ok} tokIn=${r.tokensIn} msg=${String(r.message).slice(0, 140)}`);
          return r;
        }),
        runLane("mimic", (lead, n) => {
          // Mutate both source selectors right before runRound clones them (sync until its first await) → the
          // clone replays this lead's sheet row + LinkedUp row. Mimic-only state; Stagehand never reads it.
          if (sheetClick) sheetClick.selector = baseSheet.replace(/tr:nth-of-type\(\d+\)/, `tr:nth-of-type(${lead.row})`);
          if (liClick) liClick.selector = baseLi.replace(/div:nth-of-type\(\d+\)/, `div:nth-of-type(${lead.row})`);
          console.log(`[race] mimic → ${lead.name} (sheet tr${lead.row} · li div${lead.row})`);
          return mimic.runRound({ messageText: lead.message }, n, broadcast, { breakNow: n === breakAtLead });
        }),
      ]);
    } catch (e) {
      console.error("[race] failed:", (e as Error).message);
    } finally {
      await Promise.all([stagehand.close(), mimic.close()]);
    }
  })();
});

const PORT = Number(process.env.PORT ?? 3000);
server.listen(PORT, () => console.log(`[mimic] http://localhost:${PORT}`));
