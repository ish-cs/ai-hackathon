// Turns OFF Vercel Deployment Protection (SSO) for the public mock project so a Browserbase cloud
// browser can load it. Reads the token from the Vercel CLI's own auth file at runtime (the secret
// never enters the agent's context). Run: tsx disable-vercel-protection.ts
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const projectId = "prj_5tW6C0MIyMwZQKdxpGXpkJMD0OTp";
const teamId = "team_zISBBkIYM4HNRfyFuWV7AiO0";

function vercelToken(): string {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN;
  const candidates = [
    join(homedir(), "Library/Application Support/com.vercel.cli/auth.json"),
    join(homedir(), ".config/vercel/auth.json"),
    join(homedir(), ".vercel/auth.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      const t = JSON.parse(readFileSync(p, "utf8")).token;
      if (t) return t;
    }
  }
  throw new Error("no Vercel token found (set VERCEL_TOKEN or run `vercel login`)");
}

const res = await fetch(`https://api.vercel.com/v9/projects/${projectId}?teamId=${teamId}`, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${vercelToken()}`, "Content-Type": "application/json" },
  body: JSON.stringify({ ssoProtection: null }),
});
const j = (await res.json()) as Record<string, unknown>;
console.log("status:", res.status);
console.log("ssoProtection:", JSON.stringify(j.ssoProtection ?? null));
console.log("passwordProtection:", JSON.stringify(j.passwordProtection ?? null));
if (!res.ok) console.log("error:", JSON.stringify(j).slice(0, 300));
process.exit(res.ok ? 0 : 1);
