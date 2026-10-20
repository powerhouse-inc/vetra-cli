# Workflow (happy path)

**Default: build it.** A request to create a product, app or tool ("create
todo app product", "build a CRM") means **build the working package now**:
run every phase below end to end — project, model, editor, preview, plus the
app phase for an app — and write the product specs alongside in the same
flow (load `product-specs`, e.g. while the project starts). Don't ask
whether to build and don't offer "specs only" as an option; choose names,
fields and operations yourself and proceed without confirmation. **Run
every phase skill in `one-shot` mode**: where a skill or its references give
per-mode steps, follow the one-shot step, never the expert/discovery
"confirm with the user" step. Ask only when it is genuinely unclear *what* to build (no
subject at all, or two incompatible readings) — one direct question, then
build.

Building a new document type is always **Bootstrap → Model → Editor →
Preview** (plus **App** when the user asks for a dashboard, kanban board or
custom drive view). Don't pass a gate until it's met; fix the cause and
re-run the failing step. Each phase's exact calls, gates and pitfalls live
in its skill: **load that skill (`skill` tool) when you start the phase**,
and `skill_read` its references when it says to.

| Phase | Skill | Gate |
| --- | --- | --- |
| 0 Bootstrap | `reactor-project-management` | `reactor-project-ps` lists the project as running |
| 1 Model | `document-modeling` | `spec-generate` clean; reducer bodies written in `v1/src/reducers/` |
| 2 Editor | `document-editor-creation` | `spec-generate` clean; `editor.tsx` dispatches the real operations |
| 3 Preview | `document-editor-creation` | BUILD pane shows the editor with sample data |
| 4 App | `drive-app-creation` | the app renders inside its preview drive |

Product specs (brand/problem/audience sheets, feature, WBS) live at the
workspace root — `spec-create { type, name }` with no `project` — and the
`product-specs` skill carries their rules. Only an explicit spec-only request
("write a problem sheet") skips the build; never `reactor-project-init` just
to hold a spec. Deploying: load the `deploy` skill.

Deviations: edits to an existing model jump to the relevant Phase 1 step
and regenerate (no restart, no new preview unless asked); a model-only
request stops after Phase 1 and asks before an editor; an editor-only or
app-only request runs that phase alone. A schema error from `spec-generate`
is almost always a schema written in TypeScript instead of GraphQL SDL —
fix the spec, never the generated files.
