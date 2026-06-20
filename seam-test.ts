// SEAM TEST — does YOUR brain understand CK's REAL recorder output, end to end?
// Uses shared/fixtures/real-trace.json (captured by his actual recorder) through
// structure() -> Redis -> replay -> break -> heal. Real Claude + real Redis.
import { readFileSync } from "node:fs";
import { structure } from "./brain/structure";
import { saveWorkflow, getWorkflow } from "./brain/store";
import { replay } from "./runtime/player";
import type { DataRow, RawTrace, RunEvent } from "./shared/types";

for (const line of readFileSync(new URL("./.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
let pass = true;
const check = (n: string, ok: boolean, d = ""): void => {
  console.log(`  ${ok ? "✓" : "✗"} ${n}${d ? " — " + d : ""}`);
  if (!ok) pass = false;
};

const trace: RawTrace = JSON.parse(readFileSync(new URL("./shared/fixtures/real-trace.json", import.meta.url), "utf8"));
const mockUrl = new URL("./web/mock.html", import.meta.url).href;
const row: DataRow = { customerName: "Globex Corporation", customerEmail: "ap@globex.com" };
const events: RunEvent[] = [];
const emit = (e: RunEvent): void => { events.push(e); };

console.log("\n── ck's REAL recorder trace → your structure() ──");
const wf = await structure(trace);
wf.startUrl = mockUrl;
check("understood it — 2 variables found", wf.parameters.length === 2, JSON.stringify(wf.parameters.map((p) => p.name)));
check("3 steps", wf.steps.length === 3);
check("selectors preserved verbatim (#name,#email,#submit-btn)", wf.steps.map((s) => s.selector).join(",") === "#name,#email,#submit-btn", wf.steps.map((s) => s.selector).join(","));
await saveWorkflow(wf);
check("saved + reloads from Redis", !!(await getWorkflow(wf.workflowId)));

console.log("\n── replay on the BROKEN page: control crashes, healing survives ──");
const control = await replay({ ...wf, startUrl: mockUrl + "?break=1" }, row, { heal: false, lane: "control", emit });
const healing = await replay({ ...wf, startUrl: mockUrl + "?break=1" }, row, { heal: true, lane: "healing", emit, onHeal: async (w) => { w.version += 1; await saveWorkflow(w); } });
check("control lane crashed (no healing)", control === false);
check("healing lane survived the break", healing === true);
check("a real heal occurred", events.some((e) => e.kind === "heal"));

console.log(`\n══ SEAM (ck's recorder → your brain → heal): ${pass ? "PASS ✅" : "FAIL ❌"} ══`);
process.exit(pass ? 0 : 1);
