# Brief for Ishaan — Demo pivot to "The Cost Race" (live LinkedIn)

**From:** ck · **Date:** 2026-06-20 · **Full spec:** `DOCS/specs/2026-06-20-cost-race-design.md`

Read this first; the spec has the detail. This is what changed and what's yours.

---

## The pivot in one paragraph

We're dropping the dumb-bot-crash comparison. New demo = **Mimic vs Stagehand**, head-to-head, **live on real LinkedIn**, with an on-screen **cumulative token / time / $ meter**. Mimic (taught once → deterministic) stays flat and cheap; Stagehand (pure LLM agent) pays full LLM cost every step every run. Mid-demo we **inject a DOM change** to simulate a redesign: Mimic heals one cheap call + re-caches, Stagehand re-reasons at full price (and may misclick). Punchline = cost-per-run gap + ×1000 projection + break-even line. We win on **economics + determinism**, not "robustness vs dumb bots."

## What changed vs the old plan

- **Comparator:** dumb selector bot → **Stagehand (real LLM agent)**. The old `control` lane is replaced by a `stagehand` lane.
- **Headline:** "self-heal vs crash" → **"deterministic + cheap vs LLM-every-run + expensive."** Heal is now the *drift-resilience climax*, not the whole show.
- **Site:** parody-only → **live real LinkedIn** via Browserbase stealth + persistent Context (warmed burner). Parody (LinkedUp) demoted to optional fallback.
- **Break:** `?break=1` on a page we own → **client-side `page.evaluate` DOM injection** on the live site (same role, real DOM). Parody still uses `?break=1`.
- **Cut entirely:** the Gmail / email-send finale. An API send has no selectors to heal → Mimic adds nothing → it muddies the pitch. Gone.
- **Fallback:** optional. **We're risking the live run.** Build the parody fallback only if there's spare time.
- **Mimic is pre-taught** (recorded once on real LinkedIn before the demo) — no live recording on stage.

## Your lane (the three long poles)

1. **`runtime/stagehand-lane.ts`** — a Stagehand agent that runs the same cold-outreach task from natural-language instructions, drives real LinkedIn, and **emits per-run token usage + wall time** as `metrics` events. LLM every step is expected (that's the point — it's the expensive lane).
2. **Browserbase stealth + persistent Context** — Advanced Stealth + residential proxy + a **Context holding the warmed burner LinkedIn session** (ck warms the account; you wire the Context so replays reuse the auth without re-login). This is the access layer that gets past bot-detection/CAPTCHA.
3. **`brain/anthropic.ts`** — return `res.usage` (input/output tokens) from `completeJSON` so `structure()` and `heal()` can report **real** token counts to the meter. Today it's discarded.

## The seam we must agree on (`shared/types.ts`)

One additive RunEvent + two lane literals. Don't merge until we both ack:

```ts
// add to the RunEvent union:
| { kind: "metrics"; lane: "stagehand" | "mimic"; run: number;
    phase: "teaching" | "running"; tokensIn: number; tokensOut: number;
    ms: number; costUsd: number }

// lane literals used across events: "stagehand" | "mimic"
```

ck's `runtime/metrics.ts` consumes these (pricing → $, cumulative, projection, break-even). Your Stagehand lane and the brain's structure/heal **emit** them.

## What ck owns (so we don't collide)

- `runtime/metrics.ts` (pricing, accumulation, projection, break-even)
- `runtime/breaker.ts` (DOM-injection break)
- `runtime/server.ts` `/api/race` orchestrator (N rounds, inject at round K, broadcast) — **keeps `/api/replay` intact**
- `web/` cost-race UI (dual Live View + climbing meter + projection + break-even + reuse CP3 heal card)
- Warming the burner LinkedIn account + the Mimic pre-recording

ck builds all of the above against **mocked `metrics` events** until your real Stagehand lane lands — so we're unblocked in parallel. We integrate at the seam.

## Defaults (tunable)

- Rounds **N=4**, break at round **K=3**.
- Stagehand per-run timeout **~40s** → on hang, ck swaps canned metrics so the meter keeps moving. A Stagehand *misclick* we keep live (it helps us); only a *hang* gets swapped.

## Non-negotiables

- **Keep `/api/replay`** (the old kill-shot demo) working as the ultimate fallback.
- `shared/types.ts` + `anthropic.ts` are the brain seam — **coordinate, no solo shape edits.**
- **Burner** LinkedIn creds live only in the Browserbase Context — **never committed.**
- We are **not** claiming novelty (browser-use Workflow Use / Stagehand caching exist). We win on polish + the visualized heal + the live cost contrast.

## Open coordination items

1. Ack the `metrics` RunEvent + lane literals above before either of us edits `shared/types.ts`.
2. Confirm you're taking the three long poles; ck takes metrics + UI + breaker + `/api/race` + burner warming + pre-recording.
3. Agree the exact cold-outreach task + the **heal-target element** (the selector ck's breaker renames and Mimic heals) on real LinkedIn — we both need the same target.
4. Current `$/Mtok` price for `claude-opus-4-8` to plug into `metrics.ts`.
