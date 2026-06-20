// Recorder smoke test — the piece sample-based smoke.ts skips. Drives the REAL Recorder against
// /mock with a scripted demonstration, dumps the captured RawTrace, and checks the fields the
// downstream seam (structure -> replay) depends on. Server must be up on :3000.
// Run: npx tsx capture-trace.ts
import { readFileSync } from "node:fs";
import { Recorder } from "./runtime/recorder";
import type { RawTrace, RawAction } from "./shared/types";

const fixture: RawTrace = JSON.parse(
  readFileSync(new URL("./shared/fixtures/sample-trace.json", import.meta.url), "utf8"),
);

function summarize(a: RawAction): string {
  const t = a.target;
  return `${a.type.padEnd(7)} sel=${String(t.selector).padEnd(14)} role=${String(t.role).padEnd(8)} label=${String(t.label).padEnd(15)} text=${String(t.text).padEnd(8)} value=${String(a.value).padEnd(16)} domLen=${t.domSnapshot.length}`;
}

(async () => {
  const rec = new Recorder();
  await rec.start("http://localhost:3000/mock");
  const page = rec.livePage!;

  // Scripted demonstration. Each fill changes focus, blurring the prior field -> native `change`
  // fires (captured as input); clicking submit blurs email then fires the submit click.
  await page.fill("#name", "Acme Corp");
  await page.fill("#email", "hello@acme.com");
  await page.click("#submit-btn");
  await page.waitForTimeout(200); // let capture-phase listeners flush over the binding

  const trace = await rec.stop("copy a customer from the source list into the target form");

  console.log("\n── LIVE TRACE (from real Recorder) ──");
  console.log(`traceId=${trace.traceId}  startUrl=${trace.startUrl}  actions=${trace.actions.length}`);
  trace.actions.forEach((a, i) => console.log(`  [${i}] ${summarize(a)}`));

  console.log("\n── FIXTURE (sample-trace.json) ──");
  fixture.actions.forEach((a, i) => console.log(`  [${i}] ${summarize(a)}`));

  // Field checks that matter for the downstream seam (structure -> replay).
  const checks: [string, boolean][] = [
    ["3 actions captured", trace.actions.length === 3],
    ["order: input, input, submit", trace.actions.map((a) => a.type).join(",") === "input,input,submit"],
    ["selectors #name,#email,#submit-btn", trace.actions.map((a) => a.target.selector).join(",") === "#name,#email,#submit-btn"],
    ["values Acme Corp / hello@acme.com / null", `${trace.actions[0]?.value},${trace.actions[1]?.value},${trace.actions[2]?.value}` === "Acme Corp,hello@acme.com,null"],
    ["every target has role", trace.actions.length > 0 && trace.actions.every((a) => a.target.role)],
    ["every target has label or text", trace.actions.length > 0 && trace.actions.every((a) => a.target.label || a.target.text)],
    ["every target has domSnapshot", trace.actions.length > 0 && trace.actions.every((a) => a.target.domSnapshot.length > 0)],
  ];
  console.log("\n── CHECKS ──");
  let pass = true;
  for (const [name, ok] of checks) {
    if (!ok) pass = false;
    console.log(`  ${ok ? "✓" : "✗"} ${name}`);
  }
  console.log(`\n══ LIVE CAPTURE: ${pass ? "PASS ✅" : "FAIL ❌"} ══`);
  process.exit(pass ? 0 : 1);
})();
