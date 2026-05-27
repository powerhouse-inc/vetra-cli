# Architecture: vetra-cli

This document describes how `vetra-cli` is put together — the components
that run in-process, the services it spawns, and the preview pipeline
that lets a freshly-generated document model be rendered live in a
browser editor as the agent iterates.

For in-progress work and setup steps, see `HANDOFF.md`. This file is
the durable map of how the pieces fit; that file is the working state
of the open work.

## High-level component map

```
                  ┌────────────────────────────────────────────────┐
                  │              vetra-cli process                 │
                  │                                                │
                  │  ┌─────────────────┐                           │
   user ────────► │  │ Interactive REPL│                           │
   (terminal)     │  │  (ph-clint)     │                           │
                  │  └────────┬────────┘                           │
                  │           │                                    │
                  │  ┌────────▼────────┐    ┌──────────────────┐   │
                  │  │ Mastra agent    │◄──►│ Embedded Reactor │   │
                  │  │ (`createAgent`) │    │ (in-process DM)  │   │
                  │  └────────┬────────┘    └────────┬─────────┘   │
                  │           │                      │             │
                  │  ┌────────▼─────────────────┐    │             │
                  │  │ vetra-cli local API      │    │             │
                  │  │ HTTP + SSE on 127.0.0.1  │    │             │
                  │  │ :5180 — resolve/start/   │    │             │
                  │  │ events (+ future surface)│    │             │
                  │  └────────┬─────────────────┘    │             │
                  │           │                      │             │
                  │  ┌────────▼──────────────────────▼──────────┐  │
                  │  │ Embedded Switchboard (apps/switchboard)  │  │
                  │  │ GraphQL + MCP                            │  │
                  │  │ http://localhost:59220/graphql           │  │
                  │  └────────┬─────────────────────────────────┘  │
                  └───────────┼────────────────────────────────────┘
                              │
                ┌─────────────┼───────────────────────┐
                │             │                       │
                ▼             ▼                       ▼
       ┌──────────────────┐  ┌─────────────────────┐  ┌──────────────────┐
       │ Connect          │  │ reactor-project(s)  │  │ (dormant)        │
       │ (static SPA      │  │ per-chat-session    │  │ local-registry   │
       │ serving          │  │ ph vetra dev-mode   │  │ gated off; see   │
       │ vetra-app)       │  │ Switchboard +       │  │ footnote         │
       │ Drive editor =   │  │ Connect with Vite   │  └──────────────────┘
       │ Vetra Studio     │  │ HMR. Preview docs   │
       │ port 27370       │  │ live here.          │
       └────────┬─────────┘  └─────────────────────┘
                │                       ▲
                │  iframe deep-linked   │
                └───────────────────────┘
```

The whole thing is one user-launched binary (`pnpm dev -i` or
`pnpm start -i`). Both scripts pass `--workdir ../../vetra-test`. The
embedded reactor's storage (`<workdir>/.ph/vetra/`) and agent
conversation logs (`<workdir>/.ph/vetra/logs/<agent>/`) live there.

Internally:

- The **reactor**, **agent**, **Switchboard**, and the **vetra-cli
  local API** all run inside the vetra-cli node process.
- The **routine** runs registered **triggers** on a poll loop in the
  same process (`chatSessionWatchTrigger`, spec-sync triggers).
- **Connect** (serving vetra-app) and any **reactor-project** sessions
  run as separate child processes managed by ph-clint's service
  manager. Connect is the user's landing surface (Vetra Studio).
  reactor-projects are previews — one per active build, spawned on
  demand by the agent.

## Repositories

The runtime composition links three repositories. The pnpm workspace
overrides in `vetra-cli/pnpm-workspace.yaml` point at local checkouts so
edits anywhere in this stack are picked up after a rebuild.

