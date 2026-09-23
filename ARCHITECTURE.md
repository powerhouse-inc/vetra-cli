# Architecture: vetra

This document describes how `vetra` is put together — the components
that run in-process, the services it spawns, and the preview pipeline
that lets a freshly-generated document model be rendered live in a
browser editor as the agent iterates.

For in-progress work and setup steps, see `HANDOFF.md`. This file is
the durable map of how the pieces fit; that file is the working state
of the open work.

## High-level component map

```
                  ┌────────────────────────────────────────────────┐
                  │              vetra process                     │
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
                  │  │ vetra local API          │    │             │
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
                ┌─────────────┴───────────┐
                │                         │
                ▼                         ▼
       ┌──────────────────┐  ┌─────────────────────┐
       │ Connect          │  │ reactor-project(s)  │
       │ (static SPA      │  │ per-chat-session    │
       │ serving          │  │ ph vetra dev-mode   │
       │ vetra-app)       │  │ Switchboard +       │
       │ Drive editor =   │  │ Connect with Vite   │
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

- The **reactor**, **agent**, **Switchboard**, and the **vetra
  local API** all run inside the vetra node process.
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
and `@powerhousedao/clint-common`. Primary drive name: `vetra`.
Storage: `<workdir>/.ph/vetra/`.

The vetra drive holds: chat session documents, spec documents
(mirrored from the reactor-project filesystems by the spec-sync
triggers), and any other domain content the studio surfaces.

### Embedded Switchboard

`@powerhousedao/switchboard`'s `startSwitchboard()`. Reuses the
pre-built reactor from the step above rather than spinning up its
own. Exposes:

- `/graphql` — supergraph composing every registered subgraph.
- `/mcp` — Model Context Protocol endpoint.
- `/d/:drive` — per-drive GraphQL endpoint.

The embedded Switchboard starts without a `registryUrl`, so the dynamic
`Packages` install/uninstall subgraph is not registered. Package
installation is not part of the live path.

### Embedded Connect (Vetra Studio)

Static SPA served by ph-clint's `connect-server.js` out of
`<vetra-app>/dist/connect/`. See "Build-output split" below for how
that directory is produced.

**Build-output split — two independent commands.** `vetra-app` ships
two artifact families and they are built separately:

- `pnpm build` (= `ph-cli build`) emits `dist/{browser,node,types}` —
  the package's consumable exports. This is what the vetra node
  process imports at startup (document models, editor module
  registrations, processor factory).
- `pnpm exec ph-cli connect build --outDir dist/connect
  --default-drives-url http://__ph_drive_url__` emits the SPA bundle
  the embedded `connect-server.js` serves. The bundle freezes a
  snapshot of `powerhouse.manifest.json` and the local editor modules
  at build time. The `--default-drives-url` flag bakes the
  `CONNECT_DRIVE_URL_PLACEHOLDER` sentinel in place of the real drive
  URL (see "Default-drive URL stamping" below); always pass it, or the
  runtime stamping hook has no token to replace.

`pnpm build` does **not** rebuild `dist/connect/`. Editing
`vetra-app/editors/*`, `vetra-app/powerhouse.manifest.json`, or
anything the SPA loads requires running both commands and restarting
vetra (the connect-server is launched at vetra startup with
`--dir` pointing at `dist/connect`; it has no watch). A common
failure mode: the source manifest lists the new app under `apps[]`
but the bundled SPA still carries the empty pre-edit manifest, so
Connect falls back to `GenericDriveExplorer` and the new drive
editor never shows up.

**Default-drive URL stamping.** Connect reads
`PH_CONNECT_DEFAULT_DRIVES_URL` from a build-time literal
(Vite-inlined `import.meta.env`); it cannot take the value from a
runtime source. But vetra's drive id is a random UUID minted on
first run, unknown at bundle-build time. So the connect build bakes
the `http://__ph_drive_url__` placeholder, and the
`connect-drive-url` lifecycle hook
(`vetra-cli/src/lifecycle/connect-drive-url.ts`) swaps it for the live
URL on startup: it listens for `powerhouse:switchboard:ready`,
string-replaces the prior token across `dist/connect/assets/*.js`
(the placeholder on first boot, the last-applied URL afterwards —
tracked in a `dist/connect/.default-drive-url` cache), and leaves the
bundle pointing at the live drive. A browser reload applies the
change. The swap is a plain literal replacement — no rebuild, no
toolchain, no install — so it works in a published, source-less
install where `ph-cli connect build` cannot run.

