# Browserbase Migration — implementation spec

> Full migration: recorder + player run on Browserbase cloud browsers, viewed via embedded
> live-view iframes in our own web UI. Engine is **flag-swappable** — the local-window path stays
> alive as the instant stage fallback. Approved 2026-06-20. API verified against Browserbase docs
> the same day.

---

## Goal
Make Browserbase a real, live, claimable 4th sponsor. Replace local `chromium.launch()` with
Browserbase cloud sessions in **both** `recorder.ts` and `player.ts`. The split-screen moves from
two OS windows → two `debuggerFullscreenUrl` iframes inside `web/`. **The Brain (`brain/*`) does
not change** — it only ever sees a Playwright `page`.

## Non-negotiables
1. **Keep the local path.** Add `ENGINE=local|browserbase` (default `local`). Nothing breaks until we flip. This flag is the stage parachute if venue wifi / Browserbase dies mid-judging.
2. **Fail loud.** `ENGINE=browserbase` with no key → throw at startup with a clear message.
3. **Record a backup video** on whichever engine is more reliable after the dry-run.

---

## ⚠️ Verify FIRST (blocks everything)
**The split-screen needs TWO concurrent Browserbase sessions** (control + healing = two cloud
browsers at once). Browserbase **free/Hobby tier historically caps concurrency at 1.** Before
building, confirm the account plan allows **≥2 concurrent sessions** (Dashboard → Settings/Billing).

- If yes → proceed as specced.
- If capped at 1 → either upgrade the plan, **or** hybrid fallback: control lane stays **local**
  (`headless:false` window), only the healing lane runs on Browserbase. Still an honest Browserbase
  claim, only 1 session. Decide this before writing the player.

The Browserbase connectivity smoke test (below) must open **two** sessions at once and assert both
connect — that's the real go/no-go.

---

## Prerequisites
- **Dep:** `npm install -S @browserbasehq/sdk`. Keep the existing `playwright` package — its
  `chromium.connectOverCDP` works; no need to add `playwright-core`.
- **Env (`.env`):** `BROWSERBASE_API_KEY=<key>`. `projectId` is **optional** (inferred from the key)
  — only add `BROWSERBASE_PROJECT_ID` if a non-default project is needed.
- **Env (engine):** `ENGINE=browserbase` to flip on; absent/`local` keeps today's behavior.

---

## 1. New seam file: `runtime/browser.ts`
Isolates the entire swap to one file. Both recorder and player call it; neither imports Browserbase
directly.

```ts
import { chromium, type Browser, type Page } from "playwright";
import Browserbase from "@browserbasehq/sdk";

export type Engine = "local" | "browserbase";
export const ENGINE: Engine = (process.env.ENGINE as Engine) ?? "local";

export interface OpenOpts {
  lane: "control" | "healing" | "record";
  interactive?: boolean;   // recorder needs a read/write live view; replay does not
}

export interface OpenedBrowser {
  browser: Browser;
  page: Page;
  liveViewUrl?: string;    // browserbase only → drives the UI iframe
  sessionId?: string;      // browserbase only → for cleanup
  close: () => Promise<void>;
}

export async function openBrowser(opts: OpenOpts): Promise<OpenedBrowser> {
  if (ENGINE === "browserbase") return openBrowserbase(opts);
  return openLocal(opts);  // existing launch({headless:false}) + --window-position logic, moved here
}
```

### Browserbase impl (verified API)
```ts
async function openBrowserbase(opts: OpenOpts): Promise<OpenedBrowser> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) throw new Error("ENGINE=browserbase but BROWSERBASE_API_KEY is unset");

  const bb = new Browserbase({ apiKey });
  const session = await bb.sessions.create({
    // projectId optional (inferred from key)
    browserSettings: { viewport: { width: 1280, height: 800 }, blockAds: true },
  });

  const browser = await chromium.connectOverCDP(session.connectUrl);
  const defaultContext = browser.contexts()[0];     // MUST use existing context so it's recorded
  const page = defaultContext.pages()[0];

  const links = await bb.sessions.debug(session.id);
  const liveViewUrl = links.debuggerFullscreenUrl;  // embed this in the iframe

  return {
    browser, page, liveViewUrl, sessionId: session.id,
    close: async () => { await browser.close().catch(() => {}); },
  };
}
```

Notes:
- `browser.contexts()[0]` / `pages()[0]` — do **not** call `browser.newContext()`; the session is
  pre-provisioned with one context, and using it is what gets the run recorded.
- `bb.sessions.debug(id)` returns `{ debuggerFullscreenUrl, debuggerUrl, pages: [{debuggerFullscreenUrl,...}] }`.
  We use the top-level `debuggerFullscreenUrl` (single tab). If a step opens a new tab, re-call
  `debug()` and read `pages[i].debuggerFullscreenUrl`.

---

