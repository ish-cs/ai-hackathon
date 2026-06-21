// Live proof of the Stagehand lane on REAL LinkedIn via the warmed burner context.
// SAFE: opens a connection's profile + the Message composer, then stops — types and sends NOTHING.
// Run: npx tsx --env-file=.env stagehand-live-test.ts
import { StagehandLane } from "./runtime/stagehand-lane";
import type { RunEvent } from "./shared/types";

async function main(): Promise<void> {
  const contextId = process.env.STAGEHAND_CONTEXT_ID;
  if (!contextId) throw new Error("STAGEHAND_CONTEXT_ID unset");

  const lane = new StagehandLane({
    startUrl: "https://www.linkedin.com/mynetwork/invite-connections/connections/",
    instruction:
      "You are already logged into LinkedIn. Open the FIRST connection in your connections list, go to " +
      "their profile, and click the 'Message' button to open the message composer. " +
      "Do NOT type anything. Do NOT click Send. Stop as soon as the message composer is open.",
    contextId,
    stealth: false, // Enterprise-only on our Dev plan
    proxies: true,
    maxSteps: 18,
  });

  const events: RunEvent[] = [];
  const emit = (e: RunEvent): void => {
    events.push(e);
    if (e.kind === "metrics") console.log(`  metrics in=${e.tokensIn} out=${e.tokensOut} $${e.costUsd.toFixed(4)} ms=${e.ms}`);
  };

  const { liveViewUrl } = await lane.open();
  console.log("open OK · live:", liveViewUrl);
  const r = await lane.runRound({}, 1, emit);
  await lane.close();

  console.log(`\nok=${r.ok} tokensIn=${r.tokensIn} tokensOut=${r.tokensOut} ms=${r.ms}`);
  console.log("agent says:", r.message.slice(0, 280));
  const pass = r.ok && r.tokensIn > 0;
  console.log(pass ? "LIVE LANE ✅ Stagehand drove real LinkedIn on the warmed context, real tokens" : "LIVE LANE ⚠️ inspect above");
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("live-test failed:", (e as Error).message);
  process.exit(1);
});
