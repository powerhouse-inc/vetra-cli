# Mastra AI Builder Integration — vetra adaptation

This document adapts the generic Mastra "AI builder with workflows + expert
subagents + clarification broker" pattern to the existing vetra plan.
The shape of the system (drive editor, reactor-project preview surface,
chat-session document, workflow registry, local API) is already decided in
`ARCHITECTURE.md` and `HANDOFF.md`. This file is about how Mastra workflows
and expert subagents plug into that shape **without changing the editor
contract** — i.e. as a V2 swap-in behind the same agent / tool / API
surface.

It is intentionally narrower than the generic guide: pieces that the
existing plan already settles differently (or defers) are called out
explicitly rather than reintroduced.

For context, read first:
- `ARCHITECTURE.md` → "Components" and "State transport".
- `HANDOFF.md` → "Architecture decisions" (12 is the load-bearing one for
  this document) and "Things NOT done".

---

## Mapping the generic model onto vetra

| Generic guide concept           | vetra equivalent                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| Chat UI                         | Vetra Studio drive editor (`vetra-app/editors/vetra-studio/`)                        |
| Builder Agent                   | The Mastra agent in `vetra-cli/src/agents/agent.ts`                                  |
| User-facing conversation        | Chat-session document in the vetra drive (`chatSessionWatchTrigger` forwards)        |
| Workflow tools on the agent     | Workflow registry tools: `start_workflow`, `set_step_content`, `complete_step`, …   |
| Workflow runtime                | **MVP:** agent-driven registry, no engine. **V2:** Mastra workflow runners.          |
| Nested workflows                | Per-concept-type workflows: document model, business logic, editor spec, component  |
| Expert subagents                | Domain-scoped Mastra agents invoked from workflow steps (V2)                         |
| Spec (source of truth)          | `.phd` spec documents in reactor-project source tree; mirrored to vetra drive       |
| Generated code                  | Codegen output written into the reactor-project tree                                 |
| Validation gates                | TBD — currently implicit in `ph-cli` codegen + tsc; needs an explicit gate (V2)      |
| Build graph                     | **Not adopted as-is.** See "Build graph" below.                                      |
| Clarification broker            | **Not adopted as-is.** See "Clarification handling" below.                           |
| Project state                   | Split: chat-session doc (reactor) + workflow registry (local API) + service manager |
| Preview / artifact rendering    | reactor-project Connect, deep-linked into the BUILD scaffold card via iframe         |
| Suspend/resume                  | Maps onto agent turns gated by chat-session user messages, not Mastra suspend (MVP)  |

The headline: **the editor / agent / tool / local-API surface defined in
HANDOFF stays as-is**. Mastra workflows and expert subagents land *behind*
the existing workflow-tool calls — `start_workflow` becomes "spawn a Mastra
workflow run", `set_step_content` becomes "resume run with payload", etc.

---

## What the generic guide gets right for us

Carry these over verbatim:

1. **Specs are the source of truth; generated code is derived.** Already
   true in vetra: `spec-create` / `spec-update` produce `.phd` files,
   `spec-generate` derives code, the reactor-project Vite HMR cycle picks
   the code up. Keep this rule when adding Mastra workflows.

2. **Expert subagents don't speak to the user.** When we add domain
   subagents in V2 (`DocumentModelExpert`, `BusinessLogicExpert`,
   `EditorSpecExpert`, `ReactComponentExpert`), they must return
   structured outputs only. The Builder Agent owns the chat-session
   document.

3. **Workflows are deterministic orchestration; agent is conversation.**
   This is exactly the line `HANDOFF.md` decision 12 is preserving — the
   editor / agent / tool surface is the conversation side, the registry
   (and later Mastra runners) is the orchestration side.

4. **Artifacts carry traceability.** When codegen writes a file, the
   artifact record should reference the originating spec path and the
   workflow run id. We can add this cheaply on top of the existing
   `spec-generate` flow.

5. **Per-concept workflows (`documentModelWorkflow`,
   `businessLogicWorkflow`, `documentEditorWorkflow`,
   `reactComponentWorkflow`).** These map cleanly onto our existing tool
   families. In V2 each becomes a Mastra workflow; in MVP each is a tool
   the agent calls in sequence.

---

## What we deviate from, and why

### Build graph: not adopting the dynamic graph model

The generic guide pushes a `BuildGraph` of nodes-with-dependencies as the
substrate that phase workflows read/update. We're not adopting that for
vetra.

Reasons:

- Our preview surface is already organized around a **reactor-project**,
  not an abstract concept graph. Dependencies between document model,
  business logic, editor spec, and component implementation are already
  expressed in the codegen pipeline (`spec-generate` consumes specs in
  the right order) and in the reactor-project's filesystem layout.
- A separate build graph would duplicate state that already exists in
  the reactor-project tree (which specs exist, which have been
  generated, which produced compile errors).
- MVP scope is one chat session at a time, one (or few) active workflow
  instances, on a single reactor-project. The dynamic-dependency case
  the generic guide solves is overkill at this scope.

