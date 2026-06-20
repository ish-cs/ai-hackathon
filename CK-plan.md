# CK-plan.md — Hands + Face

**For:** ck · the HANDS (browser: `runtime/recorder.ts`, `runtime/player.ts`) + FACE (screen: `web/`, Sentry viz). Work on branch **`ck`**.
**The one rule:** at each CP, **STOP → merge → run the test ritual (`npx tsx smoke.ts` + the manual beat) per CHECKPOINTS.md** before touching the next CP. Never solo-edit `shared/types.ts`.

> Ground truth (already read): scaffold compiles, `smoke.ts` PASSES proving `player.ts` + `mock.html` end-to-end on the write side. `runtime/recorder.ts` already has a **working capture scaffold** (capture-phase `change`/`click` listeners, `exposeBinding("__record")`, `selectorFor`/`contextFor`, `submit` detection) — CP1 is **harden + prove it flows into `structure()`**, not greenfield. `player.ts` already imports + calls the **real `heal()`** and emits `heal` RunEvents — CP2 is making the break path **deterministic**, not wiring from zero. Ishaan owns `brain/` (`structure`, `heal`, Redis `store`).

---

## CP0 — SETUP  (~30 min · both symmetric)

Goal: prove the scaffold runs on ck's machine before any feature work.

- [ ] Clone repo; `cd /Users/ish/_Projects/ai-hackathon`.
- [ ] `npm install`.
- [ ] `npm run browsers` (= `playwright install chromium`). **Stale-browser trap bit us once** — after install, run `npx playwright --version` and confirm it matches the `playwright` version in `package.json` (`^1.61.0`). If mismatch → `npx playwright install --force chromium`.
- [ ] `cp .env.example .env`; fill **`ANTHROPIC_API_KEY`** + **`REDIS_URL`** (grab from sponsor tables at kickoff). Leave `SENTRY_DSN` blank for now. Confirm `.env` is gitignored.
- [ ] `npm run dev` → server logs `[mimic] http://localhost:3000`. (`tsx watch runtime/server.ts`.)
- [ ] Open `http://localhost:3000/mock` → see Source CRM table (left) + Target form `#name`/`#email`/`#submit-btn` (right).
- [ ] Open `http://localhost:3000/` → split-screen UI loads, log shows `[ws] connected`.
- [ ] **With server up**, second terminal: `npx tsx smoke.ts` → must print **`PASS ✅`** (Scenario A completes, Scenario B crashes at `s3`).
- [ ] **Handoff gate:** say "green smoke + Redis ping" out loud with Ishaan before ANY feature work.

---

## CP1 — CRUDE END-TO-END  (~h0–4 · YOUR make-or-break)

Goal: Record → demonstrate on `/mock` → Stop → a **real `RawTrace`** → it structures + replays. **No healing yet.**

> **HIGHEST-RISK ITEM IN THE WHOLE BUILD = the recorder.** Ship the smallest capture first, then expand. **If it isn't capturing a clean trace by ~hour 3, STOP polishing it — point `structure()` at `shared/fixtures/sample-workflow.json` (or save one good trace to a fixture) and use that for the demo. Keep moving. A working fixture beats a broken live recorder on stage.**

### Step 1 — smallest shippable capture (prove the pipe, in order)
- [ ] In `runtime/recorder.ts`, leave the existing `change`-listener path alone first (it already emits `input`/`select` via `contextFor`). Just **prove the binding fires**: `npm run dev`, POST `/api/record/start`, type into the mock's `#name`, POST `/api/record/stop`, confirm the returned trace has ≥1 action with a sane `target.selector` (`#name`).
- [ ] Confirm `exposeBinding("__record", …)` actually pushes to `this.actions` across the page navigation — the listener is in `addInitScript` (runs on every doc) so it should survive `goto`. If actions come back empty, log inside the binding callback to see if it fires at all (hypothesis: binding registered after `goto` — but here `goto` is last, so it should be fine).
- [ ] Verify the trace shape **exactly matches `RawTrace`** in `shared/types.ts`: `{ traceId, task, startUrl, actions: RawAction[] }`, each action `{ type, timestamp, value, target: ElementContext }`. This is the seam into Ishaan's `structure()` — do not drift it.

### Step 2 — capture the full one-task demo
- [ ] Demonstrate the real task on `/mock`: fill `#name`, fill `#email`, click `#submit-btn`. Confirm trace has **3 actions** in order: `input` (name), `input` (email), `submit` (the button).
- [ ] Confirm the click handler tags the submit button as `type: "submit"` (it checks `type==="submit"` / `getAttribute("type")`). The mock button is `<button type="submit">` so this should land — **verify**, because `structure()`'s variable-vs-fixed logic keys off this.
- [ ] Confirm each `input` action carries the typed `value` (from the `change` event) so `structure()` can mark it variable + lift it to a parameter.
- [ ] Sanity-check `domSnapshot`: `contextFor` grabs `closest("form")?.outerHTML.slice(0,2000)` — confirm it captures the **form subtree** (gives `heal()` context later), and that 2000 chars is enough for the mock form (it is).

