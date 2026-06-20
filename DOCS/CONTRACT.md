# CONTRACT.md — The Seams Between Lanes

**Status: DRAFT — ratify in hour one. Nobody edits another lane's code; you change *this file* together.**

This defines every JSON shape that crosses a lane boundary. Brain ↔ Hands ↔ Face all speak these types and nothing else. If a shape needs to change, change it here first, then everyone pulls.

The flow these types serve:

```
Hands.record() ──RawTrace──▶ Brain.structure() ──Workflow──▶ Redis
                                                                │
Face "Run" ─────────────────────────────────────────────▶ Hands.replay(Workflow, dataRow)
                                                                │
                                              per step: Hands executes ──▶ StepResult
                                                                │ (on failure)
                              Hands ──HealRequest(step, liveDom)──▶ Brain.heal() ──HealResult──▶ Hands retries
                                                                │
                                              Brain ──patched Workflow──▶ Redis  (heal written back)
                                                                │
                                  every event ──▶ Face (live viz) + Sentry (failures)
```

---

## 1. RawTrace — Hands → Brain

What the record-agent emits after the user demonstrates the task once. Raw, unstructured, one entry per captured action.

```jsonc
{
  "traceId": "trace_abc123",
  "task": "copy customers from list into form",   // user-typed label
  "startUrl": "http://localhost:3000/tab-a",
  "actions": [
    {
      "type": "click | input | navigate | select | submit",
      "timestamp": 1718900000000,
      "value": "Acme Corp",                        // for input/select; null otherwise
      "target": {
        "selector": "#customer-name",              // best-effort CSS selector at record time
        "role": "textbox",                         // ARIA role if present
        "label": "Customer Name",                  // visible label / aria-label / placeholder
        "text": "Submit",                          // inner text (for buttons/links)
        "attributes": { "id": "submit-btn", "name": "submit", "type": "button" },
        "domSnapshot": "<form>...</form>"          // trimmed surrounding HTML — Brain uses this to infer intent
      }
    }
  ]
}
```

**Hands guarantees:** every action has a `type`, a `timestamp`, and a `target` with at minimum `selector` + one of `label`/`text`. `domSnapshot` is trimmed (the relevant subtree, not the whole page).

---

## 2. Workflow — Brain → Redis → Hands

The structured, parameterized result. This is what gets saved and replayed. **The healer writes patched versions back into this same shape.**

```jsonc
{
  "workflowId": "wf_xyz789",
  "task": "copy customers from list into form",
  "version": 3,                                    // bumped on every heal
  "startUrl": "http://localhost:3000/tab-a",
  "parameters": [                                  // the variable columns in the data
    { "name": "customerName", "example": "Acme Corp" },
    { "name": "customerEmail", "example": "a@acme.com" }
  ],
  "steps": [
    {
      "stepId": "s1",
      "action": "input | click | navigate | select | submit",
      "intent": "type the customer's name into the Name field",   // SEMANTIC — what this step MEANS. Healer re-grounds against this.
      "selector": "#customer-name",                                // current best selector; healer overwrites on fix
      "fallbackHints": {                                           // everything Brain knows for re-grounding
        "role": "textbox",
        "label": "Customer Name",
        "text": null,
        "nearText": "Customer Information"
      },
      "valueFrom": "customerName",                                 // parameter name, OR null for fixed actions
      "valueLiteral": null,                                        // literal value for fixed actions (e.g. nothing for click)
      "healHistory": []                                            // appended on each successful heal (see HealResult)
    }
  ]
}
```

**Brain guarantees:** every step has a non-empty `intent` and `fallbackHints`. `valueFrom` XOR `valueLiteral` (one is null).

---

## 3. DataRow — Face → Hands

One unit of new data to replay the workflow against. Keys must match `Workflow.parameters[].name`.

```jsonc
{ "customerName": "Beta LLC", "customerEmail": "hi@beta.com" }
```

Replay is called once per row: `replay(workflow, dataRow)`.

---

## 4. StepResult — Hands → Face (every step) / Hands → Brain (on failure)

Emitted after Hands attempts each step. Drives the live viz and triggers heal.

```jsonc
{
  "workflowId": "wf_xyz789",
  "stepId": "s1",
  "status": "ok | failed | healed",
  "attemptedSelector": "#customer-name",
  "error": "no element matches selector",          // null when ok
  "liveDom": "<form>...</form>",                    // present ONLY when status=failed — Brain needs it to heal
  "screenshotUrl": null,                            // optional, for Face
  "tookMs": 240
}
```

**On `status: "failed"`** Hands sends a `HealRequest` (below) to Brain and reports the failure to Sentry. Face shows the red/break state.

---

## 5. HealRequest — Hands → Brain

```jsonc
{
  "workflowId": "wf_xyz789",
  "step": { /* the failing Workflow.step object, verbatim */ },
  "liveDom": "<form>...</form>"                     // current page DOM where the step failed
}
```

## 6. HealResult — Brain → Hands (and appended to step.healHistory)

```jsonc
{
  "stepId": "s1",
  "healed": true,
  "newSelector": "#send-btn",                       // the re-grounded selector Hands should retry with
  "reasoning": "intent was 'submit the form'; the only submit-type button is now labelled 'Send'",
  "confidence": 0.92,
  "timestamp": 1718900500000
}
```

**On `healed: true`** Hands retries the step with `newSelector`. Brain bumps `Workflow.version`, overwrites `step.selector = newSelector`, and appends this `HealResult` to `step.healHistory` in Redis. Face shows the green heal animation. On `healed: false`, the run stops and Sentry logs an unrecovered failure.

---

## 7. Redis keys (Brain owns)

```
workflow:{workflowId}            → JSON Workflow (current version)
workflow:{workflowId}:history    → list of prior versions (heal audit trail / Redis "agent memory" prize)
trace:{traceId}                  → JSON RawTrace (kept for re-structuring / debugging)
```

---

## Transport — single process (decided)

The JSON shapes above are the contract. Transport is **one Node process**: Brain/Hands/Face are modules, the lanes call each other directly, and an event emitter feeds Face's live viz. Lowest risk for the hour-4 end-to-end checkpoint. The shapes are transport-agnostic, so this stays an implementation detail — but it's decided, not open.

## Open questions to lock in hour one

- [x] **Transport: single Node process** — decided (see above); no longer open.
- [ ] How does Hands "capture user actions" in record mode — Playwright codegen/trace, CDP listeners, or a thin DOM event logger injected into the page? **Pick the lowest-risk one by hour 1.**
- [ ] `domSnapshot` / `liveDom` size cap — trim to the relevant subtree to keep Claude prompts cheap. Agree a max.
- [ ] Which break types the demo triggers (must match `Heal` scope): **renamed element + moved/changed selector only.** No others.
