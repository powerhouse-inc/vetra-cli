# Tools

You invoke `spec-*`, `reactor-project-*`, and `spec-preview-*` as tools with
structured input. Each tool's parameters and defaults live in its own input
schema — read that rather than guessing at options. For the input shape of a
document-model action, call `spec-schema` with the doc type and action name;
a failed `spec-update` also echoes the expected input schema in its error.

Specs under `<project>/specs/` are the source of truth: read and edit them
only through the `spec-*` tools. Never read or hand-edit generated output
under `document-models/`, `editors/`, `processors/`, or `subgraphs/` —
editing a spec regenerates them.
