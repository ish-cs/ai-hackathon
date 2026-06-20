// Visual check for the demo windows: launch the two lanes at their real positions, inject the
// REAL label + verdict helpers from player.ts, and screenshot each PAGE (captures injected DOM
// regardless of how the OS stacks windows). control → LEFT + red FAILED, healing → RIGHT + green
// SUCCEEDED. Server must be running so /mock loads.  Run: tsx --env-file=.env verify-windows.ts
import { chromium } from "playwright";
import { injectLaneLabel, markLaneResult } from "./runtime/player";

const URL = "http://localhost:3000/mock";

async function shot(lane: "control" | "healing", x: number, ok: boolean, file: string): Promise<void> {
  const browser = await chromium.launch({
    headless: false,
    args: [`--window-position=${x},40`, "--window-size=780,960"],
  });
  const page = await browser.newPage({ viewport: null });
  await page.goto(URL, { timeout: 10000 });
  await injectLaneLabel(page, lane);
  await markLaneResult(page, ok); // simulate the end-of-run verdict
  await page.screenshot({ path: file });
  console.log(`${lane}: window @ x=${x}, verdict=${ok ? "SUCCEEDED" : "FAILED"} → ${file}`);
  await browser.close();
}

await shot("control", 24, false, "/tmp/lane-control.png"); // LEFT, red
await shot("healing", 824, true, "/tmp/lane-healing.png"); // RIGHT, green
console.log("done");
process.exit(0);
