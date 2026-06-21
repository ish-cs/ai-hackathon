// Cheap, free proof (headless, no cloud/LLM) that the race's per-round retarget maps row r → lead r on
// the live 20-lead parody, and that the page caps at 20. Mirrors server.ts's selector rewrite exactly.
// Run: npx tsx --env-file=.env verify-leads.ts
import { chromium } from "playwright";

(async () => {
  const url = process.env.DEMO_START_URL ?? "https://mock-public-ish-c.vercel.app/linkedin.html";
  const base = "#li-results > div:nth-of-type(1) > div:nth-of-type(2) > div:nth-of-type(4) > button:nth-of-type(1)";
  const expected = ["Sarah Chen", "Marcus Lee", "Priya Patel", "Diego Alvarez"];

  const b = await chromium.launch({ headless: true });
  const p = await b.newPage();
  await p.goto(url);
  await p.waitForSelector("#li-results .result");

  let ok = true;
  for (let r = 1; r <= 4; r++) {
    const sel = base.replace(/div:nth-of-type\(\d+\)/, `div:nth-of-type(${r})`); // == server.ts retarget
    const name = await p
      .locator(sel)
      .evaluate((el) => el.closest("[data-target]")?.getAttribute("data-name") ?? "?")
      .catch(() => "MISS");
    const good = name === expected[r - 1];
    ok = ok && good;
    console.log(`round ${r}: row-${r} Message → "${name}" ${good ? "✅" : "❌ expected " + expected[r - 1]}`);
  }

  const count = await p.locator("#li-results .result").count();
  console.log(`\ntotal results rendered: ${count} (expect 20)`);
  await b.close();

  const pass = ok && count === 20;
  console.log(pass ? "LEAD WALK ✅ — each round targets the next lead; page capped at 20" : "⚠️ check above");
  process.exit(pass ? 0 : 1);
})();