- `/Users/acaldas/dev/powerhouse/vetra/vetra-cli/` — this repo. CLI
  definition, agents, services, triggers, tool implementations, the
  local API server, and the `vetra-app` reactor project that the
  embedded reactor uses for document models, editors, processors and
  subgraphs.
- `/Users/acaldas/dev/powerhouse/ph-clint/` — framework. Owns the
  reactor lifecycle, service manager, routine loop, interactive REPL,
  agent loader, and the Switchboard / Connect integration glue.
- `/Users/acaldas/dev/powerhouse/monorepo/.claude/worktrees/vetra-codegen-agent-api/`
  — Powerhouse monorepo worktree. Contains `apps/switchboard`,
  `apps/connect`, `packages/reactor`, `packages/reactor-browser`, and
  bundled Powerhouse packages.

## Components, in detail

### Embedded reactor

Built by `cli.configureReactor` in `vetra-cli/src/cli.ts` via
`buildDefaultReactor`. Composes the document models from `vetra-app`
and `@powerhousedao/clint-common`. Primary drive name: `vetra-cli`.
Storage: `<workdir>/.ph/vetra/`.

The vetra-cli drive holds: chat session documents, spec documents
(mirrored from the reactor-project filesystems by the spec-sync
triggers), and any other domain content the studio surfaces.

### Embedded Switchboard

`@powerhousedao/switchboard`'s `startSwitchboard()`. Reuses the
pre-built reactor from the step above rather than spinning up its
own. Exposes:

- `/graphql` — supergraph composing every registered subgraph.
- `/mcp` — Model Context Protocol endpoint.
- `/d/:drive` — per-drive GraphQL endpoint.

`PackagesSubgraph` is still registered (cheap, harmless), but the
agent and editor no longer drive it; package installation is not part
of the live path.

### Embedded Connect (Vetra Studio)

Static SPA served by ph-clint's `connect-server.js` out of
`<vetra-app>/dist/connect/`. See "Build-output split" below for how
that directory is produced.

**Build-output split — two independent commands.** `vetra-app` ships
two artifact families and they are built separately:

- `pnpm build` (= `ph-cli build`) emits `dist/{browser,node,types}` —
  the package's consumable exports. This is what the vetra-cli node
  process imports at startup (document models, editor module
  registrations, processor factory).
- `pnpm exec ph-cli connect build --outDir dist/connect` emits the
  SPA bundle the embedded `connect-server.js` serves. The bundle
  freezes a snapshot of `powerhouse.manifest.json` and the local
  editor modules at build time.

`pnpm build` does **not** rebuild `dist/connect/`. Editing
`vetra-app/editors/*`, `vetra-app/powerhouse.manifest.json`, or
anything the SPA loads requires running both commands and restarting
vetra-cli (the connect-server is launched at vetra-cli startup with
`--dir` pointing at `dist/connect`; it has no watch). A common
failure mode: the source manifest lists the new app under `apps[]`
but the bundled SPA still carries the empty pre-edit manifest, so
Connect falls back to `GenericDriveExplorer` and the new drive
editor never shows up.

The user's landing experience — `Vetra Studio` — is a custom **drive
editor** registered against `powerhouse/document-drive` and selected
via the vetra-cli drive's `preferredEditor` field. The editor renders:

- Left rail: list of chat session documents in the drive, plus a
  "What will you build today?" entry point that creates a new session.
- Right pane: the **active workflow scaffold** for the current chat
  session. Default scaffold renders four vertical step cards
  (`ideate`, `specify`, `build`, `deploy`). The BUILD card hosts an
  iframe deep-linked into the chat session's current reactor-project
  Connect.

### vetra-cli local API

HTTP + SSE service hosted inside the vetra-cli node process on a fixed
loopback port. Default `127.0.0.1:5180`; see
`vetra-cli/src/preview-server/config.ts` for the constant. CORS is
permissive (`Access-Control-Allow-Origin: *`) because the loopback
bind already restricts the audience; the browser side runs on
Connect's origin (a different port) and needs cross-origin access.
Revisit if the server ever leaves loopback.

