import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import type { RawAction, RawTrace } from "../shared/types";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Records a user's demonstration inside a controlled local Chromium window.
 * Injects a DOM event listener (capture phase) that posts each action back via an exposed binding.
 * TODO(hands): tighten selector generation + domSnapshot trimming against real pages.
 */
export class Recorder {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private actions: RawAction[] = [];
  private startUrl = "";

  get recording(): boolean {
    return this.browser !== null;
  }

  /** Test/dev hook: the live page, for scripted demonstrations (e.g. capture-trace.ts). */
  get livePage(): Page | null {
    return this.page;
  }

  async start(url: string): Promise<void> {
    // Self-heal: a previous session may still be around if its window was closed
    // manually or a stop() failed. Tear it down instead of refusing forever — otherwise
    // the recorder gets wedged in "already recording" and every Record click 500s.
    if (this.browser) await this.reset();
    this.startUrl = url;
    this.actions = [];
    this.browser = await chromium.launch({ headless: false });
    this.page = await this.browser.newPage();

    await this.page.exposeBinding("__record", (_src, action: RawAction) => {
      this.actions.push(action);
    });

    // Capture logic is injected from a PLAIN JS file, not an inline function. tsx/esbuild
    // compiles inline addInitScript callbacks with keepNames, wrapping inner arrows in a
    // module-scoped __name() helper; Playwright serializes only the function, so __name is
    // undefined in the page and the script throws before attaching listeners. A .js file is
    // shipped verbatim, so it stays clean. See runtime/recorder-capture.js.
    await this.page.addInitScript({ path: join(__dirname, "recorder-capture.js") });

    await this.page.goto(url);
  }

  async stop(task: string): Promise<RawTrace> {
    if (!this.browser) throw new Error("not recording");
    const trace: RawTrace = {
      traceId: `trace_${Date.now()}`,
      task,
      startUrl: this.startUrl,
      actions: this.actions,
    };
    await this.reset();
    return trace;
  }

  /**
   * Tear down the current session. Clears state synchronously first so a wedged
   * browser can never block the next start(), then closes best-effort with a 3s
   * cap — closing a window the user already X'd out can otherwise hang forever.
   */
  private async reset(): Promise<void> {
    const browser = this.browser;
    this.browser = null;
    this.page = null;
    if (!browser) return;
    try {
      await Promise.race([
        browser.close(),
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);
    } catch {
      /* browser already gone — nothing to close */
    }
  }
}
