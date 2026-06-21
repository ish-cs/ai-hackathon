// Option 1 validation: RESUME one pre-warmed keepAlive session (stable IP, already logged in) and run
// the LinkedIn task several times IN that one session. If it survives without CAPTCHA/authwall/logout,
// the one-IP approach works and the live race is viable. If it still walls, we go parody.
// Run: npx tsx --env-file=.env stagehand-resume-test.ts <sessionId> <profileUrl> [rounds]
import { StagehandLane } from "./runtime/stagehand-lane";
import type { RunEvent } from "./shared/types";

async function main(): Promise<void> {
  const [sessionId, profileUrl, roundsArg] = process.argv.slice(2);
  if (!sessionId || !profileUrl) throw new Error("usage: <sessionId> <profileUrl> [rounds]");
  const rounds = Number(roundsArg ?? 3);

  const lane = new StagehandLane({
    startUrl: profileUrl,
    instruction:
      "You are already logged into LinkedIn and on a person's profile page. Click the 'Message' button " +
      "to open the message composer. Do NOT type anything. Do NOT click Send. Stop once the composer is open.",
    sessionId, // RESUME the warmed session — one stable IP, no per-run rotation
    stealth: false,
    maxSteps: 10,
  });

  const emit = (e: RunEvent): void => {
    if (e.kind === "metrics") console.log(`  metrics in=${e.tokensIn} out=${e.tokensOut} $${e.costUsd.toFixed(4)} ms=${e.ms}`);
  };

  const { liveViewUrl } = await lane.open();
  console.log("resumed session · live:", liveViewUrl);

  let survived = 0;
  for (let r = 1; r <= rounds; r++) {
    const res = await lane.runRound({}, r, emit);
    const blocked = /captcha|authwall|security check|security verification|sign in|login/i.test(res.message);
    console.log(`round ${r}: ok=${res.ok} blocked=${blocked} — ${res.message.slice(0, 130)}`);
    if (res.ok && !blocked) survived++;
  }
  await lane.close();

  console.log(`\n${survived}/${rounds} rounds survived in ONE session.`);
  console.log(
    survived === rounds
      ? "RESUME ✅ one persistent session holds — live race is viable on the warmed session."
      : "RESUME ⚠️ still hitting walls in a single session — go parody.",
  );
  process.exit(survived === rounds ? 0 : 1);
}

main().catch((e) => {
  console.error("resume-test failed:", (e as Error).message);
  process.exit(1);
});
