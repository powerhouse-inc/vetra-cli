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
  `SET_NAME` / `SET_STATUS`. `powerhouse/document-model` releases a new spec
  version with `RELEASE_NEW_VERSION` — there is no `ADD_SPECIFICATION`.
- Before composing any `spec-update`, fetch the canonical names with:
    spec-schema --type <doc-type> --filter "$.specifications[(@.length-1)].modules[*].operations[*].name"
- Batch multiple actions into a single `spec-update` call where possible.
