// Prebuild smoke test — proves the replay plumbing end-to-end WITHOUT an Anthropic key or Redis.
// Uses the saved sample-workflow fixture (no live recording, no structure() call).
// Scenario A: replay on the unchanged mock page  -> should COMPLETE.
// Scenario B: replay on the broken page (Submit->Send), healing OFF -> should CRASH at submit (failure detection).
// Run: server must be up on :3000, then `npx tsx smoke.ts`.
import { readFileSync } from "node:fs";
import { replay } from "./runtime/player";
import type { Workflow, DataRow, RunEvent, StepStatus } from "./shared/types";

const wf: Workflow = JSON.parse(
  readFileSync(new URL("./shared/fixtures/sample-workflow.json", import.meta.url), "utf8"),
);
const row: DataRow = { customerName: "Globex Corporation", customerEmail: "ap@globex.com" };

async function runLane(label: string, w: Workflow): Promise<{ ok: boolean; steps: Record<string, StepStatus> }> {
  const steps: Record<string, StepStatus> = {};
  const ok = await replay(w, row, {
    heal: false,
    lane: "control",
    emit: (e: RunEvent) => {
      if (e.kind === "step") {
        steps[e.result.stepId] = e.result.status;
        const err = e.result.error ? " — " + e.result.error.split("\n")[0].slice(0, 70) : "";
        console.log(`  [${label}] ${e.result.stepId} ${e.result.status.toUpperCase()}${err}`);
      }
    },
  });
  return { ok, steps };
}

(async () => {
  console.log("\n── Scenario A: UNCHANGED site, healing off (expect COMPLETE) ──");
  const a = await runLane("normal", wf);
  console.log(`  → ${a.ok ? "✓ COMPLETED" : "✗ CRASHED"}`);

  console.log("\n── Scenario B: BROKEN site (Submit→Send), healing off (expect CRASH at s3) ──");
  const broken: Workflow = { ...wf, startUrl: wf.startUrl + "?break=1" };
  const b = await runLane("control", broken);
  console.log(`  → ${b.ok ? "✓ COMPLETED" : "✗ CRASHED"}`);

  const pass =
    a.ok === true &&
    a.steps.s1 === "ok" && a.steps.s2 === "ok" && a.steps.s3 === "ok" &&
    b.ok === false &&
    b.steps.s1 === "ok" && b.steps.s2 === "ok" && b.steps.s3 === "failed";

  console.log(`\n══ PREBUILD SMOKE TEST: ${pass ? "PASS ✅" : "FAIL ❌"} ══`);
  console.log("   proves: Playwright launch → navigate → fill → fill → submit, + failure detection on a changed selector");
  if (!pass) console.log("   detail:", JSON.stringify({ a, b }));
  process.exit(pass ? 0 : 1);
})();