The user's landing experience — `Vetra Studio` — is a custom **drive
editor** registered against `powerhouse/document-drive` and selected
via the vetra drive's `preferredEditor` field. The editor renders:

- Left rail: list of chat session documents in the drive, plus a
  "What will you build today?" entry point that creates a new session.
- Right pane: the **active workflow scaffold** for the current chat
  session. Default scaffold renders four vertical step cards
  (`ideate`, `specify`, `build`, `deploy`). The BUILD card hosts an
  iframe deep-linked into the chat session's current reactor-project
  Connect.

### vetra local API

HTTP + SSE service hosted inside the vetra node process on a fixed
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
- `GET /project-package?project=<label>` — read-only. Returns the
  project's package identity (`{ kind: "ok", name, version }`) read from
  `<workdir>/<label>/package.json`, or `unknown-project` / `no-package`.
  The Deploy section's read-only package display calls this.
- `GET /release-status?project=<label>&registry=<url>` — read-only. Compares
  the project's current source content hash
  (`helpers/project-fingerprint.ts`) against the hash embedded in the latest
  published version on the registry (full packument via
  `cloud/registry-packument.ts`), returning `{ kind: "ok", upToDate,
  needsRelease, localVersion, publishedVersion, reason }` or
  `unknown-project` / `no-package` / `unknown`. `reactor-project-publish`
  embeds the hash at `package.json` → `powerhouse.contentHash`. The Deploy
  section's "up to date / needs release" indicator calls this.
