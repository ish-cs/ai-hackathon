import type { RawTrace, Workflow, WorkflowStep } from "../shared/types";

// Multi-tab support WITHOUT touching brain/structure.ts. structure()'s LLM schema has no
// tab/switchTab, so we bracket it:
//   1) stripSwitchTabs(trace) → hand structure() a trace with switchTab actions removed, so it emits
//      one step per remaining action, in order.
//   2) applyTabs(workflow, trace) → walk the ORIGINAL action order, stamp each structured step's tab
//      from its source action, and re-insert switchTab steps where they occurred.
// If the structured steps don't line up 1:1 with the non-switchTab actions (LLM merged/dropped one),
// degrade SAFELY to single-tab (all tab 0) rather than mis-route. The original single-page demo and
// every saved single-tab workflow always take this safe path and are unchanged.

export function stripSwitchTabs(trace: RawTrace): RawTrace {
  return { ...trace, actions: trace.actions.filter((a) => a.type !== "switchTab") };
}

export function applyTabs(workflow: Workflow, trace: RawTrace): Workflow {
  const hasSwitch = trace.actions.some((a) => a.type === "switchTab");
  const nonSwitch = trace.actions.filter((a) => a.type !== "switchTab");

  // A multi-tab recording that doesn't align 1:1 with structure()'s steps would lose its tabs SILENTLY
  // and become a broken single-page workflow — warn loudly so it's caught, not shipped.
  if (hasSwitch && workflow.steps.length !== nonSwitch.length) {
    console.warn(
      `[multitab] structure() returned ${workflow.steps.length} steps for ${nonSwitch.length} non-switchTab ` +
        `actions — cannot align tabs; falling back to single-tab (switchTab dropped). Re-record more cleanly.`,
    );
  }
  // No tabs, or counts don't align → keep it single-tab (tab 0). Never mis-route.
  if (!hasSwitch || workflow.steps.length !== nonSwitch.length) {
    return { ...workflow, steps: workflow.steps.map((s) => ({ ...s, tab: s.tab ?? 0 })) };
  }

  const steps: WorkflowStep[] = [];
  let si = 0; // index into workflow.steps, aligned 1:1 with nonSwitch order
  for (const action of trace.actions) {
    if (action.type === "switchTab") {
      steps.push({
        stepId: "", // re-assigned below
        action: "switchTab",
        intent: `switch to tab ${action.tab ?? 0}`,
        selector: `tab:${action.tab ?? 0}`,
        fallbackHints: { role: null, label: null, text: null, nearText: null },
        valueFrom: null,
        valueLiteral: action.value, // destination tab's URL → player opens it if missing
        tab: action.tab ?? 0,
        healHistory: [],
      });
    } else {
      steps.push({ ...workflow.steps[si++], tab: action.tab ?? 0 });
    }
  }
  steps.forEach((s, i) => (s.stepId = `s${i + 1}`)); // keep stepIds contiguous after insertion
  return { ...workflow, steps };
}

// Demo "break the site" harness. Multi-tab → append ?break=1 to the switchTab destination (e.g. the
// LinkedIn page that renames Send) AND drop the opener click so the player opens the BROKEN page
// directly instead of adopting the un-broken click-popup. Single-tab → append ?break=1 to startUrl
// (the original demo). Returns a cloned, broken workflow; the healer must re-ground the renamed control.
export function breakForDemo(wf: Workflow): Workflow {
  const c = structuredClone(wf);
  const sw = c.steps.find((s) => s.action === "switchTab" && s.valueLiteral);
  if (sw && sw.valueLiteral) {
    sw.valueLiteral += (sw.valueLiteral.includes("?") ? "&" : "?") + "break=1";
    const i = c.steps.indexOf(sw);
    if (i > 0 && c.steps[i - 1].action === "click" && (c.steps[i - 1].tab ?? 0) === 0) c.steps.splice(i - 1, 1);
  } else {
    c.startUrl += (c.startUrl.includes("?") ? "&" : "?") + "break=1";
  }
  return c;
}

// Persist a heal onto the PRISTINE workflow, not the broken demo-harness copy that the run used
// (which has a dropped opener click and a ?break=1 switchTab URL). Carry over only the steps the
// healer actually re-grounded (matched by stepId); everything else stays pristine. Keeps the saved
// "latest" workflow and the memory trail clean and replayable.
export function mergeHeal(pristine: Workflow, healed: Workflow): Workflow {
  const next = structuredClone(pristine);
  for (const hs of healed.steps) {
    const ps = next.steps.find((s) => s.stepId === hs.stepId);
    if (ps && hs.healHistory.length > ps.healHistory.length) {
      ps.selector = hs.selector;
      ps.healHistory = hs.healHistory;
    }
  }
  next.version = healed.version;
  return next;
}
