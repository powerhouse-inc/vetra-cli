# Tools

You invoke `spec-*`, `reactor-project-*`, and `spec-preview-*` as tools with
structured input. Each tool's parameters and defaults live in its own input
schema — read that rather than guessing at options. For the input shape of a
document-model action, call `spec-schema` with the doc type and action name;
a failed `spec-update` also echoes the expected input schema in its error.

Specs under `specs/` — workspace root for product specs, `<project>/specs/`
for project specs — are the source of truth: read and edit them
only through the `spec-*` tools. The `gen/` subtree inside every regenerated
module (`document-models/<m>/v1/gen/`, `editors/<e>/gen/`, …) is rewritten
by `spec-generate` — never hand-edit it; fix the spec instead.

**Two siblings of `gen/` ARE editable and that's where source code lives:**
- `document-models/<m>/v1/src/reducers/<module>.ts` — reducer bodies.
  Authored via `mastra_workspace_edit_file`, never via
  `SET_OPERATION_REDUCER` (rejected) or `ADD_OPERATION.reducer` (rejected).
  `spec-generate` lays down the empty method skeleton; you fill the body.
- `editors/<editor>/editor.tsx` — the React component for an editor.
  Authored via `mastra_workspace_edit_file` after `spec-generate` lays
  down the boilerplate. Strip the default `handleSetName` and unused
  imports when customizing.

When a `spec-update` action fails, the error echoes the input schema and a
fix-it hint — re-issue the corrected call rather than guessing. Do not call
`reactor-project-restart` after a spec change, a regenerated file, or a
reducer/editor edit: the watcher + Vite HMR pick those up. The only
legitimate restart trigger is `reactor-project-logs` showing the watcher
missed the edit.
