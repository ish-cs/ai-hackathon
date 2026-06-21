// The seam. Brain ↔ Runtime ↔ Web all speak these and nothing else.
// This file IS the contract — change it here, together, before changing any consumer.
// Prose spec + rationale: ../DOCS/CONTRACT.md

export type ActionType = "click" | "input" | "navigate" | "select" | "submit" | "switchTab";

/** What the recorder captured about the element a step targets. */
export interface ElementContext {
  /** Best-effort CSS selector at record time. */
  selector: string;
  /** ARIA role if present. */
  role: string | null;
  /** Visible label / aria-label / placeholder. */
  label: string | null;
  /** Inner text (for buttons/links). */
  text: string | null;
  /** Key attributes: id, name, type, etc. */
  attributes: Record<string, string>;
  /** Trimmed surrounding HTML — the Brain uses this to infer intent. */
  domSnapshot: string;
}

export interface RawAction {
  type: ActionType;
  timestamp: number;
  /** For input/select; null otherwise. For switchTab: the destination tab's URL. */
  value: string | null;
  target: ElementContext;
  /** Tab index this action ran on (for switchTab, the destination index). Absent → 0 (single-tab). */
  tab?: number;
}

/** Recorder → Brain. The unstructured demonstration. */
export interface RawTrace {
  traceId: string;
  task: string;
  startUrl: string;
  actions: RawAction[];
}

export interface WorkflowParameter {
  name: string;
  example: string;
}

/** Everything the Brain knows for re-grounding a step when its selector breaks. */
export interface FallbackHints {
  role: string | null;
  label: string | null;
  text: string | null;
  nearText: string | null;
}

/** Appended to a step's healHistory on each successful heal. */
export interface HealRecord {
  healed: boolean;
  oldSelector: string;
  newSelector: string | null;
  reasoning: string;
  confidence: number;
  timestamp: number;
}

export interface WorkflowStep {
  stepId: string;
  action: ActionType;
  /** SEMANTIC — what this step MEANS. The healer re-grounds against this, not the selector. */
  intent: string;
  /** Current best selector; the healer overwrites this on a fix. */
  selector: string;
  fallbackHints: FallbackHints;
  /** Parameter name to pull the value from, OR null for fixed actions. */
  valueFrom: string | null;
  /** Literal value for fixed actions, OR null when valueFrom is set. For switchTab: the destination tab's URL. */
  valueLiteral: string | null;
  /**
   * Tab index this step runs on. Absent → 0, so single-tab workflows (the original demo) replay
   * unchanged. For a "switchTab" step this is the DESTINATION tab index; valueLiteral carries that
   * tab's URL so the player can open it (context.newPage + goto) if it isn't open yet.
   */
  tab?: number;
  healHistory: HealRecord[];
}

/** Brain → Redis → Runtime. The structured, parameterized, replayable workflow. */
export interface Workflow {
  workflowId: string;
  task: string;
  /** Bumped on every heal that writes back. */
  version: number;
  startUrl: string;
  parameters: WorkflowParameter[];
  steps: WorkflowStep[];
}

/** Web → Runtime. One unit of new data to replay against. Keys match Workflow.parameters[].name. */
export type DataRow = Record<string, string>;

export type StepStatus = "ok" | "failed" | "healed";

/** Runtime → Web (every step) / Runtime → Brain (on failure). */
export interface StepResult {
  workflowId: string;
  stepId: string;
  status: StepStatus;
  attemptedSelector: string;
  /** null when ok. */
  error: string | null;
  /** Present ONLY when status=failed — the Brain needs it to heal. */
  liveDom: string | null;
  screenshotUrl: string | null;
  tookMs: number;
}

/** Runtime → Brain. */
export interface HealRequest {
  workflowId: string;
  step: WorkflowStep;
  /** Current page DOM where the step failed. */
  liveDom: string;
}

/** Brain → Runtime, and appended to step.healHistory. */
export interface HealResult {
  stepId: string;
  healed: boolean;
  /** The re-grounded selector the Runtime should retry with. */
  newSelector: string | null;
  reasoning: string;
  confidence: number;
  timestamp: number;
}

/**
 * Lanes a run can belong to. control/healing = the original split-screen kill-shot (/api/replay);
 * record = the teach live-view; stagehand/mimic = the Cost Race head-to-head (/api/race). Widening
 * is additive — every existing control/healing producer and consumer keeps compiling unchanged.
 */
export type Lane = "healing" | "control" | "record" | "stagehand" | "mimic";

/** What the web UI receives over the WebSocket. A tagged union keeps the client honest. */
export type RunEvent =
  | { kind: "step"; lane: Lane; result: StepResult }
  | { kind: "heal"; lane: Lane; result: HealResult }
  | { kind: "run_start"; lane: Lane; workflowId: string; row: DataRow }
  | { kind: "run_done"; lane: Lane; workflowId: string; ok: boolean }
  // Browserbase only: carries a cloud session's live-view URL so the UI can embed it as an iframe.
  // Never emitted when ENGINE=local (the OS windows are visible directly).
  | { kind: "liveview"; lane: Lane; url: string }
  // Cost Race (/api/race): per-lane cost telemetry for the on-screen meter. tokensIn/Out are REAL —
  // Stagehand reports its own usage; Mimic's teaching/heal tokens come from brain/anthropic usage.
  // costUsd is computed by runtime/metrics.ts from $/Mtok pricing. phase: "teaching" = one-time setup
  // (human demo + structure()); "running" = one replay round. run = round index.
  | { kind: "metrics"; lane: "stagehand" | "mimic"; run: number;
      phase: "teaching" | "running"; tokensIn: number; tokensOut: number;
      ms: number; costUsd: number };
