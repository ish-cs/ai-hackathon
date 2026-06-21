# Mimic — Stage Script (3 min) + Judge Q&A

**Product:** Mimic — *Show, Don't Code.* Teach a web task by doing it once; it builds a
reusable workflow, replays on new data, and **heals itself** when the site changes.

**One-liner (memorize this):**
> "Every web agent breaks the moment a button moves. Mimic is the first one that fixes itself —
> live, on stage."

**The demo task (v2):** personalized **LinkedIn outreach**. A lead sheet → open the lead on
LinkedIn (new tab) → search them → open Message → type a personalized note → **Send**. Then we
break "Send" and watch Mimic heal while a normal agent dies. Runs across multiple leads.

---

## Before you walk up (setup checklist)

- [ ] `.env` has `ENGINE=browserbase` + real keys (Browserbase Dev plan: plenty of minutes)
- [ ] Server running, one clean instance: `tsx --env-file=.env runtime/server.ts`
- [ ] Browser open on `http://localhost:3000` — the **LinkedIn outreach** workflow auto-loaded in
      the box (app.js prefers the multi-tab one), param inputs filled with a real lead
- [ ] Memory panel open in a second tab: `http://localhost:3000/memory.html`
- [ ] Screen mirrored to projector; the two cloud browsers **embed in the page side-by-side**
      (control = left lane, Mimic = right lane) — no OS windows to wrangle
- [ ] Backup video queued in case wifi/Browserbase/projector dies
- [ ] Sentry Issues tab open on your phone as proof (optional flex)
- [ ] Browserbase dashboard open on your phone — live sessions as proof it's real cloud (optional flex)

> **Teaching is a one-time local step (parked for the stage).** Don't live-record on stage — start
> from the pre-built LinkedIn workflow. The win is the **heal**, not the recording.

---

## The 3-minute run

### 0:00 — Hook (10s)
*"Show of hands — who's had an automation or an AI agent break because a website changed a
button?"* (pause) *"Right. That's every agent here. We fixed it. Watch."*

### 0:10 — The problem (20s)
*"Normal agents are brittle. They memorize 'click the button with this exact ID.' The site
renames it, the agent dies, and you go re-record everything. Mimic grounds on **intent**, not IDs —
when the page changes, it re-finds the button by what it's **for**. And it's not a toy single page:
this task spans **two tabs** — a lead sheet and LinkedIn — and Mimic tracks which step happens in
which."*

### 0:30 — What we taught it (20s)
- Point at the box: the **LinkedIn outreach** workflow is already loaded — *"I taught this once by
  doing it: open the lead on LinkedIn, search them, open Message, write a personalized note, Send.
  No code, no selectors."*
- Point at the param inputs: *"Claude turned that one demo into a reusable recipe and pulled out the
  **variables** — name, role, company. I can run it on a whole sheet of leads."*

### 0:50 — Run it normally (25s)
- Click **Run**. Two **cloud browsers** appear in the page, side-by-side.
- *"These are real browsers running in the cloud on Browserbase — left is a normal agent, right is
  Mimic. Same task. Watch them open LinkedIn in a new tab, search the lead, and send a personalized
  message."* (the iframes follow the active tab)
- *"Site's normal right now — both finish. Green on both."*

### 1:15 — THE KILL SHOT (55s) ⭐ this is the demo
- *"Now I'll break the website — exactly what happens in real life when LinkedIn ships an update.
  I'm renaming the Send button."*
- Click **Run (break site)**.
- *"Watch them race."*
  - **Left (normal agent):** reaches the renamed Send → **can't find it → red FAILED.**
    *"Dead. This is every other agent on the planet right now."*
  - **Right (Mimic):** also misses → *"…and watch —"* → it reads the live page, asks Claude *"which
    element here **sends the message**?"*, re-grounds onto the renamed button, retries → **green
    SUCCEEDED.**
- *"Same broken site. One died. One healed itself — live, no human, no re-recording."*

### 2:10 — Why it healed: the memory (20s)
- Flip to the **memory panel**.
- *"It didn't just recover — it **remembered**. Here's the old broken target, the new one it found,
  Claude's reasoning, and a confidence score, saved to Redis as the agent's memory. Next time it
  already knows. It gets **more** reliable the more the web breaks."*

### 2:30 — Run the rest of the sheet (15s)
- *"And it's not one lead."* Change the params to the next lead, hit **Run** again (or note it loops
  the sheet). *"Same recipe, new data, unattended. That's the actual product — a non-coder automates
  a real multi-step, multi-tab task by showing it once."*

### 2:45 — Close (15s)
- *"Mimic. Show it once, it works forever — even when the web fights back. Claude does the reasoning
  and the healing, Redis is the agent's memory, Browserbase runs the cloud browsers you just watched,
  Sentry catches every failure live. Thank you."*

**Total: 3:00. If you're tight, cut 2:30 (the second lead) — the kill shot at 1:15 is the part that
wins. Never cut the memory panel; that's what makes it "agent," not "macro."**

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

**"How does it handle multiple tabs / pages?"**
> "Every recorded step is tagged with the tab it happened in. The recorder watches for new tabs
> opening — clicking 'Message on LinkedIn' pops a new tab — and the player holds all the open pages
> and routes each step to the right one. So the agent can read from a sheet in one tab and act in
> LinkedIn in another, the way a person actually works."

**"Does this scale to real sites, not just your demo page?"**
> "The healing logic is site-agnostic — it reads the live DOM and re-grounds by intent, nothing is
> hardcoded to our page. The demo page just lets us **break it on command** so you can see the heal
> in 3 minutes instead of waiting for LinkedIn to ship a change."

**"How is the workflow stored / what's the Redis for?"**
> "Redis is the agent's **memory**: the workflow recipe, every version, and the full heal history —
> old selector, new selector, reasoning, confidence, timestamp. That's what makes it improve over
> time instead of re-learning from scratch."

**"What's actually using Claude?"**
> "Two places: turning the raw recording into a **structured, parameterized workflow**, and the
> **healing** — given the failed step and the live page, reason out which element matches the
> original intent. Model is `claude-opus-4-8`."

**"What's Browserbase doing?"**
> "The replay and the self-healing run on **Browserbase** cloud browsers — the two browsers you
> watched race were real cloud sessions embedded live in the page, not screenshots. Teaching a new
> workflow is a one-time local step; all the autonomous agent work runs in the cloud."

**"What broke / what's left?"** (be honest)
> "The core loop — record, structure, replay, heal, across multiple tabs — is solid and you just
> watched it. Live in-browser teaching over the cloud is the next step; for now teaching is a quick
> local step and the cloud runs everything after that."

---

## If something dies on stage

- **An iframe doesn't load / a session hangs:** narrate over it — *"that's a live cloud browser
  booting, let me show you the result"* — and **cut to the backup video.** Never debug live.
- **Heal is slow (model latency):** *"it's reasoning about the page right now — this is the part
  that replaces a human re-recording for an hour."* Slowness sells the point.
- **Wifi / Browserbase dies:** flip `.env` to `ENGINE=local` + restart and the whole thing runs in
  local windows as the fallback — or just cut to the **backup video** for the kill shot and keep
  talking. (Record the backup while cloud is healthy.)
