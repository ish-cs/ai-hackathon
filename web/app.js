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

const lastFailed = {}; // lane -> { stepId, selector } — the selector that missed, for the heal card

function ring(confidence) {
  const pct = Math.round(confidence * 100);
  const R = 16, C = 2 * Math.PI * R;
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 40 40");
  svg.classList.add("ring");
  svg.innerHTML =
    `<circle class="ring-bg" cx="20" cy="20" r="${R}"></circle>` +
    `<circle class="ring-fg" cx="20" cy="20" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="${C}" transform="rotate(-90 20 20)"></circle>` +
    `<text class="ring-txt" x="20" y="24" text-anchor="middle">${pct}%</text>`;
  svg.dataset.offset = String(C * (1 - confidence));
  return svg;
}

function healCard(result, oldSelector) {
  const card = document.createElement("div");
  card.className = result.healed ? "heal-card" : "heal-card refused";

  const head = document.createElement("div");
  head.className = "hc-head";
  head.textContent = result.healed ? "⚡ RE-GROUNDED by intent" : "HELD BACK — refused to guess";
  card.appendChild(head);

  if (result.healed) {
    if (oldSelector) {
      const oldEl = document.createElement("div");
      oldEl.className = "hc-old";
      oldEl.textContent = oldSelector;
      card.appendChild(oldEl);
      const arrow = document.createElement("div");
      arrow.className = "hc-arrow";
      arrow.textContent = "↓";
      card.appendChild(arrow);
    }
    const newEl = document.createElement("div");
    newEl.className = "hc-new";
    newEl.textContent = result.newSelector;
    card.appendChild(newEl);
    card.appendChild(ring(result.confidence));
  }

  const reason = document.createElement("div");
  reason.className = "hc-reason";
  reason.textContent = result.reasoning;
  card.appendChild(reason);

  requestAnimationFrame(() => {
    card.classList.add("reveal");
    const fg = card.querySelector(".ring-fg");
    const svg = card.querySelector(".ring");
    if (fg && svg) fg.style.strokeDashoffset = svg.dataset.offset;
  });
  return card;
}

function setLaneState(lane, state) {
  const key = lane === "control" ? "control" : "healing";
  const laneEl = document.querySelector(`.lane.${key}`);
  const status = $(`${key}-status`);
  laneEl.classList.remove("crashed", "completed");
  laneEl.classList.add(state);
  status.textContent = state === "completed" ? "✓ COMPLETED" : "💀 CRASHED";
  status.className = `status big ${state}`;
}

function handle(ev) {
  log(`[${ev.lane ?? "-"}] ${ev.kind} ${ev.result ? JSON.stringify(ev.result).slice(0, 120) : ""}`);
  if (ev.kind === "run_start") {
    const rf = $("record-frame"); if (rf) { rf.innerHTML = ""; rf.style.display = "none"; } // teach frame done
    const { steps, status } = laneEls(ev.lane);
    steps.innerHTML = "";
    status.textContent = `running — row ${JSON.stringify(ev.row)}`;
    delete lastFailed[ev.lane];
    const laneEl = document.querySelector(`.lane.${ev.lane === "control" ? "control" : "healing"}`);
    laneEl.classList.remove("crashed", "completed");
    status.className = "status";
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
    if (r.status === "failed") lastFailed[ev.lane] = { stepId: r.stepId, selector: r.attemptedSelector };
  } else if (ev.kind === "heal") {
    const { steps } = laneEls(ev.lane);
    const old = lastFailed[ev.lane] ? lastFailed[ev.lane].selector : null;
    steps.appendChild(healCard(ev.result, old));
  } else if (ev.kind === "run_done") {
    setLaneState(ev.lane, ev.ok ? "completed" : "crashed");
  } else if (ev.kind === "liveview") {
    renderLiveView(ev.lane, ev.url);
  }
}

