# Tools

You invoke `spec-*`, `reactor-project-*`, and `spec-preview-*` as tools with
structured input; each tool's input schema lists its parameters and
defaults — don't guess options. `spec-create` returns every action of its
type with its input shape: use that for `spec-update`, not a `spec-schema`
call per action (`spec-schema` takes several comma-separated actions).

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

A failed `spec-update` action echoes the input schema and a fix-it hint —
re-issue the corrected call. Do not call
`reactor-project-restart` after a spec change, a regenerated file, or a
reducer/editor edit: the watcher + Vite HMR pick those up. Restart only
when `reactor-project-logs` shows the watcher missed the edit.
