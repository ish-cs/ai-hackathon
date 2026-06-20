import type { RawTrace, Workflow, WorkflowStep } from "../shared/types";
import { completeJSON } from "./anthropic";

// The model produces parameters + steps; we assign ids/version/healHistory in code.
type StructureOutput = {
  parameters: { name: string; example: string }[];
  steps: Omit<WorkflowStep, "stepId" | "healHistory">[];
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    parameters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { name: { type: "string" }, example: { type: "string" } },
        required: ["name", "example"],
      },
    },
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["click", "input", "navigate", "select", "submit"] },
          intent: { type: "string" },
          selector: { type: "string" },
          fallbackHints: {
            type: "object",
            additionalProperties: false,
            properties: {
              role: { type: ["string", "null"] },
              label: { type: ["string", "null"] },
              text: { type: ["string", "null"] },
              nearText: { type: ["string", "null"] },
            },
            required: ["role", "label", "text", "nearText"],
          },
          valueFrom: { type: ["string", "null"] },
          valueLiteral: { type: ["string", "null"] },
        },
        required: ["action", "intent", "selector", "fallbackHints", "valueFrom", "valueLiteral"],
      },
    },
  },
  required: ["parameters", "steps"],
};

const SYSTEM = `You convert a raw browser action trace into a structured, reusable, parameterized workflow that can be replayed on new data and self-healed when the site changes.

For each action decide:

1. intent — a SEMANTIC description of what the step accomplishes, written so the element can be re-found by MEANING after a redesign. Be specific enough to disambiguate it from other elements ("type the customer's email into the email field", "click the primary button that submits/saves the form") but NEVER reference the selector, id, or DOM position. This is the single most important field: the healer re-grounds the element from it.

2. variable vs fixed —
   - VARIABLE: per-record data that changes every run (a customer name, email, address, amount). Set valueFrom to a stable camelCase parameter name, leave valueLiteral null, and add that parameter to parameters[] with the observed value as its example.
   - FIXED: the same every run (clicking submit, navigating, a constant select option). Set valueFrom null and valueLiteral to the literal value, or null for a pure click/submit.
   Use ONE consistent parameter name across all steps that share a value.

3. selector — the most STABLE selector for the element from what the trace shows, preferring a durable attribute (name, type, role) over a volatile auto-generated id. This is the happy-path selector; the healer fixes it only if it breaks.

4. fallbackHints — the healer's lifeline when the selector breaks. Copy role/label/text from the action's target, and infer nearText (a nearby visible label or heading) from the surrounding DOM. Favor the most distinguishing, rename-resistant cues.

Return ONLY the parameters and steps.`;

/**
 * Raw trace → parameterized Workflow.
 * SYSTEM tuned for intent quality + variable detection + rename-resistant hints.
 * VALIDATE at the event: run on a REAL recorded trace (not just the fixture) once the key lands.
 */
export async function structure(trace: RawTrace): Promise<Workflow> {
  const out = await completeJSON<StructureOutput>({
    system: SYSTEM,
    user: JSON.stringify(trace, null, 2),
    schema: SCHEMA,
    effort: "high",
  });

  return {
    workflowId: `wf_${trace.traceId.replace(/^trace_/, "")}`,
    task: trace.task,
    version: 1,
    startUrl: trace.startUrl,
    parameters: out.parameters,
    steps: out.steps.map((s, i): WorkflowStep => ({
      ...s,
      stepId: `s${i + 1}`,
      healHistory: [],
    })),
  };
}
