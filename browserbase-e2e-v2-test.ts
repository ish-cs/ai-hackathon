// Gates 5 + 6 (and 7 when run with ENGINE=browserbase): record the multi-tab LinkedIn-outreach
// workflow, replay it over N rows (gate 5), then break the LinkedIn Send + heal (gate 6).
//   local:       ENGINE=local      tsx --env-file=.env browserbase-e2e-v2-test.ts
//   browserbase: (ENGINE from .env) tsx --env-file=.env browserbase-e2e-v2-test.ts
import { Recorder } from "./runtime/recorder";
import { stripSwitchTabs, applyTabs, breakForDemo } from "./runtime/multitab";
import { structure } from "./brain/structure";
import { saveWorkflow } from "./brain/store";
import { replay, closeLiveBrowsers } from "./runtime/player";
import type { DataRow, RunEvent, Workflow } from "./shared/types";

const BASE = "https://mock-public-ish-c.vercel.app";
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const engine = process.env.ENGINE ?? "local";

async function record(): Promise<Workflow> {
  const rec = new Recorder();
  await rec.start(`${BASE}/leadsheet.html`);
  const sheet = rec.openTabs[0];
  await sheet.click('tr[data-row="0"] .li-open'); // opens LinkedIn in a new tab
  for (let i = 0; i < 80 && rec.openTabs.length < 2; i++) await sleep(100);
  const li = rec.openTabs[1];
  await li.waitForLoadState("domcontentloaded").catch(() => {});
  for (let i = 0; i < 80; i++) {
    if (await li.evaluate("!!window.__mimicCaptureAttached").catch(() => false)) break;
    await sleep(100);
  }
  await li.fill("#li-search", "Sarah Chen");
  await li.click('[data-name="Sarah Chen"] .li-message');
  await li.fill("#li-compose", "Hi Sarah Chen, saw you're VP Engineering at Acme — would love to connect.");
  await li.click("#li-send");
  await sleep(500);
  const trace = await rec.stop("message leads on linkedin");
  const wf = applyTabs(await structure(stripSwitchTabs(trace)), trace);
  await saveWorkflow(wf);
  return wf;
}

const wf = await record();
const nameP = wf.parameters.find((p) => /name/i.test(p.name))?.name ?? wf.parameters[0]?.name ?? "leadName";
const msgP = wf.parameters.find((p) => /mess|body|note/i.test(p.name))?.name ?? wf.parameters[1]?.name ?? "messageBody";
console.log(`engine=${engine}  workflow ${wf.workflowId}: ${wf.steps.length} steps, params=[${nameP}, ${msgP}]`);

const leads = [
  { name: "Sarah Chen", role: "VP Engineering", company: "Acme" },
  { name: "Marcus Lee", role: "Head of Product", company: "Globex" },
];
const rowFor = (l: (typeof leads)[number]): DataRow => ({
  [nameP]: l.name,
  [msgP]: `Hi ${l.name}, saw you're ${l.role} at ${l.company} — would love to connect.`,
});

console.log("\n=== GATE 5: replay over N rows (no break) ===");
let all = true;
for (const l of leads) {
  await closeLiveBrowsers();
  const ev: RunEvent[] = [];
  const ok = await replay(structuredClone(wf), rowFor(l), { heal: false, lane: "healing", emit: (e) => ev.push(e) });
  console.log(`  ${l.name}: ok=${ok} (${ev.filter((e) => e.kind === "step").length} steps)`);
  all = all && ok;
}
console.log(all ? "GATE 5 ✅ all rows completed (LeadSheet → LinkedIn → message → send)" : "GATE 5 ❌");

console.log("\n=== GATE 6: break + heal on the LinkedIn Send ===");
await closeLiveBrowsers();
const broken = breakForDemo(wf);
const evH: RunEvent[] = [];
const [c, h] = await Promise.all([
  replay(structuredClone(broken), rowFor(leads[0]), { heal: false, lane: "control", emit: () => {} }),
  replay(structuredClone(broken), rowFor(leads[0]), { heal: true, lane: "healing", emit: (e) => evH.push(e), onHeal: async () => {} }),
]);
for (const e of evH) {
  if (e.kind === "step") console.log(`   H step ${e.result.stepId} ${e.result.status} ${e.result.attemptedSelector}${e.result.error ? " — " + e.result.error.slice(0, 60) : ""}`);
  if (e.kind === "heal") console.log(`   H heal healed=${e.result.healed} new=${e.result.newSelector ?? "—"} | ${(e.result.reasoning ?? "").slice(0, 70)}`);
  if (e.kind === "liveview") console.log(`   H liveview ${e.url.slice(0, 56)}…`); // one per active tab → follows the tab
}
const heals = evH.filter((e) => e.kind === "heal" && e.result.healed).length;
console.log(`  control ok=${c} (expect false)   healing ok=${h} (expect true)  heals=${heals}`);
const gate6 = c === false && h === true && heals >= 1;
console.log(gate6 ? "GATE 6 ✅ control died on renamed Send; healing re-grounded by intent + sent" : "GATE 6 ❌");

console.log(`\n${all && gate6 ? `V2 ${engine.toUpperCase()} ✅ gates 5 + 6 passed` : "V2 ❌ inspect above"}`);
await closeLiveBrowsers();
process.exit(all && gate6 ? 0 : 1);
