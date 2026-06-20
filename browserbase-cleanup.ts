// Releases all RUNNING Browserbase sessions — frees the concurrency budget when lingering demo
// sessions (or leaked test sessions) pile up against the cap. Safe to run anytime between demos.
// Run: tsx --env-file=.env browserbase-cleanup.ts
import Browserbase from "@browserbasehq/sdk";

const apiKey = process.env.BROWSERBASE_API_KEY;
if (!apiKey) throw new Error("BROWSERBASE_API_KEY unset");
const bb = new Browserbase({ apiKey });

const running = await bb.sessions.list({ status: "RUNNING" });
console.log(`running sessions: ${running.length}`);
for (const s of running) {
  try {
    await bb.sessions.update(s.id, { projectId: s.projectId, status: "REQUEST_RELEASE" });
    console.log(`  released ${s.id}`);
  } catch (e) {
    console.log(`  release failed ${s.id}: ${(e as Error).message}`);
  }
}
console.log("done");
process.exit(0);
