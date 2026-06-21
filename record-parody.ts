// Scripted Mimic recording on the LinkedUp parody → the DEMO_WORKFLOW_ID the Cost Race replays.
// No login on the parody, so we drive the recorder's local browser ourselves (Recorder exposes
// livePage exactly for scripted demonstrations) and structure+save EXACTLY like /api/workflows.
// Run: npx tsx --env-file=.env record-parody.ts
import { Recorder } from "./runtime/recorder";
import { structure } from "./brain/structure";
import { stripSwitchTabs, applyTabs } from "./runtime/multitab";
import { saveWorkflow } from "./brain/store";
import { lastUsage } from "./brain/anthropic";

const URL = process.env.DEMO_START_URL ?? "https://mock-public-ish-c.vercel.app/linkedin.html";
// Reference the lead by name/role/company so structure() parameterizes the message.
const MESSAGE =
  "Hi Sarah Chen, I came across your work as VP Engineering at Acme and would love to connect about what your team is building.";

async function main(): Promise<void> {
  const rec = new Recorder();
  await rec.start(URL);
  const page = rec.livePage;
  if (!page) throw new Error("recorder opened no page");

  await page.waitForLoadState("domcontentloaded");
  // 1. Click the FIRST result's (Sarah Chen) "Message" button → reveals the bottom-right compose dock.
  await page.locator(".li-message").first().click();
  await page.waitForSelector("#li-compose", { state: "visible" });
  // 2. Type the outreach note, then force a `change` so the field-edit is captured (recorder listens on change).
  await page.fill("#li-compose", MESSAGE);
  await page.locator("#li-compose").dispatchEvent("change");
  // 3. Send.
  await page.click("#li-send");
  await page.waitForTimeout(400); // let the in-page capture array flush before we read it

  const trace = await rec.stop("Send a personalized outreach message to a LinkedUp search result");
  console.log("captured actions:", trace.actions.map((a) => `${a.type}:${a.target.selector}`).join("  |  "));
  if (trace.actions.length < 2) throw new Error(`only ${trace.actions.length} actions captured — flow did not record`);

  // Mirror server.ts /api/workflows: structure (sans switchTabs), stamp tabs + teaching token cost, save.
  const wf = await structure(stripSwitchTabs(trace));
  const tabbed = applyTabs(wf, trace) as typeof wf & { teachingTokensIn?: number; teachingTokensOut?: number };
  tabbed.teachingTokensIn = lastUsage.tokensIn;
  tabbed.teachingTokensOut = lastUsage.tokensOut;
  await saveWorkflow(tabbed);

  console.log("\n=== WORKFLOW SAVED ===");
  console.log("DEMO_WORKFLOW_ID:", tabbed.id);
  console.log("task:", tabbed.task);
  console.log("startUrl:", tabbed.startUrl);
  console.log("steps:", tabbed.steps.map((s) => `${s.action} ${s.selector ?? s.value ?? ""}`.trim()).join("  |  "));
  console.log("params:", tabbed.parameters.map((p) => `${p.name}=${p.example}`).join(", ") || "(none)");
  console.log("teaching tokens:", tabbed.teachingTokensIn, "in /", tabbed.teachingTokensOut, "out");
  process.exit(0);
}

main().catch((e) => {
  console.error("record-parody failed:", (e as Error).message);
  process.exit(1);
});
