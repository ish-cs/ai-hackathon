# ISHGOON — Brain build plan (Ishaan)

For **Ishaan / THE BRAIN / branch `ishgoon`**. Pure logic: `brain/structure.ts` + `brain/heal.ts`. No browser, no UI — that's ck.
**ONE RULE:** at each CP, STOP and merge per `CHECKPOINTS.md`. Same JSON shapes (`shared/types.ts`) either side of the seam — never change a shape without agreeing with ck first.

---

## CP0 — SETUP (~30 min)

- [ ] `git checkout -b ishgoon` off the agreed base; confirm working tree clean.
- [ ] `npm install` at repo root; confirm no errors.
- [ ] `npm run browsers` (= `playwright install chromium`) — needed even though Brain has no browser, so smoke/player can run on your machine.
- [ ] Create `.env` at repo root: `ANTHROPIC_API_KEY=...` + `REDIS_URL=...` (both arrive at the event). DO NOT commit `.env` — verify it's gitignored.
- [ ] Run smoke: `npx tsx smoke.ts` → must PASS (proves replay plumbing + failure detection, no key/Redis needed).
- [ ] `npm run typecheck` (= `tsc --noEmit`) → clean.
- [ ] Redis ping: `redis-cli -u $REDIS_URL ping` → `PONG` (or a 3-line `tsx` script importing `getWorkflow` to force `connect()`).
- [ ] Smoke `structure()` WITHOUT crashing: tiny `tsx` script → load `shared/fixtures/sample-trace.json`, call `structure(trace)`, log the returned `Workflow`. With a key it should produce real output; without one it must fail LOUDLY (anthropic.ts client throws on missing key — that's expected, not a bug).
- [ ] Smoke `heal()` WITHOUT crashing: build a `HealRequest` from one `sample-workflow.json` step + a snippet of DOM, call `heal(req)`, log the `HealResult`.
- [ ] Skim `brain/anthropic.ts`, `brain/store.ts` (both DONE) so you know the helpers: `completeJSON<T>({system,user,schema,effort,maxTokens})`, `MODEL="claude-opus-4-8"`, `saveWorkflow`/`getWorkflow`/`getHistory`/`saveTrace`.
- [ ] Confirm the seam in your head: `RawTrace` in → `Workflow` out (structure); `HealRequest` in → `HealResult` out (heal). Nothing else crosses.
- [ ] **MERGE CP0** per `CHECKPOINTS.md`.

---

## CP1 — CRUDE END-TO-END (~h0–4, both converge)
**Exit: a recorded task structures into a runnable workflow stored in Redis.**

Make `structure(RawTrace) → Workflow` actually *correct*. The stub prompt + schema exist but are UNTUNED.

- [ ] Re-read `brain/structure.ts` `SYSTEM` + `SCHEMA` against `sample-trace.json` → `sample-workflow.json`. That fixture pair IS your target output. Tune until structure() reproduces it.
- [ ] **Variable-vs-fixed detection** — the core CP1 judgement. Tune `SYSTEM` so:
  - `input`/`select` carrying per-row data (name `Acme Corp`, email `hello@acme.com`) → `valueFrom = <camelCase param>`, `valueLiteral = null`, and that param is pushed to `parameters[]` with the observed value as `example`.
  - fixed actions (the Submit click) → `valueFrom = null`, `valueLiteral = null` (or the literal for a fixed input).
  - param names stay CONSISTENT across steps and match `parameters[].name`.
- [ ] **Intent quality** — tune `SYSTEM` so each step's `intent` is SEMANTIC and re-groundable by meaning, not selector ("type the customer's name into the Name field", "submit the form to save the customer"). This intent is what `heal()` consumes at CP2 — weak intent here = weak heal later.
- [ ] **fallbackHints** — verify structure() copies `role`/`label`/`text` from `action.target` and infers a useful `nearText` from `target.domSnapshot`. These are heal's lifeline.
- [ ] Tune `effort`/`maxTokens` in the `completeJSON` call in `structure()` if output is truncated or sloppy (currently `effort:"high"`, default 8192 tokens).
- [ ] **Fixture assertion** — write `brain/_check_structure.ts` (throwaway): `structure(sample-trace)` then assert parameter count = 2, names `customerName`/`customerEmail`, step count = 3, s3 is `submit` with both value fields null, each step has non-empty `intent`. Run it; iterate prompt until green.
- [ ] Confirm id/version assignment in code is right: `workflowId = wf_<traceId minus trace_ prefix>`, `version:1`, `stepId = s1..sN`, `healHistory: []`. (Logic already in structure.ts — just verify it survives your edits.)
- [ ] **Redis round-trip**: `saveWorkflow(wf)` → `getWorkflow(wf.workflowId)` → deep-equal the original. Also confirm `saveWorkflow` pushed a `workflow:{id}:history` entry (`getHistory` returns 1 item at version 1).
- [ ] (needs ck's recorder emitting `RawTrace` — CP1 handoff) run `structure()` on a REAL recorded trace, not just the fixture. Compare shape to fixture; if recorder fields differ from `ElementContext`, FLAG to ck immediately — do not silently coerce.
- [ ] (depends on ck's `runtime/player.ts`) sanity-check: a structured `Workflow` + a `DataRow` whose keys = `parameters[].name` replays clean on the happy path (no break yet).
- [ ] **MERGE CP1** per `CHECKPOINTS.md`.

---

## CP2 — THE HEAL WORKS (~h4–10)
**Exit: healing lane re-grounds and completes, repeatably, on the Submit→Send break.**

Make `heal(HealRequest) → HealResult` re-ground by INTENT from live DOM with usable confidence.

- [ ] Re-read `brain/heal.ts` `SYSTEM` + `SCHEMA`. Tune `SYSTEM` to prioritise `step.intent` over the dead selector; instruct selector preference order `#id` → `[name=...]` → stable attr/text selector.
- [ ] **Rehearse the exact demo break**: button text/id changes Submit→Send. Hand-build a `HealRequest` (s3 step from `sample-workflow.json` + a DOM where `#submit-btn` is gone and a `Send` button exists). Call `heal()` → assert `healed:true`, `newSelector` matches the Send button, `confidence` high (set+document a threshold, e.g. ≥0.7).
- [ ] **Conservatism check**: feed a DOM where NO element matches the intent → assert `healed:false`, `newSelector:null` (no hallucinated selector). Tune `SYSTEM` until both the positive and negative cases hold.
- [ ] **DOM size cap** (the `TODO(brain)` in heal.ts): trim/cap `req.liveDom` before sending so the live-stage call stays fast and within tokens. Keep `effort:"medium"`, `maxTokens:2048` unless accuracy demands more — heal is on the live demo path, favor speed.
- [ ] **Heal history persisted = Redis agent memory** (CP2 exit-critical):
  - (with ck) on a successful heal, the step's `selector` is overwritten with `newSelector`, a `HealRecord` is appended to `step.healHistory`, `Workflow.version` bumps, and `saveWorkflow` re-persists. Confirm `getHistory(id)` shows version 1 → 2.
  - decide WHO writes back (player calls `heal()` then persists, vs Brain helper) — agree the boundary with ck; if it lands in Brain, add a thin `applyHeal(wf, healResult)` in `brain/` that returns the bumped workflow.
- [ ] (depends on ck's `runtime/player.ts`) end-to-end heal lane: player hits the broken selector → calls your `heal()` → retries with `newSelector` → step goes `failed`→`healed`→run completes. Run it 3× for repeatability.
- [ ] Tune prompts so heal works on at least one break BEYOND the demo (e.g. an input field renamed) — proves it's intent-based, not memorised.
- [ ] **MERGE CP2** per `CHECKPOINTS.md`.

---

## CP3 — SPLIT-SCREEN + SPONSORS (~h10–16)
*Coarse from here — can't plan past the first working demo in fine detail. Adjust live.*

- [ ] Make Redis a VISIBLE agent memory for the demo: ensure `listWorkflows()` + `getHistory(id)` expose the workflow list and the heal audit trail so ck's `web/` can render "what the agent learned." Add a tiny query helper in `brain/store.ts` only if ck needs a shape that isn't there yet.
- [ ] Write the economic-empowerment pitch framing (1 paragraph): automation as a superpower handed to non-coders — record once, the agent does it forever and fixes itself. This is the judged story, not a feature.
- [ ] Band go/no-go on running record/replay/heal as **agents in shared rooms** (sponsor tie-in). Same JSON shapes either way — only wire it if GO; if NO-GO, drop it, don't half-build.
- [ ] **MERGE CP3** per `CHECKPOINTS.md`.

---

## CP4 — POLISH + SAFETY NET (~h16–22)
*Coarse.*

- [ ] Harden `structure()` + `heal()` `SYSTEM` prompts against edge cases in the actual demo task (empty fields, duplicate-looking elements, multiple candidate buttons). Add the failure modes you hit during rehearsal as explicit prompt guardrails.
- [ ] Help record the backup video (Brain output on screen: trace → workflow JSON → heal reasoning + confidence).
- [ ] **HARD GATE:** help ensure the Devpost draft is up by **SAT MIDNIGHT**. Non-negotiable.
- [ ] **MERGE CP4** per `CHECKPOINTS.md`.

---

## CP5 — SUBMIT + PRESENT (Sun)
*Coarse.*

- [ ] Help submit by **SUN 11 AM**.
- [ ] Be at the table **SUN 1–3 PM**.
- [ ] Own the rebuttal: "is this just Testim / a QA tool?" → No. Testim records selectors and breaks; we re-ground by semantic INTENT via the LLM and self-heal at replay, with the heal history as persistent agent memory. It's automation for non-coders, not a test suite.
- [ ] **MERGE CP5** per `CHECKPOINTS.md`.

---

## Definition of done for the Brain

- [ ] `structure(sample-trace.json)` reproduces `sample-workflow.json`: 2 params, correct variable-vs-fixed split, semantic intents.
- [ ] `structure()` verified on a REAL recorder trace, not just the fixture.
- [ ] `saveWorkflow` → `getWorkflow` round-trips; `getHistory` shows version history.
- [ ] `heal()` re-grounds the Submit→Send break: `healed:true`, correct `newSelector`, confidence above threshold — repeatably.
- [ ] `heal()` returns `healed:false` (no hallucinated selector) when nothing matches.
- [ ] Heal writes back: selector overwritten, `HealRecord` appended, `version` bumped, re-persisted to Redis.
- [ ] `npm run typecheck` clean; `smoke.ts` PASS.
- [ ] Merged through CP2 minimum; CP3–CP5 as time allows.
- [ ] `shared/types.ts` shapes never changed unilaterally.