Implemented as a trigger (`vetra-cli/src/triggers/preview-server.ts`)
so it gets the framework's `ServiceManager` + event-bus access via
`TriggerContext`. Server module lives at `vetra-cli/src/preview-server/`.

**Endpoints (current):**

- `GET /resolve?project=<label>&doc=<id-or-slug>` — read-only. Returns
  the live preview URL or a state code (`no-target`,
  `unknown-project`, `project-stopped`, `starting`, `ready`). The
  editor calls this on every relevant state change.
- `POST /start?project=<label>` — idempotent. If an instance for
  the project's workdir is already `starting`/`ready`, returns
  `already-running`; otherwise spawns one via
  `services.start("reactor-project", ...)` and returns `started`.
  The editor calls this automatically when `/resolve` returns
  `project-stopped` — preview intent implies project should run.
- `GET /events` — SSE stream of `service:*` events filtered to
  `id === "reactor-project"`. The editor refetches `/resolve` on
  any event. 15s heartbeat keeps the stream alive through quiet
  periods.
- `GET /healthz` — liveness check.

**Endpoints (planned but not yet built):**

- `GET /projects` / `GET /projects/subscribe` — broader projection
  of the service manager's reactor-project state, beyond the
  per-target resolution `/resolve` provides today.
- `GET /chat-sessions/:id/workflows` /
  `GET /chat-sessions/:id/workflows/subscribe` — workflow registry
  projection. Depends on the workflow registry itself, which is
  unbuilt.

The API surfaces two kinds of state:

- **Project runtime state** — projection of the service manager.
  Source of truth remains `<workdir>/.ph/<cli>/services/
  reactor-project/<instance>.json`; the API is a fanout. `/resolve`
  is a per-target slice; the planned `/projects` endpoints would
  expose the full list.
- **Workflow registry state (planned)** — in-memory map of workflow
  instances per chat session. Not implemented yet.

The API exists for **cross-session, ephemeral runtime state** that the
editor needs to see live but that doesn't belong in CRDT-replicated
documents. The line is intentional (see "State transport" below).

The writes (`POST /start`) are scoped: only thing the editor can
trigger is starting a reactor-project that a session already pointed
at. It can't enumerate, stop, or otherwise mutate the manager.

### State transport: chat-session document vs local API

Two parallel channels carry state from the agent / runtime to the
browser-side editor. Each has a clearly-scoped purpose.

- **Chat-session document (reactor)** carries domain content and
  within-session UI signals: user/agent messages, tool calls, tool
  results, workflow dispatch events. Replicated, persistent,
  scrollable history. Read via standard reactor-browser
  subscriptions. The editor's "show this preview" signal is just the
  most recent relevant tool call in the session's history.

- **vetra-cli local API (HTTP + SSE)** carries ephemeral runtime
  state that lives across or outside agent turns: project lifecycle,
  workflow live state (especially when V2 background tasks need to
  update state without an agent turn happening). Not persisted, not
  replicated; recomputed on each vetra-cli boot.

The distinction is deliberate. Ephemeral runtime state in a CRDT
document creates noise in history and forces the editor to constantly
re-derive "current" from a log. Domain content in HTTP+SSE loses
replayability and forces re-fetching on every reload. Putting each
class where it belongs keeps both subsystems simple.

### Drive editor (Vetra Studio) in vetra-app

A custom editor registered for `powerhouse/document-drive`. Lives at
`vetra-app/editors/vetra-studio/` (planned). The vetra-cli drive's
document sets `preferredEditor` to this editor's id so Connect picks
it up automatically.

Composition:

- Subscribes via `useDocument` to the drive doc itself (to list chat
  sessions) and to the currently-selected chat session (for messages,
  tool calls, and stage content derived from tool history).
- Subscribes via `fetch` + `EventSource` to the vetra-cli local API
  for project and workflow live state.
