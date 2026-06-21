import { type Page } from "playwright";
import type { DataRow, RunEvent, StepResult, Workflow, WorkflowStep, HealResult } from "../shared/types";
import { openBrowser, liveViewForTab, type OpenedBrowser } from "./browser";
import { heal } from "../brain/heal";
import { captureFailure } from "./sentry";

const STEP_TIMEOUT = 3000;
const MAX_HEAL_ATTEMPTS = 2;

// ── Demo presentation: two labeled, side-by-side lanes that LINGER on a colored verdict ──
// control → LEFT, healing → RIGHT. Local mode → two OS windows; Browserbase mode → two live-view
// iframes inside the web UI (the same page-side banners/borders render INSIDE them). Lanes stay
// open after a run so the audience SEES one fail (red) and one succeed (green); the next
// /api/replay reaps the previous run's browsers/sessions via closeLiveBrowsers(). The local window
// geometry now lives in browser.ts (the engine seam).
const liveBrowsers = new Set<OpenedBrowser>();

export async function closeLiveBrowsers(): Promise<void> {
  for (const b of liveBrowsers) {
    try { await b.close(); } catch { /* already closed (window OR cloud session) */ }
    liveBrowsers.delete(b);
  }
}

/** Banner across the top of each window so it's unmistakably the normal vs the self-healing agent. */
export async function injectLaneLabel(page: Page, lane: "control" | "healing"): Promise<void> {
  const healing = lane === "healing";
  await page
    .evaluate((h: boolean) => {
      const d: any = (globalThis as any).document;
      d.getElementById("__mimic_label")?.remove();
      const bar = d.createElement("div");
      bar.id = "__mimic_label";
      bar.textContent = h ? "🟢  MIMIC — self-healing agent" : "⚪  NORMAL AGENT — no healing";
      Object.assign(bar.style, {
        position: "fixed", top: "0", left: "0", right: "0", zIndex: "2147483647",
        padding: "12px", textAlign: "center", color: "#fff", letterSpacing: ".04em",
        font: "700 16px ui-sans-serif,system-ui,sans-serif",
        background: h ? "#1f8a4c" : "#5b6470",
      });
      d.documentElement.appendChild(bar);
      if (d.body) d.body.style.paddingTop = "48px";
    }, healing)
    .catch(() => { /* best-effort — never fail the run over a banner */ });
}

/** Paint a green (succeeded) or red (failed) frame + verdict chip; left on screen for the demo. */
export async function markLaneResult(page: Page, ok: boolean): Promise<void> {
  await page
    .evaluate((success: boolean) => {
      const d: any = (globalThis as any).document;
      const color = success ? "#1fd65f" : "#ff3b3b";
      const frame = d.createElement("div");
      Object.assign(frame.style, {
        position: "fixed", inset: "0", zIndex: "2147483646", pointerEvents: "none",
        border: "12px solid " + color, boxSizing: "border-box",
      });
      d.documentElement.appendChild(frame);
      const chip = d.createElement("div");
      chip.textContent = success ? "✓ SUCCEEDED" : "✗ FAILED";
      Object.assign(chip.style, {
        position: "fixed", bottom: "20px", left: "50%", transform: "translateX(-50%)",
        zIndex: "2147483647", padding: "10px 24px", borderRadius: "999px", color: "#fff",
        font: "800 20px ui-sans-serif,system-ui,sans-serif", background: color,
        boxShadow: "0 6px 20px rgba(0,0,0,.35)",
      });
      d.documentElement.appendChild(chip);
    }, ok)
    .catch(() => { /* best-effort */ });
}

export interface ReplayOpts {
  /** false = the "dead" control agent (no re-grounding). true = our self-healing agent. */
  heal: boolean;
  lane: "healing" | "control";
  emit: (e: RunEvent) => void;
  /** Called after a successful heal so the caller can bump version + persist to Redis. */
  onHeal?: (wf: Workflow) => Promise<void>;
}

function valueFor(step: WorkflowStep, row: DataRow): string | null {
  if (step.valueFrom) return row[step.valueFrom] ?? null;
  return step.valueLiteral;
}

