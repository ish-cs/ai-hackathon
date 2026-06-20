# CHECKPOINTS.md — Mimic Shared Spine

**Mimic — Show, Don't Code.** Teach-by-demonstration web automation with a self-healing core.
Loop: **record → structure → replay → heal.** Record a web task once → AI structures it into a reusable parameterized workflow → replays on new data → repairs itself (re-grounds the element by semantic **INTENT**, not stale selector) when the site changes.

## How to use this file

- Two **separate** plan files hold each person's tasks: **ISHGOON-plan.md** (Ishaan, the Brain) and **CK-plan.md** (ck, Hands + Face).
- **THIS file is the shared spine** — the anti-drift contract. It defines the merge-and-test pauses.
- Every task in the plan files is tagged **CP0–CP5** and must map to the gates here **exactly**. No task ships past a checkpoint until the gate is green.
- At every checkpoint: **both STOP → merge → run the test ritual → only then continue.** No solo sprinting past a gate.
- The seam between the two people is **`shared/types.ts`** (`RawTrace, Workflow, WorkflowStep, DataRow, StepResult, HealRequest, HealResult, RunEvent`). **Neither edits those shapes without agreeing together.**

---

## At a glance

| CP | Rough time | Goal | Gate that ends it |
|----|-----------|------|-------------------|
| **CP0** | first ~30 min | Both machines set up + green | green smoke + Redis ping on both |
| **CP1** | hrs 0–4 | Crude end-to-end on ONE task, no healing | Record → Redis → Run replays from NEW DataRow |
| **CP2** | hrs 4–10 | The heal works (60-sec kill shot) | Break ON → control dies, healing lane completes |
| **CP3** | hrs 10–16 | Split-screen + sponsors made real | One button → both lanes + heal anim + Sentry + Redis |
| **CP4** | hrs 16–22 | Polish + safety net | Backup video + Devpost draft + 5× cold flawless |
| **CP5** | Sun | Submit + present | Submitted by 11 AM, demoed 1–3 PM |

**Hard gates inside:** Devpost draft = **Sat midnight** · Submit = **Sun 11 AM** · Edits lock = **Sun 12 PM** · Table = **Sun 1–3 PM**.

---

## CP0 — SETUP
*both · first ~30 min at event*

**Goal:** both machines clone, install, key up, prove the scaffold runs before any feature work.

**ck delivers:** machine set up per below; server boots locally.
**Ishaan delivers:** machine set up per below; Redis reachable.
*(CP0 is symmetric — same steps both sides.)*

**Exit criteria**
- [ ] Repo cloned on **both** machines
- [ ] `npm install` done on both
- [ ] `npm run browsers` done on both (Playwright browsers installed)
- [ ] `.env` has **`ANTHROPIC_API_KEY`** + **`REDIS_URL`** (grab from sponsor tables at event)
- [ ] `npx tsx smoke.ts` **PASSES** on both machines
- [ ] Server boots
- [ ] Redis reachable (`ping`)

**The pause ritual**
- **Handoff:** both confirm **green smoke + Redis ping** out loud before ANY feature work starts. No exceptions.

---

## CP1 — CRUDE END-TO-END on ONE task
*BOTH converge · ~hrs 0–4 · the make-or-break*

**Goal:** record → structure → replay a single task. Ugly but real. **NO healing yet.**

