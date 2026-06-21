# Landing Page × Cost Race — SJ Hand-off Brief

> **For SJ.** Bring the cost-race pivot (Stagehand $ vs Mimic $) into your landing page
> (`frontend-landing-page`). Keep ALL marketing chrome — hero, manifesto, feature cards,
> CTA, fonts, `demo.mp4`. Replace ONLY the interactive `#heal`/`#demo` block (the old
> "crash vs heal" robustness demo) with the two-lane cost race, restyled to your
> cream-on-black design.

**Decision (locked):** Replace the heal demo with the cost race. The break round still
shows the heal beat (Mimic re-grounds once, then re-caches), so "self-healing" survives as
a sub-point inside the economics story — you don't lose the heal moment, it just becomes
one bump on Mimic's otherwise-flat cost curve.

---

## The new story the section must tell

Old `#demo`: *Normal agent crashes ✕ / Mimic heals ✓.*
New `#demo`: **Stagehand re-reasons every run and pays the model every time. Mimic was
taught once — it replays for free, heals once when the page breaks, then is free again.**
The win axis is **money + determinism**, not robustness.

Per lane the audience watches: a **live Browserbase window**, a **current-round token
counter**, a **cumulative $/tokens readout**, and a **cumulative-spend graph** (both lanes
on one canvas, your lane bold, the other faded). Stagehand's curve climbs every round;
Mimic's starts *elevated* (its one-time teaching cost) then runs flat.

---

## Split of work

| Who | Does | Status |
|---|---|---|
| **ck** | Tasks 1–2: merge the cost-race backend onto your branch, resolve the backend conflicts (`shared/types.ts`, `server.ts`, `recorder.ts`, deps), push you a branch with `/api/race` working. | **blocks you — wait for the pushed branch** |
| **SJ (you)** | Tasks 3–5: rebuild the `#demo` markup, rewrite `live.js` around the new events, strip the dead canned animation. | your half |
| **ck** | Task 6: final live run with the real `.env` secrets (Browserbase keys, burner Context IDs, LinkedIn workflow). | needs the last-mile recording |

You **cannot run the race live** — it needs ck's `.env` (Browserbase keys + burner
Context IDs, all gitignored). So you build the UI against **mock metrics events** (Task 0),
exactly how the cost-race UI was first built. ck swaps in the real backend at the end.

---

## State of the two branches (context)

| | `frontend-landing-page` (you) | `ishgoon` (ck, canonical backend) |
|---|---|---|
| Landing UI | ✅ hero/manifesto/cards/CTA | ❌ minimalist only |
| Interactive demo | OLD crash-vs-heal (`#heal`, `live.js`) | cost race (`web/race.js`) |
| `shared/types.ts` | OLD (`control`/`healing` only) | NEW (`+ stagehand/mimic` + `metrics` event) |
| Cost-race backend | ❌ none | ✅ `StagehandLane`, `MimicLane`, `breaker.ts`, `metrics.ts`, `/api/race` |
| `recorder.ts` | self-heal `reset()` patch | Browserbase-aware `start()` → `{ liveViewUrl }` |
| Stagehand deps | ❌ | ✅ `@browserbasehq/stagehand` + `@browserbasehq/sdk` |

The branches diverged before the pivot. ck merges them (Tasks 1–2) and hands you the result.

---

## The event contract you build against