- `POST /publish?project=<label>&registry=<url>` — build + publish the
  project's package for the Deploy flow (`preview-server/publish-project.ts`).
  Skips publishing when the source already matches the latest published
  version (same content hash); otherwise picks a free version and runs the
  **same publish sequence the agent's `reactor-project-publish` uses** —
  `publishReactorProject` in `commands/reactor-project/publish-core.ts` (embed
  content hash, `reactor-project/build.ts`, `npm publish --registry` with a
  token minted from the agent's Renown identity). The shared core bump-and-
  retries a registry version conflict (`bumpOnConflict`) so a stale packument
  can't surface a 409 to the UI. Returns `{ kind: "ok", packageName, version,
  registry, published }` (`published: false` = skipped, install the existing
  version) or `unknown-project` / `no-package` / `auth-required` / `failed`.
  The browser then installs that exact version into the target cloud
  environment (env-document edit + approve, signed by the user). This is the
  publish half of the Deploy section's per-environment Deploy/Update action.
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
- `GET /sessions` — gated. Lists the embedded drive's chat-session
  documents (`{ id, name, status, startedAt, threadId, agent }`),
  enriched from each doc's state. `503 reactor-unavailable` when no
  reactor is running.
- `GET /sessions/export?id=<session>` — gated. Returns a zip
  (`application/zip`, attachment) bundling the session for debugging:
  `chat-session.json` (the reactor doc state), `chat-session-operations.json`
  (op history), `mastra-thread.json` (the Mastra thread `recall`ed by the
  doc's `threadId`, when the LibSQL store exists), `session.md` (the
  markdown log when `agentLogging` was on), and `metadata.json` (versions,
  model, flags, which sources were found). `404 unknown-session`,
  `503 reactor-unavailable`. Implementation: `preview-server/session-export.ts`.
- `GET /export?workspace=1` — gated. Streams a zip (`application/zip`,
  attachment `vetra-workspace.zip`) of the whole workdir under a `workspace/`
  prefix, excluding `node_modules`, build/cache output
  (`dist`/`build`/`.next`/`out`/`coverage`/`.turbo`/`.cache`), `.git`, the `.ph`
  store, and `.env*` secrets. Deflate runs on fflate's worker pool and
  the archive streams to the response (bounded memory; the main thread stays
  free). Single-flight: a concurrent request gets `409 export in progress`. A
  general endpoint — `workspace` is the only selectable part today. `400` when
  no part is selected. Implementation: `preview-server/workspace-export.ts`.
- `GET /export/status` — ungated; returns `{ authorized }` (the export gate
  resolved server-side, incl. the `ADMINS` owner check the browser can't
  compute). The studio "Download workspace" button reads it to guide an
  unauthorized user to the Renown authorize flow instead of failing the fetch.
- `GET /healthz` — liveness check.

**Session-export access gate** (`preview-server/session-auth.ts`,
`authorizeSessions`). The `/sessions*` routes carry bulk conversation data
and are reachable through the public proxy, so unlike the other read
endpoints they are gated: when `VETRA_SESSION_EXPORT_SECRET` is set, a
request must present a matching `Authorization: Bearer <secret>` (or
`?token=`) — the operator/support path, which works through the proxy;
when unset, the routes serve only direct-loopback requests (the embedded
proxy tags routed requests with `x-forwarded-prefix`/`x-forwarded-for`), so
local dev exports freely while the public proxy stays closed. `GET /export`
additionally accepts the **authorized owner**: `authorizeSessions` OR
`isAuthorizedAdmin` (`auth/renown.ts`) — the daemon's authorized Renown
identity (`getAuthState`) has its wallet in the pod-injected `ADMINS`
allowlist. This lets the studio "Download workspace" header button work
through the proxy once the owner has authorized the agent, without shipping a
secret to the browser. It gates on the daemon's single authorized identity,
not the specific browser user (per-user browser auth remains the deferred
follow-up below). Sub-agent
threads (resource `cli-user-<agentName>`) are not bundled — their
per-delegation threadIds don't link back to a session. Cryptographic
per-user browser auth (the browser holds no Renown token today) is a
deferred follow-up.

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

- **vetra local API (HTTP + SSE)** carries ephemeral runtime
  state that lives across or outside agent turns: project lifecycle,
  workflow live state (especially when V2 background tasks need to
  update state without an agent turn happening). Not persisted, not
  replicated; recomputed on each vetra boot.

The distinction is deliberate. Ephemeral runtime state in a CRDT
document creates noise in history and forces the editor to constantly
re-derive "current" from a log. Domain content in HTTP+SSE loses
replayability and forces re-fetching on every reload. Putting each
class where it belongs keeps both subsystems simple.

### Drive editor (Vetra Studio) in vetra-app

A custom editor registered for `powerhouse/document-drive`. Lives at
`vetra-app/editors/vetra-studio/` (planned). The vetra drive's
document sets `preferredEditor` to this editor's id so Connect picks
it up automatically.

Composition:

- Subscribes via `useDocument` to the drive doc itself (to list chat
  sessions) and to the currently-selected chat session (for messages,
  tool calls, and stage content derived from tool history).
- Subscribes via `fetch` + `EventSource` to the vetra local API
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

### Renown identity (agent authorization)

**Renown is the identity/auth provider.** The user authorizes the agent with
their Renown identity once; that authorization lets the agent act as the user
across Vetra Cloud and other Renown-protected services. The `deploy-environment-*`
tools are one consumer — they operate on the user's real Vetra Cloud environments
at `switchboard.staging.vetra.io` (the same switchboard the vetra-app Studio
Deploy section uses). The Node side lives in `vetra-cli/src/cloud/`.

Two Renown identities are involved: the user's wallet identity (browser, on
`renown.id`) and the agent's own `did:key` (backend). Authorizing the agent
delegates the user's wallet to that `did:key`.

- **Identity.** `@renown/sdk/node` `RenownBuilder` gives the agent a stable
  `did:key`. The keypair persists to `<workdir>/.ph/.keypair.json` and the
  delegated credential to `<workdir>/.ph/.renown.json` (workdir-scoped, like
  the embedded reactor's state); `PH_RENOWN_PRIVATE_KEY` overrides the keypair
  for pre-provisioned deployed agents. `src/auth/renown.ts` caches one
  `IRenown` per workdir and exposes `getBearerToken` (no `aud` — the
  switchboard's verifier rejects it), `getSigner`, the auth state machine
  (`startAuth` / `getAuthState` / `confirmAuth` / `logoutAuth`), and
  `getRenownStatus`. (The Vetra Cloud resource layer — switchboard URL,
  environments, drive — stays under `src/cloud/`.)
- **Authorization is the user's action, from the studio.** The agent has a
  single read-only `whoami` tool (reports whether it's authorized, and as
  which address); it cannot log in. The studio header renders an **Authorize
  agent** button (`vetra-app/.../AgentAuthButton.tsx`, left of "Auto-follow
  agent") that drives the console flow via the preview-server (the in-process
  local API, sharing the same per-workdir `IRenown`): `POST /auth/start`
  builds the `<renownUrl>/console?session=…&connect=<agentDid>` URL and opens
  it; the user approves with their wallet on `renown.id`; `POST /auth/confirm`
  polls `<renownUrl>/api/console/session/<id>` and runs `renown.login` to store
  the credential; `GET /auth/status` and `POST /auth/logout` round it out. (An
  in-app one-click authorize isn't possible — the wallet session and credential
  publishing live on the
  `renown.id` origin.) The Renown server URL defaults to
  `https://www.renown.id` (`config.cloudRenownUrl` overrides); the switchboard
  URL defaults to staging (`config.cloudSwitchboardUrl`).