**ck delivers:**
- `runtime/recorder.ts` captures real clicks/inputs in the controlled Playwright browser and emits a **`RawTrace`** matching the contract.
- *(Recorder is the #1 unbuilt risk — this is ck's top priority at CP1.)*

**Ishaan delivers:**
- `structure(RawTrace)` → **`Workflow`** with correct **variable-vs-fixed detection** + a **semantic intent** per step.
- `saveWorkflow` to Redis; `getWorkflow` reads it back.

**Exit criteria**
- [ ] Click **Record** → demonstrate the mock task → **Stop**
- [ ] Workflow appears in **Redis**
- [ ] Click **Run** → replay fills the target form from a **NEW DataRow** → submits
- [ ] Both watch it work, end to end

**The pause ritual**
- **PAUSE → MERGE → run `smoke.ts` → one manual end-to-end.**
- **Escape hatch:** if NOT alive by **~hour 4**, BOTH pile onto this and **cut all other scope.** Nothing else matters until this is breathing.

---

## CP2 — THE HEAL WORKS / the 60-second kill shot
*~hrs 4–10*

**Goal:** break the site — our agent survives.

**ck delivers:**
- The **break-trigger** (Submit→Send rename — already in mock).
- Replay calls `heal()` on failure → retries with the new selector → writes it back → emits **heal `RunEvent`s**.

**Ishaan delivers:**
- `heal(HealRequest)` → **`HealResult`** that **re-grounds by INTENT** from the live DOM with usable **confidence** and returns a **working selector**.
- Heal history **appended + persisted to Redis** (agent memory).

**Exit criteria**
- [ ] Run with **break ON** → control lane **crashes at submit**
- [ ] Healing lane **re-grounds**, clicks the **renamed** button, **completes**
- [ ] **Repeatable**

**The pause ritual**
- **PAUSE → MERGE → run the broken-site demo 3× → must be deterministic.** If it flickers, it's not done.

---

## CP3 — SPLIT-SCREEN + SPONSORS MADE REAL
*~hrs 10–16*

**Goal:** it looks like a demo + prizes wired honestly.

**ck delivers:**
- **Split-screen UI** (control dies | healing survives) driven by **`RunEvent`s over WS**.
- **LIVE heal visualization** (not raw JSON).
- **Sentry** wired on failures.

**Ishaan delivers:**
- **Redis as genuine agent memory** (workflows + heal audit trail, visible / queryable).
- The **economic-empowerment pitch** framing.
- **Band go/no-go decision** on running agents in shared rooms → wire transport **only if GO**, else skip. **Same JSON shapes either way.**

**Exit criteria**
- [ ] One button → **both lanes run side by side** on screen
- [ ] Heal **animates**
- [ ] **Sentry** shows the captured failure
- [ ] **Redis** shows the saved + healed workflow

**The pause ritual**
- **PAUSE → MERGE → full dress-run of the 60-second beat.**

---

## CP4 — POLISH + SAFETY NET
*~hrs 16–22*

**Goal:** nothing can sink the live demo.

**Both deliver:**
- Record a **CLEAN backup demo video** (venue-wifi / cloud-browser insurance + Devpost wants one).
- Tighten copy, error states, the one demo task.
- **Second use case ONLY** if everything above is rock solid.

**HARD GATE:** **Devpost draft created by SAT MIDNIGHT** — project name + **BOTH** teammates added. Non-negotiable ("the only way we can guarantee judging").

**Exit criteria**
- [ ] **Backup video saved**
- [ ] **Devpost draft live** (name + both teammates) — by **Sat midnight**
- [ ] Demo runs **flawlessly 5× cold**

**The pause ritual**
- **PAUSE → MERGE → full dress-run of the 60-second beat** (carry CP3's ritual forward; lock the final cut).

---

## CP5 — SUBMIT + PRESENT
*Sun*

**HARD GATES:**
- **Submit on Devpost by SUN 11 AM.**
- **Edits lock SUN 12 PM.**

**Both:**
- At the table **SUN 1–3 PM** for judging (~**4-min pitch**).
- Rehearse the **"isn't this Testim / Testim-like QA tool?"** answer → we **don't claim novelty**; we win on a **flawless demo + usability for non-coders + clean sponsor integration.**
- If finalist: **3-min stage talk + 2-min VC/research Q&A.**

**Exit criteria**
- [ ] **Submitted** on Devpost by **Sun 11 AM**
- [ ] **Demoed** at table 1–3 PM
- [ ] Done

**The pause ritual**
- Final merge to `main` is locked **before 11 AM submit** — nothing lands after the Devpost lock at 12 PM.

---

## Merge & test ritual (run at EVERY pause)

Both follow this, same way, every checkpoint:

1. **Get on your branch** (`ishgoon` / `ck`) → make sure your work is committed.
   ```
   git add -A && git commit -m "<what shipped for this CP>"
   ```
2. **Merge both branches into `main`** (or open PRs and merge):
   ```
   git checkout main
   git merge ishgoon
   git merge ck
   ```
   Resolve conflicts together — **do NOT** resolve a `shared/types.ts` conflict solo.
3. **Run smoke:** `npx tsx smoke.ts` → must **PASS**.
4. **One manual end-to-end** — the actual demo beat for that checkpoint (CP1: record→run; CP2: break→heal; CP3+: full 60-sec dress-run).
5. **Branch back out** and resume your own plan file.

> **Seam rule:** never change `shared/types.ts` shapes (`RawTrace, Workflow, WorkflowStep, DataRow, StepResult, HealRequest, HealResult, RunEvent`) except **together**, in person. That contract is the only thing keeping two parallel branches mergeable.

---

## Hard deadlines (do not miss)

> ```
> ┌─────────────────────────────────────────────────────────┐
> │  SAT MIDNIGHT  →  Devpost DRAFT created                  │
> │                   (project name + BOTH teammates added)  │
> │  SUN 11:00 AM  →  SUBMIT on Devpost                      │
> │  SUN 12:00 PM  →  Edits LOCK (no changes after this)     │
> │  SUN 1–3 PM    →  BOTH at the table for judging          │
> └─────────────────────────────────────────────────────────┘
> ```
> Devpost draft is the non-negotiable — "the only way we can guarantee judging." Set a timer for Sat 11 PM.
