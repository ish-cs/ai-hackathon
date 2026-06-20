import { createClient } from "redis";
import type { RawTrace, Workflow } from "../shared/types";

// Redis as genuine agent memory: workflows + their full heal-history audit trail.
const client = createClient({ url: process.env.REDIS_URL ?? "redis://localhost:6379" });
client.on("error", (e) => console.error("[redis]", e.message));

let ready: Promise<void> | null = null;
function connect(): Promise<void> {
  if (!ready) ready = client.connect().then(() => undefined);
  return ready;
}

const wfKey = (id: string) => `workflow:${id}`;
const historyKey = (id: string) => `workflow:${id}:history`;
const traceKey = (id: string) => `trace:${id}`;

export async function saveWorkflow(wf: Workflow): Promise<void> {
  await connect();
  await client.set(wfKey(wf.workflowId), JSON.stringify(wf));
  // A brand-new workflow (version 1) resets its history so position 0 is always THIS
  // workflow's true original. Without this, a reused/colliding id would leave a stranger's
  // v1 at the front, and replay (which reads the oldest entry as "pristine") would grab the
  // wrong workflow. Heal write-backs (version > 1) append, building the agent-memory trail.
  if (wf.version === 1) await client.del(historyKey(wf.workflowId));
  await client.rPush(historyKey(wf.workflowId), JSON.stringify({ version: wf.version, wf }));
}

export async function getWorkflow(id: string): Promise<Workflow | null> {
  await connect();
  const raw = await client.get(wfKey(id));
  return raw ? (JSON.parse(raw) as Workflow) : null;
}

export async function listWorkflows(): Promise<Workflow[]> {
  await connect();
  const keys = await client.keys("workflow:*");
  const ids = keys.filter((k) => !k.endsWith(":history"));
  if (ids.length === 0) return [];
  const raws = await client.mGet(ids);
  return raws.filter((r): r is string => r !== null).map((r) => JSON.parse(r) as Workflow);
}

export async function getHistory(id: string): Promise<{ version: number; wf: Workflow }[]> {
  await connect();
  const items = await client.lRange(historyKey(id), 0, -1);
  return items.map((i) => JSON.parse(i) as { version: number; wf: Workflow });
}

export async function saveTrace(t: RawTrace): Promise<void> {
  await connect();
  await client.set(traceKey(t.traceId), JSON.stringify(t));
}
