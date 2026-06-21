// Smoke: StagehandLane class end-to-end (open → runRound → metrics event → close) on a benign page,
// before /api/race wires it for real. Run: npx tsx --env-file=.env stagehand-lane-smoke.ts
import { StagehandLane } from "./runtime/stagehand-lane";
import type { RunEvent } from "./shared/types";

async function main(): Promise<void> {
  const lane = new StagehandLane({
    startUrl: "https://news.ycombinator.com/",
    instruction: "Tell me the title of the top story on this page.",
    stealth: false, // benign page → no stealth/proxy/Context needed for the smoke
    proxies: false,
    maxSteps: 6,
  });

  const events: RunEvent[] = [];
  const emit = (e: RunEvent): void => {
    events.push(e);
    console.log(`  emit ${e.kind}` + (e.kind === "metrics" ? ` in=${e.tokensIn} out=${e.tokensOut} $${e.costUsd.toFixed(4)}` : ""));
  };

  const { liveViewUrl } = await lane.open();
  console.log(`[smoke] open OK · live=${liveViewUrl ? "yes" : "no"}`);
  const r = await lane.runRound({ name: "Ada" }, 1, emit);
  await lane.close();

  const gotMetrics = events.some((e) => e.kind === "metrics");
  const pass = r.ok && r.tokensIn > 0 && gotMetrics;
  console.log(`[smoke] ok=${r.ok} in=${r.tokensIn} out=${r.tokensOut} ms=${r.ms}`);
  console.log(pass ? "LANE ✅ class works: open→runRound→metrics→close, real tokens" : "LANE ❌ inspect above");
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("[smoke] CRASHED:", e);
  process.exit(1);
});
