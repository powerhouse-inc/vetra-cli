# Architecture: vetra-cli

This document describes how `vetra-cli` is put together — the components
that run in-process, the services it spawns, the package-distribution
pipeline, and the dynamic-load chain that lets a freshly-published
Powerhouse package light up inside a running Connect tab.

For setup steps, build commands and the publish-pipeline test plan, see
`HANDOFF.md`. This file is the durable map of how the pieces fit; that
file is the working state of the open work.

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
                  │  └─────────────────┘    └────────┬─────────┘   │
                  │                                  │             │
                  │  ┌───────────────────────────────▼───────────┐ │
                  │  │ Embedded Switchboard (apps/switchboard)    │ │
                  │  │ GraphQL + MCP + PackagesSubgraph           │ │
                  │  │ http://localhost:59220/graphql             │ │
                  │  └────────┬───────────────────────────────────┘ │
                  │           │                                    │
                  │  ┌────────▼────────────────┐                   │
                  │  │ publish-reload trigger   │                  │
                  │  │ (routine, polls SSE)     │                  │
                  │  └────────┬────────────────┘                   │
                  │           │                                    │
                  └───────────┼────────────────────────────────────┘
                              │
                ┌─────────────┼──────────────────┐
                │             │                  │
                ▼             ▼                  ▼
       ┌─────────────┐  ┌───────────────┐  ┌────────────────────────┐
       │ Connect     │  │ local-registry│  │ reactor-project        │
       │ (static SPA)│  │ (Verdaccio +  │  │ (per-project `ph vetra`│
       │ port 27370  │  │ CDN, port     │  │  Switchboard, optional)│
       └─────────────┘  │ 8765)         │  └────────────────────────┘
                        └───────────────┘
