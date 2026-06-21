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
 * Records a user's demonstration inside a controlled browser — a local Chromium window
 * (ENGINE=local) or a Browserbase cloud session viewed through the UI's read/write iframe
 * (ENGINE=browserbase). The engine choice lives entirely in runtime/browser.ts.
 * Injects a DOM event listener (capture phase) that posts each action back via an exposed binding.
 * TODO(hands): tighten selector generation + domSnapshot trimming against real pages.
 */
export class Recorder {
  private opened: OpenedBrowser | null = null;
  private page: Page | null = null;
  private actions: RawAction[] = [];
  private startUrl = "";

  get recording(): boolean {
    return this.opened !== null;
  }

  /** Test/dev hook: the live page, for scripted demonstrations (e.g. capture-trace.ts). */
  get livePage(): Page | null {
    return this.page;
  }

  /**
   * Opens the record browser, wires capture, navigates. Returns the Browserbase live-view URL when
   * ENGINE=browserbase (so the UI can embed the read/write iframe to teach in); undefined locally.
   */
  async start(url: string): Promise<{ liveViewUrl?: string }> {
    if (this.opened) throw new Error("already recording — stop first");
    this.startUrl = url;
    this.actions = [];
    this.opened = await openBrowser({ lane: "record", interactive: true });
    this.page = this.opened.page;

    // Capture logic is injected from a PLAIN JS file, not an inline function. tsx/esbuild
    // compiles inline addInitScript callbacks with keepNames, wrapping inner arrows in a
    // module-scoped __name() helper; Playwright serializes only the function, so __name is
    // undefined in the page and the script throws before attaching listeners. A .js file is
    // shipped verbatim, so it stays clean. See runtime/recorder-capture.js.
    await this.page.addInitScript({ path: CAPTURE_PATH }); // local: fires on the goto below

    await this.page.goto(url);
    // Over Browserbase CDP the pre-existing page's navigation skips init scripts, so also inject the
    // capture script into the now-loaded document. Idempotent (window.__mimicCaptureAttached), so
    // local mode (where addInitScript already ran) never double-binds.
    await this.page.evaluate(CAPTURE_SOURCE);
    return { liveViewUrl: this.opened.liveViewUrl };
  }

  async stop(task: string): Promise<RawTrace> {
    if (!this.opened) throw new Error("not recording");
    // Pull captured actions out of the in-page array (engine-agnostic; works over Browserbase CDP,
    // where exposeBinding is unreliable). Read BEFORE closing the browser.
    const raw = this.page ? ((await this.page.evaluate("JSON.stringify(window.__mimicActions || [])")) as string) : "[]";
    this.actions = JSON.parse(raw) as RawAction[];
    const trace: RawTrace = {
      traceId: `trace_${Date.now()}`,
      task,
      startUrl: this.startUrl,
      actions: this.actions,
    };
    await this.opened.close();
    this.opened = null;
    this.page = null;
    return trace;
  }
}
