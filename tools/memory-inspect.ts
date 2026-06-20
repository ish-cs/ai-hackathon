// memory-inspect — read-only window into Mimic's shared agent memory (Redis).
// One brain, two screens, one memory: shows the workflows + heal audit trail
// that the healer writes and the demo's memory panel reads.
//
//   npx tsx tools/memory-inspect.ts            overview (all workflows + heals)
//   npx tsx tools/memory-inspect.ts <id>       deep-dive one workflow (version + heal timeline)
//   npx tsx tools/memory-inspect.ts --json      machine-readable dump
//
// READ ONLY. Never writes. Safe to run against the live shared DB mid-demo.

import { createClient } from "redis";
import type { Workflow, RawTrace, HealRecord } from "../shared/types";

const url = process.env.REDIS_URL ?? "redis://localhost:6379";

/** Hide the password when echoing the connection target. */
function maskUrl(u: string): string {
  return u.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@");
}

type FlatHeal = HealRecord & { workflowId: string; stepId: string; intent: string };

/** Pull every heal out of every step, across every workflow, newest first. */
function flattenHeals(workflows: Workflow[]): FlatHeal[] {
  const out: FlatHeal[] = [];
  for (const wf of workflows) {
    for (const step of wf.steps) {
      for (const h of step.healHistory ?? []) {
        out.push({ ...h, workflowId: wf.workflowId, stepId: step.stepId, intent: step.intent });
      }
    }
  }
  return out.sort((a, b) => b.timestamp - a.timestamp);
}

function iso(ts: number): string {
  return Number.isFinite(ts) ? new Date(ts).toISOString() : "?";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const targetId = args.find((a) => !a.startsWith("--")) ?? null;

  const client = createClient({ url });
  client.on("error", (e) => console.error("[redis]", (e as Error).message));
  await client.connect();

  try {
    // Load workflows (workflow:* minus the :history lists).
    const keys = await client.keys("workflow:*");
    const wfIds = keys.filter((k) => !k.endsWith(":history"));
    const wfRaws = wfIds.length ? await client.mGet(wfIds) : [];
    const workflows = wfRaws
      .filter((r): r is string => r !== null)
      .map((r) => JSON.parse(r) as Workflow);

    // Load traces (trace:*).
    const traceKeys = await client.keys("trace:*");
    const traceRaws = traceKeys.length ? await client.mGet(traceKeys) : [];
    const traces = traceRaws
      .filter((r): r is string => r !== null)
      .map((r) => JSON.parse(r) as RawTrace);

    const heals = flattenHeals(workflows);

    if (asJson) {
      console.log(JSON.stringify({ workflows, traces, heals }, null, 2));
      return;
    }

    console.log(`\nMIMIC MEMORY — ${maskUrl(url)}\n`);

    if (targetId) {
      const wf = workflows.find((w) => w.workflowId === targetId);
      if (!wf) {
        console.log(`  no workflow "${targetId}". known: ${workflows.map((w) => w.workflowId).join(", ") || "(none)"}`);
        return;
      }
      console.log(`  ${wf.workflowId}  "${wf.task}"  v${wf.version}  ${wf.steps.length} steps`);
      console.log(`  params: ${wf.parameters.map((p) => `${p.name}=${p.example}`).join(", ") || "(none)"}\n`);

      // Version timeline from the history list.
      const histRaw = await client.lRange(`workflow:${wf.workflowId}:history`, 0, -1);
      console.log(`  VERSIONS (${histRaw.length})`);
      for (const item of histRaw) {
        const { version, wf: snap } = JSON.parse(item) as { version: number; wf: Workflow };
        const healed = snap.steps.reduce((n, s) => n + (s.healHistory?.length ?? 0), 0);
        console.log(`   v${version}  ${healed} cumulative heals`);
      }

      console.log(`\n  STEPS`);
      for (const s of wf.steps) {
        const marks = s.healHistory?.length ? `  (${s.healHistory.length} heal)` : "";
        console.log(`   ${s.stepId}  ${s.action}  "${s.intent}"${marks}`);
        console.log(`     selector: ${s.selector}`);
        for (const h of s.healHistory ?? []) {
          console.log(`     ↳ ${h.oldSelector} → ${h.newSelector ?? "(failed)"}  conf ${h.confidence}  ${iso(h.timestamp)}`);
          console.log(`       ${h.reasoning}`);
        }
      }
      return;
    }

    // Overview.
    console.log(`  WORKFLOWS (${workflows.length})`);
    for (const wf of workflows) {
      const healed = wf.steps.reduce((n, s) => n + (s.healHistory?.length ?? 0), 0);
      console.log(`   ${wf.workflowId}  "${wf.task}"  v${wf.version}  ${wf.steps.length} steps  ${healed} heals`);
    }
    if (!workflows.length) console.log("   (none)");

    console.log(`\n  TRACES (${traces.length})`);
    for (const t of traces) {
      console.log(`   ${t.traceId}  "${t.task}"  ${t.actions.length} actions`);
    }
    if (!traces.length) console.log("   (none)");

    console.log(`\n  HEAL AUDIT (${heals.length})`);
    for (const h of heals) {
      console.log(`   ${h.workflowId}/${h.stepId}  "${h.intent}"`);
      console.log(`     ${h.oldSelector} → ${h.newSelector ?? "(failed)"}  conf ${h.confidence}  ${iso(h.timestamp)}`);
    }
    if (!heals.length) console.log("   (none yet — run a broken-site heal to populate)");

    console.log(`\n  one brain, two screens, one memory.\n`);
  } finally {
    await client.quit();
  }
}

main().catch((e) => {
  console.error("memory-inspect failed:", (e as Error).message);
  process.exit(1);
});