- **Publish path (live).** `reactor-project-publish` mints a registry-bound
  bearer token from the agent's identity (`getRegistryToken` in
  `src/auth/renown.ts` → `generateAccessToken(…, { aud: registryUrl })`, the
  same mechanism as `ph publish`) and passes it to `npm publish` as the
  ephemeral `_authToken`; `reactor-project-publish-status` reads the registry
  packument over HTTP with the same token. No `npm login` — authorizing the
  agent is the only prerequisite.
- **Read path (live).** `deploy-environment-list` / `-get` query
  `myEnvironments` over GraphQL with the bearer token
  (`src/cloud/graphql.ts`) and trim to the caller's own environments
  (`filterOwn`, mirroring the Studio).
- **Write path (live).** `deploy-environment-create` / `-update` load (or
  create) the `vetra-cloud-environment` document via a `RemoteDocumentController`
  and push signer-signed actions against the cloud, mirroring the Studio
  (`src/cloud/environments-write.ts`, delegating to
  `@powerhousedao/vetra-cloud-client`).
- **Wait.** `deploy-environment-wait` polls the read path every 5s (up to a
  caller-set timeout — default 30s, max 60s) until the status leaves the
  in-flight set (`CHANGES_*` / `DEPLOYING` / `TERMINATING`) and settles, so the
  agent blocks in a single tool call instead of looping `deploy-environment-get`
  (`src/commands/deploy/wait.ts`).

### Triggers

Registered in `cli.ts`. Run as part of ph-clint's routine loop.

- `chatSessionWatchTrigger` (clint-common) — watches chat-session
  documents for new user messages and forwards them to the agent.
- `specSyncTrigger` — drive → filesystem mirror for spec documents.
  Routes each doc to `<workdir>/<project>/specs/` by reading the doc's
  file node and its parent folder (the project) off the embedded
  `vetra` drive; falls back to `<workdir>/specs/` for root-level
  docs (single-project layout).
- `specFsSyncTrigger` — filesystem → drive (chokidar-based), the
  **external-change detector**: hand-edited `.phd`, `git pull`,
  reactor-project writes. Watches the workdir root recursively, so
  `specs/` subtrees for projects created after startup are picked up
  automatically (no `poll()` reconcile step), replays each `.phd`'s
  operations via
  `loadBatch`, and attaches the doc to the embedded `vetra` drive
  under an ADD_FOLDER node named after its project (idempotent
  ensure-folder + ensure-file). This is the project↔folder mapping
  `specSyncTrigger` reads back. The shared push/remove logic lives in
  `helpers/spec-drive-sync.ts` (`applyFsChangesToReactor`,
  `removeSpecFromDrive`); the `spec-*` write commands call it directly
  (see below), so for command-originated changes this watcher only
  observes a convergent no-op (`loadBatch` dedups by `action.id`).

