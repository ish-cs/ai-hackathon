// Diagnostic: WHY does capture get 0 actions over Browserbase CDP? Tests, in isolation, whether
// Playwright's exposeBinding + addInitScript actually take effect on Browserbase's pre-existing page.
// Uses STRING page-side code (not inline fns) to avoid the esbuild __name() confound.
// Run: tsx --env-file=.env browserbase-cdp-probe.ts
import Browserbase from "@browserbasehq/sdk";
import { chromium } from "playwright";

const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY! });
const MOCK_URL = process.env.MOCK_URL!;

const session = await bb.sessions.create({ timeout: 120, browserSettings: { viewport: { width: 1280, height: 800 } } });
const browser = await chromium.connectOverCDP(session.connectUrl);
const page = browser.contexts()[0].pages()[0];

let bindingCalls = 0;
await page.exposeBinding("__probe", () => { bindingCalls++; }); // Node-side callback
await page.addInitScript({ content: "window.__initRan = true;" }); // string → no esbuild mangling
await page.goto(MOCK_URL, { waitUntil: "domcontentloaded" });

const hasProbe = await page.evaluate("typeof window.__probe");
const initRan = await page.evaluate("window.__initRan === true");
await page.evaluate("window.__probe && window.__probe({x:1})"); // call the binding from the page
await page.waitForTimeout(400);

// Can we at least READ a value the page sets, via evaluate? (the fallback capture mechanism)
await page.evaluate("window.__bucket = (window.__bucket||[]); window.__bucket.push('hello')");
const bucket = await page.evaluate("JSON.stringify(window.__bucket||[])");

console.log("exposeBinding → typeof window.__probe:", hasProbe);
console.log("addInitScript ran on goto:           ", initRan);
console.log("binding calls received in Node:      ", bindingCalls);
console.log("page-array readable via evaluate:    ", bucket);
await browser.close();
process.exit(0);
