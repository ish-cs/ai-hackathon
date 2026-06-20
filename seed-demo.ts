// Seeds the shared cloud DB with ONE clean demo workflow whose startUrl is machine-independent
// (http://localhost:3000/mock, served by each teammate's own server) so EITHER machine can replay
// it — unlike a file:// path. Adds one real heal so the memory panel has a trail to show.
// Run: tsx --env-file=.env seed-demo.ts   (server must be running so /mock is reachable)
import { readFileSync } from "node:fs";
import { structure } from "./brain/structure";
import { saveWorkflow } from "./brain/store";
import { replay } from "./runtime/player";
import type { RawTrace, DataRow, RunEvent } from "./shared/types";

const trace: RawTrace = JSON.parse(readFileSync(new URL("./shared/fixtures/real-trace.json", import.meta.url), "utf8"));
const url = "http://localhost:3000/mock";

const wf = await structure(trace);
wf.startUrl = url;
await saveWorkflow(wf);
console.log(`seeded ${wf.workflowId}  startUrl=${wf.startUrl}`);

// One heal on the broken page → memory trail = v1 original + healed v2.
const row: DataRow = { customerName: "Globex Corporation", customerEmail: "ap@globex.com" };
const events: RunEvent[] = [];
const ok = await replay({ ...wf, startUrl: url + "?break=1" }, row, {
  heal: true,
  lane: "healing",
  emit: (e) => events.push(e),
  onHeal: async (w) => { w.version += 1; await saveWorkflow(w); },
});
console.log(`healing replay ok=${ok}  heals=${events.filter((e) => e.kind === "heal").length}`);
process.exit(0);
