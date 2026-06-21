// Pure unit test (no network): after a broken multi-tab run heals, mergeHeal must persist the PRISTINE
// structure (opener kept, switchTab URL clean) with only the healed selector carried over.
// Run: tsx multitab-test.ts
import { breakForDemo, mergeHeal } from "./runtime/multitab";
import type { Workflow } from "./shared/types";

const hints = { role: null, label: null, text: null, nearText: null };
const pristine: Workflow = {
  workflowId: "wf_test",
  task: "t",
  version: 1,
  startUrl: "https://x/leadsheet.html",
  parameters: [],
  steps: [
    { stepId: "s1", action: "click", intent: "open linkedin", selector: ".li-open", fallbackHints: hints, valueFrom: null, valueLiteral: null, tab: 0, healHistory: [] },
    { stepId: "s2", action: "switchTab", intent: "switch", selector: "tab:1", fallbackHints: hints, valueFrom: null, valueLiteral: "https://x/linkedin.html", tab: 1, healHistory: [] },
    { stepId: "s3", action: "submit", intent: "send the message", selector: "#li-send", fallbackHints: hints, valueFrom: null, valueLiteral: null, tab: 1, healHistory: [] },
  ],
};

// Simulate a real run: break it (drops s1 opener + ?break=1 on s2 url), then heal the Send step.
const healed = breakForDemo(pristine);
healed.version = 2;
const send = healed.steps.find((s) => s.stepId === "s3");
if (!send) throw new Error("send step missing after breakForDemo");
send.selector = "#li-submit"; // healer re-grounded
send.healHistory.push({ healed: true, oldSelector: "#li-send", newSelector: "#li-submit", reasoning: "r", confidence: 0.9, timestamp: 0 });

const next = mergeHeal(pristine, healed);
const sw = next.steps.find((s) => s.action === "switchTab");
const out = next.steps.find((s) => s.stepId === "s3");
const checks = {
  openerKept: next.steps.some((s) => s.stepId === "s1"),
  switchUrlClean: !!sw && !sw.valueLiteral.includes("break=1"),
  startUrlClean: !next.startUrl.includes("break=1"),
  sendSelectorHealed: out?.selector === "#li-submit",
  healTrailCarried: (out?.healHistory.length ?? 0) === 1,
  versionBumped: next.version === 2,
  stepCount: next.steps.length === 3,
};
console.log(JSON.stringify(checks));
const pass = Object.values(checks).every(Boolean);
console.log(pass ? "MERGEHEAL ✅ saved workflow = pristine structure + healed selector (no harness leakage)" : "MERGEHEAL ❌ inspect above");
process.exit(pass ? 0 : 1);
