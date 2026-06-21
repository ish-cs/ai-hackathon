# Mimic — Pay Once, Run Forever

Browser automation you build by **showing it, not coding it**. Demonstrate a tedious web task once; Mimic learns the workflow, replays it on new data deterministically (no LLM, so near-zero cost), and **heals itself when the site changes** instead of breaking.

The pitch in one line: every other AI browser agent re-pays an LLM to re-reason the same task on every run, so cost scales with volume. Mimic pays to think **once**, then runs for pennies. Measured head to head on the same job, a state-of-the-art agent spent `$1.55`; Mimic spent `$0.06`.

> Strategy: [DOCS/PROJECT.md](./DOCS/PROJECT.md) · Data contract: [DOCS/CONTRACT.md](./DOCS/CONTRACT.md) · Full docs in [DOCS/](./DOCS).

## How it works

A four-step loop, with a memory layer holding it together:

```
record    Playwright captures your clicks / inputs / navigation + page context, across tabs
structure Anthropic Claude (Opus 4.8) turns the raw trace into a parameterized Workflow
replay    the runtime re-runs the Workflow on new DataRows, unattended, with zero LLM calls
heal      on a broken step, Claude re-grounds the element by intent, patches it, writes the fix back
```

Workflows and their full version history live in Redis as genuine, auditable **agent memory** (not a cache). The healer reads from it and writes upgrades back as new versions.

## Two live demos

Both are real code paths, streamed to the UI over WebSocket.

- **Cost Race** (`POST /api/race`) — Mimic vs Stagehand (a state-of-the-art LLM agent) on the *same* multi-tab job: walk a LeadSheet, open LinkedUp, message each lead, come back, repeat. A live meter shows **real** tokens and dollars from each side's actual API usage. Mid-race we rename the Send button: a brittle replay would die, Stagehand never notices (it re-reads the whole page every step, which is why it is expensive), and Mimic heals the broken step live. Files: `runtime/mimic-lane.ts`, `runtime/stagehand-lane.ts`, `runtime/metrics.ts`, `runtime/breaker.ts`.
- **Heal split-screen** (`POST /api/replay`) — the same workflow run twice side by side, healing on vs off (`heal: false` is the honest "dead" control). One crashes on the site change, the other re-grounds and finishes.

## Layout

```
shared/       types.ts (the CONTRACT made code) + fixtures
brain/        structure() · heal() · Redis store · Anthropic client          ← Ishaan (Brain)
runtime/      recorder · player · lanes (mimic / stagehand) · metrics ·
              breaker · multitab · Sentry · Express + WS server              ← ck (Hands)
web/          zero-build UI: live event feed, Cost Race, heal-vs-crash       ← SJ + ck (Face)
mock-public/  LinkedUp + LeadSheet — the simulated sandbox we automate
```

## Setup

```bash
npm install
npm run browsers              # one-time: Playwright Chromium (local engine)
cp .env.example .env          # fill the keys below
npm run typecheck             # should pass clean
npm run dev                   # runtime + UI on http://localhost:3000
```

`.env` keys:

```
ANTHROPIC_API_KEY=    # the brain + both Cost Race lanes
REDIS_URL=            # workflow store / agent memory (local: docker run -p 6379:6379 redis)
ENGINE=local          # or "browserbase" for real cloud browsers + embedded live view
BROWSERBASE_API_KEY=  # required when ENGINE=browserbase (the Cost Race runs here)
SENTRY_DSN=           # optional: captures the failure -> heal moment
```

The Cost Race runs on Browserbase (`ENGINE=browserbase`) so both lanes get real cloud browsers with live-view iframes. The local engine (`ENGINE=local`) is fine for the heal split-screen and day-to-day dev.

## Verify it's real

```bash
npm run dev                                # terminal 1: server + UI
npx tsx --env-file=.env race-verify.ts     # terminal 2: fires /api/race, prints real per-lane $ + tokens, the break, the heal
```

## The seam

Everything crossing a module boundary is a type in `shared/types.ts`. The flow:

```
recorder → RawTrace → structure() → Workflow → Redis
                                        │
   POST /api/replay → player.replay(Workflow, DataRow, {heal})
   POST /api/race   → mimic-lane + stagehand-lane (multi-tab, head to head)
                                        │ per step → StepResult / metrics → WS → web
                          on failure → heal(HealRequest) → HealResult → retry + write back
```

## Cost model

Replay is deterministic Playwright: **zero LLM calls, zero tokens**. The only spend after teaching is a heal, which fires when the site changes, not when you run. So token cost stays roughly flat in the number of runs, while a pure-LLM agent's grows linearly. Both lanes are priced identically at Opus 4.8 list rate (`$5` in / `$25` out per million tokens, in `runtime/metrics.ts`).

Honest caveat: this flattens the **thinking** cost, not wall-clock time. Doing N tasks is still N rounds of clicking; we do not beat physics.

## Stack

TypeScript · Node · Anthropic Claude (Opus 4.8) · Redis · Browserbase + Stagehand · Sentry · Playwright · Express · WebSockets · zod.
