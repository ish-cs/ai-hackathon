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

const SYSTEM = `You convert a raw browser action trace into a structured, reusable, parameterized workflow.

For each action, decide:
- intent: a SEMANTIC description of what the step accomplishes ("submit the form", "type the customer's name"). This is what survives a site redesign — write it so an element can be re-found by meaning, not by selector.
- which actions carry VARIABLE data (the per-row values like a customer name/email) vs FIXED actions (clicking submit). For a variable input, set valueFrom to a stable camelCase parameter name and add that parameter to parameters[] with the observed value as its example. For a fixed action, set valueFrom to null and valueLiteral to the literal value (or null if there is none, e.g. a click).
- fallbackHints: copy role/label/text from the action's target, and infer nearText from the surrounding DOM if useful.

Return ONLY the parameters and steps. Keep parameter names consistent across steps.`;

/** Raw trace → parameterized Workflow. TODO(brain): tune SYSTEM against real recorded traces. */
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
