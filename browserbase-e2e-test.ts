// Full shipped loop, one shot: TEACH locally (capture works) → structure → save to Redis → REPLAY
// both lanes on Browserbase (control dies, healing self-repairs). Proves the demo end-to-end.
// Run: tsx --env-file=.env browserbase-e2e-test.ts
import { Recorder } from "./runtime/recorder";
import { structure } from "./brain/structure";
import { saveWorkflow } from "./brain/store";
import { replay, closeLiveBrowsers } from "./runtime/player";
import type { DataRow, RunEvent } from "./shared/types";

const MOCK_URL = process.env.MOCK_URL;
if (!MOCK_URL) throw new Error("MOCK_URL unset");
if (process.env.ENGINE !== "browserbase") throw new Error(`ENGINE=${process.env.ENGINE} (need browserbase)`);

// 1) TEACH — record lane auto-forces local; demonstrate the task programmatically in the local window.
const rec = new Recorder();
await rec.start(MOCK_URL);
const page = rec.livePage;
if (!page) throw new Error("no live page");
await page.fill("#name", "Umbrella Corp");
await page.fill("#email", "ap@umbrella.com");
await page.click("#submit-btn");
await page.waitForTimeout(600);
const trace = await rec.stop("copy customer into form");
console.log(`1) taught locally: ${trace.actions.length} actions captured`);

// 2) STRUCTURE + SAVE to Redis (the agent's memory).
const wf = await structure(trace);
await saveWorkflow(wf);
console.log(`2) structured + saved: ${wf.workflowId} v${wf.version}, ${wf.steps.length} steps, ${wf.parameters.length} params`);

// 3) REPLAY both lanes on Browserbase against the broken public mock.
const row: DataRow = { customerName: "Globex Corporation", customerEmail: "ap@globex.com" };
const base = `${MOCK_URL}?break=1`;
const events: RunEvent[] = [];
const emit = (e: RunEvent): void => {
  events.push(e);
  if (e.kind === "liveview") console.log(`   liveview[${e.lane}] ${e.url.slice(0, 56)}…`);
  if (e.kind === "heal") console.log(`   heal[${e.lane}] healed=${e.result.healed} → ${e.result.newSelector ?? "—"}`);
};
const control = structuredClone(wf); control.startUrl = base;
const healing = structuredClone(wf); healing.startUrl = base;
const [c, h] = await Promise.all([
  replay(control, row, { heal: false, lane: "control", emit }),
  replay(healing, row, { heal: true, lane: "healing", emit, onHeal: async (w) => { w.version += 1; await saveWorkflow(w); } }),
]);
const heals = events.filter((e) => e.kind === "heal" && e.result.healed).length;

console.log(`\n3) control ok=${c} (expect false)   healing ok=${h} (expect true)   heals=${heals}`);
const pass = trace.actions.length >= 3 && wf.steps.length >= 3 && c === false && h === true && heals >= 1;
console.log(pass
  ? "\nE2E ✅  taught locally → saved to Redis → replayed + self-healed on Browserbase. Full loop works."
  : "\nE2E ❌  inspect above.");
await closeLiveBrowsers();
process.exit(pass ? 0 : 1);
