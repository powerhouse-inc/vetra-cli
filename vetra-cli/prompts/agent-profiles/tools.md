## Document specifications
Document specifications are the foundation for creating Powerhouse packages.
Always use the provided tools to interact with specifications:
The `spec-*` tools are deliberately terse in their top-level descriptions —
expanded usage and examples come from each tool's --help output:

- `spec-list` — list specs in the project; `--type <doc-type>` filters to one type.
- `spec-create --type <doc-type> --name <name>` — scaffold a new spec under
  `specs/`; `--dryRun` returns the doc in-memory without saving.
- `spec-get --name <name>` — read a spec. Default returns a short summary
  plus type-aware example queries. Use `--filter` (and `--latest` for
  doc-model specs) to get actual data; pair with `--format toon` for large
  results.
- `spec-update --name <name> --actions '[...]'` — apply reducer actions.
- `spec-delete --name <name>` — remove a spec from disk.
- `spec-schema --type <doc-type>` — read a doc-model schema. Default returns a
  summary plus a JSONPath cookbook. Use `--action <NAME>`, `--state`, or
  `--filter` to retrieve content; pair with `--format toon` for large results.
- `spec-schema-list` — enumerate known document model types.
- `spec-extract [--type ...]` — reverse-engineer an existing package's
  `document-models/`, `editors/`, `processors/`, and `subgraphs/` into `specs/`.
  One-shot migration step toward documents-as-source-of-truth; not for
  routine reads.

# Source of truth

Spec documents under `specs/` are the source of truth. Always work through the
`spec-*` tools. Do not read `document-models/**/*.json` or any generated
artifact directly — those are downstream outputs. Do not edit files under
`document-models/`, `editors/`, `processors/`, or `subgraphs/`; modifying a spec
regenerates them.

# Reading specs

When a spec uses versioned `specifications`, you almost always want the latest
one — that is what the reducer edits. Pass `--latest` to `spec-get` (or
`[(@.length-1)]` in a JSONPath) so you don't silently read an older spec.

Aim to reduce token usage. Start narrow, not wide. Don't fetch the whole state up front. First list module/operation names, then drill into the slice you need:

  spec-get --name X --latest --filter "$.modules[*].name"
  spec-get --name X --latest --filter "$.modules[?(@.name=='details')].operations[*].name"
  spec-get --name X --latest --filter "$.modules[?(@.name=='details')].operations[?(@.name=='SET_BUG_TITLE')]"

Always wrap `--filter` paths in quotes — they contain `$`, `*`, `(`, `[`, which shells (zsh in particular) expand. The examples above use `"..."` so JSONPath's own `'...'` segments nest cleanly.

If applicable, use `--format toon` — it is ~40% smaller than JSON.

Use `spec-schema --type <doc-type>` to discover the actions you can apply to a
given document type, and `--action NAME` to fetch a single input schema.

# Updating specs

Pass actions to `spec-update` directly via the `actions` parameter — it accepts
the JSON array inline. Do **not** write intermediate `*.json` files in the
workspace and do **not** pipe through stdin from your tool calls; both are
unnecessary detours.

  spec-update --name Bug --actions '[{"type":"ADD_OPERATION","input":{...}}]'

- Action `type` values are LITERAL strings defined per doc-type. Never invent
  them, never strip a prefix, never extrapolate by pattern. For example:
  `powerhouse/subgraph` uses `SET_SUBGRAPH_NAME` / `SET_SUBGRAPH_STATUS` — not
  `SET_NAME` / `SET_STATUS`.
- A freshly created `powerhouse/document-model` spec already contains v1 in
  its `specifications` array. All edits (state schema, modules, operations,
  reducers) apply to the latest version automatically — do **not** call
  `RELEASE_NEW_VERSION` to "start working." That action seals the current
  spec and opens an empty v(n+1), which leaves your v1 generated code as a
  broken stub. Only call `RELEASE_NEW_VERSION` once v1 is stable and you
  want to begin a backwards-incompatible v2.
- Before composing any `spec-update`, fetch the canonical names with:
    spec-schema --type <doc-type> --filter "$.specifications[(@.length-1)].modules[*].operations[*].name"
- Batch multiple actions into a single `spec-update` call where possible.

## Defining custom operations on a `powerhouse/document-model`

When you call `ADD_OPERATION` or `SET_OPERATION_NAME` on a document-model
spec, the `name` field is the literal action `type` string — it ends up in
generated code as `action.type === "ADD_WORKOUT"`. It is **not** a display
label. It must be SCREAMING_SNAKE_CASE (`^[A-Z][A-Z0-9_]*$`); the reducer
will throw with a `Did you mean "..."?` hint if it isn't. Pick the
canonical form on the first try — e.g. `ADD_WORKOUT`, not `"Add Workout"`
or `addWorkout`.

## Verifying generated code

`spec-generate` runs `tsc --noEmit` and `eslint` over the generated files
after writing them, scoped to `gen/` paths. Diagnostics appear in the
result text and under `data.diagnostics`. When you see errors, read the
diagnostic first — they usually point at the spec change that needs
fixing (missing input type, name format, schema not GraphQL SDL, etc.).
Fix the spec via `spec-update` and re-run `spec-generate`; do not patch
files under `document-models/`, `editors/`, `processors/`, or `subgraphs/`
by hand.

For a standalone check (after hand-edits to non-generated files, or to
confirm a project compiles before stopping), use `reactor-project-check
--project <name>`. Default scope is the whole project; pass `--scope
generated` to match what `spec-generate` does, or `--skipLint` /
`--skipTypecheck` to narrow.

# Surfacing a preview to the user (BUILD pane)

The vetra-studio chat UI has a BUILD pane next to the chat that renders an iframe of a reactor-project preview document. **The pane only shows a doc when you call `spec-preview-show`.** `spec-preview-create` makes the document exist but does not surface it — always follow create with show when you want the user to see what you just made.

The pane auto-starts the reactor project if it isn't running, so `spec-preview-show` works even against a stopped project — but the user sees a "starting" state until the reactor is ready. If you've just initialized a project or want the iframe ready faster, pre-warm it: `reactor-project-start --workdir <project>` is idempotent and a no-op when already running.

`spec-preview-show` overrides whatever the BUILD pane currently shows. Don't call it for documents unrelated to what the user is iterating on — each chat session's pane reflects the most recent successful `spec-preview-show` from that session.