The `spec-*` write commands (`spec-create`, `spec-update`,
`spec-extract`, `spec-delete`) write the filesystem `specs/`
unconditionally — codegen's source of truth — and, when a reactor is
already running, **also push the change into the embedded drive
synchronously** via the same `spec-drive-sync.ts` helpers. The
running-reactor signal is `helpers/embedded-drive.ts` →
`getEmbeddedDrive(ctx)`: it gates on `ctx.folders` (wired only by the
daemon's startup, absent in one-shot CLI) so a standalone
`vetra spec-create` never boots a reactor just to write a spec. When
present, `ctx.reactor()` returns the already-cached instance.
- `previewServerTrigger` — runs the local API server. Triggers
  receive `commandContext.services` + `commandContext.on`, which is
  exactly what the http handlers need. `setup()` boots the server,
  `teardown()` closes it on daemon shutdown, `poll()` returns null
  (no work items — the trigger is purely a lifetime host for the
  server).

### Services

- `reactor-project` — `ph vetra` in dev mode for the preview surface.
  Persistent state at `<workdir>/.ph/vetra-cli/services/reactor-project/
  <instance>.json` (read by `reactor-project-ls` and projected over
  the local API).

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
  spec-create / spec-update
    ├─→ specs/*.phd  (filesystem, codegen source of truth)
    │       │ also feeds reactor-project tree (project source)
    │       ↓ (ph vetra dev mode, Vite HMR)
    │   reactor-project picks up new document model (codegen)
    └─→ vetra drive  (direct, synchronous when reactor running;
                          specFsSyncTrigger is the fallback for
                          external edits)
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

## Embedded reverse proxy

ph-clint's embedded proxy (`proxyEnabled: true`, port pinned to 8090 via
`configDefaults.proxyPort`) exposes every browser-facing endpoint through
a single public port — the requirement for deployed agents, where the
user's browser can only reach that one port.

Route sources:

- **Switchboard built-ins** — `/switchboard/graphql`, `/switchboard/d/`,
  `/switchboard/mcp`, registered before `powerhouse:switchboard:ready`
  fires so event consumers can hand out proxied URLs immediately.
- **Service readiness captures** — every typed capture routes at
  `/{serviceId}/{captureName}` (e.g. `/reactor-project/vetra-switchboard`).
  `website` captures route there too unless they claim the `/` catch-all
  via `proxyRoot: true` (the embedded Connect does; single-website CLIs
  fall back to root implicitly).
- **Static `proxyRoutes`** — in-process servers the ServiceManager doesn't
  know about; vetra registers `/preview` → preview-server (`:5180`).

Browser-facing URL policy, per consumer. The `connect-drive-url` hook
stamps absolute URLs into the prebuilt vetra-app bundle on
`powerhouse:switchboard:ready` (placeholder tokens on first run, the
last-applied value afterwards; one cache file per token):

- **vetra-studio (embedded Connect)** — served at proxy `/`; the hook
  stamps the *proxied* drive URL
  (`http://localhost:8090/switchboard/d/<id>`) from the extended
  switchboard-ready event payload.
- **preview-server** — the hook stamps `<proxy>/preview` over
  `PREVIEW_SERVER_URL_PLACEHOLDER` (a literal in vetra-app's
  `preview-server-client.ts`; direct loopback URL when the proxy is
  off). Vite-dev of vetra-app falls back to direct `127.0.0.1:5180`
  via `import.meta.env.DEV`.
- **BUILD iframe (reactor-project Connect)** — the service passes
  `ph vetra --base /reactor-project/vetra-studio/` (see
  `REACTOR_PROJECT_CONNECT_PROXY_PATH`) so Vite emits self-contained
  URLs under the proxy prefix; the readiness capture keeps the base path
  in the endpoint URL so the proxy forwards verbatim. `/resolve` returns
  both `url` (direct) and `proxiedUrl` (proxy-relative); the client
  resolves `proxiedUrl` against the stamped proxy origin (detected by
  the stamp's `/preview` pathname).

- **Project switchboard (drive sync for the BUILD iframe)** — when a
  public proxy URL is configured, the service passes
  `ph vetra --drives-public-base <publicUrl>/reactor-project/switchboard`
  so the nested studio's defaultDrives carry the proxy origin
  (`<publicUrl>/reactor-project/switchboard/d/<slug>`) instead of the
  unreachable `http://localhost:<sbPort>`; `reactor-project-start`
  registers the matching proxy routes
  (`/reactor-project/switchboard/{d/,graphql,attachments/,mcp}` →
  project switchboard, source `service:reactor-project`), whose
  `/d/`-aligned shape yields the X-Forwarded-Prefix the switchboard
  needs to announce proxied follow-up endpoints. Without a publicUrl the
  drive URLs stay local (current dev behavior).

Known gaps: `--base` only reaches Vite once monorepo PR #2676
(builder-tools `base: env.PH_CONNECT_BASE_PATH`) is in the published
stack; `--drives-public-base` requires a published ph-cli that knows the
flag (an older project-local ph-cli rejects it and the service fails to
start — only when a publicUrl is configured); and the stamped drive
URL bakes the proxy's localhost origin, so deployed agents need either a
public-origin config or relative drive-URL support in Connect.

## Workflow scaffolds

A workflow scaffold is a React component in vetra-app that owns the
right-pane layout for a class of agent task. Scaffolds:

- Declare the step ids they accept (`'ideate' | 'specify' | 'build' |
  'deploy'` for the default scaffold).
- Define per-step payload shapes.
- Render whatever UI fits the task. The default scaffold is a vertical
  timeline of step cards; future scaffolds can be single full-bleed
  iframes, side-by-side comparisons, etc.

Workflow instances live in vetra's in-memory registry. Each chat
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
    │   ├── constants.ts       ← API port, proxy paths, default PH version
    │   ├── agents/agent.ts    ← Mastra agent factory
    │   ├── preview-server/    ← vetra local API (resolve/start/events)
    │   ├── commands/          ← spec-*, reactor-project-*, spec-preview-*
    │   ├── services/
    │   │   └── reactor-project.ts
    │   ├── triggers/
    │   │   ├── preview-server.ts   ← hosts the local API
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

- **Workflow registry is in-memory.** vetra restart drops all
  active workflows; the editor reconnects to a fresh registry. For
  MVP this is fine. Persistence (and the resumable-vs-abandonable
  question that comes with it) is V2.

- **Project state is not a drive document.** Chat sessions reference
  their current project by a transient handle (path or service
  instance id). Renaming or moving a project workdir invalidates
  references in any chat sessions that pointed at it. Promoting
  project to a document model in the vetra drive is phase 2;
  it'll resolve this and let the editor enumerate projects via the
  reactor instead of a side-channel API.

- **Agent doesn't see runtime failures.** Service errors, workflow
  failures, and reactor-project crashes surface in the terminal via
  log handlers; the agent's input channels (chat session + Mastra
  thread) don't yet receive them. A `pushAgentNotice(message)` primitive
  in ph-clint, or a per-turn pending-context queue, would close it.

- **Studio-mode parity.** Connect runs static in vetra today
  (vetra-app's prebuilt bundle exists). ph-clint's `connect-server.ts`
  serves the static SPA and applies the dynamic-base substitution; it no
  longer hosts a live package hot-reload channel. ph-clint still accepts
  a `registryUrl` on its Switchboard/Connect config (the `Packages`
  subgraph + `PH_CONNECT_PACKAGES_REGISTRY`), but vetra does not set
  it — the live preview path is reactor-project + Vite HMR, not dynamic
  package loading.

The live publish path — `commands/reactor-project/publish.ts` and
`publish-status.ts` — is unaffected: those are the deploy-flow tools that
publish a Reactor package to the remote registry via the agent's Renown
token (see "Renown identity → Publish path" above).