- Renders the active workflow scaffold (default = four-step vertical
  layout) in the right pane. Scaffold component reads tool-call
  history from the chat session to populate step cards; reads project
  state from the local API to resolve iframe URLs.

### reactor-project service

Per-project `ph vetra` instance running its own full Switchboard +
Connect in dev mode (Vite HMR for editors). Spawned by the agent via
the `reactor-project-start` tool. Each project lives at a known
workdir under `<workdir>/projects/<project-name>/` and exposes its
own ports.

Each reactor-project has a **preview drive** with a hardcoded slug
shared by its Switchboard and Connect. Preview documents (instances
of in-progress document models) live in this drive. The agent's
`spec-preview-*` tools target this drive by default. The editor
composes iframe URLs as deep links into this drive's editor route.

A chat session may associate with a reactor-project throughout its
lifecycle, and may also switch projects mid-session if the agent
needs to touch multiple projects. The chat-session document carries
a reference to its current project (id or workdir path); switching
is an explicit action.

### Agent

Created via `cli.configureAgent(createAgent)`. Mastra-backed.

Tool surface for MVP (see `HANDOFF.md` for the implementation
checklist):

- **Existing project lifecycle:** `reactor-project-init`,
  `reactor-project-start`, `reactor-project-stop`, `reactor-project-ls`.
- **Existing spec lifecycle:** `spec-create`, `spec-get`, `spec-list`,
  `spec-update`, `spec-delete`, `spec-extract`, `spec-generate`.
- **Preview document lifecycle (planned):** `spec-preview-create`,
  `spec-preview-get`, `spec-preview-list`, `spec-preview-update`,
  `spec-preview-delete`. Mirror the `spec-*` shape; operate on the
  preview drive of a named reactor-project.
- **Workflow tools (planned):** `start_workflow({ scaffold, input? })`,
  `set_step_content({ instanceId, step, payload })`,
  `complete_step({ instanceId, step })`,
  `promote_workflow({ instanceId })`,
  `complete_workflow({ instanceId, status })`.

Workflow scaffolds are React components in vetra-app. The default
scaffold's step ids are `'ideate' | 'specify' | 'build' | 'deploy'`.
BUILD step payload shape: `{ projectId, documentId, title? }`. The
scaffold resolves the iframe URL from the editor's project-state
subscription; the agent does not construct Connect URLs.

### Triggers

Registered in `cli.ts`. Run as part of ph-clint's routine loop.

- `chatSessionWatchTrigger` (clint-common) — watches chat-session
  documents for new user messages and forwards them to the agent.
- `specSyncTrigger` — drive → filesystem mirror for spec documents.
- `specFsSyncTrigger` — filesystem → drive (chokidar-based).
- `previewServerTrigger` — runs the local API server. Triggers
  receive `commandContext.services` + `commandContext.on`, which is
  exactly what the http handlers need. `setup()` boots the server,
  `teardown()` closes it on daemon shutdown, `poll()` returns null
  (no work items — the trigger is purely a lifetime host for the
  server).
- `publishReloadTrigger` — **dormant**; gated by
  `LOCAL_REGISTRY_ENABLED = false` in `constants.ts`. Not registered
  at runtime. See footnote.

### Services

- `reactor-project` — `ph vetra` in dev mode for the preview surface.
  Persistent state at `<workdir>/.ph/vetra-cli/services/reactor-project/
  <instance>.json` (read by `reactor-project-ls` and projected over
  the local API).
- `local-registry` — **dormant**; gated by `LOCAL_REGISTRY_ENABLED`.
  See footnote.

## Boot sequence

ph-clint's `startupSequence`:

1. **Reactor** — `reactorConfig.create(ctx)` builds the in-process
   document store. Persistence at `<workdir>/.ph/vetra/`.
2. **Switchboard** — `startSwitchboard()` reuses the reactor from
   step 1. Listens on 59220 by default.
