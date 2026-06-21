// The break harness for the Cost Race — simulate a site redesign on a page we don't own.
//
// We can't rename a real site's button on their server, but our Browserbase/Playwright browser owns the
// page in our tab, so we mutate its live DOM on cue: rename the heal-target element so the recorded
// selector misses. Mimic then re-grounds it by intent (a REAL heal against the actual mutated DOM);
// Stagehand, which never cached a selector, just re-reasons at full token cost. Same role as the old
// `?break=1` flag, but applied to a live real page. Honest framing on stage: "sites redesign constantly —
// here's that change simulated."
import type { Page } from "playwright";

export interface BreakSpec {
  /** CSS selector of the element the recorded workflow targets (the heal target). */
  selector: string;
  /** New id to stamp on it (so an `#id` selector misses). Optional. */
  newId?: string;
  /** New visible text (so a text/label-based selector misses). Optional. */
  newText?: string;
}

export interface BreakResult {
  ok: boolean;
  /** What actually changed, for logging / the on-stage caption. */
  detail: string;
}

/**
 * Mutate the live DOM to break one element's recorded selector. Runs in the page via evaluate, so it
 * works on any real site loaded in our controlled browser. Returns ok:false (never throws) if the
 * target isn't present — the caller logs it and the round proceeds (a missing target just means no
 * break this round, not a crash).
 */
export async function breakElement(page: Page, spec: BreakSpec): Promise<BreakResult> {
  try {
    const detail = await page.evaluate(
      ({ selector, newId, newText }) => {
        const el = document.querySelector(selector) as HTMLElement | null;
        if (!el) return `MISS: no element matched ${selector}`;
        const was = { id: el.id, text: (el.textContent ?? "").trim().slice(0, 40) };
        if (newId) el.id = newId;
        if (newText) el.textContent = newText;
        return `renamed ${selector} (id "${was.id}"→"${newId ?? was.id}", text "${was.text}"→"${newText ?? was.text}")`;
      },
      spec,
    );
    return { ok: !detail.startsWith("MISS"), detail };
  } catch (e) {
    return { ok: false, detail: `break failed: ${(e as Error).message}` };
  }
}
