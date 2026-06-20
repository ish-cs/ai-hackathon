# Show, Don't Code — Self-Healing Web Automation

**One-liner:** Teach an AI to do a tedious web task by doing it once yourself. It learns the workflow, saves it, and replays it on demand. When the website changes, it repairs itself instead of breaking.

**Pitch line for judges:** "RPA for people who can't code, that doesn't break when the site changes. Show it once, it works forever."

> Strategy doc — synced against the official **AI Hackathon 2026 Hacker Guide** (in repo). Prize criteria below are quoted from it. Technical seam spec lives in [CONTRACT.md](./CONTRACT.md).

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

The self-healing mechanism is **not novel in mid-2026**. It's a named, shipping product category, mostly aimed at QA/test automation (Playwright Healer, Shiplight, Testim, Mabl). A judge who knows the space may ask: *"how is this different from existing self-healing tools?"* — and the finalist round has a **2-minute Q&A from VC + research judges** where exactly this lands.

**Our rehearsed answer:** those tools heal test suites *for engineers*. Ours is **teach-by-demonstration RPA for non-technical users** automating their own daily work. That packaging — show-don't-configure + non-coder + general web tasks — is genuinely less served than the QA-tooling space. It's a **positioning edge, not a technical moat**.

**Strategic consequence:** we are explicitly **not competing on novelty**. We compete on the lane Toolbox actually judges — execution, usability, demo polish. Nobody promises "world-first" on stage. We promise *"the most usable, reliable version, that anyone can use."*

## Why We Still Believe It Wins

It passes every filter except novelty:
- Claude alone can't do it (can't watch/click/replay/heal on a live site).
- Not commoditized by Browser Use (they improvise and break; we learn, save, self-heal).
- Fits Toolbox (execution-judged — our best $5k shot).
- Buildable in 24h.
- Has a genuinely visceral demo beat.

The novelty ding is the cheapest leg to lose — most hackathon projects are unoriginal and judges reward execution. The org itself states they *"care more about the idea, genuine effort, and thought process… rather than the final product"* — and Toolbox specifically rewards *"how useful, usable, and well-executed your tools are."* We sit right in that lane.

**General judging criteria (all tracks): impact · quality · technical complexity · creativity.** We hit all four — impact (non-coder empowerment), quality (usability), technical complexity (self-healing), creativity (teach-by-demo).

---

## Target Track & Prize Strategy

**Main track (the $5k shot): Ddoski's Toolbox Track.** One main track only — each team applies to exactly one. Verbatim criteria: *"tools built for developers, creators, and knowledge workers… automation scripts, workflow apps… how useful, usable, and well-executed your tools are — not just the idea behind them."* Built for us. **This is our pick.** ($5,000 cash.)

> All teams are **automatically** considered for every sponsor prize below — no separate application. But "considered" ≠ "qualified": each prize has a hard requirement we must actually satisfy. Honest read of each:

