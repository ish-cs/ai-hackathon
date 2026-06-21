// Verify a LinkedIn login. Two modes:
//   npx tsx --env-file=.env verify-login.ts session <sessionId>   → check an existing live session
//   npx tsx --env-file=.env verify-login.ts context <contextId>   → open a FRESH session reusing the
//                                                                    warmed context (the real test that
//                                                                    the saved auth survives).
import Browserbase from "@browserbasehq/sdk";
import { chromium } from "playwright";

async function projectId(bb: Browserbase): Promise<string> {
  if (process.env.BROWSERBASE_PROJECT_ID) return process.env.BROWSERBASE_PROJECT_ID;
  const list = (await bb.projects.list()) as unknown;
  const arr = Array.isArray(list) ? list : ((list as { data?: unknown[] }).data ?? []);
  const id = (arr[0] as { id?: string } | undefined)?.id;
  if (!id) throw new Error("no Browserbase project");
  return id;
}

async function main(): Promise<void> {
  const [mode, idArg] = process.argv.slice(2);
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey || (mode !== "session" && mode !== "context") || !idArg) {
    throw new Error("usage: verify-login.ts <session|context> <id>");
  }
  const bb = new Browserbase({ apiKey });

  let connectUrl: string;
  if (mode === "session") {
    connectUrl = `wss://connect.browserbase.com?apiKey=${apiKey}&sessionId=${idArg}`;
  } else {
    const pid = await projectId(bb);
    const s = await bb.sessions.create({
      projectId: pid,
      proxies: true,
      browserSettings: { context: { id: idArg, persist: false }, solveCaptchas: true, viewport: { width: 1280, height: 800 } },
    });
    connectUrl = s.connectUrl;
    console.log(`fresh session ${s.id} reusing context ${idArg}`);
  }

  const browser = await chromium.connectOverCDP(connectUrl);
  const page = browser.contexts()[0].pages()[0];
  await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(4000);
  const url = page.url();
  console.log("url:", url, "| title:", await page.title());
  const shot = mode === "session" ? "verify-session.png" : "verify-context.png";
  await page.screenshot({ path: shot }).catch(() => {});
  console.log("screenshot:", shot);
  const loggedIn = /linkedin\.com\/(feed|in\/|mynetwork)/.test(url) && !/login|checkpoint|challenge|authwall/.test(url);
  console.log(loggedIn ? "LOGGED IN ✅" : "NOT logged in — login/checkpoint/authwall ⚠️");
  await browser.close().catch(() => {});
  process.exit(loggedIn ? 0 : 1);
}

main().catch((e) => {
  console.error("verify failed:", (e as Error).message);
  process.exit(1);
});