## 2. Recorder (`runtime/recorder.ts`)
- Replace `this.browser = await chromium.launch({ headless: false })` with
  `const opened = await openBrowser({ lane: "record", interactive: true })`.
- **The injected capture script stays unchanged** — it runs in-page and is engine-agnostic.
- Live-teach flow on Browserbase: the user performs the task **inside the live-view iframe**
  (human-in-the-loop). The iframe must be **read/write** for this (see UI: omit `pointer-events:none`).
- Emit the recorder's `liveViewUrl` to the UI (reuse the `liveview` event below) so the user sees the
  browser to teach in.
- Same `RawTrace` out → no Brain changes.

## 3. Player (`runtime/player.ts`)
- Replace the per-lane `chromium.launch({...window-position...})` with
  `await openBrowser({ lane })` for **both** lanes (control + healing).
- Everything else stays: `replay()`, heal wiring, `injectLaneLabel`, the green/red verdict frame —
  all page-side, so they render **inside the iframe**.
- After opening each lane, emit a `liveview` RunEvent carrying `{ lane, url: liveViewUrl }`.
- **Linger-on-verdict:** don't close the Browserbase session at run end — the injected verdict frame
  stays visible in the iframe while the session is alive. Reap on the next run.
- **`closeLiveBrowsers()`:** extend to also close any open Browserbase sessions from the previous run
  (track the `sessionId`/`close()` handles in a module-level array, same pattern as the local windows).

## 4. Contract (`shared/types.ts`)
Add one backward-compatible variant to the `RunEvent` union:
```ts
| { kind: "liveview"; lane: "control" | "healing" | "record"; url: string }
```
No other type changes. Existing events untouched.

## 5. Web UI (`web/`)
- On `kind:"liveview"`, render a live-view **iframe** for that lane into the existing split-screen
  containers (left = control, right = healing; recorder uses a single centered frame).
- **Replay iframes are read-only:**
  ```html
  <iframe src="{url}" sandbox="allow-same-origin allow-scripts"
          allow="clipboard-read; clipboard-write" style="pointer-events:none;"></iframe>
  ```
- **Recorder iframe is read/write:** identical but **remove** `pointer-events:none` so the user can
  click/type to teach.
- **Disconnect handling (verified event):**
  ```js
  window.addEventListener("message", (e) => {
    if (e.data === "browserbase-disconnected") {
      /* show "session ended" overlay on that lane; do not treat as a heal failure */
    }
  });
  ```
- When `ENGINE=local`, no `liveview` events arrive → UI behaves exactly as today (OS windows). Both
  modes coexist.

## 6. Error handling + Sentry (tightens our Sentry story)
- Missing key → throw at startup (above).
- `bb.sessions.create()` / `connectOverCDP` failure → surface on the lane in the UI **and**
  `captureMessage` to Sentry with `{ engine, lane, sessionId }`.
- `browserbase-disconnected` mid-run → log to Sentry, show overlay, keep the other lane running.
- Runtime outage → operator sets `ENGINE=local`, restarts → instant fallback.

---

## Testing gates (in order — do not skip)
1. **Typecheck:** `npx tsc --noEmit` green.
2. **Concurrency smoke (the real go/no-go):** a standalone script opens **two** sessions at once,
   `connectOverCDP` both, navigates each, asserts titles, closes both. If the 2nd session is
   rejected → plan is concurrency-capped → apply the hybrid fallback before continuing.
3. **Full seam on Browserbase:** `ENGINE=browserbase` run → control lane **fails** on the brittle
   selector, healing lane **heals**, both verdict frames render in their iframes, two `liveview`
   events emitted, memory trail still versions in Redis.
4. **Live-teach dry-run (the one genuinely new risk):** Record → perform the task inside the
   read/write iframe → Stop & build → confirm a valid workflow → Run. If flaky, fallback is teaching
   on `ENGINE=local` and replaying on Browserbase.
5. **Fallback proof:** flip `ENGINE=local`, confirm the OS-window demo still works untouched.

## Stage safety
- Keep `ENGINE=local` green throughout.
- Record the backup video on the more reliable engine after gate 4.
- Pick the stage engine **after** the dry-run, not before.

## Risks (ranked)
1. **Concurrency cap** → no split-screen. Mitigation: verify ≥2 first; hybrid fallback.
2. **Live network on stage** → demo dies if wifi/Browserbase hiccups. Mitigation: `ENGINE=local`
   parachute + backup video.
3. **Live-teach through the iframe** → input forwarding/latency. Mitigation: gate 4; teach-local fallback.
4. **Live-view latency** → cloud frames lag local. Mitigation: `viewport` sized for the projector;
   accept a small beat (it reads as "real remote browser," which is fine).

## Out of scope
Stagehand (LLM act/extract — would replace our healer; not now). Proxies, contexts persistence,
mobile viewport. Band. These are explicitly NOT part of this migration.