| Sponsor | What they actually reward (quoted) | What WE must do to qualify | Honest odds |
|---|---|---|---|
| **Redis** | *"Beyond Caching… Agent memory, vector search, context retrieval… solving real human problems… correctness, scalability, architecture."* | Use Redis as genuine **agent memory** — store workflows + heal-history, not just a cache. We already do (the heal audit trail = persistent agent memory). | **Strong** — load-bearing + on-thesis. Mac Minis + 25k credits. |
| **Anthropic** | *"projects built with **Claude Code** that tackle meaningful issues in health, education, **economic opportunity**, or any domain where AI could genuinely shift what's possible… take the biggest swing toward the most challenging problem."* | Built with Claude Code (we are). **Lead the narrative with economic empowerment** — automation is a superpower locked behind money/coding skill; we hand it to the 99% who have neither. NOT "we called the API." | **Winnable with the right story** — the biggest prize ($5k credits + Applied AI office hour + SF office visit). Frame = impact, not integration. |
| **Band** | *"top project… that used Band as a key technology… **at least 2 agents collaborating via the BAND platform**"* (agents coordinate in shared rooms, exchange context). | **Real integration, not a vibe.** Our record / replay / heal agents must actually run as Band agents in shared rooms — code modules don't count. Costs integration time. | **Conditional** — only if we pay the integration tax. Decide hour 1. $1k (split). Band workshop Sat. |
| **Sentry** | *"builders who go beyond the prompt… technical execution paired with clear communication, collaborative problem-solving… confidence to speak up, course-correct, and lead… **Bonus points** if you leveraged observability or error monitoring."* | This is a **team-dynamics** prize; observability is bonus only. Wire Sentry on our step-failures (cheap, and failure *is* our product) for the bonus, but the win rides on how the team presents under pressure. | **Bonus-tier** — wire it cheap, don't over-invest. Switch 2 each. |
| **Browserbase** | *"build any agent that uses the web… **must be powered by the Browserbase platform** (browsers, search, fetch, Stagehand, Browse CLI)."* | If we build the engine on **Browserbase/Stagehand** from the start, we qualify for free. Prize value "coming soon." | **Free if we commit the engine** — tradeoff: cloud browser adds live-demo network risk. Keep a local Playwright fallback. |

**Realistic target:** Toolbox main-track win + Redis + Anthropic, with Band/Sentry/Browserbase as honest upside.

---

## Event Logistics & Timeline (don't lose the prize on a clock miss)

**Venue:** ASUC Student Union (MLK Jr. Building), 2495 Bancroft Way. Enter via 2nd-floor Sproul Plaza entrance.

| When | What | Why it matters |
|---|---|---|
| **Sat 9 AM** | Check-in opens | — |
| **Sat 10 AM** | Opening Ceremony, Wheeler Auditorium | Hacking starts after |
| **Sat (times TBD on live site/app)** | Sponsor workshops | **Must-attend: Band** (learn the platform — required to qualify), **Redis** (Agent Memory pipeline = our exact use case), **Anthropic**, **Sentry**, **Browserbase CLI**. |
| **Sat midnight** | **Create the Devpost draft** — project name + all 3 teammates added | *"the only way we can guarantee your project will be judged."* Non-negotiable. |
| **Sun 11 AM** | **Hard submission deadline on Devpost** | Late = not judged. |
| **Sun 12 PM** | Edits lock | No changes after. |
| **Sun 1–3 PM** | **Table judging** — judges visit, ~4-min pitch | **Entire team must be at the table the whole window** or you're not judged. Must be in-person. |
| **Sun (closing)** | Finalists: **3-min stage talk + 2-min VC/research Q&A**, Wheeler | Where the "isn't this Testim?" question lands — see rehearsed answer above. |

**Key links:** Live site `live.hackberkeley.org` · Devpost `ai-hackathon-2026.devpost.com` · Slack `hackberkeley.org/slack`.

**Backup:** record a clean **demo video** before Sunday — venue wifi + a cloud browser is a live-demo risk, and Devpost submissions want a video anyway.

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

1. **Record:** Browser engine (**Browserbase / Stagehand** — banks the Browserbase prize; Playwright as local fallback) captures the user's actions — clicks, inputs, navigation — plus page context (DOM snapshot, element attributes) at each step. **The user demonstrates inside our controlled browser** — do NOT try to capture arbitrary clicks via a Chrome extension; that's the over-scope trap.
2. **Structure:** Claude (via Claude Code / Anthropic API) converts the raw trace into a structured, parameterized workflow — identifying which fields are variables (customer data) vs fixed actions (click submit) — and stores it in **Redis**.
3. **Replay:** The replay-agent executes the saved workflow against new data rows, unattended.
4. **Heal:** On a step failure, the healer-agent grabs the current DOM, Claude re-identifies the target element by its **semantic intent** (stored from the original recording) rather than the stale selector, patches the step, retries, and writes the fix back to the workflow in **Redis** (the heal-history = our "agent memory"). **Sentry** logs the failure and recovery.

