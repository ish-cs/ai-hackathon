// Zero-build UI. Consumes RunEvent (shared/types.ts) over WebSocket and drives the split-screen.
const $ = (id) => document.getElementById(id);
const log = (m) => { $("log").textContent += m + "\n"; $("log").scrollTop = 1e9; };

const ws = new WebSocket(`ws://${location.host}`);
ws.onopen = () => log("[ws] connected");
ws.onmessage = (e) => handle(JSON.parse(e.data));

function laneEls(lane) {
  const key = lane === "control" ? "control" : "healing";
  return { steps: $(`${key}-steps`), status: $(`${key}-status`) };
}

function handle(ev) {
  log(`[${ev.lane ?? "-"}] ${ev.kind} ${ev.result ? JSON.stringify(ev.result).slice(0, 120) : ""}`);
  if (ev.kind === "run_start") {
    const { steps, status } = laneEls(ev.lane);
    steps.innerHTML = "";
    status.textContent = `running — row ${JSON.stringify(ev.row)}`;
  } else if (ev.kind === "step") {
    const { steps } = laneEls(ev.lane);
    const r = ev.result;
    const row = document.createElement("div");
    row.className = `step ${r.status}`;
    const left = document.createElement("span");
    left.textContent = `${r.stepId} · ${r.status.toUpperCase()}`;
    const right = document.createElement("span");
    right.className = "s";
    right.textContent = r.attemptedSelector + (r.error ? " — " + r.error.slice(0, 40) : "");
    row.append(left, right);
    steps.appendChild(row);
  } else if (ev.kind === "heal") {
    const { steps } = laneEls(ev.lane);
    const r = ev.result;
    const note = document.createElement("div");
    note.className = "heal-note";
    note.textContent = r.healed
      ? `↻ healed ${r.stepId} → ${r.newSelector}  (${Math.round(r.confidence * 100)}%) — ${r.reasoning}`
      : `✗ could not heal ${r.stepId} — ${r.reasoning}`;
    steps.appendChild(note);
  } else if (ev.kind === "run_done") {
    const { status } = laneEls(ev.lane);
    status.textContent = ev.ok ? "✓ completed" : "✗ crashed";
  }
}

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return res.json();
}

$("rec-start").onclick = async () => {
  await api("/api/record/start", { url: `${location.origin}/mock` });
  log("[record] started — demonstrate in the opened browser, then Stop");
};

$("rec-stop").onclick = async () => {
  const trace = await api("/api/record/stop", { task: $("task").value });
  log(`[record] ${trace.actions.length} actions captured — structuring…`);
  const wf = await api("/api/workflows", trace);
  $("wf").value = wf.workflowId;
  log(`[workflow] ${wf.workflowId} v${wf.version} — ${wf.steps.length} steps, ${wf.parameters.length} params`);
};

function run(breakSite) {
  const row = { customerName: $("name").value, customerEmail: $("email").value };
  log(`[run] ${$("wf").value} breakSite=${breakSite}`);
  api("/api/replay", { workflowId: $("wf").value, row, breakSite });
}
$("run").onclick = () => run(false);
$("run-break").onclick = () => run(true);