async function execute(page: Page, step: WorkflowStep, selector: string, value: string | null): Promise<void> {
  switch (step.action) {
    case "input":
      await page.fill(selector, value ?? "", { timeout: STEP_TIMEOUT });
      break;
    case "select":
      await page.selectOption(selector, value ?? "", { timeout: STEP_TIMEOUT });
      break;
    case "click":
    case "submit":
      await page.click(selector, { timeout: STEP_TIMEOUT });
      break;
    case "navigate":
      await page.goto(value ?? step.selector, { timeout: STEP_TIMEOUT * 3 });
      break;
  }
}

/** Best-effort current DOM for the healer — prefer the form subtree, cap size. */
async function liveDom(page: Page): Promise<string> {
  try {
    const form = await page.locator("form").first().evaluate((el) => el.outerHTML);
    if (form) return form.slice(0, 8000);
  } catch {
    /* no form — fall through */
  }
  try {
    return (await page.content()).slice(0, 8000);
  } catch {
    return ""; // never throw from liveDom — the caller is already handling a step failure
  }
}

export async function replay(wf: Workflow, row: DataRow, opts: ReplayOpts): Promise<boolean> {
  opts.emit({ kind: "run_start", lane: opts.lane, workflowId: wf.workflowId, row });
  const opened = await openBrowser({ lane: opts.lane });
  liveBrowsers.add(opened); // reaped on the next run by closeLiveBrowsers() — local window OR cloud session
  const context = opened.page.context();

  // Multi-tab: route each step to its tab, opening tabs on demand. tab 0 = the initial page, so a
  // single-tab workflow (the original demo) runs exactly as before — every step routes to page 0.
  const pages = new Map<number, Page>([[0, opened.page]]);
  const tabUrls = new Map<number, string>([[0, wf.startUrl]]);
  let active: Page = opened.page;
  let ok = true;

  // Emit the active tab's live-view so the UI iframe follows it (Browserbase only; local → no-op).
  const followTab = async (tabIndex: number): Promise<void> => {
    // tab 0's live-view was already fetched at open — reuse it to skip a redundant debug() round-trip.
    const url = tabIndex === 0 && opened.liveViewUrl ? opened.liveViewUrl : await liveViewForTab(opened, tabIndex);
    if (url) opts.emit({ kind: "liveview", lane: opts.lane, url });
  };
  // Make a tab active: bring to front + follow it in the UI.
  const focusTab = async (tabIndex: number, page: Page): Promise<void> => {
    active = page;
    await page.bringToFront().catch(() => {});
    await followTab(tabIndex);
  };
  // Open a tab (newPage + goto + label) if not open yet; return its page.
  const ensureTab = async (tabIndex: number, url: string | null): Promise<Page> => {
    const existing = pages.get(tabIndex);
    if (existing) return existing;
    // Adopt a tab a click already opened (target=_blank) so we don't open a duplicate; else open by URL.
    const mapped = new Set(pages.values());
    let orphan = context.pages().find((pg) => !mapped.has(pg));
    if (!orphan) {
      // a click may still be opening it — wait briefly for the popup before opening one ourselves
      try {
        orphan = await context.waitForEvent("page", { timeout: 1000 });
      } catch {
        /* no popup — open by URL below */
      }
    }
    if (orphan) {
      pages.set(tabIndex, orphan);
      tabUrls.set(tabIndex, url ?? orphan.url());
      try {
        await orphan.waitForLoadState("domcontentloaded", { timeout: STEP_TIMEOUT * 2 });
      } catch {
        /* best effort */
      }
      await injectLaneLabel(orphan, opts.lane);
      return orphan;
    }
    const target = url ?? tabUrls.get(tabIndex) ?? wf.startUrl;
    const p = await context.newPage();
    pages.set(tabIndex, p);
    tabUrls.set(tabIndex, target);
    await p.goto(target, { timeout: STEP_TIMEOUT * 3 });
    await injectLaneLabel(p, opts.lane);
    return p;
  };

  try {
    await opened.page.goto(wf.startUrl, { timeout: STEP_TIMEOUT * 3 });
    await injectLaneLabel(opened.page, opts.lane); // label the window the moment it loads
    await followTab(0); // initial live-view (Browserbase)

    for (const step of wf.steps) {
      const tab = step.tab ?? 0;
      const started = Date.now();

      // switchTab: bring the destination tab to front (opening it by URL if needed). No element to heal.
      if (step.action === "switchTab") {
        try {
          const p = await ensureTab(tab, step.valueLiteral);
          await focusTab(tab, p);
          opts.emit({
            kind: "step",
            lane: opts.lane,
            result: stepResult(wf, step, "ok", step.selector || `tab:${tab}`, null, null, Date.now() - started),
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          opts.emit({
            kind: "step",
            lane: opts.lane,
            result: stepResult(wf, step, "failed", `tab:${tab}`, error, null, Date.now() - started),
          });
          captureFailure("switchTab failed", { workflowId: wf.workflowId, stepId: step.stepId, error });
          ok = false;
          break;
        }
        continue;
      }

      // Normal step → route to its tab (opened by a prior switchTab; fall back to the active tab).
      const page = pages.get(tab) ?? active;
      if (page !== active) await focusTab(tab, page);

      const value = valueFor(step, row);
      try {
        await execute(page, step, step.selector, value);
        opts.emit({
          kind: "step",
          lane: opts.lane,
          result: stepResult(wf, step, "ok", step.selector, null, null, Date.now() - started),
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        const dom = await liveDom(page);

        // Both lanes surface the miss the same way — the dead selector, which the UI strikes
        // through. step.selector is still the original broken selector here; tryHeal only mutates
        // it on a verified heal. Emitting this for the healing lane too is what feeds the heal
        // card's old→new story (the strike-through line).
        opts.emit({
          kind: "step",
          lane: opts.lane,
          result: stepResult(wf, step, "failed", step.selector, error, dom, Date.now() - started),
        });

        // Control lane: no healing — it dies here, exactly like a normal browser agent.
        if (!opts.heal) {
          captureFailure("step failed (control, no heal)", { workflowId: wf.workflowId, stepId: step.stepId, error });
          ok = false;
          break;
        }

        // Healing lane: re-ground by intent on the ACTIVE tab, retry, verify — bounded attempts.
        const recovered = await tryHeal(page, wf, step, value, opts);
        if (!recovered) {
          captureFailure("step failed (heal exhausted)", { workflowId: wf.workflowId, stepId: step.stepId, error });
          ok = false;
          break;
        }
        opts.emit({
          kind: "step",
          lane: opts.lane,
          result: stepResult(wf, step, "healed", step.selector, null, null, Date.now() - started),
        });
      }
    }
  } catch (err) {
    ok = false; // unexpected error (e.g. the initial navigation) → failure for the visual verdict
    const error = err instanceof Error ? err.message : String(err);
    captureFailure("replay crashed before verdict", { workflowId: wf.workflowId, lane: opts.lane, error });
  }

  // Verdict on the tab the run ended on; lanes linger (no close) so the audience sees red vs green.
  await markLaneResult(active, ok);

  opts.emit({ kind: "run_done", lane: opts.lane, workflowId: wf.workflowId, ok });
  return ok;
}

/** Heal → retry → verify, up to MAX_HEAL_ATTEMPTS. Mutates step + writes back on success. */
async function tryHeal(
  page: Page,
  wf: Workflow,
  step: WorkflowStep,
  value: string | null,
  opts: ReplayOpts,
): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_HEAL_ATTEMPTS; attempt++) {
    const dom = await liveDom(page);
    const result: HealResult = await heal({ workflowId: wf.workflowId, step, liveDom: dom });
    opts.emit({ kind: "heal", lane: opts.lane, result });

    if (!result.healed || !result.newSelector) continue;

    try {
      await execute(page, step, result.newSelector, value); // retry with re-grounded selector
    } catch {
      continue; // selector still wrong — heal again
    }

    // Verified: the action succeeded. Write the fix back into the workflow.
    step.healHistory.push({
      healed: true,
      oldSelector: step.selector,
      newSelector: result.newSelector,
      reasoning: result.reasoning,
      confidence: result.confidence,
      timestamp: result.timestamp,
    });
    step.selector = result.newSelector;
    if (opts.onHeal) await opts.onHeal(wf);
    return true;
  }
  return false;
}

function stepResult(
  wf: Workflow,
  step: WorkflowStep,
  status: StepResult["status"],
  attemptedSelector: string,
  error: string | null,
  dom: string | null,
  tookMs: number,
): StepResult {
  return {
    workflowId: wf.workflowId,
    stepId: step.stepId,
    status,
    attemptedSelector,
    error,
    liveDom: dom,
    screenshotUrl: null,
    tookMs,
  };
}
