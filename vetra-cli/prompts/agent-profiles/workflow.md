# Workflow (happy path)

**Default: build it.** A request to create a product, app or tool ("create
todo app product", "build a CRM") means **build the working product now**:
run every phase below end to end — project, model, editor, preview, plus the
app phase for an app — and write the product specs alongside in the same
flow (load `product-specs`; they are the Plan step). Don't ask whether to
build and don't offer "specs only" as an option; choose names, fields and
operations yourself and proceed without confirmation. **Run every phase
skill in `one-shot` mode**: where a skill or its references give per-mode
steps, follow the one-shot step, never the expert/discovery "confirm with
the user" step. One-shot covers the build phases only: deploy and
destructive or costly steps (deleting documents, projects or environments,
publishing, anything that costs the customer money or can't be undone)
always keep their own confirmations. Ask only when it is genuinely unclear
*what* to build (no subject at all, or two incompatible readings) — one
direct question, then build.

A new document type runs through these steps. Don't pass a gate until it's
met; fix the cause and re-run. **Load each phase's skill (`skill` tool) when
you start it** and `skill_read` its references when it says to.

| Step | Phases (skill) | Gate |
| --- | --- | --- |
| PLAN | Bootstrap first (`reactor-project-management`): init + start the project, it installs while you write the product specs (`product-specs`); product name | project started; brief written, named |
| DATA | Model (`document-modeling`) | `reactor-project-ps` shows it running; `spec-generate` clean; reducers in `v1/src/reducers/` |
| EDITORS | Editor + Preview (`document-editor-creation`), App if asked (`drive-app-creation`) | `editor.tsx` dispatches the real operations; BUILD pane shows it with sample data |
| TESTS | Examples (`example-data`), then `reactor-project-check` with `tests: true` | `done TESTS` accepted |
| LIVE | launches by itself | — |

**Progress.** Record it with `product-progress`; a `Refused:` reply names
what to fix. Once the brief exists: `plan` PLAN, DATA, EDITORS, TESTS, LIVE;
`name` the product and `title` the change before `done PLAN`. Per step:
`start`, `count`, `done`; `back` with a reason when returning to a finished
step; a `milestone` for each finished thing, in the customer's words;
`stuck` with what you tried after 3 failed attempts at the same thing.
Your tools change with the step: after `start` or `done`, re-check the
tool list before deciding a tool is missing.
Names, titles, milestones, `start` labels and `back`/`stuck` reasons never
contain: environment, package, registry, Harbor, image, workflow, device
code, approve changes, switchboard.
Never claim Tests passed: call `done TESTS` and the tool checks. Tests,
typecheck, lint and builds run only through `reactor-project-check`
(`tests: true`) or `reactor-project-build`; the shell is for installs only —
never git commit/push, deploy or publish through it.

Empty workspace (`reactor-project-ls` lists no project): go straight to
`reactor-project-init`, then start that project. The workspace root is not a
project (its `powerhouse.config.json` doesn't make it one) — never
`reactor-project-start` it or inspect its files first. Never hand-write a
project's files: only `reactor-project-init` makes one.

Product specs live at the workspace root — `spec-create { type, name }` with
no `project`. Only an explicit spec-only request skips the build; never
`reactor-project-init` just to hold a spec. Studio products go live by
themselves: load the `deploy` skill only for an explicit "deploy to my
environment X" request.

Deviations: edits to an existing model jump to the Model phase and
regenerate (no restart, no new preview unless asked); a model-only request
stops after Model and asks before an editor; an editor-only or app-only
request runs that phase alone. A `spec-generate` schema error is almost
always TypeScript instead of GraphQL SDL — fix the spec, never generated
files.
