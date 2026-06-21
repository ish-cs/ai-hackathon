# Mimic Demo — "The Cost Race" on Live LinkedIn (Design Spec)

**Date:** 2026-06-20
**Authors:** ck (Hands + Face) + Ishaan (Brain + Engine)
**Status:** Approved design — ready for build
**Supersedes:** the dumb-bot-crash kill-shot framing and `2026-06-20-multi-app-demo-design.md`

---

## TL;DR of the pivot

We stop comparing Mimic to a **dumb deterministic selector bot** (which just crashes) and instead compare it to a **pure-LLM browser agent (Stagehand)** — the real competitor a judge will name. The demo becomes a **live cost race on real LinkedIn**:

- **Mimic** = taught once, then deterministic + cheap, heals when the site changes.
- **Stagehand** = re-reasons every step every run → pays full LLM cost forever.

On-screen **cumulative tokens / time / $ meter** makes the economic win visible. The break/heal is the climax — proof the deterministic cache survives drift without going back to full LLM price.

## Goal

A 3-minute live demo: two lanes run the same cold-outreach task on **real LinkedIn** over Browserbase, side by side, with a running cost meter. Mimic stays flat; Stagehand climbs. When the site "changes," Mimic heals for one cheap call and re-caches; Stagehand re-pays in full (and may misclick). Punchline: cost-per-run converging + ×1000 projection + break-even line.

## Why (the positioning)

- A renamed button does **not** kill a true LLM agent like Stagehand — it re-reads the page every run. So "robustness vs dumb bots" is a strawman a sharp judge sees through.
- Mimic's real, defensible edge over Stagehand is **cost / speed / determinism**: pay the model **once** (teaching) + only again when the page actually changes (heal). Stagehand pays the model **every step, every run, forever.**
- Prior art exists (browser-use "Workflow Use", Stagehand action caching, Voyager skill libraries) — so we **do not claim novelty**. We win on demo polish, the visualized self-heal, and the live economic contrast.

## Non-goals

- No dumb-deterministic-bot lane. Retired.
- No Gmail / email-send finale. **Cut** — an API send has no selectors to heal, so Mimic adds nothing there; it muddies the story.
- No claim that Mimic invented compile-the-agent caching.
- No real LinkedIn **logins on a personal account** — burner only, warmed ahead of time.

## The lanes

Both run the **same task** over Browserbase, shown in the existing dual **Live View iframes** with a cost-meter overlay.

| Lane | What it is | Cost profile |
|---|---|---|
| **Stagehand** (Ishaan) | Pure LLM agent. Natural-language instructions, drives real LinkedIn, LLM decides every step every run. | Full LLM tokens **every step, every run** |
| **Mimic** | Pre-taught deterministic workflow (recorded once on real LinkedIn). Replays selectors; on break, heals (1 Claude call) + re-caches. | ~0 tokens/run; one-time teaching; one cheap heal on drift |

## The counter (the payload)

Two phases on screen:

1. **Teaching (run 0):** Mimic = `1 human demo + 1 structure() call` (one-time cost, shown honestly). Stagehand = `0 setup`.
2. **Running (rounds 1…N):** cumulative **tokens / time / $** per lane. Stagehand climbs ~linearly; Mimic stays flat. At the break round, Stagehand takes a full-cost jump; Mimic takes a tiny heal blip then flatlines.

**Punchline readouts:** cost-per-run converging (Stagehand flat-high, Mimic → 0), **×1000 projection** ("$X,XXX vs $X"), **break-even** line ("Mimic's teaching pays for itself after run N").

**Honesty framing (say it out loud):** Mimic got a free human demonstration; Stagehand started cold. That asymmetry **is the product** — "showing once is cheaper than exploring a thousand times." Show the teaching cost; don't hide it.

## The break (on a real site we don't own)

We can't rename LinkedIn's button on their server, so we **simulate a redesign client-side**: our Browserbase/Playwright browser runs JS in the page to rename/move the heal-target element after recording.

```js
page.evaluate(() => {
  const b = document.querySelector("<heal-target>");
  b.id = "changed"; b.textContent = "<renamed>"; // simulate a redesign
});
```

Same role as the parody `?break=1`, applied to the live page **we control in our own tab**. The heal is still 100% real — Claude re-grounds against the **actual mutated DOM**. Frame it honestly on stage: *"Sites redesign constantly — here's that change simulated. Watch each agent."*

Why it still lands vs Stagehand (not a crash): Stagehand never cached anything, so it re-reasons the changed page at **full token cost every run** (and may misclick the renamed element). Mimic's cached selector misses → **one cheap heal** → re-cache → back to ~0. Meter shows Stagehand's full jump vs Mimic's tiny blip.

