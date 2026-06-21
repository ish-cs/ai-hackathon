// Live driver for the Mimic landing page.
// Connects to the runtime WebSocket and drives the #demo split-screen from real
// RunEvent data (shared/types.ts). When a real run starts it takes over the canned
// animation baked into index.html; with no backend, that canned animation still plays
// so the page always demos. All DOM hooks are the design's own data-* attributes.
(function () {
  const $ = (sel) => document.querySelector(sel);
  const root = () => document.getElementById("mimic-lp");

  // ---- lane lookup ------------------------------------------------------------
  // RunEvent.lane is "control" | "healing"; the design calls the healing lane "mimic".
  function lane(evLane) {
    const r = root();
    if (!r) return null;
    if (evLane === "control") {
      return {
        steps: r.querySelector('[data-ctrl-steps]'),
        status: r.querySelector('[data-ctrl-status]'),
        end: r.querySelector('[data-ctrl-end]'),
        box: r.querySelector('[data-lane="control"]'),
        healCard: null,
      };
    }
    return {
      steps: r.querySelector('[data-heal-steps]'),
      status: r.querySelector('[data-heal-status]'),
      end: r.querySelector('[data-heal-end]'),
      box: r.querySelector('[data-lane="mimic"]'),
      healCard: r.querySelector('[data-heal-card]'),
    };
  }

  // ---- step-row visuals (mirror the canned helpers in index.html) -------------
  const ROW_CSS =
    "display:flex;justify-content:space-between;align-items:center;gap:10px;" +
    "padding:10px 13px;border:1px solid rgba(225,224,204,.10);border-radius:10px;" +
    "font:12px/1.4 ui-monospace,Menlo,monospace;color:rgba(225,224,204,.35);transition:all .45s ease;";

  function styleOk(s) {
    s.style.borderColor = "rgba(120,210,160,.5)";
    s.style.background = "transparent";
    s.style.color = "rgba(225,224,204,.85)";
    const d = s.querySelector("[data-d]");
    if (d) { d.textContent = "✓"; d.style.color = "#7fd3a0"; d.style.animation = ""; }
  }
  function styleFail(s) {
    s.style.borderColor = "rgba(255,107,107,.85)";
    s.style.background = "rgba(255,107,107,.08)";
    s.style.color = "#ff9b9b";
    const d = s.querySelector("[data-d]");
    if (d) { d.textContent = "✕"; d.style.color = "#ff6b6b"; d.style.animation = "mimicBlink 1s steps(1) infinite"; }
  }
  function styleHealed(s) {
    s.style.borderColor = "rgba(225,224,204,.7)";
    s.style.background = "rgba(225,224,204,.07)";
    s.style.color = "#E1E0CC";
    const d = s.querySelector("[data-d]");
    if (d) { d.textContent = "✓"; d.style.color = "#E1E0CC"; d.style.animation = ""; }
  }

  // one row per stepId per lane, so a later "healed" event updates the same row
  const rowMap = { control: {}, healing: {} };

  function rowFor(evLane, result) {
    const L = lane(evLane);
    if (!L || !L.steps) return null;
    let row = rowMap[evLane][result.stepId];
    if (!row) {
      row = document.createElement("div");
      row.style.cssText = ROW_CSS;
      const label = document.createElement("span");
      label.textContent = (result.stepId || "step") + " · " + (result.attemptedSelector || "");
      const mark = document.createElement("span");
      mark.setAttribute("data-d", "");
      mark.textContent = "·";
      row.append(label, mark);
      row._label = label;
      L.steps.appendChild(row);
      rowMap[evLane][result.stepId] = row;
    }
    return row;
  }

  // ---- heal card --------------------------------------------------------------
  function playHealCard(result, oldSelector) {
    const L = lane("healing");
    const card = L && L.healCard;
    if (!card) return;
    // old selector text (sits before the <i data-strike>)
    const strike = card.querySelector("[data-strike]");
    if (strike && oldSelector && strike.parentNode.firstChild) {
      if (strike.parentNode.firstChild.nodeType === 3) strike.parentNode.firstChild.textContent = oldSelector;
    }
    // new selector text (preserve the arrow svg, replace trailing text)
    const newsel = card.querySelector("[data-newsel]");
    if (newsel) {
      const svg = newsel.querySelector("svg");
      newsel.textContent = "";
      if (svg) newsel.appendChild(svg);
      newsel.appendChild(document.createTextNode(" " + (result.newSelector || "(no match)")));
    }
    const reason = card.querySelector("[data-reason]");
    if (reason) reason.textContent = result.reasoning || "";

    if (!result.healed) {
      // refused-to-guess state — amber instead of cream
      card.style.borderColor = "rgba(255,180,84,.5)";
      const head = card.querySelector("span");
      if (head) head.textContent = "Held back — refused to guess";
    }

    requestAnimationFrame(() => {
      card.style.opacity = "1";
      card.style.transform = "none";
      if (strike) strike.style.width = "100%";
      setTimeout(() => { if (newsel) { newsel.style.opacity = "1"; newsel.style.transform = "none"; } }, 300);
      const conf = typeof result.confidence === "number" ? result.confidence : 0;
      const ring = card.querySelector("[data-ring-fg]");
      const rt = card.querySelector("[data-ring-txt]");
      setTimeout(() => {
        if (ring) ring.style.strokeDashoffset = (119.4 * (1 - conf)).toFixed(1);
        if (rt) {
          let v = 0; const target = Math.round(conf * 100);
          const iv = setInterval(() => { v += 4; if (v >= target) { v = target; clearInterval(iv); } rt.textContent = v + "%"; }, 24);
        }
      }, 350);
      setTimeout(() => { if (reason) reason.style.opacity = "1"; }, 550);
    });
  }

  // ---- enter live mode: stand down the canned animation, clear the lanes -------
  function beginLive() {
    if (window.__mimicLive) return;
    window.__mimicLive = true;
    if (window.__mimicLP && window.__mimicLP.stopCanned) window.__mimicLP.stopCanned();
  }

  function resetLane(evLane, row) {
    const L = lane(evLane);
    if (!L) return;
    rowMap[evLane] = {};
    if (L.steps) L.steps.innerHTML = "";
    if (L.end) L.end.style.opacity = "0";
    if (L.box) L.box.style.animation = "";
    if (L.status) { L.status.textContent = "running…"; L.status.style.color = "rgba(225,224,204,.6)"; }
    if (L.healCard) {
      L.healCard.style.opacity = "0"; L.healCard.style.transform = "translateY(8px)";
      const strike = L.healCard.querySelector("[data-strike]"); if (strike) strike.style.width = "0";
      const ns = L.healCard.querySelector("[data-newsel]"); if (ns) { ns.style.opacity = "0"; ns.style.transform = "translateY(-4px)"; }
      const ring = L.healCard.querySelector("[data-ring-fg]"); if (ring) ring.style.strokeDashoffset = "119.4";
      const reason = L.healCard.querySelector("[data-reason]"); if (reason) reason.style.opacity = "0";
    }
  }

  // last failed selector per lane, so the heal card can show old -> new
  const lastFailed = {};

  function handle(ev) {
    if (!ev || !ev.kind) return;
    if (ev.kind === "run_start") {
      beginLive();
      resetLane(ev.lane);
      delete lastFailed[ev.lane];
    } else if (ev.kind === "step") {
      const r = ev.result; const row = rowFor(ev.lane, r);
      if (!row) return;
      if (r.status === "ok") styleOk(row);
      else if (r.status === "failed") { styleFail(row); lastFailed[ev.lane] = r.attemptedSelector; }
      else if (r.status === "healed") styleHealed(row);
    } else if (ev.kind === "heal") {
      const L = lane(ev.lane);
      if (L && L.status) { L.status.textContent = "healing…"; L.status.style.color = "#E1E0CC"; }
      playHealCard(ev.result, lastFailed[ev.lane]);
    } else if (ev.kind === "run_done") {
      const L = lane(ev.lane);
      if (!L) return;
      if (ev.ok) {
        if (L.box && ev.lane !== "control") L.box.style.animation = "mimicGlow 2.4s ease infinite";
        if (L.end) L.end.style.opacity = "1";
        if (L.status) { L.status.textContent = "completed"; L.status.style.color = "#E1E0CC"; }
      } else {
        if (L.box) L.box.style.animation = "mimicCrash 1s ease infinite";
        if (L.end) L.end.style.opacity = "1";
        if (L.status) { L.status.textContent = "dead — no recovery"; L.status.style.color = "#ff6b6b"; }
      }
    }
  }

  // ---- websocket --------------------------------------------------------------
  function setDot(on, label) {
    const dot = $("[data-live]");
    if (!dot) return;
    dot.classList.toggle("on", !!on);
    dot.lastChild.textContent = label;
  }

  let ws;
  function connect() {
    try {
      ws = new WebSocket(`ws://${location.host}`);
    } catch (e) { setDot(false, "offline"); return; }
    ws.onopen = () => setDot(true, "live");
    ws.onclose = () => { setDot(false, "offline"); setTimeout(connect, 2500); };
    ws.onerror = () => setDot(false, "offline");
    ws.onmessage = (e) => { try { handle(JSON.parse(e.data)); } catch (_) {} };
  }

  // ---- controls ---------------------------------------------------------------
  let workflowId = "";
  async function api(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    return res.json();
  }

  function wireControls() {
    const recBtn = $("[data-record]");
    const stopBtn = $("[data-record-stop]");
    const runBtn = $("[data-run]");
    const breakBtn = $("[data-run-break]");

    if (recBtn) recBtn.onclick = () => api("/api/record/start", { url: location.origin + "/mock" });
    if (stopBtn) stopBtn.onclick = async () => {
      const task = ($("[data-task]") || {}).value || "task";
      const trace = await api("/api/record/stop", { task });
      const wf = await api("/api/workflows", trace);
      if (wf && wf.workflowId) workflowId = wf.workflowId;
    };
    const run = (breakSite) => {
      const row = {
        customerName: ($("[data-name]") || {}).value || "",
        customerEmail: ($("[data-email]") || {}).value || "",
      };
      api("/api/replay", { workflowId, row, breakSite });
    };
    if (runBtn) runBtn.onclick = () => run(false);
    if (breakBtn) breakBtn.onclick = () => run(true);
  }

  async function autoloadWorkflow() {
    try {
      const wfs = await (await fetch("/api/workflows")).json();
      if (Array.isArray(wfs) && wfs.length && wfs[0].workflowId) workflowId = wfs[0].workflowId;
    } catch (_) {}
  }

  document.addEventListener("DOMContentLoaded", () => {
    wireControls();
    autoloadWorkflow();
    connect();
  });
})();
