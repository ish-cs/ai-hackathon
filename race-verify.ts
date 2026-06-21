// End-to-end Cost Race verification. Connects to the running server's WS bus, fires POST /api/race,
// and prints REAL per-lane / per-round token + $ metrics, the break, and the heal — proof the whole
// thing is alive (not "probably working"). Run AFTER starting the server:
//   npx tsx --env-file=.env runtime/server.ts   (in another shell / background)
//   npx tsx --env-file=.env race-verify.ts
import WebSocket from "ws";

const PORT = Number(process.env.PORT ?? 3000);
type Metric = { lane: string; run: number; phase: string; tokensIn: number; tokensOut: number; ms: number; costUsd: number };
const metrics: Metric[] = [];
let stDone = 0, miDone = 0, healed = 0, broke = false, done = false, lanesStopped = 0;

const ws = new WebSocket(`ws://localhost:${PORT}`);

ws.on("open", async () => {
  console.log("WS connected → firing /api/race");
  const r = await fetch(`http://localhost:${PORT}/api/race`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  console.log("race ack:", (await r.text()).slice(0, 120), "\n");
});

ws.on("message", (d) => {
  const e = JSON.parse(d.toString());
  switch (e.kind) {
    case "liveview":
      console.log(`  [${e.lane}] live: ${String(e.url).slice(0, 64)}`);
      break;
    case "metrics":
      metrics.push(e);
      console.log(`  [${e.lane}] run ${e.run} ${e.phase}: in=${e.tokensIn} out=${e.tokensOut} $${e.costUsd.toFixed(4)} ${e.ms}ms`);
      break;
    case "heal":
      if (e.result?.healed) { healed++; console.log(`  [mimic] ✅ HEAL → ${e.result.newSelector}`); }
      else console.log(`  [mimic] heal attempt: ${JSON.stringify(e.result?.reason ?? e.result).slice(0, 80)}`);
      break;
    case "step":
      if (e.result?.stepId === "break") { broke = true; console.log(`  [mimic] 💥 BREAK: ${e.result.attemptedSelector} (${e.result.status})`); }
      else if (e.result?.status === "failed") console.log(`  [${e.lane}] step FAILED: ${e.result.attemptedSelector}`);
      break;
    case "timer":
      console.log(`  [${e.lane}] ⏱ ${e.state}${e.elapsedMs != null ? " — " + (e.elapsedMs / 1000).toFixed(1) + "s" : ""}`);
      if (e.state === "stop" && ++lanesStopped >= 2) finish(); // both lanes done their queue
      break;
    case "run_done":
      if (e.lane === "stagehand") stDone++;
      if (e.lane === "mimic") miDone++;
      break;
  }
});

ws.on("error", (e) => { console.error("WS error:", (e as Error).message); process.exit(1); });

function sum(lane: string, k: "tokensIn" | "tokensOut" | "costUsd") {
  return metrics.filter((m) => m.lane === lane).reduce((a, m) => a + m[k], 0);
}

function finish() {
  if (done) return;
  done = true;
  const stCost = sum("stagehand", "costUsd"), miCost = sum("mimic", "costUsd");
  const stTok = sum("stagehand", "tokensIn") + sum("stagehand", "tokensOut");
  const miTok = sum("mimic", "tokensIn") + sum("mimic", "tokensOut");
  console.log("\n========== COST RACE RESULT ==========");
  console.log(`break fired: ${broke ? "yes 💥" : "NO ⚠️"}   heals: ${healed}`);
  console.log(`Stagehand:  ${stTok.toLocaleString()} tokens   $${stCost.toFixed(4)}   (${stDone} rounds, pays every run)`);
  console.log(`Mimic:      ${miTok.toLocaleString()} tokens   $${miCost.toFixed(4)}   (${miDone} rounds, taught once + 1 heal)`);
  const ratio = miCost > 0 ? (stCost / miCost).toFixed(1) : "∞";
  console.log(`Mimic is ${ratio}× cheaper.`);
  console.log("======================================");
  process.exit(broke && lanesStopped >= 2 ? 0 : 1);
}

setTimeout(() => { console.log("\n(hard timeout — summarizing what arrived)"); finish(); }, 360_000);
