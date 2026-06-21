// Scripted Mimic recording of the FAITHFUL multi-tab flow → the DEMO_WORKFLOW_ID the race replays.
// Drives the local recorder: on the LeadSheet, click a lead's "Message on LinkedIn" (opens LinkedUp in a
// new tab → recorder captures a switchTab), then on that LinkedUp tab search→message→send. Structures +
// saves exactly like /api/workflows. Run: npx tsx --env-file=.env record-sheet.ts
import { Recorder } from "./runtime/recorder";
import { structure } from "./brain/structure";
import { stripSwitchTabs, applyTabs } from "./runtime/multitab";
import { saveWorkflow } from "./brain/store";
import { lastUsage } from "./brain/anthropic";

const SHEET = process.env.DEMO_SHEET_URL ?? "https://mock-public-ish-c.vercel.app/leadsheet.html";
const MESSAGE =
  "Hi Sarah Chen, I came across your work as VP Engineering at Acme and would love to connect about what your team is building.";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const rec = new Recorder();
  await rec.start(SHEET);
  const sheet = rec.livePage;
  if (!sheet) throw new Error("recorder opened no page");
  await sheet.waitForLoadState("domcontentloaded");
  await sheet.waitForSelector(".li-open");

  // 1. (sheet tab) Click the FIRST lead's "Message on LinkedIn" link → opens LinkedUp in a new tab.
  await sheet.locator(".li-open").first().click();

  // 2. Wait for the recorder to adopt the new LinkedUp tab (its context "page" handler is async).
  for (let i = 0; i < 20 && rec.openTabs.length < 2; i++) await wait(250);
  const li = rec.livePage;
  if (!li || rec.openTabs.length < 2) throw new Error(`LinkedUp tab never opened (tabs=${rec.openTabs.length})`);
  await li.waitForLoadState("domcontentloaded");
  await li.waitForSelector("#li-results .result");

  // 3. (LinkedUp tab) Message the same person: click their Message → type → send.
  await li.locator(".li-message").first().click();
  await li.waitForSelector("#li-compose", { state: "visible" });
  await li.fill("#li-compose", MESSAGE);
  await li.locator("#li-compose").dispatchEvent("change");
  await li.click("#li-send");
  await wait(400); // flush the in-page capture before reading

  const trace = await rec.stop("Outreach: from the LeadSheet, message the top uncontacted lead on LinkedUp");
  console.log("captured actions:");
  for (const a of trace.actions) console.log(`  tab${a.tab ?? 0}  ${a.type}  ${a.target.selector}`);
  if (!trace.actions.some((a) => a.type === "switchTab")) throw new Error("no switchTab captured — multi-tab flow did not record");

  const wf = await structure(stripSwitchTabs(trace));
  const tabbed = applyTabs(wf, trace) as typeof wf & { teachingTokensIn?: number; teachingTokensOut?: number };
  tabbed.teachingTokensIn = lastUsage.tokensIn;
  tabbed.teachingTokensOut = lastUsage.tokensOut;
  await saveWorkflow(tabbed);

  console.log("\n=== MULTI-TAB WORKFLOW SAVED ===");
  console.log("DEMO_WORKFLOW_ID:", tabbed.workflowId);
  console.log("startUrl:", tabbed.startUrl);
  console.log("steps:");
  for (const s of tabbed.steps) console.log(`  tab${(s as { tab?: number }).tab ?? 0}  ${s.action}  ${s.selector}  ${s.valueFrom ? "←" + s.valueFrom : ""}`);
  console.log("params:", tabbed.parameters.map((p) => `${p.name}=${p.example}`).join(", ") || "(none)");
  console.log("teaching tokens:", tabbed.teachingTokensIn, "/", tabbed.teachingTokensOut);
  process.exit(0);
}

main().catch((e) => { console.error("record-sheet failed:", (e as Error).message); process.exit(1); });
