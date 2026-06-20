# Devpost Submission: paste-ready

> Copy each section into the matching Devpost field. Project name + both teammates must be on the **draft by Sat midnight** or it isn't judged. Two honest decisions flagged at the bottom (Band, Browserbase). Don't claim either unless we actually integrate it.

---

## Project name
**Mimic: Show, Don't Code**

## Elevator pitch (tagline, one line)
Teach an AI a tedious web task by doing it once. It learns the workflow, replays it on new data, and repairs itself when the website changes, instead of breaking.

---

## Inspiration
Knowledge workers lose hours to browser busywork: copying records between two systems that don't talk, filling the same form fifty times, pulling the same weekly report. The fixes on offer are bad: traditional automation (UiPath, Zapier) needs a developer and weeks of setup, and the new AI browser agents improvise the task fresh every run, so they're unreliable and break the instant a page shifts.

We wanted the thing in between: automation a non-coder can create by *showing*, not configuring, that doesn't fall apart the first time the site changes. Automation is a superpower currently locked behind money or coding skill. We wanted to hand it to the people who have neither.

## What it does
You demonstrate a task once inside Mimic's browser: read a customer from one tab, type it into a form, submit. Mimic records every step. Claude turns that raw demonstration into a structured, **parameterized** workflow. It figures out which parts are variables (the customer data) and which are fixed actions (click submit), and saves it.

Then you hit run and it does the job for you, unattended, across new rows of data.

The core that makes it real: when a step fails because the site changed, Mimic doesn't crash. It reads the live page, asks Claude to re-find the element by what it *means* ("the button that submits this form") instead of the brittle selector it recorded, fixes the step, finishes the run, and **writes the fix back** so it never breaks there again. We show this as a split screen: a normal agent hits the change and dies on the left; Mimic heals on the same failure and finishes on the right.

## How we built it
**Architecture: record → structure → replay → heal.**

- **Record**: Playwright captures the user's clicks, inputs, and navigation, plus the page context (DOM, element attributes, semantic intent) at each step.
- **Structure**: Claude (**Opus 4.8**, structured JSON outputs) converts the raw trace into a parameterized workflow, detecting variables vs. fixed actions.
- **Store**: the workflow and its full version history live in **Redis** as genuine *agent memory*, not a cache, but the persistent record the healer reads and writes back to.
- **Replay**: the runtime executes the saved workflow against new data, unattended, streaming each step to the UI over WebSockets.
- **Heal**: on a failure, Claude re-grounds the element by its stored semantic intent, patches the step, retries, and writes the upgraded workflow back to Redis as a new version. **Sentry** captures the failure-and-recovery moment. Failure is literally our product, so we observe it.

Every replay runs **two lanes side by side**: a control lane with healing off (stays brittle, always crashes on the break) and a healing lane that re-grounds live. That's the demo's kill shot, and it's the actual code path, not a mockup.

We split the build across one clean contract: the **Brain** (Claude intent-extraction, structure, and the healer: pure logic, owns the Redis schema) and the **Hands + Face** (the browser engine, record/replay, the split-screen, and the live heal visualization). A single shared types file is the only seam between us.

## Challenges we ran into
- **The healer has to refuse to guess.** A confident wrong heal is worse than failing: it clicks the wrong button and submits bad data. We hardened the prompt and wrote a dedicated anti-hallucination test: when nothing on the page fulfills the step's intent, the healer must return "could not heal," not invent a selector. It passes.
- **The demo could only work once.** Our first version let the healing lane write its fix back to shared memory, so on the second run the control lane read the cured workflow and *also* survived, killing the contrast. We fixed it so both lanes always start from the pristine original; the heal still accrues in the memory trail, but the control lane stays brittle and the split-screen is repeatable.
- **Keeping the recorded selector brittle on purpose.** The structuring step kept "helpfully" upgrading our brittle selector to a stable one, which meant our staged break wouldn't break it, so nothing would heal. We had to make structuring preserve the recorded selector verbatim; the healer is the *only* thing allowed to upgrade it.

## Accomplishments that we're proud of
- The full loop works end to end on real infrastructure: a real recorded trace → Claude → Redis → a real break → a real heal → fix written back, verified against live Claude and a live cloud Redis.
- The healer re-grounds a renamed/moved control by intent at high confidence **and** correctly refuses when there's nothing valid to click.
- Three sponsor technologies are load-bearing and proven, not bolted on: Claude is the brain, Redis is the agent memory, Sentry catches the exact failure that triggers a heal.

## What we learned
- Self-healing is only as trustworthy as its willingness to fail loudly. The "refuse to guess" behavior turned out to be more important than the heal itself.
- "Agent memory" means an auditable, versioned trail of what changed and why, not a key-value cache. Redis modeled that cleanly.
- The hardest part of a two-person hackathon is the seam. One shared contract and a crude end-to-end before fanning out saved us.

## What's next for Mimic
- More healing classes beyond renamed/moved elements: reordered flows, multi-page tasks, auth walls.
- Scheduling and unattended runs so a workflow fires on its own.
- A workflow library non-coders can share and fork.
- Confidence thresholds with a human-in-the-loop fallback when the healer isn't sure.

## Built With
`typescript` · `node.js` · `claude-opus-4-8` · `anthropic` · `redis` · `sentry` · `playwright` · `express` · `websockets` · `html` · `css`

## Try it out (links)
- GitHub: (repo link)
- Demo video: (record before Sunday)

---

## ⚠️ Two honest decisions before submitting: don't overclaim
- **Band** ($1k): the prize needs our agents *actually running on the Band platform in shared rooms*. Right now our three agents are logical modules in one process, not Band agents. Either we pay the integration tax and then add `band` to Built With + a paragraph, or we don't claim Band at all. **Currently: not integrated → not claimed in this draft.**
- **Browserbase**: the prize needs the engine *powered by Browserbase/Stagehand*. We built on local Playwright. Either we swap the browser layer (adds live-demo network risk) and claim it, or we don't. **Currently: local Playwright → not claimed.**

Everything claimed above (Anthropic, Redis, Sentry, Playwright) is real and proven today.
