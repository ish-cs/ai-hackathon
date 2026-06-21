// Gate 4: record the multi-tab LinkedIn-outreach workflow locally and confirm the trace carries a
// switchTab action + per-tab tagging, and that structure()+applyTabs builds a workflow with a
// switchTab step and tab-1 steps. Saves the workflow to Redis for the replay gates.
// Run: tsx --env-file=.env browserbase-record-v2-test.ts
import { Recorder } from "./runtime/recorder";
import { stripSwitchTabs, applyTabs } from "./runtime/multitab";
import { structure } from "./brain/structure";
import { saveWorkflow } from "./brain/store";

const BASE = "https://mock-public-ish-c.vercel.app";
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const rec = new Recorder();
await rec.start(`${BASE}/leadsheet.html`);
const sheet = rec.openTabs[0];

// tab 0: click the lead's "Message on LinkedIn ↗" link → opens LinkedIn in a new tab (target=_blank).
await sheet.click('tr[data-row="0"] .li-open');

// wait for the recorder to register the new tab AND attach capture to it
for (let i = 0; i < 80 && rec.openTabs.length < 2; i++) await sleep(100);
if (rec.openTabs.length < 2) throw new Error("LinkedIn tab never opened");
const li = rec.openTabs[1];
await li.waitForLoadState("domcontentloaded").catch(() => {});
for (let i = 0; i < 80; i++) {
  if (await li.evaluate("!!window.__mimicCaptureAttached").catch(() => false)) break;
  await sleep(100);
}

// tab 1: search → open profile → Message → compose → Send
await li.fill("#li-search", "Sarah Chen");
await li.click("#li-result");
await li.click("#li-message-btn");
await li.fill("#li-compose", "Hi Sarah Chen, saw you're VP Engineering at Acme — would love to connect.");
await li.click("#li-send");
await sleep(500);

const trace = await rec.stop("message leads on linkedin");
const switchN = trace.actions.filter((a) => a.type === "switchTab").length;
const tabsSeen = [...new Set(trace.actions.map((a) => a.tab ?? 0))].sort();
console.log(`trace: ${trace.actions.length} actions, switchTab=${switchN}, tabs=${JSON.stringify(tabsSeen)}`);
for (const a of trace.actions) {
  console.log(`  [tab ${a.tab ?? 0}] ${a.type} ${a.target.selector}${a.value ? ` = "${String(a.value).slice(0, 36)}"` : ""}`);
}

const wf = applyTabs(await structure(stripSwitchTabs(trace)), trace);
await saveWorkflow(wf);
const wfSwitch = wf.steps.filter((s) => s.action === "switchTab").length;
console.log(`\nworkflow ${wf.workflowId}: ${wf.steps.length} steps, params=[${wf.parameters.map((p) => p.name).join(", ")}], switchTab steps=${wfSwitch}`);
for (const s of wf.steps) {
  const v = s.valueFrom ? `<${s.valueFrom}>` : s.valueLiteral ? `"${String(s.valueLiteral).slice(0, 28)}"` : "";
  console.log(`  ${s.stepId} [tab ${s.tab ?? 0}] ${s.action} ${s.selector} ${v}`);
}

const pass = switchN >= 1 && tabsSeen.includes(0) && tabsSeen.includes(1) && wfSwitch >= 1 && wf.steps.some((s) => (s.tab ?? 0) === 1);
console.log(pass
  ? "\nGATE 4 ✅  trace has switchTab + per-tab tagging; workflow built with switchTab step + tab-1 steps."
  : "\nGATE 4 ❌  inspect above.");
console.log(`WORKFLOW_ID=${wf.workflowId}`);
process.exit(pass ? 0 : 1);
