// Proves the history invariant replay depends on: position 0 = THIS workflow's true original,
// even when an id collides. This is exactly ck's cross-machine crash — a stranger's stale v1
// sitting at history[0] (with a path only their machine has) → replay reads it → crash.
import { readFileSync } from "node:fs";
import { saveWorkflow, getHistory, getWorkflow } from "./brain/store";
import type { Workflow } from "./shared/types";

for (const line of readFileSync(new URL("./.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

let pass = true;
const check = (n: string, ok: boolean, d = ""): void => {
  console.log(`  ${ok ? "✓" : "✗"} ${n}${d ? " — " + d : ""}`);
  if (!ok) pass = false;
};

const mk = (id: string, version: number, startUrl: string): Workflow => ({
  workflowId: id, task: "t", version, startUrl, parameters: [], steps: [],
});

const ID = "wf_test_invariant";

console.log("\n── history invariant: position 0 = the real original, even on id collision ──");

// Owner A records v1 with a path only their machine has.
await saveWorkflow(mk(ID, 1, "file:///only-on-machine-A/mock.html"));
let h = await getHistory(ID);
check("A's v1 saved, history len 1", h.length === 1, `len=${h.length}`);

// Owner B re-uses the SAME id with a fresh v1 — the collision that caused the crash.
await saveWorkflow(mk(ID, 1, "http://localhost:3000/mock"));
h = await getHistory(ID);
check("B's v1 RESET history to len 1 (A's stale entry gone)", h.length === 1, `len=${h.length}`);
check("history[0] is B's original, NOT A's machine path", h[0].wf.startUrl === "http://localhost:3000/mock", h[0].wf.startUrl);

// A heal writes back v2 → appends, original preserved at [0].
await saveWorkflow(mk(ID, 2, "http://localhost:3000/mock"));
h = await getHistory(ID);
check("heal v2 APPENDED (memory trail grows)", h.length === 2, `len=${h.length}`);
check("history[0] STILL the v1 original", h[0].version === 1);
check("main copy is the latest (v2)", (await getWorkflow(ID))?.version === 2);

console.log(`\n══ HISTORY INVARIANT: ${pass ? "PASS ✅" : "FAIL ❌"} ══`);
process.exit(pass ? 0 : 1);
