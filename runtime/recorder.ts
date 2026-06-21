import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { type Page } from "playwright";
import { openBrowser, type OpenedBrowser } from "./browser";
import type { RawAction, RawTrace } from "../shared/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAPTURE_PATH = join(__dirname, "recorder-capture.js");
const CAPTURE_SOURCE = readFileSync(CAPTURE_PATH, "utf8"); // also injected post-goto for Browserbase CDP

/**
 * Records a user's demonstration across one or MORE browser tabs (multi-tab support for the
 * LinkedIn-outreach demo). A local Chromium window (ENGINE forces record local for snappy capture);
 * each action is tagged with the tab it ran on, and a `switchTab` action is emitted when a new tab
 * opens. Single-tab recordings keep every action at tab 0, so the original demo is unaffected.
 * Capture is per-page (window.__mimicActions array, read on stop) — engine-agnostic, CDP-safe.
 * TODO(hands): tighten selector generation + domSnapshot trimming against real pages.
 */
export class Recorder {
  private opened: OpenedBrowser | null = null;
  private tabs: Page[] = []; // ordered by tab index; tabs[0] = the initial page
  private switchActions: RawAction[] = []; // switchTab markers emitted when a new tab opens
  private startUrl = "";

  get recording(): boolean {
    return this.opened !== null;
  }

  /** Active tab (the most recently opened) — used by scripted demonstrations. */
  get livePage(): Page | null {
    return this.tabs[this.tabs.length - 1] ?? null;
  }

  /** All open tabs in index order — for scripted multi-tab demonstrations/tests. */
  get openTabs(): Page[] {
    return [...this.tabs];
  }

  private async attachCapture(page: Page): Promise<void> {
    await page.addInitScript({ path: CAPTURE_PATH }).catch(() => {});
    // Attach to the already-loaded document too (covers Browserbase CDP + tabs already navigated).
    // Idempotent via window.__mimicCaptureAttached, so this never double-binds.
    await page.evaluate(CAPTURE_SOURCE).catch(() => {});
  }

  async start(url: string): Promise<{ liveViewUrl?: string }> {
    if (this.opened) throw new Error("already recording — stop first");
    this.startUrl = url;
    this.tabs = [];
    this.switchActions = [];
    this.opened = await openBrowser({ lane: "record", interactive: true });
    const page0 = this.opened.page;
    this.tabs.push(page0);

    // New tabs/popups → record a switchTab to the new tab + attach capture to it.
    page0.context().on("page", async (newPage) => {
      const idx = this.tabs.length;
      this.tabs.push(newPage);
      try {
        await newPage.waitForLoadState("domcontentloaded", { timeout: 8000 });
      } catch {
        /* still attach below — best effort */
      }
      await this.attachCapture(newPage);
      this.switchActions.push({
        type: "switchTab",
        timestamp: Date.now(),
        value: newPage.url(), // refined to the tab's FINAL url in stop() (page event fires pre-navigation)
        target: { selector: `tab:${idx}`, role: null, label: null, text: null, attributes: {}, domSnapshot: "" },
        tab: idx,
      });
    });

    // page0: addInitScript BEFORE goto (fires on the navigation), then evaluate after (CDP/idempotent).
    await page0.addInitScript({ path: CAPTURE_PATH });
    await page0.goto(url);
    await page0.evaluate(CAPTURE_SOURCE);
    return { liveViewUrl: this.opened.liveViewUrl };
  }

  async stop(task: string): Promise<RawTrace> {
    if (!this.opened) throw new Error("not recording");
    // Drain each tab's in-page action array, tagging with its tab index, then merge with the
    // switchTab markers and order everything by timestamp. Read BEFORE closing the browser.
    const captured: RawAction[] = [];
    for (let i = 0; i < this.tabs.length; i++) {
      let raw = "[]";
      try {
        raw = (await this.tabs[i].evaluate("JSON.stringify(window.__mimicActions || [])")) as string;
      } catch {
        /* tab closed/navigated — skip */
      }
      for (const a of JSON.parse(raw) as RawAction[]) {
        a.tab = i;
        captured.push(a);
      }
    }
    // The page event captured each new tab's URL before navigation settled — refine to the final url
    // so a switchTab can reopen the right page (e.g. .../linkedin.html, not the bare origin).
    for (const sa of this.switchActions) {
      const t = this.tabs[sa.tab ?? 0];
      if (t) {
        try {
          sa.value = t.url();
        } catch {
          /* tab gone — keep the earlier value */
        }
      }
    }
    const actions = [...captured, ...this.switchActions].sort((a, b) => a.timestamp - b.timestamp);
    const trace: RawTrace = { traceId: `trace_${Date.now()}`, task, startUrl: this.startUrl, actions };

    await this.opened.close();
    this.opened = null;
    this.tabs = [];
    this.switchActions = [];
    return trace;
  }
}