```

The whole thing is one user-launched binary (`pnpm dev -i` or
`pnpm start -i`). Both scripts pass `--workdir ../../vetra-test` so
projects created via `reactor-project-init` land in
`vetra/vetra-test/` rather than polluting the CLI source tree; the
embedded reactor's storage (`<workdir>/.ph/vetra/`) and agent
conversation logs (`<workdir>/.ph/vetra/logs/<agent>/`) live there too.
Internally:

- The **reactor**, **agent**, and **Switchboard** all run inside the
  vetra-cli node process. The Switchboard is the API surface (GraphQL +
  MCP); the reactor is the document store underneath it.
- The **routine** (a ph-clint construct) runs registered **triggers** on
  a poll loop in the same process. `publish-reload` is one of them.
- **Connect**, **local-registry**, and any **reactor-project** sessions
  run as separate child processes, started and supervised by ph-clint's
  service manager.

## Repositories

The runtime composition links three repositories. The pnpm workspace
overrides in `vetra-cli/pnpm-workspace.yaml` point at local checkouts so
edits anywhere in this stack are picked up after a rebuild.

- `/Users/acaldas/dev/powerhouse/vetra/vetra-cli/` — this repo. Contains
  the CLI definition, agents, services, triggers, and the `vetra-app`
  reactor project that the embedded reactor uses as its source of truth
  for document models, editors, processors and subgraphs.
- `/Users/acaldas/dev/powerhouse/ph-clint/` — the framework vetra-cli is
  built on. Owns the reactor lifecycle, service manager, routine loop,
  interactive REPL, agent loader, and the Switchboard / Connect
  integration glue.
- `/Users/acaldas/dev/powerhouse/monorepo/.claude/worktrees/vetra-codegen-agent-api/`
  — the Powerhouse monorepo worktree. Contains `apps/switchboard`,
  `apps/connect`, `packages/reactor`, `packages/reactor-browser`,
  `packages/registry`, and the bundled Powerhouse packages
  (`@powerhousedao/vetra`, `@powerhousedao/powerhouse-vetra-packages`).

## Components, in detail

### Embedded reactor

Built by `cli.configureReactor` in `vetra-cli/src/cli.ts` via
`buildDefaultReactor`. Composes the document models from `vetra-app` and
`@powerhousedao/clint-common`, names the primary drive `vetra-cli`, and
returns a `ReactorContext` that the agent and the Switchboard both share.
Storage lives at `<workdir>/.ph/vetra/`.

### Embedded Switchboard

`@powerhousedao/switchboard`'s `startSwitchboard()`, invoked from
ph-clint's `switchboard.ts`. ph-clint passes its own pre-built reactor
in via `StartServerOptions.reactor` so the Switchboard and the agent
share one document store rather than each running their own.

The Switchboard exposes:

- `/graphql` — supergraph composing every registered subgraph
  (`reactor-drive`, `document-model`, `vetra-package`, `chat-session`,
  `Packages`, …).
- `/graphql/packages` — the `PackagesSubgraph` that fronts
  `PackageManagementService.installPackage / uninstallPackage`. This is
  the API the publish-reload trigger drives.
- `/mcp` — Model Context Protocol endpoint.
- `/d/:drive` — per-drive GraphQL endpoint.

The Switchboard remembers its installed packages in the read-model DB
(`<workdir>/.ph/read-storage`). However, it currently starts with
`packages: []` and **does not yet re-register persisted packages on
boot** — see "Known gaps" below.

### Embedded Connect

A static SPA served by ph-clint's `connect-server.js` (Node + Express)
out of `<vetra-app>/dist/connect/`. ph-clint auto-detects static mode in
`packages/ph-clint/src/core/cli.ts` by looking for
`<connect-workdir>/dist/connect/index.html`; falls back to studio mode
(`ph connect` via Vite) if missing.

The bundle is produced by `pnpm exec ph-cli connect build --outDir
dist/connect` inside `vetra-app`. That command runs Vite over
`@powerhousedao/connect`'s source (linked from the monorepo worktree)
with `vetra-app` as the local-package import. It bakes
`vetra-app/dist/connect/ph-packages.json` with the build-time package
list and the local package metadata.

The connect-server exposes:

- `GET /` and `/assets/*` — the SPA and its chunks.
- `GET /__packages` — SSE stream. On connect emits a `connected` event
  and an immediate `packages-changed` event carrying the merged baked +
  dynamic list. Subsequent events: `packages-changed` (new full list)
  and `package-error` (forwarded from `/__packages/error` posts).
- `POST /__packages` — body `{ packages: string[] }`. Replaces the
  in-memory dynamic overlay and broadcasts `packages-changed`. Returns
  204 with `X-Subscribers: <count>`.
- `POST /__packages/error` — accepts `{ message, filename, stack? }`
  and rebroadcasts as `package-error`.
- `GET /ph-packages.json` — merged baked + dynamic list (so a fresh
  page load sees what running tabs already know).

On the SPA side, `apps/connect/src/store/reactor.ts`'s
`subscribeToPackagesChannel` opens an EventSource against `/__packages`
and reconciles each event with `BrowserPackageManager` (see "Dynamic
package loading" below).

### local-registry

`@powerhousedao/registry` (Verdaccio + Powerhouse CDN + SSE webhooks),
spawned as a separate process by ph-clint's service manager. Defined in
`vetra-cli/src/services/local-registry.ts`. Binds to a hardcoded port
(`LOCAL_REGISTRY_PORT = 8765` in `vetra-cli/src/constants.ts`) so the
embedded Switchboard and Connect can hardcode the registry URL at
configuration time — see Known Issue #3 in HANDOFF for the lazy-callback
follow-up.

The local-registry is currently **not auto-started** at vetra-cli boot.
ph-clint's startup sequence only auto-starts the reactor, Switchboard
and Connect; arbitrary services declared in `defineCli.services` sit
dormant until something calls `services.start('local-registry')`.

Storage:
- `<workdir>/.ph/registry/storage/` — Verdaccio package storage.
- `<workdir>/.ph/registry/cdn-cache/` — extracted bundles served from
  `/-/cdn/<name>@<version>/...` for browser-side dynamic imports.

The registry emits a `publish` event on `<registryUrl>/-/events` (SSE)
whenever a package is published. The publish-reload trigger subscribes
to this stream.

Anonymous publish is the default — no `npm login` flow is required.
`--auth-renown` enables signed bearer-token verification for hosted
deployments.

### Agent

Created via `cli.configureAgent(createAgent)` in
`vetra-cli/src/agents/agent.ts`. Uses Mastra for chat session memory and
tool execution. Tools are auto-injected from `cli.commands[]` and the
registered skills. The agent has direct in-process access to the reactor
via `ctx.reactor()` from inside tools.

### Triggers

Registered in `cli.ts`. Run as part of ph-clint's routine loop (every
N seconds via `routine.tick()`).

- `chatSessionWatchTrigger` (clint-common) — watches the chat-session
  document for new user messages and forwards them to the agent.
- `specSyncTrigger` — drive → filesystem mirror for spec documents.
- `specFsSyncTrigger` — filesystem → drive (chokidar-based).
- `publishReloadTrigger` — the focus of this document; described in
  "Publish flow" below.

### Services

Declared in `cli.ts`. Spawned and supervised by ph-clint's service
manager. Persistent state lives at
`<workdir>/.ph/<cli>/services/<id>/<instance>.json`.

- `reactor-project` — runs `ph vetra` for a per-project Switchboard
  + Connect pair. Not in the publish-reload fan-out (see HANDOFF
  decision #5). Used to preview a project's own documents.
- `local-registry` — the Verdaccio-based registry described above.

## Boot sequence

ph-clint's `startupSequence` in
`ph-clint/src/core/runtime.ts`:

1. **Proxy** (if configured) — multiplexed front-door for downstream
   services. Not used in default vetra-cli config.
2. **Reactor** — `reactorConfig.create(ctx)` builds and starts the
   in-process document store. Drive is created or loaded; folder
   commands are injected if the drive supports them. Persistence at
   `<workdir>/.ph/vetra/`.
3. **Switchboard** — `startSwitchboard()` from `apps/switchboard`
   (lazy-imported). Reuses the reactor module from step 2 — does not
   spin up a second reactor. Listens on port 59220 by default.
   `PackagesSubgraph` is registered. Identity is generated via Renown.
4. **Connect** — `services.start('vetra-studio')` spawns
   `connect-server.js` against `vetra-app/dist/connect/`. Detects static
   vs studio mode based on whether the prebuilt bundle exists. Listens
   on port 27370 by default. The SPA's `BrowserPackageManager.init()`
   then registers the bundled `@powerhousedao/powerhouse-vetra-packages`
   and `@powerhousedao/vetra` packages plus the local `vetra-app`
   project package, then loads any registry packages declared in
   `ph-packages.json`.
5. **Routine** — the trigger loop starts. Each trigger's `setup(ctx)`
   runs once; thereafter `poll(ctx)` runs on every tick.

Services registered in `cli.services` but not part of `startupSequence`
(currently `local-registry` and any `reactor-project` instances) stay
dormant until the user explicitly starts them.

## Publish flow

What happens when a user publishes a new Reactor package to the local
registry.

```
  developer
     │
     ▼
  npm publish ──► local-registry
                    │
                    │  SSE event: { type: "publish",
                    │              packageName,
                    │              version, ... }
                    │  on /-/events
                    ▼
              publish-reload trigger
                    │
        ┌───────────┼───────────┐
        │                       │
        ▼                       ▼
    Switchboard              Connect
    GraphQL                  /__packages
    Packages.uninstall       (HTTP POST)
    Packages.install         + SSE broadcast
    (with @version)             to subscribers
        │                       │
        ▼                       ▼
   PackageMgr re-      BrowserPackageManager
   loads bundle via    diff vs current, refetches
   HttpPackageLoader   on version bump, notifies
                          │
                          ▼
                       useVetraPackages
                       re-renders → DocumentEditor's
                       version-keyed `key` flips →
                       editor remounts with new bundle
```

Details, from `vetra-cli/src/triggers/publish-reload.ts`:

1. The trigger subscribes to `<registry>/-/events` in its `setup(ctx)`,
   parsing each `publish` SSE event into `{ packageName, version }` and
   queuing it onto `ctx.state.pending`.
2. On each `poll(ctx)` tick the trigger drains pending events and runs
   `reloadOnSwitchboard` followed by `reloadOnConnect` for each.
3. `reloadOnSwitchboard` queries
   `{ Packages { installedPackages { name } } }`, uninstalls every prior
   entry matching `<name>` or `<name>@*`, then installs
   `<name>@<version>`. The version suffix bypasses Node's ESM URL cache.
4. `reloadOnConnect` queries `installedPackages` again, deduplicates,
   and POSTs the version-qualified list to `<connect-url>/__packages`.
   The connect-server replaces its dynamic overlay and broadcasts
   `packages-changed` to all SSE subscribers.

In addition, the trigger does a **one-shot initial reconciliation** on
its first poll once both the Switchboard URL and Connect URL are ready:
it queries `installedPackages` and POSTs the result to
`/__packages`. This means Connect tabs see the Switchboard's persisted
state immediately on boot, without waiting for a publish event.

Failures are surfaced via the `package:reload-failed` event bus event,
which `cli.ts` registers a handler for to print a visible `ERROR` line
in the terminal. The agent does **not** yet receive these failures
through its input channel — see "Open gaps".

## Dynamic package loading in Connect

The SPA receives the version-qualified package list and reconciles
without a page reload.

`apps/connect/src/store/reactor.ts → subscribeToPackagesChannel`:

1. Opens `EventSource('/__packages')`.
2. The first `packages-changed` event after `connected` is treated as
   the initial replay — packages get reconciled but no toast is shown.
3. On each subsequent event:
   - Parse every incoming spec into `{ bareName, version }`.
   - Diff against `packageManager.getRegistryPackages()` — registry-
     tracked entries only. Bundled (common/project) packages are never
     touched.
   - For each removed name → `packageManager.removePackage(name)` +
     `toast("Removed package …")`.
   - For each added name → `packageManager.addPackage(spec)` +
     `toast("Installed package …")`.
   - For each known name with a different version →
     `packageManager.addPackage(spec)` + `toast("Updated package …")`.

`BrowserPackageManager.addPackage(spec)`:

- Short-circuits with the existing entry only when the requested
  version matches the stored version (or no version was requested or
  the package is bundled/local).
- On a version bump, unmounts the old stylesheet, loads the new bundle
  from `<registry>/-/cdn/<name>@<version>/...`, and calls
  `#registerPackage` which overwrites the entry in `#packages` and
  `#storage`, then fires `#notifyPackagesChanged()`.

## Editor hot-reload chain

When a user has an editor open and republishes a new version:

1. Trigger pushes version-qualified specs to `/__packages` (see above).
2. SSE handler detects version diff → `addPackage(spec)` refetches.
3. `#notifyPackagesChanged()` notifies the `useSyncExternalStore`-backed
   subscribers in `useVetraPackageManager`.
4. `useVetraPackages()` returns the new package list.
5. `DocumentEditor` in `apps/connect/src/components/editors.tsx`
   recomputes:
   ```
   const editorBundleKey = `${owningPackageName}@${owningPackageVersion}`;
   ```
   The owning package is resolved by iterating `vetraPackages` and
   matching the editor module to its `editors[]` array.
6. The React `key` on the inner `<EditorComponent>` is
   `${editorBundleKey}:${documentId}`. When the version changes, the
   key changes, React unmounts the old subtree, and the next mount
   imports the new bundle.

This chain only works because (a) `addPackage` actually refetches on
version bump, (b) the trigger sends version-qualified specs, and (c)
the editor host reads the version reactively from the package manager
rather than capturing it once.

## Workspace overrides

`vetra-cli/pnpm-workspace.yaml` declares overrides that link every
Powerhouse package to its source checkout — switchboard, reactor-api,
reactor-browser, connect, vetra, powerhouse-vetra-packages, registry,
ph-cli, ph-clint and clint-common all resolve to the monorepo / ph-clint
working trees rather than to npmjs.org releases.

This has consequences:

- A rebuild of any linked package is immediately visible to vetra-cli
  on next process start. No re-publish needed.
- The pnpm lockfile sometimes resists override changes — see HANDOFF
  Known Issue #1. The standard workaround is to bump the consumer's
  version spec, or to manually re-symlink in `node_modules`.
- Connect's static bundle (`vetra-app/dist/connect/`) is a build
  artifact — rebuild via `pnpm exec ph-cli connect build --outDir
  dist/connect` after touching apps/connect or any of its dependencies.
  `ph-cli build` alone does not produce the Connect bundle; it only
  builds the lib (`dist/node`, `dist/browser`, types).

## Configuration surface

`vetra-cli/src/framework.ts`:

- `configSchema` — Zod schema for `cli.config`. Includes `registryUrl`
  (defaults to `LOCAL_REGISTRY_URL`), `phVersion`, model selection, and
  registry credentials.
- `secretsSchema` — Zod schema for `cli.secrets`. Holds the Anthropic
  API key and registry password.

`vetra-cli/src/constants.ts`:

- `LOCAL_REGISTRY_PORT = 8765`
- `LOCAL_REGISTRY_URL = "http://localhost:8765"`

Both Switchboard and Connect read `LOCAL_REGISTRY_URL` at configure
time and pass it down. The `Packages.installPackage` GraphQL mutation
defaults to this URL when the caller doesn't pass one.

## Filesystem layout

```
vetra-cli/
├── ARCHITECTURE.md            ← you are here
├── HANDOFF.md                 ← open work + setup steps
├── package.json
├── pnpm-workspace.yaml        ← overrides linking to ph-clint + monorepo
├── vetra-app/                 ← embedded reactor's project
│   ├── document-models/
│   ├── editors/
│   ├── processors/
│   ├── subgraphs/
│   ├── powerhouse.config.json
│   └── dist/connect/          ← built Connect static bundle
└── vetra-cli/
    ├── src/
    │   ├── cli.ts             ← defineCli + configureReactor
    │   ├── framework.ts       ← config + secrets schemas
    │   ├── constants.ts       ← LOCAL_REGISTRY_*
    │   ├── agents/agent.ts    ← Mastra agent factory
    │   ├── commands/          ← spec-* and reactor-project-* commands
    │   ├── services/
    │   │   ├── local-registry.ts
    │   │   └── reactor-project.ts
    │   └── triggers/
    │       ├── publish-reload.ts
    │       ├── spec-sync.ts
    │       └── spec-fs-sync.ts
    └── .ph/                   ← runtime state
        ├── vetra/             ← reactor PGlite
        ├── read-storage       ← Switchboard read-model DB
        ├── registry/          ← local registry storage + cdn-cache
        ├── vetra-cli/services/ ← service manager state files
        └── connect-build/     ← intermediate Connect build output
```

## Open gaps

These are known limitations called out in the code or HANDOFF; they are
not bugs in the current iteration but are worth tracking.

- **Switchboard cold-start package set is empty.** `startSwitchboard`
  is called with `packages: []`. On a fresh boot, `installedPackages`
  returns `[]` until the publish-reload trigger reconciles via SSE.
  Persisted packages in `<workdir>/.ph/read-storage` aren't replayed.
  Three resolution paths under consideration: (1) trigger queries the
  registry on startup and re-installs each package; (2) trigger persists
  its own `installed-packages.json` and replays it; (3) apps/switchboard
  self-restores from its read-model DB. Tracked in HANDOFF.

- **local-registry doesn't auto-start.** ph-clint's `startupSequence`
  only auto-starts reactor, Switchboard and Connect. The user must run
  `local-registry-start` (or it must be started programmatically). The
  proper fix is either an `autoStart: true` flag on `defineService` or
  exposing `services` on `LifecycleInitContext` so a vetra-cli
  lifecycle plugin can call `services.start('local-registry')`.

- **Connect URL not on `ReactorContext`.** ph-clint's
  `runtime.ts:282` computes `connectUrl` but only uses it for a stdout
  line. The publish-reload trigger compensates by doing the same
  `services.list(connectName)[0].endpoints['connect-studio']` lookup
  itself. A one-line ph-clint change would cache it.

- **`registryUrl` is hardcoded.** `cli.configureReactor` runs before
  config resolution; the embedded Switchboard / Connect therefore
  can't read a user-overridden `registryUrl` from `ctx.config`. The
  hardcoded `LOCAL_REGISTRY_URL` is the single source of truth.
  ph-clint accepting a lazy `registryUrl: (ctx) => string` callback
  would unblock this.

- **Reactor-projects aren't in the publish fan-out.** Per HANDOFF
  decision #5, the trigger targets only the embedded reactor's
  Switchboard + Connect. Per-project `ph vetra` instances (if running)
  don't see published packages until a manual restart.

- **Agent doesn't see `package:reload-failed`.** The event reaches
  `cli.ts`'s handler and prints a terminal `ERROR` line, but the
  Mastra agent only ingests tool-call results, its memory thread, and
  chat-session document messages. None of those carry the trigger's
  failure events.

- **Studio-mode `/__packages` plugin is missing.** Static-mode
  `connect-server.js` implements the full protocol. Studio mode (Vite
  dev) doesn't expose the endpoints, so the publish-reload trigger
  gets 404s when Connect is in studio mode. A parallel Vite plugin is
  the proper fix.
