// Foundation spike for the Cost Race "Stagehand lane". Proves the ONE unproven assumption the whole
// pivot rests on, BEFORE building the full lane:
//   does Stagehand v3 init on OUR Browserbase, complete an agent task, and report REAL token usage?
// Runs on a benign public page (Hacker News) — NOT live LinkedIn. LinkedIn access needs ck's warmed
// burner Context + Advanced Stealth and is a separate JOINT rehearsal; this validates MY plumbing only.
// Gate: agent.success === true AND input/output tokens > 0.
// Run: npx tsx --env-file=.env stagehand-spike.ts
import { Stagehand } from "@browserbasehq/stagehand";
import Browserbase from "@browserbasehq/sdk";

const MODEL = "anthropic/claude-opus-4-8"; // Stagehand uses AI-SDK "provider/model" form

// Browserbase needs a projectId to create a session; our .env only has the API key, so resolve it
// once via the SDK (autonomous — no extra env var required). Handles array OR paginated {data} shapes.
async function resolveProjectId(apiKey: string): Promise<string> {
  if (process.env.BROWSERBASE_PROJECT_ID) return process.env.BROWSERBASE_PROJECT_ID;
  const bb = new Browserbase({ apiKey });
  const list = (await bb.projects.list()) as unknown;
  const arr = Array.isArray(list) ? list : ((list as { data?: unknown[] }).data ?? []);
  const id = (arr[0] as { id?: string } | undefined)?.id;
  if (!id) throw new Error("No Browserbase project found for this API key");
  console.log(`[spike] resolved projectId=${id}  (add BROWSERBASE_PROJECT_ID to .env to skip this lookup)`);
  return id;
}

async function main(): Promise<void> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) throw new Error("BROWSERBASE_API_KEY unset");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY unset (Stagehand's LLM)");
  const projectId = await resolveProjectId(apiKey);

  const sh = new Stagehand({
    env: "BROWSERBASE",
    apiKey,
    projectId,
    model: MODEL,         // LLM picks up ANTHROPIC_API_KEY from env
    serverCache: false,   // no action caching → the honest "pure-LLM-every-step" expensive lane
    verbose: 1,
    browserbaseSessionCreateParams: {
      projectId,
      browserSettings: { viewport: { width: 1280, height: 800 }, blockAds: true },
    },
  });

  const t0 = Date.now();
  await sh.init();
  console.log(`[spike] init OK in ${Date.now() - t0}ms · session=${sh.browserbaseSessionID}`);

  // Live-view URL for the UI iframe (same call runtime/browser.ts uses for the lanes).
  try {
    const links = await new Browserbase({ apiKey }).sessions.debug(sh.browserbaseSessionID!);
    console.log(`[spike] live view: ${links.debuggerFullscreenUrl}`);
  } catch (e) {
    console.log(`[spike] live-view lookup failed: ${(e as Error).message}`);
  }

  // Navigate, then run a small READ→ANSWER agent task — same SHAPE as the cold-outreach task, benign.
  const page = sh.context.pages()[0] ?? (await sh.context.newPage());
  await page.goto("https://news.ycombinator.com/");
  console.log("[spike] navigated to Hacker News");

  // (maxSteps + Stagehand's built-in per-tool timeout bound the run; AbortSignal is an experimental
  // feature that needs experimental:true + disableAPI:true — not worth it for the spike.)
  const agent = sh.agent({ model: MODEL, mode: "dom" });
  const runStart = Date.now();
  const result = await agent.execute({
    instruction: "Read the front page and tell me the title of the very first (top) story.",
    maxSteps: 6,
  });
  const wallMs = Date.now() - runStart;

  console.log(`[spike] agent done · success=${result.success} · steps=${result.actions.length} · wall=${wallMs}ms`);
  console.log(`[spike] answer: ${String(result.message).slice(0, 200)}`);
  console.log(`[spike] per-run usage:`, result.usage);

  const m = await sh.metrics;
  console.log(`[spike] session metrics: prompt=${m.totalPromptTokens} completion=${m.totalCompletionTokens} inferenceMs=${m.totalInferenceTimeMs}`);

  await sh.close();

  // Gate: real tokens flowed and the agent finished. Fall back to session metrics if usage is absent.
  const tin = result.usage?.input_tokens ?? m.totalPromptTokens;
  const tout = result.usage?.output_tokens ?? m.totalCompletionTokens;
  const pass = result.success && tin > 0 && tout > 0;
  console.log(
    pass
      ? `\nSPIKE ✅ Stagehand v3 inits on Browserbase, completes the task, and reports REAL tokens (in=${tin} out=${tout}). Foundation proven — safe to build the full lane.`
      : `\nSPIKE ❌ success=${result.success} tin=${tin} tout=${tout} — inspect output above before building the lane.`,
  );
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("[spike] CRASHED:", e);
  process.exit(1);
});
