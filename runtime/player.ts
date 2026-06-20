import { chromium, type Page } from "playwright";
import type { DataRow, RunEvent, StepResult, Workflow, WorkflowStep, HealResult } from "../shared/types";
import { heal } from "../brain/heal";
import { captureFailure } from "./sentry";

const STEP_TIMEOUT = 3000;
const MAX_HEAL_ATTEMPTS = 2;

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
  return (await page.content()).slice(0, 8000);
}

export async function replay(wf: Workflow, row: DataRow, opts: ReplayOpts): Promise<boolean> {
  opts.emit({ kind: "run_start", lane: opts.lane, workflowId: wf.workflowId, row });
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  let ok = true;

  try {
    await page.goto(wf.startUrl, { timeout: STEP_TIMEOUT * 3 });

    for (const step of wf.steps) {
      const value = valueFor(step, row);
      const started = Date.now();
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

        // Control lane: no healing — it dies here, exactly like a normal browser agent.
        if (!opts.heal) {
          opts.emit({
            kind: "step",
            lane: opts.lane,
            result: stepResult(wf, step, "failed", step.selector, error, dom, Date.now() - started),
          });
          captureFailure("step failed (control, no heal)", { workflowId: wf.workflowId, stepId: step.stepId, error });
          ok = false;
          break;
        }

        // Healing lane: re-ground by intent, retry, verify — bounded attempts.
        const recovered = await tryHeal(page, wf, step, value, opts);
        if (!recovered) {
          opts.emit({
            kind: "step",
            lane: opts.lane,
            result: stepResult(wf, step, "failed", step.selector, error, dom, Date.now() - started),
          });
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
  } finally {
    await browser.close();
  }

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