3. **Connect** — `services.start('vetra-studio')` spawns
   `connect-server.js` against `vetra-app/dist/connect/`. Listens on
   27370 by default.
4. **Routine** — trigger loop starts. `previewServerTrigger.setup()`
   binds the local API HTTP + SSE server on `127.0.0.1:5180` and
   subscribes to the framework event-bus for `service:*` events.
   The other triggers (`chatSessionWatchTrigger`,
   `specSyncTrigger`, `specFsSyncTrigger`) begin polling.

`reactor-project` instances stay dormant until the agent starts one
via the `reactor-project-start` tool.

### Auto-start of reactor-project

The editor pre-empts manual lifecycle calls for the BUILD pane. When
`/resolve` returns `project-stopped` for a session's target, the
browser-side `useResolvedPreview` hook fires `POST /start` once per
target without any user click. SSE drives the resulting state
transitions back into the pane: `service:starting` →
`service:ready` → the pane refetches `/resolve` and lands on `ready`.

Guards: the browser tracks "auto-started for project X" to avoid
spinning on a persistent failure (e.g. port conflict surfaces as
`service:failed`; the guard is only cleared when state reaches
`ready`, so the next stop will auto-recover). The server side is
idempotent independently: a `POST /start` for an already-running
workdir returns `already-running` and never spawns a duplicate.

The agent's existing `reactor-project-start` tool is still the
chat-visible way to start a project; auto-start is the recovery
path. Agent-driven starts produce visible chat history, which is
preferable for normal flow.

## Preview flow

What happens when the agent previews an in-progress document model.

```
  agent
    │
    ▼
  spec-create / spec-update → vetra-cli drive
                              ↓ (specFsSyncTrigger)
                       reactor-project tree (project source)
                              ↓ (ph vetra dev mode, Vite HMR)
                       reactor-project picks up new document model
    │
    ▼
  spec-preview-create({ projectId, specSlug })
    → reactor-project Switchboard GraphQL mutation
    → returns { documentId, driveId }
    │
    ▼
  set_step_content({ instanceId, step: 'build',
                     payload: { projectId, documentId, title } })
    → recorded in chat session as a tool call
    │
    ▼
  Drive editor scaffold's BUILD card observes the tool call,
  reads the reactor-project's Connect URL from local API state,
  sets <iframe src> to a deep link into the preview drive
    │
    ▼
  User watches the editor render live as the agent iterates;
  Vite HMR re-renders on each codegen pass.
```

The chain has no package boundary: specs are generated directly into
the reactor-project's source tree, the dev-mode Switchboard registers
the document model from the project's own code, the dev-mode Connect
imports the editor via Vite. No `npm publish`, no local registry, no
dynamic bundle swap.

## Workflow scaffolds

A workflow scaffold is a React component in vetra-app that owns the
right-pane layout for a class of agent task. Scaffolds:

- Declare the step ids they accept (`'ideate' | 'specify' | 'build' |
  'deploy'` for the default scaffold).
- Define per-step payload shapes.
- Render whatever UI fits the task. The default scaffold is a vertical
  timeline of step cards; future scaffolds can be single full-bleed
  iframes, side-by-side comparisons, etc.

Workflow instances live in vetra-cli's in-memory registry. Each chat
session can have multiple instances; one is `primary` and renders in
the right pane. Non-primary instances surface as a small indicator
(badge / status strip).

The agent dispatches workflows via `start_workflow({ scaffold,
input? })` and mutates them via the other workflow tools. For MVP,
workflows have no engine — they're declarative state that the agent
maintains. V2 will plug Mastra workflow runners into the same
registry without changing the agent or editor surfaces.

## Filesystem layout

