// The seam. Brain ↔ Runtime ↔ Web all speak these and nothing else.
// This file IS the contract — change it here, together, before changing any consumer.
// Prose spec + rationale: ../DOCS/CONTRACT.md

export type ActionType = "click" | "input" | "navigate" | "select" | "submit";

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
  /** For input/select; null otherwise. */
  value: string | null;
  target: ElementContext;
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
  /** Literal value for fixed actions, OR null when valueFrom is set. */
  valueLiteral: string | null;
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

/** What the web UI receives over the WebSocket. A tagged union keeps the client honest. */
export type RunEvent =
  | { kind: "step"; lane: "healing" | "control"; result: StepResult }
  | { kind: "heal"; lane: "healing" | "control"; result: HealResult }
  | { kind: "run_start"; lane: "healing" | "control"; workflowId: string; row: DataRow }
  | { kind: "run_done"; lane: "healing" | "control"; workflowId: string; ok: boolean };
