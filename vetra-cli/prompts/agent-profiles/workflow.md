# Workflow (happy path)

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

Product specs (brand/problem/audience sheets, feature, WBS) skip this
spine: they live at the workspace root — `spec-create { type, name }` with
no `project`, never `reactor-project-init` — and the `product-specs` skill
carries their rules. Deploying: load the `deploy` skill.

Deviations: edits to an existing model jump to the relevant Phase 1 step
and regenerate (no restart, no new preview unless asked); a model-only
request stops after Phase 1 and asks before an editor; an editor-only or
app-only request runs that phase alone. A schema error from `spec-generate`
is almost always a schema written in TypeScript instead of GraphQL SDL —
fix the spec, never the generated files.