When build-graph-shaped state becomes necessary (a single chat session
coordinating many concept nodes across multiple projects, or
parallelization beyond what `.foreach()` over specs gives us), revisit.
Until then: treat the reactor-project source tree + the workflow
registry as the working set.

### Clarification broker: not adopting the structured-question pattern

The generic guide routes all expert-subagent questions through a
`ClarificationRequest` → suspend → user-answer → resume cycle, with
durable `DecisionRecord` rows.

For MVP we don't need this. The Builder Agent **is** in a chat session
with the user already; questions are just turns in that conversation.
Decisions persist as user messages + agent responses in the chat-session
document, which is already a CRDT with full history.

When we add expert subagents in V2:

- Subagents should still **return** structured clarification objects (so
  the Builder Agent can format them consistently), but
- The "suspend workflow / resume on answer" plumbing maps onto our
  existing flow: workflow tools record state in the registry, the agent
  asks the user, the user's reply triggers `chatSessionWatchTrigger`,
  the next agent turn calls the appropriate workflow tool to advance
  the run.
- Mastra's native `suspend`/`resume` becomes relevant only when a
  workflow needs to pause *across* agent turns without an agent in the
  loop (e.g. a background validation pass). HANDOFF.md "Things NOT
  done" already flags this.

Skip `DecisionRecord` as a separate type. The chat-session document is
already the decision log.

### Project state shape: stays split

The generic guide proposes a single `ProjectState` object containing
spec, build graph, artifacts, clarifications, decisions. We keep the
split that's already in `ARCHITECTURE.md → State transport`:

- **Chat-session document (reactor):** messages, tool calls, tool
  results, workflow dispatch events. This is the decision log and the
  domain content.
- **Workflow registry (local API, in-memory):** active workflow
  instances and their step state. Ephemeral.
- **Reactor-project source tree:** spec documents + generated code.
- **Service manager state (`<workdir>/.ph/vetra-cli/services/…`):**
  reactor-project lifecycle.

Don't merge these. Each has a different transport, lifetime, and
replication story.

### Suspend / resume: re-mapped to agent turns for MVP

Use Mastra `suspend`/`resume` only for V2 background workflows. For the
MVP agent-driven flow, the natural pause points are agent turns: the
workflow registry holds the state, the agent decides when to ask, the
user's reply is a new turn.

---

## V2 target: per-concept workflows behind the existing tools

When we move from agent-driven workflows to Mastra-runner workflows, the
shape is:

```txt
Builder Agent (vetra-cli/src/agents/agent.ts)
  ↓ calls
Workflow tools (start_workflow / set_step_content / …)
  ↓ start / resume
Mastra workflow run                               (src/workflows/*)
  ├─ documentModelWorkflow                        ← spec-create / spec-update / spec-generate
  ├─ businessLogicWorkflow                        ← (new) spec for behavior + codegen
  ├─ documentEditorWorkflow                       ← editor spec + codegen
  └─ reactComponentWorkflow                       ← component spec + codegen
       ↓ each step calls
       Expert subagent (Mastra agent)             (src/agents/experts/*)
         returns: { specPatches, artifacts,
                    clarifications, findings }
       ↓ workflow then
       applies spec patches → reactor-project tree
       runs validators
       writes artifacts via spec-generate
       updates workflow registry (drives SSE → editor)
```

Key constraints preserved from the existing plan:

- Workflow tool **inputs/outputs don't change** between MVP and V2.
  The agent's tool surface and the editor's render contract stay stable.
- Spec writes still go through the reactor-project tree (so Vite HMR
  picks them up) and are mirrored back into the vetra drive by
  `specFsSyncTrigger`. Don't write specs directly into the vetra
  drive from a workflow step.
- Workflow registry mutations still drive the local API's SSE channel.
  Whether the mutation source is "agent tool call" (MVP) or "Mastra
  workflow step" (V2) is invisible to the editor.

---

## Concrete V2 implementation outline

When ready to start the Mastra-workflow integration, the work breakdown
is:

### 1. Lift the workflow registry into a shape Mastra runs can drive

`src/workflows/registry.ts` (planned per HANDOFF step 4) should expose
both:

- An imperative API for MVP agent tool handlers
  (`startInstance`, `setStepContent`, …).
- A way to bind a registry instance to a Mastra workflow run id, so a
  Mastra step can `registry.update(instanceId, …)` and the SSE channel
  fans out as before.

The registry stays the **single mutation point** for editor-visible
workflow state, regardless of who mutates it.

### 2. Implement one nested workflow end-to-end before generalizing

Pick `documentModelWorkflow` first. It maps onto the existing
`spec-create` + `spec-update` + `spec-generate` chain. A single Mastra
workflow run should:

- Read or draft a `DocumentModelSpec` (Zod-typed).
- Validate it (initially: schema-level only; later: cross-spec).
- Write it into the reactor-project tree via the same code paths
  `spec-create` / `spec-update` use today.
- Trigger codegen via the same code path `spec-generate` uses today.
- Update the workflow registry's step state at each transition.

No build graph; no clarification broker. The agent asks any follow-up
questions in chat the same way it does today.

