# Handoff: drive editor + reactor-project preview surface

This document captures the in-progress work on shifting vetra-cli's
preview model from "publish to local registry → dynamically load in
embedded Connect" to "spawn a reactor-project Connect → iframe it into
a custom drive editor in vetra-app". Read it cover-to-cover before
touching the code — the design has several interlocking pieces.

For the durable map of how everything fits, see `ARCHITECTURE.md`.

## Ground rules for whoever picks this up

These are durable preferences from the user driving the work. Honor
them across every commit and every edit.

- **No historical narration in code comments.** Comments describe what
  the code does *now*, not what it used to do. Do not write "was
  previously…", "before this change…", "swap from X to Y…", "we used
  to…", or anything that bakes a temporal story into a file. PR
  descriptions and commit messages are the right place for that; code
  is not.
- **No marketing/buzzword phrasing in code or docs.** Plain technical
  English. The function does what it does; don't preface it with
  "elegant", "robust", "powerful", etc.
- **No emoji in code, comments, file content, or commit messages**
  unless the user explicitly asks for them.
- **Don't pre-emptively wrap up.** When asked to do X, do X. Don't
  tack on a summary of the whole session, a TODO list of unrelated
  polish, or a self-review. End-of-turn summaries should be at most
  one or two sentences.
- **Commit boundaries follow concern, not size.** Don't lump
  architectural changes (apps/switchboard schema additions) with
  consumer wiring (vetra-cli/cli.ts) into one commit. Separate
  commits in separate repos.
- **Service state is on disk.** ph-clint's ServiceManager reads
  `<workdir>/.ph/<cli>/services/<id>/<instance>.json`, so externally-
  started services *are* visible to a running CLI's `services.list()`.
