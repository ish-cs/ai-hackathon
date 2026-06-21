// Programmatic LinkedIn login for a warming session (the fullscreen live-view can't paste).
// Usage: npx tsx --env-file=.env login-burner.ts <sessionId> <email> <password>
// Creds come from argv (never hardcoded/committed). Screenshots the result so we can see the real state.
import { chromium } from "playwright";

async function main(): Promise<void> {
  const [sessionId, email, password] = process.argv.slice(2);
  if (!sessionId || !email || !password) throw new Error("usage: login-burner.ts <sessionId> <email> <password>");
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) throw new Error("BROWSERBASE_API_KEY unset");

  // Reconnect to the already-running keepAlive session (documented Browserbase connect URL form).
  const browser = await chromium.connectOverCDP(`wss://connect.browserbase.com?apiKey=${apiKey}&sessionId=${sessionId}`);
  const page = browser.contexts()[0].pages()[0];

  console.log("connected. url:", page.url(), "| title:", await page.title());
  await page.screenshot({ path: "burner-before.png" }).catch(() => {});

  // Already on the sign-in page (pre-navigated). Target the VISIBLE labeled fields — .first() on a
  // raw #username matched a hidden duplicate input ("element is not visible").
  const emailField = page.getByLabel("Email or phone").filter({ visible: true }).first();
  await emailField.waitFor({ state: "visible", timeout: 20000 });
  await emailField.fill(email);
  await page.getByLabel("Password", { exact: true }).filter({ visible: true }).first().fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).filter({ visible: true }).first().click();

  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4000);

  const url = page.url();
  console.log("after-login url:", url);
  console.log("title:", await page.title());
  await page.screenshot({ path: "burner-after-login.png" }).catch(() => {});
  console.log("screenshot: burner-after-login.png");

  const ok = /linkedin\.com\/(feed|in\/|mynetwork|home)/.test(url) && !/login|checkpoint|uas|challenge/.test(url);
  console.log(ok ? "LOGIN ✅ on the app — looks logged in" : "LOGIN ⚠️ not on feed — checkpoint/verification likely (see screenshot)");
  await browser.close().catch(() => {});
  process.exit(0);
}

main().catch((e) => {
  console.error("login failed:", (e as Error).message);
  process.exit(1);
});
