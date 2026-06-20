// The engine seam. ONE file decides whether a lane runs in a local Chromium window or a Browserbase
// cloud session. recorder.ts + player.ts call openBrowser() and never import Browserbase directly,
// so the entire local↔cloud swap lives here. Default ENGINE=local → today's behavior, untouched.
// Spec: ../DOCS/BROWSERBASE.md.
import { chromium, type Browser, type Page } from "playwright";
import Browserbase from "@browserbasehq/sdk";

export type Engine = "local" | "browserbase";
export const ENGINE: Engine = (process.env.ENGINE as Engine) ?? "local";

export interface OpenOpts {
  lane: "control" | "healing" | "record";
  /** Recorder needs a read/write live view; replay lanes are read-only. UI-side concern only. */
  interactive?: boolean;
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
  // Live-teach over Browserbase CDP doesn't capture reliably (PARKED — see DOCS/BROWSERBASE.md), so
  // RECORDING always runs locally (instant, free, capture works). Replay + heal — the agent's real
  // cloud web automation — still honors ENGINE, so the Browserbase claim holds. Teach-local → run-cloud.
  const engine: Engine = opts.lane === "record" ? "local" : ENGINE;
  return engine === "browserbase" ? openBrowserbase(opts) : openLocal(opts);
}

async function openLocal(opts: OpenOpts): Promise<OpenedBrowser> {
  // Recorder: a plain headed window the user demonstrates in.
  if (opts.lane === "record") {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();
    return { browser, page, close: async () => void (await browser.close().catch(() => {})) };
  }
  // Replay lane: a positioned window so control + healing sit side by side; viewport:null → the
  // page fills the OS window.
  const x = LANE_X[opts.lane];
  const browser = await chromium.launch({
    headless: false,
    args: [`--window-position=${x},${LANE_WINDOW.y}`, `--window-size=${LANE_WINDOW.width},${LANE_WINDOW.height}`],
  });
  const page = await browser.newPage({ viewport: null });
  return { browser, page, close: async () => void (await browser.close().catch(() => {})) };
}

async function openBrowserbase(opts: OpenOpts): Promise<OpenedBrowser> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) throw new Error(`ENGINE=browserbase but BROWSERBASE_API_KEY is unset (lane=${opts.lane})`);

  const bb = new Browserbase({ apiKey });
  const session = await bb.sessions.create({
    // projectId is inferred from the key; viewport sized for a projector.
    timeout: 180, // seconds — cap a leaked/lingering session so it can't silently burn free-tier minutes
    browserSettings: { viewport: { width: 1280, height: 800 }, blockAds: true },
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
