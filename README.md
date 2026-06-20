# Mimic — Show, Don't Code

Teach-by-demonstration web automation with a self-healing core. Do a tedious web task once; it learns the workflow, replays it on new data, and **repairs itself when the site changes** instead of breaking.

> Product name `Mimic` is a placeholder — swap freely. Strategy: [DOCS/PROJECT.md](./DOCS/PROJECT.md). Data contract: [DOCS/CONTRACT.md](./DOCS/CONTRACT.md). Full docs in [DOCS/](./DOCS).

## Locked design decisions (hour-1 calls, already made)

1. **Transport: single Node process.** Brain/Runtime/Web are modules; the runtime serves the UI and streams events over WebSocket.
2. **Engine: local Playwright Chromium.** The user demonstrates in a real local browser they can click. Browserbase is an optional replay-only stretch (banks that prize) — left out of the critical path because a cloud browser adds live-demo network risk.
3. **Replay is dataset-driven.** Tab A is the human's teach prop; replay fills the target form from provided `DataRow`s. No source-scraping, so no `extract` action — healing only concerns the write side, which matches the demo.
4. **The "dead" control agent = our own replay with healing disabled** (`heal: false`). More reliable on stage than a third-party agent, and honest: "the same automation without our healing layer."
5. **Model: `claude-opus-4-8`** (one constant in `brain/anthropic.ts` — swap to Haiku if heal latency hurts the live demo).

## Layout

```
shared/    types.ts (the CONTRACT made code) + fixtures
brain/     structure() · heal() · Redis store · Anthropic client   ← Ishaan
runtime/   recorder (Playwright capture) · player (replay+heal) · Express+WS server   ← ck (Hands)
web/       zero-build UI: live event feed + split-screen heal-vs-crash   ← ck (Face)
```

## Setup

```bash
npm install
npm run browsers        # one-time: installs Playwright Chromium
cp .env.example .env    # fill ANTHROPIC_API_KEY + REDIS_URL (sponsor starter packs)
npm run typecheck       # should pass clean
npm run dev             # runtime + UI on http://localhost:3000
```

Local Redis for dev: `docker run -p 6379:6379 redis` (or use the Redis Cloud URL from the sponsor pack).

## The seam

Everything crossing a module boundary is a type in `shared/types.ts`. The flow:

```
recorder → RawTrace → structure() → Workflow → Redis
                                        │
              POST /replay → player.replay(Workflow, DataRow, {heal})
                                        │ per step → StepResult (→ WS → web)
                              on failure → heal(HealRequest) → HealResult → retry + write back
```

## Status

Scaffold: the seam, stubs, and wiring compile and run end-to-end in shape. The bodies marked `TODO(brain)` / `TODO(hands)` are where the real logic goes — start with the hour-0–4 crude end-to-end (record → replay one task), then make the heal bulletproof. See PROJECT.md build order.
