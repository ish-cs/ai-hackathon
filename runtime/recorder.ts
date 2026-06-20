import { chromium, type Browser, type Page } from "playwright";
import type { RawAction, RawTrace } from "../shared/types";

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

  async start(url: string): Promise<void> {
    if (this.browser) throw new Error("already recording — stop first");
    this.startUrl = url;
    this.actions = [];
    this.browser = await chromium.launch({ headless: false });
    this.page = await this.browser.newPage();

    await this.page.exposeBinding("__record", (_src, action: RawAction) => {
      this.actions.push(action);
    });

    await this.page.addInitScript(() => {
      const post = (a: unknown) => (window as unknown as { __record: (a: unknown) => void }).__record(a);

      const selectorFor = (el: Element): string => {
        if (el.id) return `#${CSS.escape(el.id)}`;
        const name = el.getAttribute("name");
        if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`;
        const parent = el.parentElement;
        if (!parent) return el.tagName.toLowerCase();
        const tag = el.tagName.toLowerCase();
        const sameTag = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
        const idx = sameTag.indexOf(el) + 1;
        return `${selectorFor(parent)} > ${tag}:nth-of-type(${idx})`;
      };

      const contextFor = (el: HTMLElement) => {
        const tag = el.tagName.toLowerCase();
        const role =
          el.getAttribute("role") ||
          (tag === "button" ? "button" : tag === "input" || tag === "textarea" ? "textbox" : null);
        const label =
          (el as HTMLInputElement).labels?.[0]?.innerText?.trim() ||
          el.getAttribute("aria-label") ||
          el.getAttribute("placeholder") ||
          null;
        const text = (el.innerText || "").trim().slice(0, 80) || null;
        const attrs: Record<string, string> = {};
        for (const a of ["id", "name", "type", "role"]) {
          const v = el.getAttribute(a);
          if (v) attrs[a] = v;
        }
        const scope = el.closest("form") || el.parentElement || el;
        return {
          selector: selectorFor(el),
          role,
          label,
          text,
          attributes: attrs,
          domSnapshot: (scope as HTMLElement).outerHTML.slice(0, 2000),
        };
      };

      document.addEventListener(
        "change",
        (e) => {
          const el = e.target as HTMLElement;
          const isField =
            el instanceof HTMLInputElement ||
            el instanceof HTMLSelectElement ||
            el instanceof HTMLTextAreaElement;
          if (!isField) return;
          post({
            type: el instanceof HTMLSelectElement ? "select" : "input",
            timestamp: Date.now(),
            value: (el as HTMLInputElement).value ?? null,
            target: contextFor(el),
          });
        },
        true,
      );

      document.addEventListener(
        "click",
        (e) => {
          const el = (e.target as HTMLElement)?.closest(
            "button, a, [role=button], input[type=submit]",
          ) as HTMLElement | null;
          if (!el) return;
          const isSubmit =
            (el as HTMLButtonElement).type === "submit" || el.getAttribute("type") === "submit";
          post({
            type: isSubmit ? "submit" : "click",
            timestamp: Date.now(),
            value: null,
            target: contextFor(el),
          });
        },
        true,
      );
    });

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
    await this.browser.close();
    this.browser = null;
    this.page = null;
    return trace;
  }
}
