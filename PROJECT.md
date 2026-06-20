# Show, Don't Code — Self-Healing Web Automation

**One-liner:** Teach an AI to do a tedious web task by doing it once yourself. It learns the workflow, saves it, and replays it on demand. When the website changes, it repairs itself instead of breaking.

**Pitch line for judges:** "RPA for people who can't code, that doesn't break when the site changes. Show it once, it works forever."

---

## The Problem

Knowledge workers waste hours on repetitive browser busywork: copying data between two systems that don't talk to each other, filling the same form 50 times, pulling the same weekly report.

- **Traditional automation (UiPath, Zapier):** needs a developer and weeks of setup, or only works when an API exists.
- **Newer AI browser agents (Browser Use, Claude-in-Chrome):** improvise the task fresh every run, so they're unreliable and break the moment a page layout shifts.

## The Solution

A tool where you **demonstrate the task once**. It records your steps, an AI turns them into a structured, reusable, parameterized workflow, stores it, and replays it against new data unattended.

**The defensible core:** when a step fails because the site changed, it detects the failure, re-finds the element by intent ("the button that submits this form") rather than a brittle selector, fixes the step, and updates the saved workflow so it never breaks there again.

---

## The Honest Weakness (team must know)

The self-healing mechanism is **not novel in mid-2026**. It's a named, shipping product category, mostly aimed at QA/test automation (Playwright Healer, Shiplight, Testim, Mabl). A judge who knows the space may ask: *"how is this different from existing self-healing tools?"*

**Our rehearsed answer:** those tools heal test suites *for engineers*. Ours is **teach-by-demonstration RPA for non-technical users** automating their own daily work. That packaging — show-don't-configure + non-coder + general web tasks — is genuinely less served than the QA-tooling space. It's a **positioning edge, not a technical moat**.

**Strategic consequence:** we are explicitly **not competing on novelty**. We compete on the lane Toolbox actually judges — execution, usability, demo polish. Nobody promises "world-first" on stage. We promise *"the most usable, reliable version, that anyone can use."*

## Why We Still Believe It Wins

It passes every filter except novelty:
- Claude alone can't do it (can't watch/click/replay/heal on a live site).
- Not commoditized by Browser Use (they improvise and break; we learn, save, self-heal).
- Fits Toolbox (execution-judged — our best $5k shot).
- Buildable in 24h.
- Has a genuinely visceral demo beat.

The novelty ding is the cheapest leg to lose — most hackathon projects are unoriginal and judges reward execution.

---

## Target Track & Prize Strategy

**Main track (the $5k shot): Ddoski's Toolbox Track.** Judges "how useful, usable, and well-executed your tools are, not just the idea." Built for us — polish beats concept. This is our **one** main track.

**Auto-considered sponsor prizes we stack honestly** (every integration is load-bearing, nothing bolted on):

| Sponsor | Role in the build | Prize |
|---|---|---|
| **Anthropic** | Claude does the re-grounding / intent reasoning that powers the healing | $5k API credits + Applied AI office hour (relationship is the real prize) |
| **Redis** | Stores learned workflows + their healing history (genuine agent memory) | Mac Minis + 25k credits |
| **Band** | System split into collaborating agents: record-agent, replay-agent, healer-agent (satisfies "2+ agents collaborating") | $1k |
| **Sentry** | Monitors and captures the step failures — the entire point of the product | Switch 2 each |
| **Browserbase** | Likely the browser engine; prize "coming soon" → treat as upside, not a dependency. Swap in Stagehand/Playwright with zero impact if no prize | TBD |

**Realistic target:** one main-track win plus several sponsor prizes.

---

## The Killer Demo (~3 min — where the project lives or dies)

**Setup (10s):** Two browser tabs. Tab A: a list of customer records. Tab B: a form to enter them into. The universal copy-paste-between-tabs busywork.

**Teach it (40s):** Do the task once, live — read customer 1 from Tab A, type into Tab B, submit. The tool records every step. Say: *"I did this once. I never want to do it again."*

**Watch it work (40s):** Hit run. It replays itself — customer 2, 3, 4 — hands off the keyboard. Strong "it's doing my job" beat.

**The kill shot (60s):** Say *"every tool can do that on a good day — here's the real world."* Secretly change the form (rename "Submit" → "Send," or move a field). Run again, split-screen:
- **Left — a normal browser agent:** hits the change, can't find the button, crashes. Dead.
- **Right — ours:** detects the failed step, re-reads the page, finds the button by what it *means*, clicks it, finishes, and updates its saved workflow.

The audience watches one agent die and the other heal itself **on the same failure, side by side.**

