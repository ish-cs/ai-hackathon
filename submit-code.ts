// Submit a LinkedIn email-verification code into a warming session sitting on the checkpoint page.
// Usage: npx tsx --env-file=.env submit-code.ts <sessionId> <code>
import { chromium } from "playwright";

async function main(): Promise<void> {
  const [sessionId, code] = process.argv.slice(2);
  if (!sessionId || !code) throw new Error("usage: submit-code.ts <sessionId> <code>");
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) throw new Error("BROWSERBASE_API_KEY unset");

  const browser = await chromium.connectOverCDP(`wss://connect.browserbase.com?apiKey=${apiKey}&sessionId=${sessionId}`);
  const page = browser.contexts()[0].pages()[0];
  console.log("on:", page.url(), "|", await page.title());

  const field = page
    .locator("input[name='pin'], input#input__email_verification_pin, input[placeholder*='code' i], input[autocomplete='one-time-code']")
    .filter({ visible: true })
    .first();
  await field.waitFor({ state: "visible", timeout: 20000 });
  await field.fill(code);
  await page.getByRole("button", { name: /submit|verify/i }).filter({ visible: true }).first().click();

  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4000);
  console.log("after-submit url:", page.url(), "| title:", await page.title());
  await page.screenshot({ path: "burner-after-code.png" }).catch(() => {});

  const ok = /linkedin\.com\/(feed|in\/|mynetwork|home)/.test(page.url()) && !/checkpoint|login|challenge/.test(page.url());
  console.log(ok ? "VERIFIED ✅ logged in — ready to persist" : "still not in — see burner-after-code.png");
  await browser.close().catch(() => {});
  process.exit(0);
}

main().catch((e) => {
  console.error("submit-code failed:", (e as Error).message);
  process.exit(1);
});