## Engine + fallback

- **Engine:** Browserbase **Advanced Stealth + residential proxy + persistent Context** (warmed **burner** LinkedIn account). This is what gets past bot-detection/CAPTCHA — the access problem Browserbase is built to solve. Ishaan's lane.
- **Fallback (optional, build only if time):** env/keystroke flips both lanes' target → **LinkedUp parody** (reuses existing `?break=1`). Same workflow, same break. **Decision: we risk the live run. If LinkedIn challenges us mid-demo, we deal with it then.** Fallback is a nice-to-have, not a required build.

## Components / file split

| File | Owner | Responsibility |
|---|---|---|
| `shared/types.ts` | **seam — agree together** | + `metrics` RunEvent `{kind:"metrics", lane, run, phase, tokensIn, tokensOut, ms, costUsd}`; lane literals `"stagehand"` / `"mimic"` |
| `runtime/stagehand-lane.ts` | **Ishaan** | Stagehand agent runs the task, emits `step` + `metrics` events, reports real token usage; Browserbase stealth/Context launch |
| `brain/anthropic.ts` | **Ishaan / brain** | return `res.usage` so `structure()` + `heal()` report real tokens (currently discarded) |
| `runtime/metrics.ts` | **ck** | `$/Mtok` pricing constants, cumulative accumulation, ×1000 projection, break-even math |
| `runtime/breaker.ts` | **ck** | inject DOM rename on the live page (`page.evaluate`); parody path reuses `?break=1` |
| `runtime/server.ts` | shared | new `/api/race`: N rounds, inject at round K, accumulate, broadcast metrics. **Keep `/api/replay` as the ultimate fallback demo.** |
| `web/` (cost-race UI) | **ck (Face)** | dual Live View + per-lane token/time/$ tickers, climbing cumulative chart, ×1000 projection, break-even line, Teaching→Running phases, reuse the CP3 heal card at the break |

**Parallelization:** ck builds `metrics.ts` + the cost-race UI + `/api/race` scaffolding against **mocked** Stagehand metrics events. Ishaan builds the real `stagehand-lane.ts` + `anthropic.ts` usage. They meet at the `metrics` RunEvent seam.

## Data flow

0. **Pre-demo:** ck warms the burner LinkedIn Context. Mimic workflow pre-recorded once on real LinkedIn → structured → stored (capture teaching tokens). Sessions pre-warmed.
1. **Teaching display (run 0).**
2. **Rounds 1…N** (default **N=4, break at K=3** — tunable):
   - Stable rounds: both run; Mimic ~0 tokens, Stagehand pays. Counter accumulates.
   - Break round K: inject the DOM rename before the heal-target step. Mimic heals (1 cheap call) + re-caches; Stagehand re-reasons (full cost, maybe misclick).
   - Post-break rounds: Mimic flat (cached heal); Stagehand still full each run.
3. **Finale:** totals, cost-per-run, ×1000 projection, break-even line.

## Error handling

- **Stagehand hang** → per-run timeout (~40s) → mark the run failed, swap in **canned metrics** so the meter keeps moving. *A misclick stays live (it helps us); only a hang gets swapped.*
- **LinkedIn CAPTCHA / checkpoint mid-demo** → we accept the risk and handle it live. (Optional parody fallback if built.)
- **Break-injection target missing** (LinkedIn DOM shifted between rehearsal and stage) → verify the target selector day-of.
- **Heal fails** (DOM too changed) → existing failed-step path; rehearse heal against the exact injected change so it's reliable.
- **Missing token usage** → render "—", never crash. Pricing = hardcoded `$/Mtok` constants (use current published price for `claude-opus-4-8` at build time).

## Testing

- `metrics.ts` unit: token→$, ×1000 projection, break-even math.
- `/api/race` smoke (N=3, K=2): both lanes emit metrics each round; break at round 2 triggers Mimic heal + Stagehand cost jump; cumulative sums correct.
- `breaker` unit: inject on a test page → target selector renamed → Mimic heal re-grounds.
- Stagehand lane (Ishaan): completes the task, reports usage > 0.
- UI (Playwright): counters climb, projection updates, heal card renders at the break.

## Scope / risk flags

- **Long poles, tonight:** Browserbase stealth+Context (Ishaan), `stagehand-lane.ts` (Ishaan), `anthropic.ts` usage (Ishaan). Burner warming = **ck**. ck's metrics + UI are independent (mock events) and safe to start now.
- **Keep the old `/api/replay` kill-shot demo intact** as the ultimate fallback.
- `shared/types.ts` + `anthropic.ts` touch the brain seam → **coordinate, do not solo-edit.**
- **Burner** LinkedIn creds live in the Browserbase Context — **never committed.**
