// Cost-race UI — ck's Face lane. Consumes `metrics` events (MetricsEvent in runtime/metrics.ts) and
// `liveview` events over the WebSocket, drives the two-half Stagehand-vs-Mimic comparison. Each half:
// label · Browserbase window · current-task token counter · cumulative-spend graph (the other lane
// overlaid semi-transparently for direct contrast). Zero build, plain JS.
const $ = (id) => document.getElementById(id);
const COLOR = { stagehand: "#ff7a59", mimic: "#39d98a" };
const LANES = ["stagehand", "mimic"];

// Per-lane cumulative state. points[] is the spend curve (index = event order; cum = running tokens).
const S = {
  stagehand: { cum: 0, cumCost: 0, points: [{ cum: 0 }] },
  mimic: { cum: 0, cumCost: 0, points: [{ cum: 0 }] },
};

function reset() {
  for (const l of LANES) {
    S[l] = { cum: 0, cumCost: 0, points: [{ cum: 0 }] };
    $(`cur-${l}`).textContent = "0";
    $(`cum-${l}`).textContent = "Σ 0 tok · $0.0000";
  }
  drawAll();
}

function bump(el) {
  el.classList.add("bump");
  setTimeout(() => el.classList.remove("bump"), 130);
}

function onMetrics(ev) {
  const st = S[ev.lane];
  const tok = ev.tokensIn + ev.tokensOut;
  st.cum += tok;
  st.cumCost += ev.costUsd;
  st.points.push({ cum: st.cum });

  const cur = $(`cur-${ev.lane}`);
  cur.textContent = tok.toLocaleString();
  bump(cur);
  $(`cum-${ev.lane}`).textContent = `Σ ${st.cum.toLocaleString()} tok · $${st.cumCost.toFixed(4)}`;
  drawAll();
}

function onLive(ev) {
  const win = $(`win-${ev.lane}`);
  if (!win) return;
  win.innerHTML = "";
  const f = document.createElement("iframe");
  f.src = ev.url;
  f.setAttribute("sandbox", "allow-same-origin allow-scripts");
  f.setAttribute("allow", "clipboard-read; clipboard-write");
  f.style.pointerEvents = "none"; // read-only — the agents drive, the audience watches
  win.appendChild(f);
}

// Draw both lanes' cumulative curves into one canvas; `selfLane` is bold, the other is faded.
function draw(canvas, selfLane) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const maxCum = Math.max(1, ...LANES.flatMap((l) => S[l].points.map((p) => p.cum)));
  const maxLen = Math.max(2, ...LANES.map((l) => S[l].points.length));
  const pad = 6;
  const X = (i) => pad + (w - 2 * pad) * (i / (maxLen - 1));
  const Y = (v) => (h - pad) - (h - 2 * pad) * (v / maxCum);

  for (const l of LANES) {
    const self = l === selfLane;
    ctx.beginPath();
    S[l].points.forEach((p, i) => {
      const x = X(i), y = Y(p.cum);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.strokeStyle = COLOR[l];
    ctx.globalAlpha = self ? 1 : 0.28;
    ctx.lineWidth = self ? 2.5 : 1.5;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawAll() {
  draw($("g-stagehand"), "stagehand");
  draw($("g-mimic"), "mimic");
}

const ws = new WebSocket(`ws://${location.host}`);
ws.onmessage = (e) => {
  const ev = JSON.parse(e.data);
  if (ev.kind === "metrics" && S[ev.lane]) onMetrics(ev);
  else if (ev.kind === "liveview" && S[ev.lane]) onLive(ev);
};

$("start").onclick = async () => {
  reset();
  const btn = $("start");
  btn.disabled = true;
  try {
    const r = await fetch("/api/race", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const { rounds } = await r.json();
    setTimeout(() => (btn.disabled = false), (rounds || 4) * 1800 + 2500); // re-enable after the scripted race
  } catch {
    btn.disabled = false;
  }
};

window.addEventListener("resize", drawAll);
drawAll();
