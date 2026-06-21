# Demo v2 — multi-tab LinkedIn outreach (impressive demo upgrade)

> Replace the single self-coded form with a **two-app, tab-switching** workflow that looks like real
> SaaS: read a lead from a Sheets-like page → switch tab → message them on a LinkedIn-like page →
> Send. Break the Send button → control dies, Mimic heals. Runs over N rows = N personalized messages.
> Approved 2026-06-20.

## Why
Current demo = one homemade form. Underwhelming. This shows the agent **navigating between two
apps like a human** (the real pain: data trapped between systems that don't talk) while keeping the
**self-heal kill-shot** — the differentiator. Maps to Toolbox (workflow automation) + Anthropic
(economic opportunity: outreach for recruiters/sales).

## HARD REQUIREMENT (gates everything): tab-switching
The demo is impossible without it, and it does not exist today. Build it first.

**Contract (`shared/types.ts`)**
- Add `"switchTab"` to `ActionType`.
- Every `WorkflowStep` (and `RawTrace` action) carries `tab: number` (which tab it runs on, default `0`).
- A `switchTab` step's target = the destination tab (by index; carry its `url` too so replay can open it if missing).

**Recorder (`runtime/recorder.ts`)**
- Subscribe to `context.on("page")` to detect new tabs/popups; keep an ordered tab list + the active tab.
- Emit a `switchTab` action whenever focus moves to a different tab (or a click opens one).
- Tag every captured action with its `tab` index.
- The injected capture script stays per-page (it already re-injects post-goto for Browserbase CDP) — attach it to each new page too.

**Player (`runtime/player.ts`)**
- Hold `pages: Page[]` (or a map by tab index), not a single `page`.
- Route each step to its `step.tab`. `switchTab` → bring that tab to front (open it via `context.newPage()` + goto if it doesn't exist yet).
- Heal runs on the **active** tab (the heal logic itself shouldn't need changes — it re-grounds against whatever DOM is live).

**Browserbase (`runtime/browser.ts`)**
- Each tab has its own live-view: `bb.sessions.debug(id).pages[i].debuggerFullscreenUrl`. On a
  `switchTab`, emit a fresh `liveview` event for the active tab so the iframe follows the active tab.

**Backward compatibility**
- Default `tab: 0` everywhere → the **current single-page demo and saved workflows still replay
  unchanged.** This is required (the old demo is our fallback).

## The two clone pages (`mock-public/`, deployed to Vercel, public + breakable)
**Page A — "LeadSheet" (Sheets-like):** a polished table of leads, columns `name · role · company`,
3–5 rows. Clean, stable selectors (`data-cell="name"` etc.). Looks like Google Sheets.

**Page B — "LinkedIn-like":** search bar → person profile → **Message** button → compose textarea →
**Send** button. Polished to read as LinkedIn. Clean selectors (`#li-search`, `#li-message-btn`,
`#li-compose`, `#li-send`).
- **Breakable:** `?break=1` renames/re-ids the **Send** button (e.g. `#li-send` → `#li-submit`, label
  "Send" → "Send now") so the recorded selector misses and the heal must re-ground by intent
  ("the button that sends this message").

Both pages stable-DOM and self-hosted (no React churn, no third-party flakiness, reachable from the
Browserbase cloud).

## The workflow (taught once, runs over N rows)
1. Start on **LeadSheet**, read row: `{name, role, company}` (these are the **parameters**).
2. `switchTab` → **LinkedIn-like**.
3. Type `{name}` into search → open the matching profile.
4. Click **Message** → type a personalized note: *"Hi {name}, saw you're {role} at {company} — would love to connect."*
5. Click **Send**.
6. Run over all rows → N personalized messages, unattended.

**Kill-shot:** with `?break=1`, the control lane dies on the renamed Send; the healing lane re-grounds
and finishes. Two cloud browsers side by side, red vs green.

*(Alt if simpler: swap the Message/Send leg for a Connect-request-with-note. Message+Send is the
default — cleaner breakable button.)*

## Non-negotiables
1. **Keep the current single-page demo working** — build v2 alongside, don't delete. It's the fallback if v2 isn't finished by submission.
2. **`brain/*` stays untouched** (heal is page-agnostic; if the heal prompt genuinely needs the multi-tab context, flag it first — don't silently rewrite the brain).
3. `ENGINE` flag intact; v2 must run in both local and Browserbase modes.
4. Author = the user, never Claude.

## Build order + test gates (do not skip)
1. **Tab-switching capability** (contract → recorder → player), `npx tsc --noEmit` green.
2. **Regression:** the existing single-page demo still records + replays (default `tab:0`).
3. Build + deploy the two clone pages; confirm both load from a public URL.
4. **Record** the multi-tab workflow locally; confirm the trace has `switchTab` + per-tab tagging.
5. **Replay local:** LeadSheet → LinkedIn → message → send, over N rows.
6. **Break + heal:** `?break=1` → control dies, healing heals, on the LinkedIn Send.
7. **Browserbase full run:** two iframes, live-view follows the active tab, N rows.
8. **Fallback proof:** old demo still runs.

## Risks
1. **Tab-switching is the lift** — touches contract + recorder + player. Time, not minutes. If it
   can't land in time, the current demo + Devpost are the floor (don't break them chasing this).
2. **Live-view following the active tab** — if swapping the iframe per tab is fiddly, acceptable v1 is
   two iframes (one per tab) shown side by side, or the active tab only.
3. **Deadline:** Devpost online entry is still due **tonight, midnight** — independent of this build.

## Out of scope
Real LinkedIn/Gmail/Sheets (login + bot-detection + can't break them = no heal). Connection-graph
realism. More than ~5 leads. Band/Poke.
