// Cheap, isolated proof of the Mimic break+heal (no Stagehand lane → ~$0.03). Replays the taught
// workflow 4 rounds; round 3 fires the DOM break (#li-send → li-submit / "Send now"), so the recorded
// selector misses and a REAL brain heal re-grounds it. Rounds 1,2,4 stay free. Mirrors /api/race's
// Mimic path exactly. Run: npx tsx --env-file=.env mimic-break-verify.ts
import { MimicLane } from "./runtime/mimic-lane";
import { getWorkflow, getHistory } from "./brain/store";
import type { RunEvent, DataRow } from "./shared/types";

async function main(): Promise<void> {
  console.log("BREAK_SELECTOR parsed as:", JSON.stringify(process.env.BREAK_SELECTOR));
  const id = process.env.DEMO_WORKFLOW_ID;
  if (!id) throw new Error("DEMO_WORKFLOW_ID unset");
  const history = await getHistory(id);
  const workflow = history.length ? history[0].wf : await getWorkflow(id);
  if (!workflow) throw new Error("workflow not found: " + id);
  const row: DataRow = Object.fromEntries(workflow.parameters.map((p) => [p.name, p.example]));
  const breakSpec = process.env.BREAK_SELECTOR
    ? { selector: process.env.BREAK_SELECTOR, newId: process.env.BREAK_NEW_ID, newText: process.env.BREAK_NEW_TEXT }
    : undefined;
  console.log("breakSpec:", JSON.stringify(breakSpec), "\n");

  const ROUNDS = 4, BREAK_AT = 3;
  let broke = false, healed = 0;
  const emit = (e: RunEvent): void => {
    const r = (e as { result?: { stepId?: string; status?: string; attemptedSelector?: string; error?: string; healed?: boolean; newSelector?: string } }).result;
    if (e.kind === "step" && r?.stepId === "break") { broke = true; console.log(`💥 BREAK: ${r.attemptedSelector} (${r.status})`); }
    else if (e.kind === "step" && r?.status === "failed") console.log(`  step FAILED: ${r.attemptedSelector} — ${r.error ?? ""}`);
    else if (e.kind === "heal") { if (r?.healed) { healed++; console.log(`✅ HEAL → ${r.newSelector}`); } else console.log(`  heal miss`); }
    else if (e.kind === "metrics") { const m = e as unknown as { run: number; tokensIn: number; tokensOut: number; costUsd: number; ms: number }; console.log(`[mimic] run ${m.run}: in=${m.tokensIn} out=${m.tokensOut} $${m.costUsd.toFixed(4)} ${m.ms}ms`); }
  };

  const mimic = new MimicLane({ workflow, breakSpec });
  const { liveViewUrl } = await mimic.open();
  console.log("mimic open · live:", String(liveViewUrl).slice(0, 64), "\n");
  for (let round = 1; round <= ROUNDS; round++) {
    await mimic.runRound(row, round, emit, { breakNow: round === BREAK_AT });
  }
  await mimic.close();

  console.log(`\nbreak fired: ${broke ? "yes 💥" : "NO ⚠️"}   heals: ${healed}`);
  const pass = broke && healed > 0;
  console.log(pass ? "MIMIC BREAK+HEAL ✅ — round 3 heals by intent, rounds 1/2/4 free" : "⚠️ break or heal did not fire");
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error("mimic-break-verify failed:", (e as Error).message); process.exit(1); });
