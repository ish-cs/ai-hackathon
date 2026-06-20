// Confirms a PUBLIC url is reachable + correct FROM a Browserbase cloud browser (the real consumer).
// Catches Vercel SSO/deployment-protection walls that would block the cloud lanes.
// Run: tsx --env-file=.env browserbase-verify-url.ts <url>
import Browserbase from "@browserbasehq/sdk";
import { chromium } from "playwright";

const url = process.argv[2] ?? process.env.MOCK_URL;
const apiKey = process.env.BROWSERBASE_API_KEY;
if (!url || !apiKey) {
  console.error("need <url> arg + BROWSERBASE_API_KEY");
  process.exit(1);
}

const bb = new Browserbase({ apiKey });
const session = await bb.sessions.create({ browserSettings: { viewport: { width: 1280, height: 800 } } });
const browser = await chromium.connectOverCDP(session.connectUrl);
const page = browser.contexts()[0].pages()[0];
try {
  await page.goto(url, { timeout: 30000, waitUntil: "domcontentloaded" });
  const title = await page.title();
  const submitBtn = await page.locator("#submit-btn").count();
  const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 160).replace(/\s+/g, " ");
  const wall = /authenticat|log in|sign in|vercel/i.test(title);
  console.log(`url:        ${url}`);
  console.log(`title:      ${JSON.stringify(title)}`);
  console.log(`#submit-btn: ${submitBtn}`);
  console.log(`body[:160]:  ${JSON.stringify(body)}`);
  if (submitBtn === 1 && !wall) console.log("\nOPEN ✅  cloud browser sees the mock — Browserbase can act on it.");
  else console.log("\nBLOCKED ⚠️  not the mock (auth wall or wrong page) — disable Vercel protection.");
} finally {
  await browser.close().catch(() => {});
  process.exit(0);
}
