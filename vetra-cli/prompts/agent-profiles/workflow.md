# Workflow (happy path)

This spine is for **project specs** — building a new document type. Product
specs (identity sheets, feature, WBS) skip it entirely: they need no project,
no Phase 0 — just `spec-create { type, name }` at the workspace root.

Building a new document type is always **Bootstrap → Model → Editor →
Preview**, with a gate between phases — don't advance past a gate until it's
met; fix the cause and re-run the failing step. The skill prompts in
`skills-tpl/` go deeper on each phase; this is the deterministic spine.

Below is a concrete run for a todo list. Each step is a tool call written as
`tool-name { key inputs }`; `…` stands in for the action list (exact input
shapes come from `spec-schema` and the `document-modeling` skill's spec-update
input reference).

## Phase 0 — Bootstrap

    reactor-project-ls
    reactor-project-init  { name: "todo-list" }       # only if it doesn't exist
    reactor-project-start { workdir: "todo-list" }     # idempotent; warms the BUILD pane

**Gate:** `reactor-project-ps` lists `todo-list` as running. If a different
project is running, stop it first.

## Phase 1 — Document model

    spec-create   { project: "todo-list", type: "powerhouse/document-model", name: "Todo List" }
    spec-update   { project: "todo-list", name: "Todo List", actions: [ SET_MODEL_ID, SET_MODEL_NAME, SET_MODEL_EXTENSION, SET_MODEL_DESCRIPTION, SET_STATE_SCHEMA, SET_INITIAL_STATE ] }
    spec-update   { project: "todo-list", name: "Todo List", actions: [ ADD_MODULE, ADD_OPERATION × N (schema only, no reducer) ] }
    spec-generate { project: "todo-list", name: "Todo List" }
    # Reducer bodies are written next, into the generated
    # `v1/src/reducers/<module>.ts` files using `mastra_workspace_edit_file`.
    # `SET_OPERATION_REDUCER` is rejected by spec-update, and ADD_OPERATION
    # is rejected if it carries a `reducer` field — reducer source is
    # TypeScript only, never spec JSON.

**Gate:** `spec-generate` reports no errors. If it fails, fix the spec via
`spec-update` and re-run — never patch files under `document-models/`. The
state schema and each operation `schema` are GraphQL SDL, not TypeScript.

## Phase 2 — Editor

The editor must exist and be generated before Phase 3 — `spec-preview-show`
without one renders a generic, non-interactive viewer in the BUILD pane.

    spec-create   { project: "todo-list", type: "powerhouse/document-editor", name: "Todo List Editor" }
    spec-update   { project: "todo-list", name: "Todo List Editor", actions: [ ADD_DOCUMENT_TYPE, SET_EDITOR_NAME, SET_EDITOR_STATUS ] }
    spec-generate { project: "todo-list", name: "Todo List Editor" }
    # `spec-generate` lays down a boilerplate editor at
    # <project>/editors/<editor>/editor.tsx that only renders the document
    # name. Edit it with `mastra_workspace_edit_file` to surface the
    # document's actual operations (use `actions` + `dispatch` from the
    # generated `document-models/<model>` module), AND delete the
    # boilerplate UI that doesn't apply (the default `handleSetName`
    # handler, the document-name input, unused imports, the demo
    # comments). The final file should contain only what the document
    # type actually needs — leftover boilerplate ships to preview.
    # Without this edit, Phase 3 will preview the boilerplate, not the
    # intended UI.

**Gate:** `spec-generate` is clean, `<project>/editors/<editor>/editor.tsx`
contains the operation-driven UI (not just the default name field), and the
watcher logs show the editor was re-bundled. Do not restart the reactor —
the watcher picks the editor up automatically (see the no-restart rule
above).

## Phase 3 — Preview

    spec-preview-create { project: "todo-list", type: "powerhouse/todo-list", name: "My Todos" }
    # populate sample data via the reactor MCP tools (one batched dispatch is fine)
    spec-preview-show   { project: "todo-list", name: "My Todos" }

**Gate:** the BUILD pane renders the editor with the sample data. If it shows
a generic viewer, Phase 2 didn't complete — fix the editor, don't restart.

## Common deviations

- **Product spec request (brand/problem/audience sheet, feature, WBS)** — no
  workflow at all: `spec-create` / `spec-update` at the workspace root, no
  `project` argument, no `reactor-project-init`.
- **Edits to an existing model** — skip Phase 0 (assume running), jump to the
  relevant Phase 1 step, regenerate. The watcher picks it up; no restart, no
  new preview unless the user asks.
- **Model-only request** — stop after Phase 1; ask before adding an editor or
  preview.
- **Editor-only request against an existing model** — Phase 2 only.
- **Generate fails on a schema error** — fix the spec, not the generated
  files; it is almost always a `SET_STATE_SCHEMA` / `ADD_OPERATION.schema`
  field written in TypeScript instead of GraphQL SDL.