Once this round-trips, repeat for `businessLogicWorkflow`,
`documentEditorWorkflow`, `reactComponentWorkflow`.

### 3. Add expert subagents as workflow-step internals

When a per-concept workflow grows logic that wants a domain prompt
(e.g. "given this rough description, propose a `DocumentModelSpec`"),
extract it into a Mastra agent registered under
`src/agents/experts/<name>.ts`. Call it from a workflow step. It
returns structured output — never speaks to the user directly.

Tests should cover: the subagent's output is a valid spec patch, the
workflow correctly applies it, codegen succeeds.

### 4. Add a validation phase only once it's cheap

The generic guide's `ValidationPhaseWorkflow` is the right shape but
expensive to write speculatively. Defer until at least two concept
workflows are landing artifacts; then add a workflow run that:

- Re-loads specs from the reactor-project tree.
- Validates cross-spec references (e.g. an editor spec referring to a
  document model that exists).
- Runs `tsc` against the generated tree.
- Surfaces findings as tool-call records in the chat-session document.

This is the closest thing to the generic guide's "project-level
validation" gate that we need.

### 5. Background workflows + true suspend/resume

This is the point at which Mastra's `suspend`/`resume` and the
"clarification broker" pattern start to earn their keep — when a
workflow run needs to wait on something that isn't a user message
inside an agent turn. Likely candidates: long-running codegen tasks,
external CI validation, multi-step `.foreach()` over many concepts.

Until that's a real need, the simpler agent-turn-as-resume model is
fine.

---

## File layout (V2)

Built on top of the layout in `ARCHITECTURE.md → Filesystem layout`:

```txt
vetra-cli/src/
  agents/
    agent.ts                         ← Builder Agent (today)
    experts/                         ← V2
      document-model-expert.ts
      business-logic-expert.ts
      editor-spec-expert.ts
      react-component-expert.ts
      validation-expert.ts
  workflows/                         ← MVP registry; V2 Mastra runs
    registry.ts
    document-model.workflow.ts       ← V2
    business-logic.workflow.ts       ← V2
    document-editor.workflow.ts      ← V2
    react-component.workflow.ts      ← V2
    validation.workflow.ts           ← V2 (once worth it)
  schemas/                           ← V2
    document-model-spec.ts
    business-logic-spec.ts
    editor-spec.ts
    react-component-spec.ts
    workflow-state.ts
  api/                               ← already planned
    server.ts
    routes/workflows.ts
    routes/projects.ts
```

No `schemas/build-graph.ts`, no `schemas/clarification.ts`,
no `services/clarification-service.ts` — see "What we deviate from".

---

## Guardrails (vetra-specific)

In addition to the generic guide's guardrails (which all still apply —
specs are source of truth, derived code is derived, expert subagents
don't talk to users, etc.):

1. **Don't change the workflow tool surface or editor render contract
   when adding Mastra workflows.** That's the entire point of decision
   12 in HANDOFF.md.
2. **Don't write specs directly to the vetra drive from workflow
   steps.** Always go through the reactor-project tree so `specFsSync`
   stays the single mirror direction.
3. **Don't introduce a build graph or clarification broker without
   re-reading this document.** Both were considered and intentionally
   deferred for MVP.
4. **Don't extend the dormant `local-registry` / `publish-reload`
   chain** while wiring workflows. It's gated off; if a workflow needs
   dynamic package loading, that's a flag-flip decision, not an
   implementation detail.
5. **One mutation source for editor-visible workflow state:** the
   workflow registry. Whether the caller is an MVP tool handler or a
   V2 Mastra step, the registry is the only thing the editor
   subscribes to (via the local API's SSE channel).

---

## Acceptance criteria (V2)

The Mastra-workflow integration is complete when:

- The Builder Agent can call `documentModelWorkflow`, and the run
  produces a validated spec + codegen output in the reactor-project,
  observable in the BUILD card via Vite HMR.
- Workflow registry state visible to the editor is identical in shape
  to the MVP version (same SSE payloads, same instance lifecycle).
- A user can interrupt a workflow run by sending a chat message
  ("actually, make it a `Customer` not a `Person`"); the agent applies
  the change via the appropriate spec-update path and the workflow
  reflects the new state.
- Expert subagents return structured output and never write directly
  to the chat-session document.
- Generated artifacts carry the originating spec path and workflow
  run id in their metadata (artifact-traceability rule from the
  generic guide).
- A cross-spec validation pass exists and surfaces findings as tool
  calls in the chat-session document.

---

## Reading order for whoever picks this up

1. `ARCHITECTURE.md` — full document. The runtime composition isn't
   negotiable from this side.
2. `HANDOFF.md` — "Architecture decisions" (especially 12), then
   "Things NOT done".
3. This file — the mapping table and "What we deviate from".
4. Mastra docs linked in the original guide, in this order: workflows
   on agents → workflow steps calling agents/tools → control flow →
   suspend/resume → `.foreach()`.

Don't start with the generic guide — its build-graph + clarification-
broker framing will pull the design in a direction we've explicitly
chosen not to go for MVP.