### Step 3 — harden capture (only what the demo needs — don't over-engineer arbitrary clicks)
- [ ] The `change` event fires on blur, not per-keystroke — fine for the demo. Confirm tabbing/clicking away from a field actually emits the `input` action (it won't fire if you Stop while a field is still focused — **click elsewhere before Stop**, or note this as a demo gotcha).
- [ ] `selectorFor` prefers `#id` → `[name=...]` → `nth-of-type` chain. Mock fields have ids — confirm it returns `#name`, `#email`, `#submit-btn` (clean), not a long chain.
- [ ] Don't expand to capture random page clicks / hovers / keypresses — out of scope. Only `input`, `select`, `click`, `submit` on form-ish targets. YAGNI.

### Step 4 — wire + prove the full loop (uses existing endpoints; don't rebuild them)
- [ ] `/api/record/start` (`server.ts`) calls `recorder.start(url)` and `/api/record/stop` calls `recorder.stop(task)` + `saveTrace`. These exist — just confirm Record/Stop buttons in `web/app.js` hit them and the trace returns.
- [ ] **(needs Ishaan's `structure()` — CP1 handoff)** Stop → `web/app.js` auto-POSTs the trace to `/api/workflows` → confirm it returns a `Workflow` with `parameters.length ≥ 1` (the name/email params) and `steps.length === 3`. If `structure()` mis-detects variable-vs-fixed, the problem is usually a missing/empty `value` or a wrong `type` in **your** trace → fix the recorder, not his prompt.
- [ ] **(needs Ishaan's Redis `store`)** Confirm the workflow lands in Redis (`getWorkflow`/`listWorkflows` return it). The `workflowId` shows in the `#wf` field after Stop.
- [ ] **Run from a NEW DataRow:** put a *different* name/email in the `#name`/`#email` bar inputs → click **▶ Run** → both lanes replay, the healing lane fills the target form with the new row + submits → `✓ saved <name>`.
- [ ] **CP1 exit:** Record → demonstrate → Stop → real `RawTrace` → structures → **Run replays a new row end to end.** Then the pause ritual.

---

## CP2 — THE HEAL WORKS  (~h4–10 · the 60-sec kill shot)

Goal: break ON → control lane crashes at submit, healing lane re-grounds the renamed button + completes. **Deterministic 3×.**

> Most of this lane already exists in `player.ts`: `tryHeal()` loops `MAX_HEAL_ATTEMPTS=2`, calls the real `heal()`, retries with `result.newSelector`, writes it back, emits `{kind:"heal"}` then `{kind:"step", status:"healed"}`. Your job = make the **break trigger** and the **heal path** rock-solid + visible, with the real key in.

- [ ] Confirm the break prop in `web/mock.html`: `?break=1` renames `#submit-btn` → `#send-btn` and text `Submit` → `Send`, so `#submit-btn` misses and **only intent survives**. (Already coded — verify it actually toggles by opening `/mock?break=1` and reading the `site changed` flag.)
- [ ] Confirm `/api/replay` (`server.ts`) appends `?break=1` to **both** lanes' `startUrl` when `breakSite` is true, and that the **🔧 Run with broken site** button in `web/app.js` sends `breakSite:true`.
- [ ] **Control lane (`heal:false`) must die at submit:** with break ON, `s1`/`s2` ok, `s3` fails (3s `STEP_TIMEOUT` on `#submit-btn`), `captureFailure(...)` logged, lane stops. This is exactly smoke.ts Scenario B with a live key — confirm it still holds.
- [ ] **(needs Ishaan's `heal()` returning a working selector — CP2 handoff)** Healing lane: on `#submit-btn` miss, `tryHeal()` sends `liveDom` (the form subtree) + intent to `heal()` → gets `#send-btn` (or a text/`:has-text` selector) → retries the click → **`✓ saved`**. If heal returns a selector Playwright can't use (e.g. `:has-text()` pseudo isn't valid CSS for `page.click` — it needs a Playwright locator), flag to Ishaan: prefer `#send-btn` / `button[type=submit]` / `text=Send` style that `page.click` accepts. **Don't change `heal()` yourself — agree on the selector shape.**
- [ ] Verify the **write-back**: after heal, `step.selector` becomes `#send-btn`, `step.healHistory` gets a record, `onHeal` bumps `wf.version` + re-saves to Redis. Re-running the same workflow on the broken site should now hit `#send-btn` on the **first** try (already learned) — note this for the "agent memory" story.
- [ ] **(needs Ishaan)** Confirm heal history persists to Redis (the agent-memory prize hook). You just emit the events; he owns the store.
- [ ] **Determinism pass:** run break-ON **3×** back-to-back. The flaky risks are (a) the 3s timeout being too tight under load — if the heal LLM call + retry races the timeout, the bottleneck is the LLM latency, not the click; (b) Gemini/Anthropic rate caps mid-demo. If it flickers on timing, raise the per-retry budget *inside `tryHeal`'s execute* only — **do not** loosen the control lane's timeout (control must still die fast and clean).
- [ ] **CP2 exit:** break ON → control dies at submit, healing completes, **repeatable 3×, no flicker.** Then the pause ritual (run the broken-site demo 3×).

---

## CP3 — SPLIT-SCREEN + SPONSORS  (~h10–16 · coarser from here)

Goal: it *looks* like a demo. One button → both lanes side by side, heal **animates** (not raw JSON), Sentry shows the captured failure. Can't plan past the first working demo in fine detail — these are the beats, refine live.

- [ ] Split-screen already exists in `web/index.html` (`.lane.control` | `.lane.healing`) + `web/app.js` consumes RunEvents over WS. Make it **read as a demo**: control side visibly **dies/red** at submit, healing side visibly **survives/green**. Status text → big clear state ("CRASHED" vs "COMPLETED").
- [ ] **Make the heal a LIVE visualization** in `web/app.js` `handle()` `kind==="heal"` branch (currently a one-line `heal-note`). Animate the re-ground: show **old selector → new selector**, the `reasoning`, the `confidence %`. Suggested: a card that flashes/pulses on the failing step, strikes through the dead selector, animates in the new one. This is the money shot — spend the polish here.
- [ ] Keep it zero-build (plain DOM + CSS transitions in `index.html`'s `<style>`). No framework. The UI is `createElement`-based — extend that, don't rewrite.
- [ ] **Sentry:** add a real `SENTRY_DSN` to `.env` (grab from Sentry sponsor table). `initSentry()` (`runtime/sentry.ts`) already inits when DSN present; `captureFailure()` already fires on both control + heal-exhausted failures. Run break-ON → confirm the failure shows in the Sentry dashboard. Tag it with workflowId/stepId (already passed in `context`).
- [ ] **(needs Ishaan)** Redis shows the saved + healed workflow (his lane — coordinate so the demo can flash "the agent remembered").
- [ ] **CP3 exit:** one button → both lanes on screen, heal animates, Sentry shows the failure. Pause ritual = full dress-run of the 60-sec beat.

---

## CP4 — POLISH + SAFETY NET  (~h16–22 · coarse)

Goal: nothing can sink the live demo.

- [ ] **Record the CLEAN backup demo video** (you own the screen — this is venue-wifi / dead-LLM insurance + Devpost requires one). Capture the full 60-sec beat: record → run clean → run broken → heal survives.
- [ ] Polish copy + error states on the **one** demo task (don't add a second use case unless everything above is rock solid — YAGNI).
- [ ] Confirm the fixture fallback still works (`shared/fixtures/sample-workflow.json`) so if live recording dies on stage you can still Run + heal from the saved workflow.
- [ ] **(shared HARD GATE — SAT MIDNIGHT)** Help ensure the **Devpost draft is up**: project name + **both** teammates added. Non-negotiable. Set a timer for Sat 11 PM.
- [ ] **CP4 exit:** backup video saved, Devpost draft live, demo runs flawlessly 5× cold. Pause ritual = full dress-run, lock the final cut.

---

## CP5 — SUBMIT + PRESENT  (Sun · coarse)

- [ ] Help **submit on Devpost by SUN 11 AM** (hard gate). Final merge to `main` locked before submit; **edits lock SUN 12 PM**.
- [ ] Be at the table **SUN 1–3 PM** (~4-min pitch).
- [ ] **Drive the live demo — you own the screen.** Run the beat: Record (or fixture) → Run clean → Run broken → control dies, Mimic heals + completes → flash Sentry + Redis.
- [ ] Have the backup video one keystroke away if wifi/LLM dies.

---

## Definition of done for Hands + Face

- [ ] **CP0:** server boots, `/mock` + `/` load, `smoke.ts` PASSES on ck's machine.
- [ ] **CP1:** `recorder.ts` emits a real `RawTrace` (3 actions, correct `submit` typing, values on inputs) that `structure()` turns into a Workflow + replays a NEW row end to end. *(Fallback wired: fixture if recorder dies by ~h3.)*
- [ ] **CP2:** break ON → control dies at submit, healing re-grounds the renamed button + completes, deterministic **3×**.
- [ ] **CP3:** split-screen reads as a demo, heal **animates** (old→new selector + reasoning + confidence), Sentry shows the captured failure.
- [ ] **CP4:** clean backup video recorded; demo flawless **5× cold**; Devpost draft up by Sat midnight.
- [ ] **CP5:** submitted by Sun 11 AM; live demo driven from the table.
- [ ] **Throughout:** never edited `shared/types.ts` shapes solo; stopped + merged at every CP.
