// Cloud Redis reachability check — proves the shared sponsor DB works before we both point at it.
import { readFileSync } from "node:fs";
import { createClient } from "redis";

for (const line of readFileSync(new URL("./.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const url = process.env.REDIS_URL ?? "";
console.log(`\n── connecting to ${url.replace(/:[^:@]+@/, ":****@")} ──`);

const client = createClient({ url });
client.on("error", (e) => console.error("  redis error:", e.message));

const t0 = Date.now();
await client.connect();
console.log(`  ✓ connected in ${Date.now() - t0}ms`);

console.log(`  PING → ${await client.ping()}`);
await client.set("mimic:smoke", "alive");
console.log(`  SET/GET round-trip → ${await client.get("mimic:smoke")}`);
await client.del("mimic:smoke");

await client.quit();
console.log(`\n══ CLOUD REDIS: PASS ✅ — shared DB reachable, both teammates can point here ══\n`);
