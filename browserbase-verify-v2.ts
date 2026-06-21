// Confirms the two v2 pages load (with their key selectors) FROM a Browserbase cloud browser, on the
// given base URL. Use the STABLE production alias so recorded workflow URLs survive redeploys.
// Run: tsx --env-file=.env browserbase-verify-v2.ts <baseUrl>
import Browserbase from "@browserbasehq/sdk";
import { chromium } from "playwright";

const base = process.argv[2];
if (!base) throw new Error("pass a base URL, e.g. https://mock-public-ish-c.vercel.app");
const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY! });

const session = await bb.sessions.create({ timeout: 120, browserSettings: { viewport: { width: 1280, height: 800 } } });
const browser = await chromium.connectOverCDP(session.connectUrl);
const page = browser.contexts()[0].pages()[0];

async function check(path: string, sels: string[]): Promise<boolean> {
  await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 30000 });
  const title = await page.title();
  const counts: Record<string, number> = {};
  for (const s of sels) counts[s] = await page.locator(s).count();
  const wall = /sso|log in|sign in|authenticat/i.test(title);
  const ok = !wall && sels.every((s) => counts[s] >= 1);
  console.log(`${path}  title=${JSON.stringify(title)}  ${JSON.stringify(counts)}  ${ok ? "OK" : "BAD"}`);
  return ok;
}

const a = await check("/leadsheet.html", ['[data-cell="name"]', ".li-open"]);
const b = await check("/linkedin.html", ["#li-search", "#li-result", "#li-send"]);
console.log(a && b ? "\nV2 PAGES ✅  both load from the cloud with selectors intact." : "\nV2 PAGES ❌  not reachable/incomplete on this base.");
await browser.close().catch(() => {});
process.exit(a && b ? 0 : 1);
