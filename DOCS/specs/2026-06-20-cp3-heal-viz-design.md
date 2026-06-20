# CP3 — Heal Viz + Lane Contrast (Design)

**Date:** 2026-06-20
**Owner:** ck (Hands + Face)
**Branch:** `ck`
**Checkpoint:** CP3, beats #1 (lane contrast) + #2 (animated heal). Sentry (#3) and Redis Cloud swap are deferred — out of scope here.
**Scope:** 2 files — `web/app.js` (rewrite the `heal` / `step` / `run_done` branches of `handle()` + helpers) and `web/index.html` `<style>` (+ minor markup). Zero-build, plain DOM + CSS transitions. **No `shared/types.ts` change. No server change.**

---

## Goal

Make the split-screen read as a demo from across a room. The healing lane's re-grounding moment animates as a distinct **heal card** (staged reveal), and the two lanes visibly diverge: control **dies red / CRASHED**, healing **ends green / COMPLETED**. The contrast is the 60-second kill shot.

---

## Data flow (no new events)

Events already arrive over the WebSocket in this order per the existing `player.ts`:

```
run_start → step(ok) → step(ok) → step(failed) → heal → step(healed) → run_done
```

The `heal` event (`HealResult`) carries `stepId`, `healed`, `newSelector`, `reasoning`, `confidence` — but **not** the old selector. So the old selector is recovered from the preceding `failed` step:

- On any `step` with `status === "failed"`: stash `lastFailed[lane] = { stepId, selector: result.attemptedSelector }`.
- On `heal`: pair `lastFailed[lane].selector` (old) with `result.newSelector` (new), plus `reasoning` + `confidence`.

No type-shape change is required; all fields already exist on `StepResult` / `HealResult` / `RunEvent` in `shared/types.ts`.

---

## Components

### 1. `healCard(result, oldSelector) → HTMLElement`
Builds the card DOM and inserts it directly after the failed step row in the healing lane's `#healing-steps`.

**Success card** (`result.healed === true`):
- Header: `⚡ RE-GROUNDED by intent`
- `.old` — old selector, strikes through red
- `.arrow` — `↓`
- `.new` — new selector, green
- `.ring` — SVG confidence ring (see below)
- `.reason` — `result.reasoning`

**Refusal card** (`result.healed === false`, the negative-heal path):
- Header: `HELD BACK — refused to guess`
- Amber border, **no ring** (a high "confidence it should refuse" next to a refusal misreads)
- `.reason` — `result.reasoning`

### 2. Staged reveal (CSS-only, no JS timers)
Card is appended with base class `heal-card`; one `requestAnimationFrame` then adds `.reveal`. Children carry staggered `transition-delay`:

| beat | element | effect |
|------|---------|--------|
| t0.0s | `.old` | strike-through draws, color → red |
| t0.3s | `.arrow` + `.new` | slide/fade in, color → green |
| t0.7s | `.ring` | stroke-dashoffset fills 0→N% |
| t0.7s | `.reason` | opacity 0→1 |

Total ≈1.5s. Pure CSS `transition` + `transition-delay`; the only JS is the single rAF class flip.

### 3. Confidence ring
SVG `<circle>` with `stroke-dasharray = circumference`, animating `stroke-dashoffset` from full (empty) to `circumference * (1 - confidence)` via a CSS transition (0.6s ease, 0.7s delay). Center text shows `Math.round(confidence * 100)%`. SVG chosen over conic-gradient for reliable animation.

### 4. `setLaneState(lane, state)`
Toggles classes on the `.lane` element and rewrites its status text:
- Control `run_done{ok:false}` → `.lane.control.crashed`: red border, failed step pulses, status → big `💀 CRASHED`.
- Healing `run_done{ok:true}` → `.lane.healing.completed`: green border, status → big `✓ COMPLETED`.

Replaces the current dim one-line `✓ completed` / `✗ crashed` status text with a large, high-contrast state.

### 5. `step{healed}` row
When the post-heal `step{status:"healed"}` arrives, the `s3` row flips to green `✓ healed #send-btn` (existing `.step.healed` class path, kept).

---

## Error handling

- **Missing `lastFailed`** (heal arrives with no prior failed step for that lane): render the card without the `.old` strike line — show only the new selector. Defensive; should not happen in the demo path.
- **Long reasoning:** `.reason` gets `max-height` + overflow clamp + slightly smaller font so a verbose Claude response never blows out the card.
- **Refusal with no `newSelector`:** handled by the refusal card variant (no ring, no `.new`).
- `lastFailed[lane]` is reset on `run_start` so a fresh run never pairs against a stale selector.

---

## Testing / verification

No frontend unit harness exists in the repo; verification is manual + tooled:

1. **Live:** server up on :3000 + Redis + key → click `🔧 Run with broken site` → confirm the card stages (old strikes → new slides → ring fills → reasoning) and the lanes diverge (control CRASHED red, healing COMPLETED green).
2. **Tooled:** drive the page with Playwright / Chrome DevTools MCP, screenshot mid-stage and post-run to confirm rendering + lane states.
3. **Cheap iteration (no LLM cost):** inject a synthetic `heal` event into `handle()` via the browser console to tune CSS timing without a real broken run.
4. **Refusal path:** synthetic `heal{healed:false}` event → confirm amber refusal card, no ring.

---

## Out of scope (this pass)

- **Sentry** (CP3 beat #3) — needs `SENTRY_DSN` from the sponsor table; `initSentry()` / `captureFailure()` already wired server-side.
- **Redis Cloud swap** — staying local until the CP4 dress-run / backup video.
- Any `shared/types.ts` change. Any server / `player.ts` change.
