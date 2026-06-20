// Repeat-determinism test — guards the control-lane bug: after the healing lane writes its
// re-grounded selector back to Redis, the CONTROL lane must STILL crash on the next broken run
// (it must never inherit the cure). Hits the REAL /api/replay route twice. Server must be up on
// :3000 WITH the key + Redis. Run: npx tsx --env-file=.env repeat-test.ts
import { readFileSync } from "node:fs";
import { getHistory } from "./brain/store";
import type { RawTrace } from "./shared/types";

const BASE = "http://localhost:3000";
const trace: RawTrace = JSON.parse(readFileSync(new URL("./shared/fixtures/real-trace.json", import.meta.url), "utf8"));
const row = { customerName: "Globex Corporation", customerEmail: "ap@globex.com" };

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

let pass = true;
const check = (name: string, ok: boolean, detail = ""): void => { if (!ok) pass = false; console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); };

(async () => {
  console.log("\n── structure + save (fresh workflow) ──");
  const wf = await post<{ workflowId: string }>("/api/workflows", trace);
  console.log("  workflowId:", wf.workflowId);

  console.log("\n── RUN 1: break ON ──");
  const r1 = await post<{ control: boolean; healing: boolean }>("/api/replay", { workflowId: wf.workflowId, row, breakSite: true });
  console.log("  result:", JSON.stringify(r1));
  check("run 1: control CRASHED", r1.control === false);
  check("run 1: healing SURVIVED", r1.healing === true);

  console.log("\n── RUN 2: break ON (after run-1 heal persisted) — the bug check ──");
  const r2 = await post<{ control: boolean; healing: boolean }>("/api/replay", { workflowId: wf.workflowId, row, breakSite: true });
  console.log("  result:", JSON.stringify(r2));
  check("run 2: control STILL CRASHED (did not inherit the cure)", r2.control === false);
  check("run 2: healing SURVIVED again", r2.healing === true);

  console.log("\n── agent-memory trail grew ──");
  const hist = await getHistory(wf.workflowId);
  check("history accumulated heal versions (≥3: v1 + 2 write-backs)", hist.length >= 3, `len=${hist.length}`);

  console.log(`\n══ REPEAT-DETERMINISM: ${pass ? "PASS ✅" : "FAIL ❌"} ══`);
  process.exit(pass ? 0 : 1);
})();
