// Gate 4 de-risk: does the recorder's in-page capture work over Browserbase CDP? Starts a record
// session on the cloud, simulates a demonstration by driving the cloud page (same DOM events a human
// makes in the live-view iframe), stops, and confirms actions were captured + structured into a
// workflow. Proves the capture pipeline; the only thing left for the human is clicking in the iframe.
// Run: tsx --env-file=.env browserbase-record-test.ts
import { Recorder } from "./runtime/recorder";
import { structure } from "./brain/structure";

if (process.env.ENGINE !== "browserbase") throw new Error(`ENGINE=${process.env.ENGINE} (need browserbase)`);
const MOCK_URL = process.env.MOCK_URL;
if (!MOCK_URL) throw new Error("MOCK_URL unset");

const rec = new Recorder();
const { liveViewUrl } = await rec.start(MOCK_URL);
console.log(`record session started — liveView: ${liveViewUrl?.slice(0, 60)}…`);

const page = rec.livePage;
if (!page) throw new Error("no live page");

// Simulate the human demonstration inside the cloud browser (real DOM events → capture listeners fire).
await page.fill("#name", "Initech LLC");
await page.fill("#email", "ap@initech.com");
await page.click("#submit-btn");
await page.waitForTimeout(600); // let the capture binding flush

const trace = await rec.stop("copy customer into form");
console.log(`actions captured: ${trace.actions.length}`);
for (const a of trace.actions) console.log(`  - ${a.type} ${a.target.selector} ${a.value ? `= "${a.value}"` : ""}`);

const wf = await structure(trace);
console.log(`\nstructured → ${wf.workflowId}  ${wf.steps.length} steps, ${wf.parameters.length} params`);
console.log(trace.actions.length >= 3 && wf.steps.length >= 3
  ? "\nGATE 4 PIPELINE ✅  capture works over Browserbase CDP → trace → workflow. Live teach is viable."
  : "\nGATE 4 ⚠️  capture thin — inspect actions above.");
process.exit(0);
