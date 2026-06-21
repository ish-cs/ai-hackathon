// Proves the array-based capture works over Browserbase CDP (the exposeBinding-free fix). Opens a
// cloud session directly, attaches the real capture script, drives a demonstration, reads the
// in-page action array. If this passes, live-teach can run on the cloud (unpark).
// Run: tsx --env-file=.env browserbase-cdp-capture-test.ts
import Browserbase from "@browserbasehq/sdk";
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const CAPTURE = readFileSync(new URL("./runtime/recorder-capture.js", import.meta.url), "utf8");
const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY! });
const MOCK_URL = process.env.MOCK_URL!;

const session = await bb.sessions.create({ timeout: 120, browserSettings: { viewport: { width: 1280, height: 800 } } });
const browser = await chromium.connectOverCDP(session.connectUrl);
const page = browser.contexts()[0].pages()[0];

await page.addInitScript({ content: CAPTURE }); // fresh navigations
await page.goto(MOCK_URL, { waitUntil: "domcontentloaded" });
await page.evaluate(CAPTURE); // attach to the already-loaded doc (idempotent guard prevents double-bind)

await page.fill("#name", "Initech LLC");
await page.fill("#email", "ap@initech.com");
await page.click("#submit-btn");
await page.waitForTimeout(500);

const raw = (await page.evaluate("JSON.stringify(window.__mimicActions || [])")) as string;
const actions = JSON.parse(raw) as Array<{ type: string; value: string | null; target: { selector: string } }>;
console.log(`captured over CDP: ${actions.length}`);
for (const a of actions) console.log(`  - ${a.type} ${a.target?.selector} ${a.value ? `= "${a.value}"` : ""}`);
console.log(actions.length >= 3
  ? "\nCDP CAPTURE ✅  array approach works over Browserbase — live-teach on cloud is viable."
  : "\nCDP CAPTURE ❌  still thin — inspect above.");
await browser.close();
process.exit(0);
