// Create + warm 2 Browserbase Contexts that hold burner LinkedIn logins, for the Cost Race live run.
//
//   npx tsx --env-file=.env warm-contexts.ts
//     → makes 2 contexts + 2 live sessions; prints contextId, sessionId, and a live-view URL for each.
//       Open each URL, log into a DIFFERENT burner LinkedIn by hand (stealth + same proxy as the race).
//
//   npx tsx --env-file=.env warm-contexts.ts --release <sessionId1> <sessionId2>
//     → ends both sessions so the logins persist into their contexts. Those contextIds are the warmed IDs.
import Browserbase from "@browserbasehq/sdk";
import { chromium } from "playwright";

const apiKey = process.env.BROWSERBASE_API_KEY;
if (!apiKey) throw new Error("BROWSERBASE_API_KEY unset");
const bb = new Browserbase({ apiKey });

async function projectId(): Promise<string> {
  if (process.env.BROWSERBASE_PROJECT_ID) return process.env.BROWSERBASE_PROJECT_ID;
  const list = (await bb.projects.list()) as unknown;
  const arr = Array.isArray(list) ? list : ((list as { data?: unknown[] }).data ?? []);
  const id = (arr[0] as { id?: string } | undefined)?.id;
  if (!id) throw new Error("No Browserbase project found for this API key");
  return id;
}

async function start(): Promise<void> {
  const pid = await projectId();
  const sessionIds: string[] = [];
  for (const n of [1, 2]) {
    const ctx = await bb.contexts.create({ projectId: pid });
    const session = await bb.sessions.create({
      projectId: pid,
      keepAlive: true, // survive past this script so you have time to log in
      timeout: 3600, // 1h cap
      proxies: true, // SAME residential-proxy conditions as the race → warm session matches replay
      browserSettings: {
        context: { id: ctx.id, persist: true }, // persist:true → save the login back into the context
        solveCaptchas: true,
        viewport: { width: 1280, height: 800 },
      },
    });
    // Open the login page for you — the fullscreen live-view has no URL bar. keepAlive keeps the
    // session + page state alive after this script drops its CDP connection (process.exit below).
    try {
      const browser = await chromium.connectOverCDP(session.connectUrl);
      const page = browser.contexts()[0].pages()[0];
      await page.goto("https://www.linkedin.com/login", { waitUntil: "domcontentloaded", timeout: 30000 });
    } catch (e) {
      console.log(`  (pre-nav skipped — just go to linkedin.com in the window: ${(e as Error).message})`);
    }
    const links = await bb.sessions.debug(session.id);
    sessionIds.push(session.id);
    console.log(`\n=== BURNER ${n} ===`);
    console.log(`contextId : ${ctx.id}`);
    console.log(`sessionId : ${session.id}`);
    console.log(`LOGIN HERE: ${links.debuggerFullscreenUrl}`);
  }
  console.log(`\nLog into a DIFFERENT burner LinkedIn in each window, then run:`);
  console.log(`  npx tsx --env-file=.env warm-contexts.ts --release ${sessionIds.join(" ")}`);
  process.exit(0); // drop CDP connections; keepAlive holds the sessions + login pages open for you
}

async function release(ids: string[]): Promise<void> {
  if (ids.length === 0) throw new Error("pass the sessionIds: --release <sid1> <sid2>");
  const pid = await projectId();
  for (const id of ids) {
    await bb.sessions.update(id, { projectId: pid, status: "REQUEST_RELEASE" });
    console.log(`released ${id} → its login is now persisted to its context`);
  }
  console.log(`\nWarmed. Drop the two contextIds into the lane config (cfg.contextId) — one per lane.`);
}

try {
  const args = process.argv.slice(2);
  if (args[0] === "--release") await release(args.slice(1));
  else await start();
} catch (e) {
  console.error("warm-contexts failed:", (e as Error).message);
  process.exit(1);
}