**Closing line (10s):** *"Everyone builds agents that work in a demo. We built one that survives reality. Teach it once, it fixes itself when the world changes."*

**Why it works:** visceral and legible to any judge in ten seconds, shows the easy magic and the hard part in one flow, and the demo itself rebuts the "isn't this Browser Use?" objection. **Build priority #1 is making this 60-second beat bulletproof.** Everything else is scaffolding for it.

---

## Architecture (record → structure → replay → heal)

1. **Record:** Browser engine (Browserbase / Stagehand / Playwright) captures the user's actions — clicks, inputs, navigation — plus page context (DOM snapshot, element attributes) at each step.
2. **Structure:** Claude converts the raw trace into a structured, parameterized workflow — identifying which fields are variables (customer data) vs fixed actions (click submit) — and stores it in Redis.
3. **Replay:** The replay-agent executes the saved workflow against new data rows, unattended.
4. **Heal:** On a step failure, the healer-agent grabs the current DOM, Claude re-identifies the target element by its **semantic intent** (stored from the original recording) rather than the stale selector, patches the step, retries, and writes the fix back to the workflow in Redis. Sentry logs the failure and recovery.

**Scope discipline:** keep healing bounded to a couple of failure types for the demo (renamed/moved element, changed selector/ID). Do **not** try to handle every possible site change — that's the over-scope trap that blows past 24h. The demo only needs healing to work flawlessly on the specific break we trigger.

---

## Three-Way Split — Brain / Hands / Face

The architecture (record → structure → replay → heal) cleanly trisects, and it maps to Band's "2+ agents collaborating" prize for free: record-agent / replay-agent / healer-agent = three people's three deliverables.

**Ishaan — the Brain (the hard part the prizes judge).** Pure logic, no browser, no UI. Claude intent-extraction at record time, the structure step (raw trace → parameterized workflow), and the healer (DOM → re-ground by intent → patch + write fix back). Owns the **Redis workflow schema**. This is the moat.

**Builder 2 (ck / aaryan) — the Hands.** Browser runtime. Record mode (capture actions inside our controlled Playwright/Browserbase browser) + the replay-agent that executes steps and **detects** failure. Owns the engine, the mock pages (Tab A records → Tab B form), and the "secretly change the form" break-trigger. Feeds raw traces + DOM to the Brain; gets back steps to execute.

**Builder 3 (ck / aaryan) — the Face.** Frontend + demo harness. Record/run buttons, workflow list, the **live heal visualization**, the split-screen (normal agent dies | ours heals), and the Sentry wiring. Whole job: make the heal **visible**. A heal that prints as raw JSON loses.

### Two non-negotiables that make a 3-way split safe

3 lanes = 3 seams instead of 1, and integration-not-landing is the #1 way 24h hackathons die. So:

1. **One shared [CONTRACT.md](./CONTRACT.md)** defines every JSON shape between lanes (trace, workflow, step, heal report). Agreed in **hour one**. Nobody edits another lane's code — you only change the contract together.
2. **First ~4 hours, all three converge on crude end-to-end** — ugly record → replay on ONE task, all lanes touching. Prove the seams hold *before* fanning out to make the heal bulletproof.

**Hour-4 checkpoint (the fallback):** if end-to-end isn't alive by hour 4, collapse to **2+1** — merge Hands+Face onto one person, the 3rd helps the critical path. Don't let a leaking seam ride past hour 4.

---

## Build Priorities (ruthless order)

1. **The 60-second kill shot working:** record → replay → trigger break → heal, on one task. Nothing else matters until this works.
2. **Sponsor integrations made real:** Redis storing workflows, Band agent split, Sentry on the failures.
3. **UI polish and the live visualization of the heal.**
4. **Stretch only if 1–3 are solid:** a second use case, a cleaner workflow-management screen.

**Explicitly cut / pitch-only (don't build):** scheduling, multi-site tasks, handling arbitrary site changes, a real backend for real user accounts, anything beyond the demo task. These are "where this goes" in the pitch, not build targets.

---

## The 30-Second Team Summary

We're building teach-by-demonstration web automation with a self-healing core. You show it a task once, it learns and replays it, and it repairs itself when the site changes. We're targeting the **Toolbox track** (judged on execution — our strength) and stacking **Anthropic, Redis, Band, and Sentry** honestly. We are **not** claiming novelty — the self-healing tech exists in QA tools — so we win on a flawless demo, real usability for non-coders, and clean sponsor integration. The whole project rides on one 60-second split-screen demo beat: **our agent heals while a normal agent crashes.** Build that first, polish around it.