- **vetra-app rebuild after editor/manifest edits.** Editing
  `vetra-app/editors/*` or `vetra-app/powerhouse.manifest.json` requires
  *two* builds and a restart: `pnpm build` (refreshes `dist/{browser,
  node,types}` for vetra-cli's node imports) and `pnpm exec ph-cli
  connect build --outDir dist/connect` (refreshes the SPA bundle that
  `connect-server.js` serves). Then restart vetra-cli. The connect
  bundle freezes the manifest at build time — skipping the connect
  build leaves the SPA carrying the pre-edit manifest, so Connect
  falls back to `GenericDriveExplorer` and the new drive editor never
  appears. See ARCHITECTURE.md → "Embedded Connect (Vetra Studio) →
  Build-output split".

## Overall goal

The vetra-cli drive becomes the user's working surface (Vetra Studio).
A custom drive editor in vetra-app renders the screenshot's UI: chat
sessions on the left, a workflow scaffold on the right. The agent
operates in a chat session, spawns a reactor-project for previews,
generates a document model into the project's source tree, creates a
preview document via the project's Switchboard, and points the
scaffold's BUILD card at a deep link into that project's Connect.

No dynamic package loading. No local registry. Specs are codegen
targets; Vite HMR + `ph vetra` dev-mode is the live-reload mechanism.

## Architecture decisions

These are the conclusions of a design session. Background for each
lives in conversation history; the short form here is what to build
against.

1. **Preview is a deep-linked editor in a separate reactor-project
   Connect.** Not the embedded Connect. The agent spawns a
   reactor-project via `reactor-project-start`; the editor iframes
   that project's Connect at a route into its preview drive.

2. **Specs live in the reactor-project's source tree.** Codegen runs
   there. Dev-mode Switchboard + Vite HMR pick up changes on save.
   The vetra-cli drive keeps a synced copy of spec docs so the agent and
   the drive UI can reason over them through the reactor.
   **Command-originated spec writes push the drive directly and
   synchronously.** The `spec-*` write commands (`spec-create`,
   `spec-update`, `spec-extract`, `spec-delete`) always write the
   filesystem `specs/` (codegen's source of truth) AND, when a reactor
   is running, push the change into the embedded drive in the same call
   — via `helpers/spec-drive-sync.ts` (`applyFsChangesToReactor` /
   `removeSpecFromDrive`), gated on `helpers/embedded-drive.ts`
   `getEmbeddedDrive(ctx)` (presence of `ctx.folders` = daemon reactor
   running; absent in one-shot CLI, so a standalone `vetra spec-create`
   never boots a reactor). `specFsSyncTrigger` is demoted to the
   **external-change detector** (hand-edited `.phd`, `git pull`,
   reactor-project writes): it still watches every project's `specs/`
   (reconciled in `poll()` for projects created after startup), replays
   ops via `loadBatch`, and ADD_FOLDER/ADD_FILEs each doc into its
   project folder, but for command writes it now observes a convergent
   no-op (`loadBatch` dedups by `action.id`). `specSyncTrigger`
   (drive→FS) reads the project↔folder mapping back to route writes to
   `<workdir>/<project>/specs/`. The push/remove + path-inference logic
   moved out of `triggers/spec-fs-sync.ts` into the shared
   `helpers/spec-drive-sync.ts`; the trigger now imports it.

3. **Project stays as a service for MVP.** Promoting `Project` to a
   document model in the vetra-cli drive is phase 2. Chat sessions
   reference their current project by a transient handle (service
   instance id or workdir path). Many-to-many over time: a chat may
   switch projects.

4. **A new HTTP + SSE API hosted in vetra-cli publishes cross-session
   runtime state.** Bound to `127.0.0.1:5180`. CORS is `*` (loopback
   bind is the access control). Hosted by a trigger
   (`previewServerTrigger`) so it gets full ServiceManager + event-bus
   access. Live surface today is preview-resolution-focused:
   `GET /resolve`, `POST /start` (idempotent reactor-project start —
   scoped write the editor can trigger), `GET /events` SSE of
   `service:*` events filtered to `reactor-project`, `GET /healthz`.
   The broader `GET /projects` + workflow-registry endpoints from the
   original design remain planned but unbuilt.

5. **State transport split.**
   - **Chat-session document → reactor:** user/agent messages, tool
     calls, tool results, workflow dispatch events. Within-session UI
     signals ride this channel as tool-call records (latest-wins).
   - **Local API (HTTP + SSE):** cross-session runtime state that
     can't live in the chat session because it changes outside agent
     turns (project lifecycle, future background workflow tasks).
   This split is deliberate. Don't put ephemeral runtime state in
   reactor documents; don't put domain content in HTTP + SSE.

6. **Drive editor is registered for `powerhouse/document-drive`.**
   The vetra-cli drive's `preferredEditor` selects it. Connect's
   default folder view is bypassed because the drive document opts
   in. No new drive document model needed.

7. **Workflows are multi-instance with a `primary` flag.** Right pane
   renders primary; non-primary running workflows surface as a small
   indicator. In-memory in vetra-cli; chat history holds dispatch
   events for replay/provenance.

8. **Workflow scaffolds are React components in vetra-app.** Default
   scaffold = four step cards (`ideate`, `specify`, `build`,
   `deploy`). Each scaffold declares its step ids and payload shapes.
   The BUILD card hosts the preview iframe.

9. **BUILD-step payload uses domain refs, not URLs.** Payload shape:
   `{ projectId, documentId, title? }`. The scaffold resolves the
   iframe `src` from the local API's project state. The agent never
   constructs Connect URLs.

10. **Preview-document tools mirror the `spec-*` shape.**
    `spec-preview-create`, `-get`, `-list`, `-update`, `-delete`. They
    CRUD documents in the project's preview drive. They do **not**
    set the iframe — that's a workflow-tool concern.

11. **Each reactor-project has a preview drive with a hardcoded slug.**
    Shared by the project's Switchboard, its Connect, the agent's
    `spec-preview-*` tools, and the scaffold's URL resolver.
    `reactor-project-init` creates it on bootstrap.

12. **Mastra workflow engine deferred to V2.** For MVP, the agent
    drives the workflow registry directly via tool calls. The local
    API and tool surface are designed so Mastra runners can plug in
    later without changing the editor contract.

13. **Local-registry chain stays gated off.** `LOCAL_REGISTRY_ENABLED
    = false` in `constants.ts` keeps `services/local-registry.ts`,
    `triggers/publish-reload.ts`, the `registryUrl` wiring, and the
    publish flow inert. Code stays as reference; do not extend it.
    See ARCHITECTURE.md footnote.

## Repositories touched

Implementation is concentrated in **vetra-cli + vetra-app** (this
repo). Upstream changes in **ph-clint** and the monorepo worktree
remain in place from the previous iteration but the live path doesn't
exercise them.

- `/Users/acaldas/dev/powerhouse/vetra/vetra-cli/` — agent tool
  implementations, local API server, workflow registry.
- `/Users/acaldas/dev/powerhouse/vetra/vetra-cli/vetra-app/` — drive
  editor (Vetra Studio), default workflow scaffold component.

ph-clint stays untouched in this round. If during implementation the
local API ends up needing project-lifecycle hooks the service manager
doesn't expose, that's an upstream change — flag it and weigh
carefully before adding.

## Implementation plan

Suggested order. Each step is independently demoable.

1. **Drive editor skeleton in vetra-app.** Register an editor for
   `powerhouse/document-drive` named `vetra-studio`. Set the
   vetra-cli drive's `preferredEditor` to it. Render a two-pane
   shell: chat-session list on the left, empty right pane. Verify
   Connect lands on it.

2. **vetra-cli local API server — partial.** Built at
   `src/preview-server/` (not `src/api/`), hosted by
   `src/triggers/preview-server.ts`. Endpoints shipped: `/resolve`,
   `/start`, `/events`, `/healthz`. Endpoints still planned:
   `/projects`, `/projects/subscribe`,
   `/chat-sessions/:id/workflows`, `…/workflows/subscribe`. The
   workflow-registry endpoints depend on the workflow registry
   itself (step 4) which is unbuilt. Browser-side client lives at
   `vetra-app/editors/vetra-studio/hooks/preview-server-client.ts`
   with the same `127.0.0.1:5180` URL hardcoded; promote to a
   shared constant when adding env-driven config.

3. **Chat session integration in the editor.** Left rail renders a
   list of chat session documents in the vetra-cli drive (clint-
   common already provides the document type). Selecting a session
   shows its messages and tool-call history. "What will you build
   today?" entry point creates a new session.

4. **Workflow registry + tool surface.** In vetra-cli:
   `start_workflow`, `set_step_content`, `complete_step`,
   `promote_workflow`, `complete_workflow`. Each mutates the
   in-memory registry and emits a dispatch tool-call into the chat
   session. Local API SSE pushes state changes.

5. **Default scaffold component in vetra-app.** Renders four cards.
   Subscribes to the active chat session (reactor) for step content
   derived from tool-call history. Subscribes to local API for the
   active workflow instance and project state. BUILD card resolves
   iframe URL from `{ projectId, documentId }` + the project's
   Connect endpoint.

6. **Preview-document tools.** `spec-preview-create/-get/-list/
   -update/-delete`. Hit the target project's Switchboard GraphQL.
   Default to the hardcoded preview-drive slug.

7. **End-to-end demo.** Agent flow: spec-create → spec-generate (into
   a reactor-project) → reactor-project-start → spec-preview-create
   → set_step_content for BUILD. The iframe lights up.

## Things NOT done that could matter

- **Workflow persistence.** In-memory registry; vetra-cli restart =
  lost workflows. Editor reconnects to a fresh registry. Persistence
  is V2.

- **Mastra workflow engine integration.** All workflows are
  agent-driven for MVP. The data shapes (multi-instance registry,
  dispatch events in chat history, live state in local API) are
  future-proofed for Mastra runners to plug in; the integration
  itself is deferred.

- **Background workflow tasks.** Implied by V2 but not in MVP. The
  registry's multi-instance + primary-flag model supports them; the
  UI for non-primary running workflows is a minimal indicator.

- **Workflow-driven user prompts.** A future workflow may need to
  pause for user input. Not modeled yet.

- **Project as a drive document.** Stays as a service. The
  consequence: chat sessions reference projects by transient handles
  that break on rename/move. Phase 2.

- **Failure notifications to the agent.** Service crashes, workflow
  failures, reactor-project errors surface in the terminal log; the
  agent doesn't see them. Same gap as the older `package:
  reload-failed` issue. A `pushAgentNotice` primitive in ph-clint or
  a per-turn pending-context queue closes it.

- **Studio-mode parity for the embedded Connect.** N/A for the live
  path (vetra-app's static bundle exists, so Connect always runs
  static in vetra-cli). Remains an upstream-only concern.

- **Per-chat-session "current project" setter.** Implicit for MVP.
  Concrete implementation today: the BUILD pane resolves its target
  by walking the session's tool history for the latest successful
  `spec-preview-show` and reading the `project` argument the agent
  passed (`vetra-app/editors/vetra-studio/hooks/useSessionPreviewTarget.ts`).
  `spec-preview-create` deliberately doesn't trigger the pane — show
  is the user-visible "this is the current preview" signal. Add an
  explicit `set-current-project` tool when ambiguity bites (e.g.
  mid-session project switches that don't naturally re-emit a
  `spec-preview-show`).

- **Workflow registry + scaffold tooling.** Architecture decisions
  7, 8, 9 and implementation steps 4, 5 describe an in-memory
  workflow registry plus agent tools (`start_workflow`,
  `set_step_content`, etc.) plus per-scaffold step contracts. None
  of that is built. The BUILD pane currently bypasses this loop
  entirely by reading `spec-preview-show` results directly from the
  chat session. The rest of `WorkflowScaffold.tsx` is still the
  four-card placeholder. The local API's planned
  `…/workflows/subscribe` endpoint waits on this registry to exist.

- **Auth on the local API.** None. Localhost-only, single-user
  assumption. Revisit if vetra-cli ever fronts a multi-user surface.

## Suggested next steps

In order:

1. Promote the preview-server URL to a shared constant. Today it's
   hardcoded as `127.0.0.1:5180` in both
   `vetra-cli/src/preview-server/config.ts` and the browser-side
   `vetra-app/editors/vetra-studio/hooks/preview-server-client.ts`.
   When the port becomes configurable, the browser side will need
   `import.meta.env.PH_PREVIEW_SERVER_URL` or similar baked at
   build time.

2. Tighten CORS once the embedded Connect's origin is known and
   stable — currently `*` for ease of dev.

3. Sketch the drive editor's scaffold registry. Probably
   `vetra-app/editors/vetra-studio/scaffolds/{index,default}.tsx`.
   Required to move past the current `spec-preview-show` shortcut
   and into the `set_step_content`-driven model.

4. Build the workflow registry + agent tools (decisions 7, 8, 9).
   Once it exists, expose `/chat-sessions/:id/workflows` /
   `…/subscribe` on the same preview-server.

5. Add `GET /projects` / `GET /projects/subscribe` to the local API
   as a broader projection of `services.list("reactor-project")`
   (today's `/resolve` is a per-target slice).

6. Decide the hardcoded preview-drive slug and ensure
   `reactor-project-init` creates it.

## Useful diagnostic commands

```bash
# Service manager state files (project lifecycle source of truth)
ls /Users/acaldas/dev/powerhouse/vetra/vetra-cli/vetra-cli/.ph/vetra-cli/services/

# Embedded Switchboard schema sanity check
curl -sS -X POST http://localhost:59220/graphql \
  -H "content-type: application/json" \
  -d '{"query":"{ __schema { types { name } } }"}' | grep -i drive

# Preview-server liveness
curl -sS http://127.0.0.1:5180/healthz

# Resolve a session's preview target
curl -sS "http://127.0.0.1:5180/resolve?project=<workdir-subdir>&doc=<slug-or-id>"

# Trigger reactor-project start (idempotent)
curl -sS -X POST "http://127.0.0.1:5180/start?project=<workdir-subdir>"

# Watch the SSE stream of reactor-project events
curl -sS -N http://127.0.0.1:5180/events
```

## Glossary

- **Vetra Studio** — the user-facing UI rendered by the drive editor
  for the vetra-cli drive. Screenshot reference design.
- **Workflow scaffold** — a React component (in vetra-app) defining
  the right-pane layout and step contract for a class of agent task.
- **Workflow instance** — a runtime entry in vetra-cli's in-memory
  workflow registry, bound to a chat session. Identified by an
  `instanceId`. One per session can be `primary`.
- **Workflow engine (V2)** — Mastra workflow runner that drives a
  workflow instance's state machine. Not in MVP.
- **Reactor-project** — a `ph vetra` dev-mode child process spawned
  by the agent to host preview surfaces. One per active build in a
  chat session.
- **Preview drive** — the hardcoded-slug drive inside a reactor-
  project, used for ephemeral preview document instances. Shared by
  the project's Switchboard, Connect, the agent's `spec-preview-*`
  tools, and the scaffold's URL resolver.
- **Preview document** — a document instance in a project's preview
  drive, used to render an editor for demonstration.
- **vetra-cli local API** — HTTP + SSE service in the vetra-cli node
  process. Publishes cross-session runtime state (projects,
  workflows). Read-only for MVP.
- **State transport split** — the architectural rule that domain
  content + within-session UI signals go through the chat-session
  document, and cross-session ephemeral runtime state goes through
  the local API. See ARCHITECTURE.md.