Two WebSocket event kinds drive your section (already defined in ck's `shared/types.ts`):

```ts
// per round, per lane — REAL token usage
{ kind: "metrics", lane: "stagehand" | "mimic", run: number,
  phase: "teaching" | "running", tokensIn: number, tokensOut: number,
  ms: number, costUsd: number }

// when a lane's live browser is ready
{ kind: "liveview", lane: "stagehand" | "mimic", url: string }  // Browserbase iframe URL
```

`run: 0, phase: "teaching"` fires once per lane at the start — Mimic carries its teaching
cost (elevated baseline), Stagehand teaching is 0. Rounds `1..N` are `phase: "running"`.

**Reference implementation:** `web/race.js` on `ishgoon` already consumes exactly these
events (accumulate `S[lane]`, baseline on `teaching`, `draw()` both curves, mount the
iframe). You're porting its logic into your DOM. Read it first.

---

## Tasks

### Task 0 — Mock harness so you can build without ck's secrets

- [ ] In a scratch file or the browser console, emit a scripted sequence of the events
  above so your section animates end-to-end with no backend:
  teaching (mimic ~8k tok, stagehand 0) → 4 rounds where stagehand spends ~3–6k tok/round
  and mimic spends 0 except round 3 (the break heal, ~2k tok) → done.
- [ ] Drive it either by posting fake events onto your WS handler, or a `?mock=1` flag in
  `live.js` that replays a hardcoded array on a timer. (ck's original cost-race UI was
  built this exact way before the real lanes existed.)

**Verify:** counters tick, both curves draw, Mimic starts elevated + stays flat with one
bump at round 3, Stagehand climbs every round — all with no server.

### Task 1 — (ck) Merge ishgoon backend onto your branch

`git merge origin/ishgoon` into `frontend-landing-page`; resolve:
- `shared/types.ts` → take ishgoon's whole file (superset).
- `package.json` + lockfile → union deps; `npm install`.
- `runtime/server.ts` → keep ishgoon's `/api/race`; keep your `/api/record` + `/api/replay`.
- `runtime/recorder.ts` → Task 2.

**Verify:** `npx tsc --noEmit` green; `POST /api/race` with no config → 400 `no workflowId`.

### Task 2 — (ck) Reconcile recorder.ts (keep BOTH)

Compatible — combine: ishgoon's Browserbase `start()` → `{ liveViewUrl }` + your self-heal
`reset()` (start calls `await this.reset()` instead of throwing; 3s `Promise.race` close cap).

### Task 3 — (SJ) Rebuild the `#heal`/`#demo` markup (`web/index.html`)

Keep the section shell, eyebrow, heading, and your reveal animations. Replace the innards.

- [ ] **Copy reframe** (keep cream/serif type styles, swap words):
  - Eyebrow `The kill shot` → `The cost race`.
  - H2 → e.g. `Every agent works once. ` + serif `Mimic is the only one you can afford to run again.`
  - Sub-line → `Stagehand re-reasons every run and pays the model every time. Mimic was
    taught once — it replays for free, and heals once when the page changes.`
- [ ] **Control bar** (`.mimic-bar`): drop the 4-button Record/Build/Run/Break cluster.
  Minimal: one `<button data-race-start>▶ Start race</button>` + keep your
  `.mimic-live-dot` WS indicator.
- [ ] **Replace the two lane cards** (`[data-lane="control"]`, `[data-lane="mimic"]`) with
  one card per `stagehand` / `mimic`, reusing your `#0c0c0a` card style, each holding:
  - Header: lane name + subtitle (`Stagehand` / `pure LLM · pays every run`,
    `Mimic` / `taught once · deterministic`).
  - **Live window:** `<div data-race-window="stagehand">` — host for the Browserbase iframe.
  - **Current-round counter:** `<div data-race-cur="stagehand">0</div>`.
  - **Cumulative readout:** `<div data-race-cum="stagehand">Σ 0 tok · $0.0000</div>`.
  - **Spend graph:** `<canvas data-race-graph="stagehand">`.
- [ ] **Palette in your tokens:** mimic = cream `#E1E0CC` (your hero color); stagehand =
  your amber/orange (`#ff9b9b` / `#ff7a59`). Two distinct lanes, page stays restrained.
- [ ] Delete the orphaned heal-card markup (`[data-heal-card]`, ring, strike, step rows).

### Task 4 — (SJ) Rewrite `web/live.js` around `metrics` + `liveview`

Port `race.js` into your DOM hooks; drop the old `run_start`/`step`/`heal`/`run_done`
handlers (the new section has no step rows). Keep your WS connect/reconnect + `.mimic-live-dot`.

- [ ] State `S[lane] = { cum, cumCost, points:[{cum:0}] }` for `stagehand`/`mimic`.
- [ ] `onMetrics(ev)`: `cum += tokensIn+tokensOut`; `cumCost += costUsd`; if
  `phase==="teaching"` set `points=[{cum}]` (baseline → elevated start), else push. Update
  `[data-race-cur]` + `[data-race-cum]`; bump.
- [ ] `onLive(ev)`: inject sandboxed `pointer-events:none` iframe into
  `[data-race-window=ev.lane]` (copy `race.js` `onLive`).
- [ ] `draw(canvas, selfLane)`: both curves, self `alpha 1 / lw 2.5`, other
  `alpha 0.28 / 1.5`, autoscale (copy `race.js` `draw`).
- [ ] `[data-race-start].onclick`: reset → `POST /api/race {}` → disable button for
  `rounds*1800+2500ms`.
- [ ] WS `onmessage`: route `metrics` → `onMetrics`, `liveview` → `onLive`; drop the rest.

### Task 5 — (SJ) Stand down the canned heal animation (inline `<script>` in index.html)

`MimicLP.registerHeal/playHeal/resetHeal` target the deleted `[data-cstep]`/`[data-hstep]`
nodes — dead after Task 3. Remove the `registerHeal(root)` call (and optionally the three
methods). KEEP `registerWords` / `registerFades` / `setupChars` / `applyNoise` — those are
your marketing reveals.

### Task 6 — (ck) Final live run

ck supplies `.env` (Browserbase keys, burner Context IDs, `DEMO_WORKFLOW_ID`,
`STAGEHAND_INSTRUCTION`, `BREAK_SELECTOR`) and runs the real race against your UI.

**Verify:** two Browserbase windows mount; both counters tick; Stagehand climbs every round;
Mimic starts elevated (teaching), flat, one bump at the break round, flat again.

---

## What SJ needs from ck (the explicit asks)

1. The merged branch (Tasks 1–2 done) pushed, so `/api/race` + `shared/types.ts` `metrics`
   exist on your branch.
2. Confirmation of the event field names above (don't hand-type them — read ck's
   `shared/types.ts` after the merge).
3. Nothing else to build live — ck owns the final `.env` + the LinkedIn workflow recording
   (the "last mile"). Your section is done once it animates correctly off mock events.

## Risks

- Two live Browserbase iframes inside a scrolling page — keep `pointer-events:none` and a
  fixed window height so layout doesn't jump.
- A Stagehand timeout must not blank the section — keep the last-good curve on error.
- Don't regress ck/Ishaan's `shared/types.ts` seam in any merge — always take the superset.