**If we go for the Band prize:** the record-agent, replay-agent, and healer-agent run as actual **Band agents collaborating in shared rooms**, passing the CONTRACT.md shapes between them — not just function calls in one process. This is the integration tax to weigh in hour 1.

**Scope discipline:** keep healing bounded to **two failure types** for the demo — (a) renamed element, (b) moved/changed selector or ID. Do **not** try to handle every possible site change — that's the over-scope trap that blows past 24h. The demo only needs healing to work flawlessly on the specific break we trigger.

---

## Two-Person Split — Brain / Hands+Face

Two builders, one clean seam: "the agent that thinks" vs "the agent that acts + what you see." We still ship **three logical agents** (record / replay / heal) — which is what satisfies Band's *"2+ agents collaborating."* Agent count is about software, not headcount.

**Ishaan — the Brain (the hard part the prizes judge).** Pure logic, no browser, no UI. Claude intent-extraction at record time, the structure step (raw trace → parameterized workflow), and the healer (DOM → re-ground by intent → patch + write fix back). Owns the **Redis workflow schema**. This is the moat.

**ck — the Hands + Face (everything that touches the browser or the screen).** *Hands:* record mode (capture actions inside our controlled Playwright/Browserbase browser) + the replay-agent that executes steps and **detects** failure; owns the engine, the mock pages (Tab A → Tab B form), and the "secretly change the form" break-trigger. *Face:* record/run buttons, workflow list, the **live heal visualization**, the split-screen (normal agent dies | ours heals), and Sentry wiring — make the heal **visible**; a heal that prints as raw JSON loses. It's the heavier lane by surface area — Brain finishes its crude core fast (build order #1) then helps here.

### Two non-negotiables that make the split safe

One seam between two people, but integration-not-landing is still the #1 way 24h hackathons die. So:

1. **One shared [CONTRACT.md](./CONTRACT.md)** defines every JSON shape across the seam (trace, workflow, step, heal report). Agreed in **hour one**. Neither person edits the other's code — you only change the contract together.
2. **First ~4 hours, both converge on crude end-to-end** — ugly record → replay on ONE task, both sides touching. Prove the seam holds *before* fanning out to make the heal bulletproof.

**Hour-4 checkpoint:** if end-to-end isn't alive by hour 4, stop adding scope — both pile onto the critical path (the 60-second kill shot) until it works. Don't let a leaking seam ride past hour 4.

---

## Build Priorities (ruthless order)

1. **The 60-second kill shot working:** record → replay → trigger break → heal, on one task. Nothing else matters until this works.
2. **Sponsor integrations made real:** Redis storing workflows (agent memory), Band agent split *if we commit to it*, Sentry on the failures.
3. **UI polish and the live visualization of the heal.**
4. **Backup demo video** recorded before Sunday (venue-wifi / cloud-browser insurance + Devpost wants one).
5. **Stretch only if 1–4 are solid:** a second use case, a cleaner workflow-management screen.

**Don't-forget gates:** Devpost draft by **Sat midnight**; submit by **Sun 11 AM**; whole team at the table **1–3 PM Sun**.

**Explicitly cut / pitch-only (don't build):** scheduling, multi-site tasks, handling arbitrary site changes, a real backend for real user accounts, anything beyond the demo task. These are "where this goes" in the pitch, not build targets.

---

## The 30-Second Team Summary

We're building teach-by-demonstration web automation with a self-healing core. You show it a task once, it learns and replays it, and it repairs itself when the site changes. We're targeting the **Toolbox track** (judged on execution — our strength) and stacking sponsor prizes honestly: **Redis** as real agent memory (strong), **Anthropic** framed as economic empowerment + built with Claude Code (winnable), **Band** *if* we run the agents on its platform, **Sentry** + **Browserbase** as cheap upside. We are **not** claiming novelty — the self-healing tech exists in QA tools — so we win on a flawless demo, real usability for non-coders, and clean sponsor integration. The whole project rides on one 60-second split-screen demo beat: **our agent heals while a normal agent crashes.** Build that first, polish around it.
