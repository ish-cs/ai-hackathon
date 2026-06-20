// Full-chain validation — everything EXCEPT the recorder, against the REAL Claude + REAL Redis.
// 1. structure() → saveWorkflow → getWorkflow (Redis round-trip)
// 2. CONTROL lane (heal off) on the broken page → must CRASH
// 3. HEALING lane (heal on) on the broken page → must SURVIVE via a real heal
// 4. the heal is written back to Redis as agent memory (selector upgraded + healHistory + version bump)
import { readFileSync } from "node:fs";
import { structure } from "./brain/structure";
import { saveWorkflow, getWorkflow, listWorkflows, getHistory } from "./brain/store";
import { replay } from "./runtime/player";
import type { DataRow, RawTrace, RunEvent } from "./shared/types";

for (const line of readFileSync(new URL("./.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

let pass = true;
const check = (name: string, ok: boolean, detail = ""): void => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) pass = false;
};

const trace: RawTrace = JSON.parse(readFileSync(new URL("./shared/fixtures/sample-trace.json", import.meta.url), "utf8"));
const mockUrl = new URL("./web/mock.html", import.meta.url).href;
const row: DataRow = { customerName: "Globex Corporation", customerEmail: "ap@globex.com" };
const events: RunEvent[] = [];
const emit = (e: RunEvent): void => { events.push(e); };

console.log("\n── 1. structure() → save → read back (REAL Claude + REAL Redis) ──");
const wf0 = await structure(trace);
wf0.startUrl = mockUrl;
await saveWorkflow(wf0);
const got = await getWorkflow(wf0.workflowId);
check("workflow round-trips through Redis", !!got && got.workflowId === wf0.workflowId && got.steps.length === 3);
check("appears in listWorkflows()", (await listWorkflows()).some((w) => w.workflowId === wf0.workflowId));
check("saved selector is the brittle #submit-btn (so the break can break it)", got?.steps.find((s) => s.action === "submit")?.selector === "#submit-btn");

console.log("\n── 2. CONTROL lane (heal OFF) on the BROKEN page — expect CRASH ──");
const controlOk = await replay({ ...got!, startUrl: mockUrl + "?break=1" }, row, { heal: false, lane: "control", emit });
check("control lane crashed (no healing layer)", controlOk === false);

console.log("\n── 3. HEALING lane (heal ON) on the BROKEN page — expect SURVIVE ──");
const healOk = await replay({ ...got!, startUrl: mockUrl + "?break=1" }, row, {
  heal: true,
  lane: "healing",
  emit,
  onHeal: async (wf) => { wf.version += 1; await saveWorkflow(wf); },
});
check("healing lane completed (survived the break)", healOk === true);
check("a real heal occurred", events.some((e) => e.kind === "heal"));

console.log("\n── 4. heal written back to Redis (agent memory) ──");
const after = await getWorkflow(wf0.workflowId);
const submitStep = after?.steps.find((s) => s.action === "submit");
check("submit selector upgraded away from the broken one", !!submitStep && submitStep.selector !== "#submit-btn", submitStep?.selector);
check("healHistory recorded on the step", (submitStep?.healHistory.length ?? 0) >= 1);
check("workflow version bumped", (after?.version ?? 1) > 1, `v${after?.version}`);
check("Redis history holds multiple versions (audit trail)", (await getHistory(wf0.workflowId)).length >= 2);

console.log(`\n══ FULL CHAIN (everything except the recorder): ${pass ? "PASS ✅" : "FAIL ❌"} ══`);
process.exit(pass ? 0 : 1);