function makeFrame(url, interactive) {
  const f = document.createElement("iframe");
  f.className = "liveview";
  f.src = url;
  f.setAttribute("sandbox", "allow-same-origin allow-scripts");
  f.setAttribute("allow", "clipboard-read; clipboard-write");
  if (!interactive) f.style.pointerEvents = "none"; // replay lanes read-only; record is read/write
  return f;
}

// ENGINE=browserbase only: embed each cloud session's live view. control→left lane, healing→right
// lane (read-only); record→centered frame (read/write, so the user can teach inside it).
function renderLiveView(lane, url) {
  if (lane === "record") {
    const host = $("record-frame");
    host.innerHTML = '<div class="label">● Recording — demonstrate the task in the live browser below, then “Stop &amp; build”.</div>';
    host.appendChild(makeFrame(url, true));
    host.style.display = "block";
    return;
  }
  const laneEl = document.querySelector(`.lane.${lane === "control" ? "control" : "healing"}`);
  laneEl.querySelector(".liveview")?.remove(); // replace any prior run's frame
  laneEl.querySelector("h2").insertAdjacentElement("afterend", makeFrame(url, false));
}

// Browserbase posts this when a session ends — note it; it is NOT a heal failure.
window.addEventListener("message", (e) => {
  if (e.data === "browserbase-disconnected") log("[liveview] a Browserbase session ended");
});

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return res.json();
}

$("rec-start").onclick = async () => {
  await api("/api/record/start", { url: $("start-url").value || `${location.origin}/mock` });
  log("[record] started — demonstrate in the opened browser, then Stop");
};

$("rec-stop").onclick = async () => {
  const trace = await api("/api/record/stop", { task: $("task").value });
  log(`[record] ${trace.actions.length} actions captured — structuring…`);
  const wf = await api("/api/workflows", trace);
  $("wf").value = wf.workflowId;
  renderParams(wf.parameters);
  log(`[workflow] ${wf.workflowId} v${wf.version} — ${wf.steps.length} steps, ${wf.parameters.length} params`);
};

// Render an input per workflow parameter — works for any workflow (customer form OR LinkedIn outreach).
function renderParams(params) {
  const box = $("params");
  box.innerHTML = "";
  for (const p of params || []) {
    const inp = document.createElement("input");
    inp.dataset.param = p.name;
    inp.placeholder = p.name;
    inp.value = p.example || "";
    inp.size = Math.min(44, Math.max(12, (p.example || p.name).length + 2));
    box.appendChild(inp);
  }
}

function run(breakSite) {
  const row = {};
  for (const inp of document.querySelectorAll("#params input")) row[inp.dataset.param] = inp.value;
  log(`[run] ${$("wf").value} breakSite=${breakSite} row=${JSON.stringify(row)}`);
  api("/api/replay", { workflowId: $("wf").value, row, breakSite });
}
$("run").onclick = () => run(false);
$("run-break").onclick = () => run(true);

// Auto-load a saved workflow on page load so the demo is click-and-go (no manual id paste).
// Only fills an empty box, so recording in-session (which sets #wf on Stop) always wins.
(async () => {
  try {
    if ($("wf").value) return;
    const wfs = await (await fetch("/api/workflows")).json();
    if (Array.isArray(wfs) && wfs.length) {
      // Prefer the multi-tab (LinkedIn outreach) workflow so the headline demo loads deterministically,
      // even though Redis may hold many saved workflows; fall back to the first.
      const wf = wfs.find((w) => (w.steps || []).some((s) => s.action === "switchTab")) ?? wfs[0];
      $("wf").value = wf.workflowId;
      renderParams(wf.parameters);
      log(`[workflow] auto-loaded ${wf.workflowId} — ${wf.steps.length} steps, ${wf.parameters.length} params${wfs.length > 1 ? ` (${wfs.length} saved; paste another id to switch)` : ""}`);
    } else {
      log("[workflow] none saved yet — Record one, or it won't have a workflow to Run");
    }
  } catch (e) {
    log("[workflow] auto-load failed: " + e.message);
  }
})();
