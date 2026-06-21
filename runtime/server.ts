import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import type { DataRow, RawTrace, RunEvent } from "../shared/types";
import { structure } from "../brain/structure";
import { saveWorkflow, getWorkflow, listWorkflows, getHistory, saveTrace } from "../brain/store";
import { Recorder } from "./recorder";
import { replay, closeLiveBrowsers } from "./player";
import { stripSwitchTabs, applyTabs, breakForDemo } from "./multitab";
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
    // ENGINE=browserbase: record against the PUBLIC mock (cloud browsers can't reach localhost).
    const url = process.env.MOCK_URL ?? req.body.url ?? "http://localhost:3000/mock";
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
    const tabbed = applyTabs(wf, trace);
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

  // ENGINE=browserbase: a workflow recorded against the operator's localhost can't be reached by the
  // cloud browser, so swap a localhost startUrl for the public MOCK_URL. Workflows recorded against a
  // public URL (e.g. the v2 LeadSheet) already work from the cloud → leave those untouched.
  const isLocalHost = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(pristine.startUrl);
  const base = process.env.MOCK_URL && isLocalHost ? process.env.MOCK_URL : pristine.startUrl;
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
        wf.startUrl = pristine.startUrl; // never persist the ?break=1 demo-harness mutation
        await saveWorkflow(wf);
      },
    }),
  ]);

  res.json({ control: controlOk, healing: healingOk });
});

const PORT = Number(process.env.PORT ?? 3000);
server.listen(PORT, () => console.log(`[mimic] http://localhost:${PORT}`));
