// Browserbase concurrency go/no-go — spec gate 2 (DOCS/BROWSERBASE.md). Opens TWO sessions and
// keeps BOTH alive at once, connects each over CDP, navigates, asserts titles. If the 2nd session
// is rejected → free/Hobby tier is concurrency-capped at 1 → the split-screen needs the hybrid
// fallback (control lane local + healing lane on Browserbase). This is THE go/no-go before any
// player code.  Run: tsx --env-file=.env browserbase-smoke.ts
import Browserbase from "@browserbasehq/sdk";
import { chromium, type Browser } from "playwright";

const apiKey = process.env.BROWSERBASE_API_KEY;
if (!apiKey) {
  console.error("NO-GO: BROWSERBASE_API_KEY unset");
  process.exit(1);
}

const bb = new Browserbase({ apiKey });
const open: { id: string; browser: Browser }[] = [];

async function openOne(n: number): Promise<{ id: string; browser: Browser }> {
  const session = await bb.sessions.create({
    browserSettings: { viewport: { width: 1280, height: 800 }, blockAds: true },
  });
  const browser = await chromium.connectOverCDP(session.connectUrl);
  const page = browser.contexts()[0].pages()[0]; // pre-provisioned context — don't newContext()
  await page.goto("https://example.com", { timeout: 30000 });
  const title = await page.title();
  console.log(`  session ${n}: id=${session.id} title="${title}"`);
  if (!/example/i.test(title)) throw new Error(`session ${n} unexpected title "${title}"`);
  return { id: session.id, browser };
}

try {
  open.push(await openOne(1)); // keep #1 OPEN…
  open.push(await openOne(2)); // …then open #2 → proves TWO concurrent
  console.log("\nGO ✅  2 concurrent Browserbase sessions confirmed — split-screen viable as specced.");
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (open.length === 1) {
    console.log(`\nNO-GO ⚠️  2nd session rejected → concurrency-capped at 1.`);
    console.log(`        → hybrid fallback: control lane LOCAL, healing lane on Browserbase.`);
    console.log(`        reason: ${msg}`);
  } else {
    console.log(`\nNO-GO ❌  failed before two sessions were open.\n        reason: ${msg}`);
  }
} finally {
  for (const o of open) await o.browser.close().catch(() => {}); // CDP disconnect ends the session
  console.log(`cleaned up ${open.length} session(s)`);
  process.exit(0);
}
