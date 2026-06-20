// Brain validation — runs the REAL AI (needs ANTHROPIC_API_KEY in .env). No Redis needed.
// Phase 1: structure() turns the sample trace into a parameterized workflow.
// Phase 2: heal() re-grounds the renamed submit button.
// Phase 3: prove the healed selector actually matches+clicks the button in the broken DOM (Playwright).
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { structure } from "./brain/structure";
import { heal } from "./brain/heal";
import type { RawTrace, Workflow, HealRequest } from "./shared/types";

// Load .env before any brain call (client() is lazy, so the key is read on first call).
for (const line of readFileSync(new URL("./.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

let pass = true;
const check = (name: string, ok: boolean, detail = ""): void => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) pass = false;
};

const trace: RawTrace = JSON.parse(
  readFileSync(new URL("./shared/fixtures/sample-trace.json", import.meta.url), "utf8"),
);

console.log("\n── Phase 1: structure() — trace → workflow (REAL Claude call) ──");
let wf: Workflow;
try {
  wf = await structure(trace);
} catch (e) {
  console.log("  ✗ structure() threw:", (e as Error).message);
  process.exit(1);
}
console.log(JSON.stringify(wf, null, 2));
check("2 parameters detected (name + email are variable)", wf.parameters.length === 2, `${wf.parameters.length}`);
check("3 steps", wf.steps.length === 3, `${wf.steps.length}`);
check("both input steps are variable (valueFrom set)", wf.steps.filter((s) => s.action === "input").length === 2 && wf.steps.filter((s) => s.action === "input").every((s) => !!s.valueFrom));
const submit = wf.steps.find((s) => s.action === "submit");
check("submit step is fixed (valueFrom null)", !!submit && submit.valueFrom === null);
check("every step has a non-empty intent", wf.steps.every((s) => s.intent.trim().length > 0));
check("no intent leaks a selector/id (#)", wf.steps.every((s) => !s.intent.includes("#")));
const traceSelectors = trace.actions.map((a) => a.target.selector);
check(
  "selectors preserved verbatim from trace (so the demo break can actually break them)",
  wf.steps.every((s, i) => s.selector === traceSelectors[i]),
  `got [${wf.steps.map((s) => s.selector).join(", ")}]`,
);

console.log("\n── Phase 2: heal() — renamed submit button #submit-btn→#send-btn, Submit→Send (REAL Claude call) ──");
const brokenForm = `<form id="target">
  <label for="name">Customer Name</label><input id="name" name="name" type="text" value="Globex">
  <label for="email">Email</label><input id="email" name="email" type="email" value="ap@globex.com">
  <button id="send-btn" type="submit">Send</button>
  <div class="saved" id="saved"></div>
</form>`;
const failedStep = submit ?? wf.steps[wf.steps.length - 1];
const req: HealRequest = { workflowId: wf.workflowId, step: { ...failedStep, selector: "#submit-btn" }, liveDom: brokenForm };
let healRes;
try {
  healRes = await heal(req);
} catch (e) {
  console.log("  ✗ heal() threw:", (e as Error).message);
  process.exit(1);
}
console.log(JSON.stringify(healRes, null, 2));
const sel = healRes.newSelector ?? "";
check("healed = true", healRes.healed === true);
check("newSelector present", !!healRes.newSelector);
check("selector is standard CSS (no xpath/:has-text/text=)", !!sel && !/xpath=|:has-text|:contains|^text=|>>/.test(sel), sel);
check("confidence >= 0.5", healRes.confidence >= 0.5, `${healRes.confidence}`);

console.log("\n── Phase 3: prove the healed selector really matches+clicks the button (Playwright) ──");
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent(brokenForm);
  let count = -1;
  let clickable = false;
  try {
    count = await page.locator(sel).count();
    if (count === 1) {
      await page.locator(sel).click({ timeout: 2000 });
      clickable = true;
    }
  } catch (e) {
    console.log("  selector error:", (e as Error).message.split("\n")[0]);
  }
  check("selector matches exactly ONE element", count === 1, `matched ${count}`);
  check("Playwright can click it (heal really works end-to-end)", clickable);
} finally {
  await browser.close();
}

console.log(`\n══ BRAIN VALIDATION: ${pass ? "PASS ✅" : "FAIL ❌"} ══`);
console.log("   structure() + heal() ran for real against Claude; the healed selector was proven on a live page.");
process.exit(pass ? 0 : 1);
