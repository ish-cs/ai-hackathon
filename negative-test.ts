// ANTI-HALLUCINATION test for heal() — the case nobody was testing.
// When NO element on the page fulfills the step's intent, the healer MUST return
// healed:false, newSelector:null. It must REFUSE to guess. A confident wrong heal is
// worse than failing — it clicks the wrong thing (submits bad data, deletes a record).
// (ck's catch; CP2 owns it. heal() is in brain/, so this is Ishaan's.)
import { readFileSync } from "node:fs";
import { heal } from "./brain/heal";
import type { HealRequest, WorkflowStep } from "./shared/types";

for (const line of readFileSync(new URL("./.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

let pass = true;
const check = (n: string, ok: boolean, d = ""): void => {
  console.log(`  ${ok ? "✓" : "✗"} ${n}${d ? " — " + d : ""}`);
  if (!ok) pass = false;
};

// The original (now-broken) submit step — real intent, exactly as structure() would produce it.
const submitStep: WorkflowStep = {
  stepId: "s3",
  action: "submit",
  intent: "Click the primary button that submits/saves the customer form",
  selector: "#submit-btn",
  fallbackHints: { role: "button", label: null, text: "Submit", nearText: null },
  valueFrom: null,
  valueLiteral: null,
  healHistory: [],
};

// Case A: the submit button is simply GONE — no button or clickable control anywhere.
const domGone = `<form id="target">
  <label for="name">Customer Name</label><input id="name" name="name" type="text">
  <label for="email">Email</label><input id="email" name="email" type="email">
  <div class="saved" id="saved"></div>
</form>`;

// Case B: a DECOY button exists (Cancel), but nothing that submits — must NOT grab the wrong one.
const domDecoy = `<form id="target">
  <label for="name">Customer Name</label><input id="name" name="name" type="text">
  <label for="email">Email</label><input id="email" name="email" type="email">
  <button id="cancel-btn" type="button">Cancel</button>
  <a href="/help">Need help?</a>
  <div class="saved" id="saved"></div>
</form>`;

async function neg(label: string, dom: string): Promise<void> {
  const req: HealRequest = { workflowId: "wf_neg", step: submitStep, liveDom: dom };
  const r = await heal(req);
  console.log(`\n  [${label}] healed=${r.healed}  newSelector=${JSON.stringify(r.newSelector)}  confidence=${r.confidence}`);
  console.log(`           reasoning: ${r.reasoning}`);
  check(`${label}: refused to heal (healed === false)`, r.healed === false);
  check(`${label}: invented no selector (newSelector === null)`, r.newSelector === null);
}

(async () => {
  console.log("\n── NEGATIVE heal: nothing fulfills the intent → the healer must refuse ──");
  await neg("A: submit button is gone", domGone);
  await neg("B: only a Cancel decoy + a link", domDecoy);
  console.log(`\n══ ANTI-HALLUCINATION: ${pass ? "PASS ✅ — the healer refuses to guess" : "FAIL ❌ — it hallucinated; prompt needs hardening"} ══`);
  process.exit(pass ? 0 : 1);
})();