```
vetra-cli/
├── ARCHITECTURE.md            ← you are here
├── HANDOFF.md                 ← open work + next steps
├── package.json
├── pnpm-workspace.yaml        ← overrides linking to ph-clint + monorepo
├── vetra-app/                 ← embedded reactor's project
│   ├── document-models/
│   ├── editors/
│   │   └── vetra-studio/      ← drive editor (Vetra Studio); planned
│   ├── processors/
│   ├── subgraphs/
│   ├── powerhouse.config.json
│   └── dist/connect/          ← built Connect static bundle
└── vetra-cli/
    ├── src/
    │   ├── cli.ts             ← defineCli + configureReactor
    │   ├── framework.ts       ← config + secrets schemas
    │   ├── constants.ts       ← LOCAL_REGISTRY_* (dormant), API port
    │   ├── agents/agent.ts    ← Mastra agent factory
    │   ├── preview-server/    ← vetra-cli local API (resolve/start/events)
    │   ├── commands/          ← spec-*, reactor-project-*, spec-preview-*
    │   ├── services/
    │   │   ├── local-registry.ts   ← dormant
    │   │   └── reactor-project.ts
    │   ├── triggers/
    │   │   ├── preview-server.ts   ← hosts the local API
    │   │   ├── publish-reload.ts   ← dormant
    │   │   ├── spec-sync.ts
    │   │   └── spec-fs-sync.ts
    │   └── workflows/         ← workflow registry; planned
    └── .ph/                   ← runtime state
        ├── vetra/             ← reactor PGlite
        ├── read-storage       ← Switchboard read-model DB
        └── vetra-cli/services/ ← service manager state
```

## Open gaps

These are limitations of the current direction; not bugs.

- **Workflow registry is in-memory.** vetra-cli restart drops all
  active workflows; the editor reconnects to a fresh registry. For
  MVP this is fine. Persistence (and the resumable-vs-abandonable
  question that comes with it) is V2.

- **Project state is not a drive document.** Chat sessions reference
  their current project by a transient handle (path or service
  instance id). Renaming or moving a project workdir invalidates
  references in any chat sessions that pointed at it. Promoting
  project to a document model in the vetra-cli drive is phase 2;
  it'll resolve this and let the editor enumerate projects via the
  reactor instead of a side-channel API.

- **Agent doesn't see runtime failures.** Service errors, workflow
  failures, and reactor-project crashes surface in the terminal via
  log handlers; the agent's input channels (chat session + Mastra
  thread) don't yet receive them. Same gap as the older `package:
  reload-failed` issue. A `pushAgentNotice(message)` primitive in
  ph-clint, or a per-turn pending-context queue, would close it.

- **Studio-mode parity.** Connect runs static in vetra-cli today
  (vetra-app's prebuilt bundle exists). The dynamic-package-loading
  endpoints in `connect-server.ts` (`/__packages` SSE, etc.) are
  upstream and remain in place, but they're not exercised by
  vetra-cli's live path anymore.

## Footnote: dormant local-registry path

A previous iteration drove preview through a different mechanism:
the agent published a Reactor package to a local Verdaccio-based
registry, and a `publish-reload` trigger reconciled the embedded
Switchboard + Connect's installed packages via SSE for dynamic bundle
swaps. That whole chain remains in the source tree, gated by
`LOCAL_REGISTRY_ENABLED = false` in `constants.ts`. Affected pieces:

- `services/local-registry.ts` (Verdaccio supervisor service)
- `triggers/publish-reload.ts` (SSE consumer + Switchboard/Connect
  reconciler)
- `commands/reactor-project/publish.ts` (publish flow)
- `LOCAL_REGISTRY_URL` / `LOCAL_REGISTRY_PORT` constants
- `registryUrl` wiring in `cli.configureReactor`'s switchboard/connect
  options

With the flag false, none of this runs. The code is retained as
reference for future scenarios where dynamic package loading is the
right primitive (e.g. previewing a package against a real
remote-registry deploy). The live path is the reactor-project + Vite
HMR flow described above; do not extend the dormant chain unless the
flag is being deliberately re-enabled.
