// Gate 3 (deterministic, terminal-verifiable): run BOTH lanes on Browserbase against the public
// mock with the site "broken" (?break=1). control (no heal) must FAIL; healing must self-repair.
// Mirrors what /api/replay does, minus the HTTP/WS. Run: tsx --env-file=.env browserbase-run-test.ts
import { listWorkflows, getWorkflow, getHistory, saveWorkflow } from "./brain/store";
import { replay, closeLiveBrowsers } from "./runtime/player";
import type { DataRow, RunEvent } from "./shared/types";

const MOCK_URL = process.env.MOCK_URL;
if (!MOCK_URL) throw new Error("MOCK_URL unset");
if (process.env.ENGINE !== "browserbase") throw new Error(`ENGINE=${process.env.ENGINE} (need browserbase)`);

const wfs = await listWorkflows();
if (!wfs.length) throw new Error("no workflow seeded in Redis");
const id = wfs[0].workflowId;
const history = await getHistory(id);
const pristine = history.length ? history[0].wf : await getWorkflow(id);
if (!pristine) throw new Error("no pristine workflow");
console.log(`workflow ${id} v${pristine.version}, ${pristine.steps.length} steps → ${MOCK_URL}?break=1`);

const row: DataRow = { customerName: "Globex Corporation", customerEmail: "ap@globex.com" };
const base = `${MOCK_URL}?break=1`;
const events: RunEvent[] = [];
const emit = (e: RunEvent): void => {
  events.push(e);
  if (e.kind === "liveview") console.log(`  liveview[${e.lane}] ${e.url.slice(0, 64)}…`);
  if (e.kind === "heal") console.log(`  heal[${e.lane}] healed=${e.result.healed} → ${e.result.newSelector ?? "—"}`);
};

const control = structuredClone(pristine); control.startUrl = base;
const healing = structuredClone(pristine); healing.startUrl = base; healing.version = history.length;

const [c, h] = await Promise.all([
  replay(control, row, { heal: false, lane: "control", emit }),
  replay(healing, row, {
    heal: true, lane: "healing", emit,
    onHeal: async (w) => { w.version += 1; w.startUrl = pristine.startUrl; await saveWorkflow(w); },
  }),
]);

const heals = events.filter((e) => e.kind === "heal" && e.result.healed).length;
const liveviews = events.filter((e) => e.kind === "liveview").length;
console.log(`\ncontrol ok=${c}  (expect false — no healing, brittle selector)`);
console.log(`healing ok=${h}  (expect true)  heals=${heals}  liveviews=${liveviews}`);
console.log(c === false && h === true && heals >= 1
  ? "\nGATE 3 ✅  on Browserbase: control died, healing re-grounded by intent and succeeded."
  : "\nGATE 3 ❌  unexpected result — inspect above.");

await closeLiveBrowsers();
process.exit(0);
