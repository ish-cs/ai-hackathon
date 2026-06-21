// The engine seam. ONE file decides whether a lane runs in a local Chromium window or a Browserbase
// cloud session. recorder.ts + player.ts call openBrowser() and never import Browserbase directly,
// so the entire local↔cloud swap lives here. Default ENGINE=local → today's behavior, untouched.
// Spec: ../DOCS/BROWSERBASE.md.
import { chromium, type Browser, type Page } from "playwright";
import Browserbase from "@browserbasehq/sdk";
import type { Lane } from "../shared/types";

export type Engine = "local" | "browserbase";
export const ENGINE: Engine = (process.env.ENGINE as Engine) ?? "local";

export interface OpenOpts {
  lane: Lane;
  /** Recorder needs a read/write live view; replay lanes are read-only. UI-side concern only. */
  interactive?: boolean;
  /** Browserbase only: reuse a warmed Context (e.g. a logged-in burner LinkedIn), read-only (persist:false).
   *  Set for the Cost Race Mimic lane so it boots already signed in; omit for the original demo. */
  contextId?: string;
}

export interface OpenedBrowser {
  browser: Browser;
  page: Page;
  liveViewUrl?: string; // browserbase only → drives the UI iframe
  sessionId?: string; // browserbase only → for cleanup/debug
  close: () => Promise<void>;
}

// Local side-by-side window geometry (moved out of player.ts). Tuned for a 16" MacBook Pro —
// control → LEFT, healing → RIGHT. The recorder uses a normal (unpositioned) window.
const LANE_WINDOW = { width: 780, height: 960, y: 40 };
const LANE_X: Record<"control" | "healing", number> = { control: 24, healing: 824 };

export async function openBrowser(opts: OpenOpts): Promise<OpenedBrowser> {
  // RECORDING runs locally for a snappy teach UX (demonstrate in a responsive local window). Capture
  // itself is engine-agnostic and verified on Browserbase too (array-based, see recorder-capture.js),
  // so flipping teach to the cloud is just returning ENGINE here — kept local by choice. Replay + heal
  // — the agent's real cloud web automation — honor ENGINE, so the Browserbase claim holds.
  const engine: Engine = opts.lane === "record" ? "local" : ENGINE;
  return engine === "browserbase" ? openBrowserbase(opts) : openLocal(opts);
}

async function openLocal(opts: OpenOpts): Promise<OpenedBrowser> {
  // Use an EXPLICIT context (not browser.newPage(), whose implicit context rejects context.newPage()
  // with "Please use browser.newContext()") so the recorder/player can open additional tabs for the
  // multi-tab flow via context.newPage().
  if (opts.lane === "record") {
    // Recorder: a plain headed window the user demonstrates in.
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    return { browser, page, close: async () => void (await browser.close().catch(() => {})) };
  }
  // Replay lane: a positioned window so control + healing sit side by side; viewport:null → the page
  // fills the OS window.
  const x = opts.lane === "healing" ? LANE_X.healing : LANE_X.control;
  const browser = await chromium.launch({
    headless: false,
    args: [`--window-position=${x},${LANE_WINDOW.y}`, `--window-size=${LANE_WINDOW.width},${LANE_WINDOW.height}`],
  });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  return { browser, page, close: async () => void (await browser.close().catch(() => {})) };
}

async function openBrowserbase(opts: OpenOpts): Promise<OpenedBrowser> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) throw new Error(`ENGINE=browserbase but BROWSERBASE_API_KEY is unset (lane=${opts.lane})`);

  const bb = new Browserbase({ apiKey });
  const session = await bb.sessions.create({
    // projectId is inferred from the key; viewport sized for a projector.
    timeout: 180, // seconds — cap a leaked/lingering session so it can't silently burn free-tier minutes
    // A warmed Context (Cost Race Mimic lane) also needs the residential proxy so LinkedIn sees a normal
    // user; the original demo (no contextId) keeps today's plain session untouched.
    ...(opts.contextId ? { proxies: true } : {}),
    browserSettings: {
      viewport: { width: 1280, height: 800 },
      blockAds: true,
      ...(opts.contextId ? { context: { id: opts.contextId, persist: false }, solveCaptchas: true } : {}),
    },
  });

  const browser = await chromium.connectOverCDP(session.connectUrl);
  const page = browser.contexts()[0].pages()[0]; // pre-provisioned context — do NOT newContext()

  const links = await bb.sessions.debug(session.id);
  const liveViewUrl = links.debuggerFullscreenUrl; // embed in the UI iframe

  return {
    browser,
    page,
    liveViewUrl,
    sessionId: session.id,
    close: async () => void (await browser.close().catch(() => {})),
  };
}

/**
 * Per-tab live-view URL for the UI iframe (Browserbase only). The player calls this on a switchTab so
 * the embedded iframe follows the active tab. Local / no session → undefined (no iframe).
 */
export async function liveViewForTab(opened: OpenedBrowser, tabIndex: number): Promise<string | undefined> {
  if (ENGINE !== "browserbase" || !opened.sessionId) return undefined;
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) return undefined;
  try {
    const bb = new Browserbase({ apiKey });
    const links = await bb.sessions.debug(opened.sessionId);
    const pages = (links as { pages?: Array<{ debuggerFullscreenUrl?: string }> }).pages;
    return pages?.[tabIndex]?.debuggerFullscreenUrl ?? links.debuggerFullscreenUrl;
  } catch {
    return undefined;
  }
}
