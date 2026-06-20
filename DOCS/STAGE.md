# Mimic — Stage Script (3 min) + Judge Q&A

**Product:** Mimic — *Show, Don't Code.* Teach a web task by doing it once; it builds a
reusable workflow, replays on new data, and **heals itself** when the site changes.

**One-liner (memorize this):**
> "Every web agent breaks the moment a button moves. Mimic is the first one that fixes itself —
> live, on stage."

---

## Before you walk up (setup checklist)

- [ ] Server running, one clean instance: `tsx --env-file=.env runtime/server.ts`
- [ ] Browser open on `http://localhost:3000` — app loaded, a workflow auto-loaded in the box
- [ ] Memory panel open in a second tab: `http://localhost:3000/memory.html`
- [ ] Screen mirrored to projector; **windows will open side-by-side** (left + right)
- [ ] Backup video queued in case wifi/projector dies
- [ ] `.env` has the real keys; Sentry Issues tab open on your phone as proof (optional flex)

---

## The 3-minute run

### 0:00 — Hook (10s)
*"Show of hands — who's had an automation or an AI agent break because a website changed a
button?"* (pause) *"Right. That's every agent here. We fixed it. Watch."*

### 0:10 — The problem (15s)
*"Normal agents are brittle. They memorize 'click the button with this exact ID.' The site
renames it, the agent dies. You go re-record everything. Mimic grounds on **intent**, not IDs —
so when the page changes, it re-finds the button by what it's **for**."*

### 0:25 — Teach it by showing (35s)
- Click **● Record**. A browser opens.
- *"I'm not writing code. I'm just doing the task once — like training a new hire."*
- Do the real task: read a customer, type their **name** + **email**, hit submit.
- Click **■ Stop & build workflow**.
- *"That's it. No selectors, no script."*

### 1:00 — It understood (15s)
- Point at the log: it built a **workflow** with steps + **parameters** (name, email).
- *"Claude turned my click-stream into a structured, reusable recipe. The name and email are now
  variables — I can run this on a thousand customers."*

### 1:15 — Run it normally (20s)
- Click **Run**. Two windows open side-by-side.
- *"Left is a normal agent. Right is Mimic. Same task. Right now the site is normal — both finish.
  Green on both."*

### 1:35 — THE KILL SHOT (50s) ⭐ this is the demo
- *"Now I'll break the website — exactly what happens in real life when a site ships an update."*
- Click **Run (break site)**.
- *"Watch them race."*
  - **Left (normal agent):** hits the renamed button → **can't find it → red FAILED.**
    *"Dead. This is every other agent on the planet right now."*
  - **Right (Mimic):** also misses → *"…and watch —"* → it asks Claude *"what was I trying to do?"*,
    re-finds the button by intent, retries → **green SUCCEEDED.**
- *"Same broken site. One died. One healed itself — live, no human, no re-recording."*

### 2:25 — Why it healed: the memory (20s)
- Flip to the **memory panel**.
- *"And it didn't just recover — it **remembered**. Here's the old broken target, the new one it
  found, Claude's reasoning, and a confidence score. That's saved to Redis as the agent's memory,
  so next time it already knows. It gets **more** reliable the more the web breaks."*

### 2:45 — Close (15s)
- *"Mimic. Show it once, it works forever — even when the web fights back. Built on Claude for the
  reasoning, Redis for the memory, Sentry catching every failure live, Playwright driving the
  browsers. Thank you."*

**Total: 3:00. If you're tight on time, cut 0:25–1:00 (the live record) and start from the
pre-built workflow — the kill shot at 1:35 is the part that wins.**

---

## Judge Q&A — rehearse these

**"Isn't this just Selenium / Testim / Playwright / existing RPA?"**
> "Those record selectors and **break** the same way — a moved button kills them and a human
> re-records. The difference is the **healing**. When the selector dies, Mimic re-grounds the
> element by **semantic intent** using Claude, verifies the fix actually worked, and writes it
> back to memory. Testim has 'smart locators' that guess from cached attributes; ours **reasons
> about purpose at runtime** and **gets better with each break** because every heal is remembered.
> No other tool turns a site change from an outage into a self-repair."

**"What if the heal picks the wrong element?"**
> "Two guards. One — it only commits a heal **after the action verifiably succeeds**; a wrong guess
> just fails the retry and it heals again, bounded. Two — every heal carries a **confidence score**
> and full reasoning in the memory panel, so it's auditable. It's built to **refuse to guess**
> rather than silently do the wrong thing."

**"Does this scale to real sites, not just your demo page?"**
> "The healing logic is site-agnostic — it reads the live DOM and re-grounds by intent, nothing is
> hardcoded to our page. The demo page just lets us **break it on command** so you can see the heal
> in 3 minutes instead of waiting for a real site to ship a change."

**"How is the workflow stored / what's the Redis for?"**
> "Redis is the agent's **memory**: the workflow recipe, every version, and the full heal history —
> old selector, new selector, reasoning, confidence, timestamp. That's what makes it improve over
> time instead of re-learning from scratch."

**"What's actually using Claude?"**
> "Two places: turning the raw recording into a **structured, parameterized workflow**, and the
> **healing** — given the failed step and the live page, reason out which element matches the
> original intent. Model is `claude-opus-4-8`."

**"What broke / what's left?"** (be honest)
> "The core loop — record, structure, replay, heal — is solid and you just watched it. We're
> [optionally] adding Browserbase to run the browsers in the cloud, kept behind a flag so this
> local demo stays the fallback."

---

## If something dies on stage

- **A window doesn't open / hangs:** narrate over it — *"the local demo's running, let me show you
  the result"* — and **cut to the backup video.** Never debug live.
- **Heal is slow (model latency):** *"it's reasoning about the page right now — this is the part
  that replaces a human re-recording for an hour."* Slowness sells the point.
- **Wifi dies:** everything's local except the model call. If the model call fails, switch to the
  backup video for the kill shot and keep talking.
