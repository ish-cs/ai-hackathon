// De-risk: can Stagehand's agent FOLLOW a new tab? It starts on the LeadSheet, must click a row's
// "Message on LinkedIn" (target=_blank → new tab), then drive that LinkedUp tab to message + send.
// If it can't, the faithful multi-tab race needs orchestration (2 execute() calls per lead) for Stagehand.
// Run: npx tsx --env-file=.env stagehand-multitab-test.ts
import { Stagehand } from "@browserbasehq/stagehand";
import Browserbase from "@browserbasehq/sdk";

const SHEET = "https://mock-public-ish-c.vercel.app/leadsheet.html";

async function main(): Promise<void> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) throw new Error("BROWSERBASE_API_KEY unset");
  const bb = new Browserbase({ apiKey });
  const list = (await bb.projects.list()) as unknown;
  const projectId = (Array.isArray(list) ? list : (list as { data?: unknown[] }).data ?? [])[0] as { id: string };

  const sh = new Stagehand({
    env: "BROWSERBASE",
    apiKey,
    projectId: projectId.id,
    model: "anthropic/claude-opus-4-8",
    serverCache: false,
    verbose: 1,
    browserbaseSessionCreateParams: {
      projectId: projectId.id,
      proxies: true,
      browserSettings: { viewport: { width: 1280, height: 800 }, solveCaptchas: true },
    },
  });
  await sh.init();
  const links = await bb.sessions.debug(sh.browserbaseSessionID);
  console.log("live:", links.debuggerFullscreenUrl, "\n");

  const page = sh.context.pages()[0] ?? (await sh.context.newPage());
  await page.goto(SHEET);

  const agent = sh.agent({ model: "anthropic/claude-opus-4-8", mode: "dom" });
  const res = await agent.execute({
    instruction:
      "You are on a LeadSheet (a spreadsheet of outreach leads). Find the FIRST row whose Status column says " +
      "'Not contacted'. Click that row's 'Message on LinkedIn' link — it OPENS A NEW BROWSER TAB (LinkedUp). " +
      "Switch to that new tab, search for that same person by name, click their Message button, type a short " +
      "friendly outreach note, then click Send. Finish once the message is sent.",
    maxSteps: 20,
  });

  const tabs = sh.context.pages();
  console.log(`\nsuccess: ${res.success}`);
  console.log(`tabs open: ${tabs.length}  (2 = it opened LinkedUp)`);
  for (const p of tabs) console.log("  tab:", p.url().slice(0, 70));
  // Did a message actually send on the LinkedUp tab?
  let sent = false;
  for (const p of tabs) {
    if (/linkedin\.html/.test(p.url())) {
      sent = await p.locator("#li-sent:not(.hidden)").count().then((c) => c > 0).catch(() => false);
    }
  }
  console.log(`message sent on LinkedUp tab: ${sent}`);
  console.log("agent says:", String(res.message).slice(0, 220));
  await sh.close();

  const pass = res.success && tabs.length >= 2 && sent;
  console.log(pass ? "\nSTAGEHAND MULTI-TAB ✅ — it follows the new tab natively; faithful race is viable" : "\nSTAGEHAND MULTI-TAB ⚠️ — needs orchestration (drive sheet, then hand it the LinkedUp tab)");
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error("multitab-test failed:", (e as Error).message); process.exit(1); });
