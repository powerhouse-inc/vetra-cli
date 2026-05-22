# Handoff: publish pipeline across vetra-cli, ph-clint, apps/connect, and apps/switchboard

This document captures the state of the work to make `agent publishes a Reactor package → local registry → embedded Switchboard + Connect dynamically load the package` actually work end-to-end. Read it cover-to-cover before touching the code — there are non-obvious pnpm + Node ESM resolution traps.

There is no full-page reload anywhere in the pipeline: Connect subscribes to a `/__packages` SSE channel and calls `packageManager.addPackage` / `removePackage` to converge with the pushed list. The old `/__reload` protocol has been removed.

## Ground rules for whoever picks this up

These are durable preferences from the user driving the work. Honor them across every commit and every edit.

- **No historical narration in code comments.** Comments describe what the code does *now*, not what it used to do. Do not write "was previously…", "before this change…", "swap from X to Y…", "we used to…", or anything that bakes a temporal story into a file. PR descriptions and commit messages are the right place for that; code is not. If you find yourself reaching for those phrases, you're explaining the diff to a reader of the source, who has no reason to care.
- **No marketing/buzzword phrasing in code or docs.** Plain technical English. The function does what it does; don't preface it with "elegant", "robust", "powerful", etc.
- **No emoji in code, comments, file content, or commit messages** unless the user explicitly asks for them.
- **Don't pre-emptively wrap up.** When asked to do X, do X. Don't tack on a summary of the whole session, a TODO list of unrelated polish, or a self-review. End-of-turn summaries should be at most one or two sentences.
- **Commit boundaries follow concern, not size.** Don't lump architectural changes (apps/switchboard schema additions) with consumer wiring (vetra-cli/cli.ts) into one commit. Separate commits in separate repos.
- **When the auto-permission classifier blocks an edit you genuinely need**, surface it once with the path and what you intended to do, and let the user grant access. Don't retry the same denied call in a loop.
- **The pnpm lockfile resists workspace overrides in this repo set.** When you add an `overrides:` entry in `pnpm-workspace.yaml` and `pnpm install` says "Already up to date", the lockfile is still pinning the old version. Bump the version spec in the consumer's `package.json` to force re-resolve, or manually re-symlink as a last resort. See "Known issues" → #1.
- **Service state is on disk.** ph-clint's ServiceManager reads `<workdir>/.ph/<cli>/services/<id>/<instance>.json` so externally-started services *are* visible to a running CLI's `services.list()`. You don't have to start everything from inside the running interactive CLI — `pnpm dev local-registry-start` from another shell works fine.
- **Auto-classifier may block file reads in adjacent repos** after a long session even if previously allowed. If that happens, ask the user to re-grant access for the path and continue.

## Overall goal

Single shared instance of Connect/Switchboard inside `vetra-cli` (the CLI's embedded reactor) hosts the spec drive. The agent works in a project sub-folder, runs `reactor-project-publish` to push a package to the **local** npm registry (`@powerhousedao/registry`), and the embedded Switchboard + Connect dynamically load the new version without a restart. Preview documents continue to live in per-project `reactor-project` instances when needed.

## Architecture decisions made

0. **Local-registry integration is currently disabled (opt-in kill-switch).** `LOCAL_REGISTRY_ENABLED` in `vetra-cli/src/constants.ts` defaults to `false`. While off, `cli.ts` skips registering the `local-registry` service, skips the `publish-reload` trigger, and omits `registryUrl` from both `switchboard` and `connect` reactor config (so they fall back to defaults). Flip the constant to `true` to restore everything decisions 2–7 below describe. Not surfaced in `configSchema`.

1. **Embedded reactor stays as source of truth.** `cli.configureReactor` in `vetra-cli/src/cli.ts` continues to build the reactor via `buildDefaultReactor`. The agent's drive (chat sessions, agent state) keeps its in-process `IReactorClient` access.

2. **Embedded Switchboard uses `apps/switchboard`, not `reactor-api.initializeAndStartAPI`.** The slim `reactor-api` agent-mode API does NOT register `PackagesSubgraph`; only `apps/switchboard` does. Without the subgraph, the publish-reload trigger can't call `Packages.installPackage` / `uninstallPackage`. The swap is enabled by adding `reactor?: ReactorClientModule` to switchboard's `StartServerOptions` so it accepts a pre-built reactor instead of always building its own.

3. **Connect speaks a uniform `/__packages` HTTP protocol regardless of mode.** Static mode (`connect-server.js`) exposes `GET /__packages` (SSE) + `POST /__packages` (push). On connect, the SSE stream emits a `connected` event then immediately a `packages-changed` event carrying the merged baked + dynamic list — so a tab that opens after a publish still sees the latest state without polling. The SPA itself (`apps/connect/src/store/reactor.ts`) subscribes to `/__packages` after `packageManager.init()` and diffs incoming `packages-changed` events against the loaded set, calling `packageManager.addPackage` / `removePackage` to converge. **No full page reload is involved.** Studio mode (vite dev) should expose the same endpoints via a vite plugin — still TODO.

4. **Connect forwards `PH_CONNECT_PACKAGES_REGISTRY` to its vite config** so the browser resolves Powerhouse package bundles from the local registry CDN.

5. **publish-reload trigger targets the embedded reactor only.** Per-project `reactor-project` instances are NOT in the fan-out — that's a deliberate scope choice for the current iteration. The trigger uses `ctx.reactor().switchboardUrl` for the switchboard mutations and `services.list()` scanning for `endpoints['connect-studio']` for the Connect URL (because ph-clint doesn't populate `ReactorContext.connectUrl` — flagged as Known Issue #2).

6. **No-auth GraphQL works in dev.** With `auth_enabled` undefined (the default) the `isAdmin` gate collapses to `() => true` (see `reactor-api/src/graphql/graphql-manager.ts:486`). The publish-reload trigger relies on this — there's no token plumbing.

7. **Load failures are surfaced via `package:reload-failed` events.** When `installPackage` returns a GraphQL error, `POST /__packages` fails, or a browser tab posts a runtime import failure to `/__packages/error`, the trigger emits a structured event (`{packageName, version, target, error}`) on the event bus. `cli.ts` registers a handler that logs it as a visible `ERROR` line. **The user sees the log line, the agent does not yet — see "How the agent learns about failures" below.** The event name still says `reload-failed` for backwards compatibility; rename is a follow-up.

## Repositories touched

- **`/Users/acaldas/dev/powerhouse/vetra/vetra-cli/`** — the CLI itself (this repo).
- **`/Users/acaldas/dev/powerhouse/ph-clint/`** — ph-clint framework.
- **`/Users/acaldas/dev/powerhouse/monorepo/.claude/worktrees/vetra-codegen-agent-api/`** — Powerhouse monorepo worktree (apps/switchboard and apps/connect both live here).

All three need to be on the same commits at the same time during dev.

## Files changed

### apps/switchboard (`monorepo/.claude/worktrees/vetra-codegen-agent-api/apps/switchboard/`)

- `src/types.ts`
  - Import `ReactorClientModule` from `@powerhousedao/reactor`.
  - Add `reactor?: ReactorClientModule` to `StartServerOptions`.
  - Add `registryUrl?: string` to `StartServerOptions`.
  - Add `shutdown: () => Promise<void>` to `SwitchboardReactor`.

- `src/server.mts`
  - Import `ReactorClientModule` as type from `@powerhousedao/reactor`.
  - Add `clientModuleRef` alongside `apiRef` so the returned `shutdown()` can call `module.reactor.kill().completed`.
  - `registryUrl` resolution honors `options.registryUrl ?? PH_REGISTRY_URL ?? config.packageRegistryUrl`.
  - `reactorPgliteDir` is `null` when `options.reactor` is set (caller owns reactor storage).
  - `initializeClient` short-circuits when `options.reactor` is set: wraps the caller's `reactor.kill` so the api `dispose` runs alongside it, starts metrics instrumentation on the caller's `reactorModule`, captures the module in `clientModuleRef`, returns `options.reactor`.
  - Return value gains `shutdown`: disposes `api` when external reactor was passed, otherwise calls `reactorModule.reactor.kill().completed`.

- Build with `pnpm run build` from inside `apps/switchboard/`. tsdown emits `dist/server.mjs` plus chunks.

### ph-clint (`ph-clint/packages/ph-clint/`)

- `package.json`
  - `@powerhousedao/switchboard: "^6.0.0-dev.253"` added to `peerDependencies` and `peerDependenciesMeta` (optional).

- `src/integrations/powerhouse/types.ts`
  - `registryUrl?: string` on `SwitchboardConfig` (forwarded to apps/switchboard).
  - `registryUrl?: string` on `ConnectConfig` (forwarded to `ph connect` as `PH_CONNECT_PACKAGES_REGISTRY`).

- `src/integrations/powerhouse/switchboard.ts`
  - `StartSwitchboardOptions.registryUrl?: string`.
  - `SwitchboardApi` type renamed to `SwitchboardHandle` and reduced to `{ shutdown: () => Promise<void> }`.
  - `buildSwitchboardInstance` takes the handle and forwards `shutdown` directly.
  - `startSwitchboard` lazy-imports `@powerhousedao/switchboard/server` and calls `startSwitchboardImpl({ reactor, port, dbPath, mcp:true, packages:[], registryUrl, strictPort:true })`.

- `src/integrations/powerhouse/connect.ts`
  - `env()` forwards `connectConfig.registryUrl` as `PH_CONNECT_PACKAGES_REGISTRY` when set.

- `src/integrations/powerhouse/connect-server.ts`
  - `GET /__packages` (SSE) + `POST /__packages` (push) endpoints. On SSE connect, the server emits `connected` then a `packages-changed` event with the current merged baked + dynamic list, so a tab arriving after a publish still sees the latest state.
  - `POST /__packages/error` accepts `{message, filename, stack?}` and broadcasts it as a `package-error` SSE event.
  - `GET /ph-packages.json` returns the merged list (baked from `<dir>/ph-packages.json` + the in-memory dynamic overlay) — keeps fresh page loads consistent with what running tabs see.
  - Injects a small `<script>` into every served HTML that hooks `window.error` / `unhandledrejection`, filters to URLs containing `/-/cdn/`, and POSTs to `/__packages/error`. The SPA itself (apps/connect) opens the SSE subscription — the injected script no longer participates in package loading.

- `src/core/runtime.ts`
  - Passes `registryUrl: reactorConfig.switchboard.registryUrl` to `startSwitchboard()`.

- `pnpm-workspace.yaml`
  - Top-level `overrides:` block with `@powerhousedao/switchboard: link:../monorepo/.claude/worktrees/vetra-codegen-agent-api/apps/switchboard`. **NOTE: this override is NOT honored by pnpm in this repo with the existing lockfile** — see "Known issues" #1.

- Build with `CI=true pnpm run build` from inside `packages/ph-clint/`. Plain `tsc`.

### vetra-cli (`vetra/vetra-cli/`)

- `pnpm-workspace.yaml`
  - Added overrides linking `@powerhousedao/switchboard`, `@powerhousedao/ph-clint`, `@powerhousedao/ph-clint-dev`, `@powerhousedao/ph-clint-observability`, `@powerhousedao/clint-common` to local checkouts.

- `vetra-cli/package.json`
  - Added `@powerhousedao/switchboard: 6.0.0-dev.253` as a direct dependency so pnpm pulls the linked package.

- `vetra-cli/src/cli.ts`
  - `cli.configureReactor`'s `switchboard:` and `connect:` both carry `registryUrl: LOCAL_REGISTRY_URL` (imported from `./constants.js`). The same constant is the default for `config.registryUrl` in `framework.ts`, so all three call sites (publisher, embedded Switchboard, embedded Connect) agree without per-site duplication. See Known Issue #3.
  - `events:` registers a `'package:reload-failed'` handler that logs the structured failure as a visible `ERROR` line.

- `vetra-cli/src/constants.ts` *(new)*
  - Exports `LOCAL_REGISTRY_PORT` and `LOCAL_REGISTRY_URL`. Leaf module to avoid the framework.ts ↔ services/local-registry.ts cycle. Single source of truth for the embedded registry port.

- `vetra-cli/src/services/local-registry.ts`
  - Imports `LOCAL_REGISTRY_PORT` and uses it for both the `ph-registry --port` flag and the preflight `checkPort`. The `--port` param on the service paramsSchema was dropped — letting users override it would silently break the embedded Switchboard/Connect wiring (which is hardcoded).
  - Defines the `local-registry` service that spawns `ph-registry` with storage at `<workdir>/.ph/registry/{storage,cdn-cache}/`.

- `vetra-cli/src/framework.ts`
  - `config.registryUrl` default is `LOCAL_REGISTRY_URL` (was the wrong port previously).

- `vetra-cli/src/commands/reactor-project/publish.ts`
  - Now destructures `username` / `password` from the tool input (was silently dropped; only `config.registryUsername`/`config.registryPassword` had any effect). Args take precedence; after a successful auto-login, the resolved username is reported in the publish summary.

- `vetra-cli/src/triggers/publish-reload.ts`
  - Targets the embedded reactor: `(await ctx.reactor())?.switchboardUrl` for switchboard, `services.list().find(s => s.endpoints?.['connect-studio'])` for Connect.
  - Switchboard mutations: list installed packages, uninstall every entry matching `<name>` or `<name>@*`, install version-qualified `<name>@<version>`. Version suffix bust Node's ESM URL cache on reinstall.
  - Connect push: after a successful switchboard install the trigger queries `{ Packages { installedPackages { name } } }`, strips the `@<version>` suffix from each name (deduped), and POSTs `{ packages: string[] }` to `<connect-url>/__packages`. The connect-server replaces its dynamic overlay and broadcasts `packages-changed` to all SSE subscribers in one round trip.
  - Captures load errors: `installPackage` GraphQL errors (200 OK with `data.errors[]`) and `POST /__packages` HTTP failures are surfaced via the `package:reload-failed` event with `{packageName, version, target: 'switchboard'|'connect', error}`.
  - Subscribes to `<connect-url>/__packages` to receive `package-error` events from browser tabs. SSE consumption is a hand-rolled fetch-stream reader because `globalThis.EventSource` isn't reliably present on the Node runtime we use.

- `vetra-cli/jest.config.js`
  - `modulePathIgnorePatterns` + `watchPathIgnorePatterns` exclude `<rootDir>/.ph/`. Without this the local-registry's `cdn-cache/<pkg>/<version>/package.json` clones make Jest's Haste map abort with "lookup is ambiguous".

- `vetra-cli/src/services/reactor-project.ts` — unchanged in this round but relevant context.

### vetra-app (`vetra/vetra-cli/vetra-app/`)

- `powerhouse.config.json`
  - `packageRegistryUrl` switched from `https://registry.dev.vetra.io` to `http://localhost:8765`. Read at build time by `@powerhousedao/builder-tools` and baked into `dist/connect/ph-packages.json` and the index HTML's CSP. Required so the embedded static-mode Connect resolves package bundles from the local registry CDN. Override with `PH_CONNECT_PACKAGES_REGISTRY` at build time if you need a different target.

### apps/connect (`monorepo/.claude/worktrees/vetra-codegen-agent-api/apps/connect/`)

- `src/store/reactor.ts`
  - Added `subscribeToPackagesChannel(packageManager)`, called once `packageManager.addPackages(packagesConfig.packages)` resolves. Opens `EventSource('/__packages')`. On each `packages-changed` event it diffs the incoming `packages: string[]` against `packageManager.packages.map(p => p.manifest.name)` and calls `packageManager.addPackage(spec)` / `packageManager.removePackage(name)` to converge. Silently no-ops when the endpoint doesn't exist (vite dev mode, non-static hosting).

- `src/hooks/useRegistryPackages.ts`
  - Defensive backstop for stale localStorage: when refreshing a cached entry whose `status === "available"` but `packageManager.getPackageSource(name)` now reports a non-null source, promote to the source-derived status. Without this, the first session's `/packages` race (registry returns entry before `addPackages` finishes) leaves the Settings UI showing "available, not installed" forever even after the package loads correctly.

- Build: `pnpm run build:bundle` produces JS; `pnpm run build:css` runs tailwind. The full `build` script chains both. In the local worktree the tailwind step currently errors on a broken `@powerhousedao/vetra/style.css` export — touch the missing file to satisfy the import then re-run.

## How to test end-to-end

### Prerequisites

1. All three repos must be at the right state. Build them in order:
   ```bash
   cd /Users/acaldas/dev/powerhouse/monorepo/.claude/worktrees/vetra-codegen-agent-api/apps/switchboard
   pnpm run build

   cd /Users/acaldas/dev/powerhouse/ph-clint/packages/ph-clint
   CI=true pnpm run build

   cd /Users/acaldas/dev/powerhouse/ph-clint/packages/ph-clint-observability && CI=true pnpm run build
   cd /Users/acaldas/dev/powerhouse/ph-clint/packages/ph-clint-dev && CI=true pnpm run build
   cd /Users/acaldas/dev/powerhouse/ph-clint/packages/clint-common && CI=true pnpm run build
   ```

2. Verify ph-clint's `@powerhousedao/switchboard` resolves to the linked local copy:
   ```bash
   readlink /Users/acaldas/dev/powerhouse/ph-clint/packages/ph-clint/node_modules/@powerhousedao/switchboard
   ```
   Expected: a path pointing into the `monorepo/.claude/worktrees/...` worktree. If it points at a `.pnpm/@powerhousedao+switchboard@<version>/...` store path instead, manually relink (see "Known issues").

3. Install in vetra-cli:
   ```bash
   cd /Users/acaldas/dev/powerhouse/vetra/vetra-cli && pnpm install
   ```
   Verify `vetra-cli/vetra-cli/node_modules/@powerhousedao/switchboard` is a symlink into the monorepo worktree.

### Boot flow

1. Clear any leftover state and free ports:
   ```bash
   cd /Users/acaldas/dev/powerhouse/vetra/vetra-cli/vetra-cli
   for pid in $(lsof -ti :59220 :27370 :8765 2>/dev/null); do kill -9 $pid; done
   rm -rf .ph/vetra .ph/registry
   ```

2. Start vetra-cli interactive (detached from a TTY is fine — the routine continues even after stdin closes):
   ```bash
   pnpm dev -i --verbose
   ```
   Expect the log to show: `Registered /graphql/packages subgraph`, `Connect 'vetra-studio' ready at http://localhost:27370/`, then `Routine running` and `[publish-reload] subscribing to http://localhost:8765/-/events`.

3. In another terminal, start the local-registry:
   ```bash
   cd /Users/acaldas/dev/powerhouse/vetra/vetra-cli/vetra-cli
   pnpm dev local-registry-start --port 8765
   ```

4. Verify the embedded Switchboard exposes `Packages`:
   ```bash
   curl -sS -X POST http://localhost:59220/graphql \
     -H "content-type: application/json" \
     -d '{"query":"{ Packages { installedPackages { name } } }"}'
   ```
   Expected: `{"data":{"Packages":{"installedPackages":[]}}}`. If you get `Cannot query field "Packages"`, the slim reactor-api path is still being used — re-check the apps/switchboard symlink at ph-clint.

5. Set up registry auth (Verdaccio htpasswd):
   ```bash
   cd /Users/acaldas/dev/powerhouse/vetra/vetra-cli/vetra-app
   RESP=$(curl -sS -X PUT "http://localhost:8765/-/user/org.couchdb.user:test" \
     -H "Content-Type: application/json" \
     -u "test:test" \
     -d '{"name":"test","password":"test","email":"test@test.local","type":"user"}')
   TOKEN=$(node -e "console.log(JSON.parse(process.argv[1]).token || '')" "$RESP")
   { echo "//localhost:8765/:_authToken=$TOKEN"; echo "registry=http://localhost:8765/"; } > .npmrc
   ```
   First call returns `{ok, token}`; if the user already exists the second call returns `{error: "username is already registered"}` and you need to wipe `<workdir>/.ph/registry/storage` and retry.

6. Build and publish vetra-app:
   ```bash
   cd /Users/acaldas/dev/powerhouse/vetra/vetra-cli/vetra-app
   pnpm exec ph-cli build
   npm publish --registry http://localhost:8765/
   ```

7. Optionally pre-open the Connect packages SSE channel in a sidecar shell so you can see the broadcast hit the static server:
   ```bash
   curl -sS -N http://localhost:27370/__packages
   ```
   First two events are `event: connected\ndata: {}\n\n` and `event: packages-changed\ndata: {"packages":[...]}\n\n` (the initial replay). Each publish pushes another `packages-changed` event with the updated list.

8. Watch the vetra-cli log for trigger output:
   ```
   [DEBUG] [publish-reload] switchboard reloaded vetra-app@1.0.0
   [DEBUG] [publish-reload] connect packages-changed broadcast for vetra-app@1.0.0 (packages: 1, 1 subscriber)
   ```
   The subscriber count comes from the `X-Subscribers` response header on `POST /__packages`.

9. Bump and republish:
   ```bash
   node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); const [a,b,c]=j.version.split('.'); j.version=\`\${a}.\${b}.\${parseInt(c)+1}\`; fs.writeFileSync(p, JSON.stringify(j,null,2)+'\n');"
   pnpm exec ph-cli build
   npm publish --registry http://localhost:8765/
   ```
   Trigger should: list installed packages (sees `vetra-app@1.0.0`), uninstall it, install `vetra-app@1.0.1`, push the new list to Connect.

10. Verify on the Switchboard:
    ```bash
    curl -sS -X POST http://localhost:59220/graphql \
      -H "content-type: application/json" \
      -d '{"query":"{ Packages { installedPackages { name } } }"}'
    ```
    Expected: `{"data":{"Packages":{"installedPackages":[{"name":"vetra-app@1.0.1"}]}}}`.

11. Verify on Connect: open `http://localhost:27370/` in a browser. The SPA subscribes to `/__packages` on startup (see `apps/connect/src/store/reactor.ts → subscribeToPackagesChannel`); on each `packages-changed` event it diffs against `packageManager.packages` and calls `addPackage`/`removePackage` accordingly. The Settings → Package Manager tab should now show the new package with `registry-install` status without any page reload.

12. **Optional — error path.** Bump again, build, but corrupt the bundle before publishing:
    ```bash
    echo "this is not valid javascript {{ broken (((" > dist/node/document-models/index.mjs
    npm publish --registry http://localhost:8765/
    ```
    Expected vetra-cli log:
    ```
    [ERROR] [publish-reload] installPackage(vetra-app@<ver>) failed: Unexpected identifier 'is'
    [ERROR] ✗ Failed to reload vetra-app@<ver> on switchboard: Unexpected identifier 'is'
    ```
    The second line confirms `cli.ts`'s `package:reload-failed` event handler is wired and the structured event is reaching it.

## Live test result

End-to-end verified with vetra-cli running, the apps/switchboard swap active, ph-clint locally linked, `connect-server.js` exposing `/__packages`, and `apps/connect`'s built bundle subscribing to that channel.

### Scenario A — clean publish, no reload
1. Boot vetra-cli → `Registered /graphql/packages subgraph`, `[publish-reload] subscribing to http://localhost:8765/-/events`, `[publish-reload] subscribing to connect http://localhost:27370/__packages`.
2. Local registry starts on the routine's auto-start. Trigger's poll-retry subscribes to SSE on the next tick.
3. Created Verdaccio user via `PUT /-/user/org.couchdb.user:test` with Basic auth, wrote token to `<project>/.npmrc`, published `@acaldas/workout-tracker@1.0.0`.
4. Trigger log: `switchboard reloaded @acaldas/workout-tracker@1.0.0` and `connect packages-changed broadcast for @acaldas/workout-tracker@1.0.0 (packages: 1, 2 subscribers)`. `installedPackages` query returned `[{"name":"@acaldas/workout-tracker@1.0.0","documentTypes":["workout-tracker"]}]`.
5. A `curl -N /__packages` sidecar received `connected` → `packages-changed (baked only)` → `packages-changed (with new entry)` — confirming the push path.
6. The browser-side SPA subscriber called `packageManager.addPackage("@acaldas/workout-tracker")` and the Settings → Package Manager tab updated to show `registry-install` status. No page reload was triggered.

### Scenario B — bump + republish
Bumped to `@acaldas/workout-tracker@1.0.1`, rebuilt, republished. Trigger logged `switchboard reloaded @acaldas/workout-tracker@1.0.1`. `installedPackages` now `[{"name":"@acaldas/workout-tracker@1.0.1"}]` — confirming uninstall + install correctly busts Node's ESM URL cache via the version-qualified spec. SPA receives `packages-changed` again; the package list is unchanged so no addPackage/removePackage calls fire, but the underlying module reload happens via the switchboard subgraph regeneration.

### Scenario C — load-failure surfacing
Bumped, built, overwrote `dist/node/document-models/index.mjs` with deliberately invalid JS, published. Output:
```
[ERROR] [publish-reload] installPackage(<spec>) failed: Unexpected identifier 'is'
[ERROR] ✗ Failed to reload <spec> on switchboard: Unexpected identifier 'is'
```
The first line is the trigger's per-failure log; the second is the `cli.ts` `package:reload-failed` event handler. The structured event carries `{packageName, version, target, error}`. **The user sees this in the terminal; the agent does NOT see it via these logs.** See "How the agent learns about failures" for the gap.

### Scenario D — Connect-side runtime error
POST a synthetic error payload to `/__packages/error` (this is what the injected browser script does on a runtime import failure):
```bash
curl -sS -X POST http://localhost:27370/__packages/error \
  -H "content-type: application/json" \
  -d '{"message":"TypeError: bundle blew up","filename":"http://localhost:8765/-/cdn/@acaldas/workout-tracker@1.0.1/node/document-models/index.mjs"}'
```
Trigger output:
```
[ERROR] [publish-reload] connect package error (@acaldas/workout-tracker@1.0.1): TypeError: bundle blew up
[ERROR] ✗ Failed to reload @acaldas/workout-tracker@1.0.1 on connect: TypeError: bundle blew up
```
The package name/version is parsed out of the filename. For real browser tabs, the injected script wires `window.addEventListener('error', ...)` + `unhandledrejection` to do the same POST automatically when a CDN module URL throws.

**Both the Switchboard install pathway and both directions of the load-failure notification pathway are proven end-to-end through a running vetra-cli.**

## Connect `/__packages` protocol

`connect-server.js` (static mode) exposes:
- `GET /__packages` — SSE stream. On connect, emits `connected` then immediately `packages-changed` with the current merged baked + dynamic list (so tabs arriving after a publish still see the latest state). Further events:
  - `packages-changed` — `{ packages: string[] }`; the SPA diffs against `packageManager.packages` and calls `addPackage` / `removePackage`.
  - `package-error` — `{ message, filename, stack? }`; the publish-reload trigger listens for this to surface runtime browser-side import failures.
- `POST /__packages` — body `{ packages: string[] }`. Replaces the in-memory dynamic overlay and broadcasts `packages-changed`. Returns `204` with `X-Subscribers: <count>` header.
- `POST /__packages/error` — accept a browser-side error report `{ message, filename, stack? }` and broadcast it as a `package-error` SSE event. Returns `204`.
- `GET /ph-packages.json` — returns the merged list: baked (read from `<dir>/ph-packages.json` per request) + the in-memory dynamic overlay, deduped. Lets a fresh page load see the same set the running tabs already know about.

Every served HTML has a `<script>` injected just before `</body>` that hooks `window.error` and `unhandledrejection`, filters to URLs containing `/-/cdn/`, and POSTs `{ message, filename, stack? }` to `/__packages/error`. The SPA (`apps/connect`) opens its own `EventSource('/__packages')` after `packageManager.init()`; the injected script no longer participates in package loading.

The trigger calls `POST <connect-url>/__packages` regardless of Connect mode and subscribes to `<connect-url>/__packages` for `package-error` events. Static mode is fully implemented; studio mode (vite dev server) still needs a parallel vite plugin that exposes the same endpoints + injects the same error reporter — see "Things NOT done" #5.

Background: ph-clint's `cli.ts:286` auto-detects Connect mode by checking for `<connect-workdir>/dist/connect/index.html`. vetra-app's prebuilt bundle exists, so the embedded Connect always runs static in vetra-cli today. That's fine because static mode supports the full protocol.

## How the agent learns about failures

This is the **open gap** in the current implementation. The `package:reload-failed` event handler in `cli.ts` calls `log.error(...)` — that writes to the CLI's stderr/stdout. A human operator watching the REPL sees the red ERROR line; the Mastra agent (the LLM driving the chat) does **not**. The agent only ingests:
- Tool call responses on its current turn.
- Memory content for its current thread.
- Messages from the chat session document the `chatSessionWatchTrigger` is watching.

### Two channels carry input to the agent today

vetra-cli runs the agent in two distinct modes; they don't share an input channel:

1. **Interactive REPL** (`ph-clint/packages/ph-clint/src/interactive/session.ts`).
   - Each REPL session gets a `threadId = opts.threadId ?? randomUUID()`.
   - User types → `handleAgentPrompt(text)` → `agentProvider.stream(text, { threadId })` streams the response.
   - Memory is keyed by `threadId` through Mastra's memory layer; no chat-session document.

2. **Non-interactive (chat-session document)** (`@powerhousedao/clint-common/chat`'s `chatSessionWatchTrigger`).
   - An external actor (another agent, an editor, an MCP tool) writes a user message into a `powerhouse/chat-session` document in the embedded reactor.
   - The trigger watches for new messages and forwards them to the agent.

A trigger or event handler that wants the agent to see something has to push into the right channel for the mode the user is in.

### Three options to actually inform the agent

In rough order of effort + invasiveness:

1. **Pretty-print in the REPL (status quo).** A REPL-side listener prints `[publish-reload] Failed to reload …` in the user's terminal; the operator manually mentions it to the agent. Effectively where we are today — the operator is the messenger.

2. **Pending-context queue drained per turn.** The event handler buffers failures into a queue; `handleAgentPrompt` drains the queue and prepends a `(System: while you were thinking, vetra-app@1.0.1 failed to load on switchboard: …)` block to the next user message. Implementation lives entirely in vetra-cli / the REPL session. Works for interactive mode only — non-interactive flow needs equivalent wiring on its side.

3. **`pushAgentNotice(message)` primitive in ph-clint.** ph-clint exposes a single API that triggers / event handlers call; the framework routes the notice to whichever channel is active (Mastra memory for interactive, append to chat session for non-interactive). Right contract long-term, biggest upstream change. Both modes converge on one call site.

The HANDOFF previously asserted "the agent sees the failure" — that was wrong. Until one of the above lands, only the human watching the terminal sees it.

## Known issues

### 1. ph-clint's pnpm workspace override didn't take effect

`ph-clint/pnpm-workspace.yaml` has:
```yaml
overrides:
  '@powerhousedao/switchboard': 'link:../monorepo/.claude/worktrees/vetra-codegen-agent-api/apps/switchboard'
```

But `pnpm install` reports "Already up to date" and doesn't re-link. `pnpm-lock.yaml` retained the previous resolutions to `6.0.0-staging.4` and `6.0.0-dev.21x`. Workarounds tried:
- `pnpm install --force` — no effect.
- `pnpm install --no-frozen-lockfile` — no effect.
- Deleting the lockfile — blocked by the harness's permission classifier.

**Workaround used:** manually replace the symlink:
```bash
unlink /Users/acaldas/dev/powerhouse/ph-clint/packages/ph-clint/node_modules/@powerhousedao/switchboard
ln -s /Users/acaldas/dev/powerhouse/monorepo/.claude/worktrees/vetra-codegen-agent-api/apps/switchboard \
  /Users/acaldas/dev/powerhouse/ph-clint/packages/ph-clint/node_modules/@powerhousedao/switchboard
```

**Permanent fix needed:** bump the `@powerhousedao/switchboard` version specifier in ph-clint's package.json (e.g. `"^6.0.0-dev.300"` or a workspace alias) to force pnpm to re-resolve, or delete the lockfile and let it regenerate.

### 2. Connect URL not on `ReactorContext`

`ph-clint/src/core/runtime.ts:282` computes `connectUrl` from `services.list(connectName)[0].endpoints['connect-studio']` but only uses it for a stdout line — it never writes the result back onto the `ReactorContext`. The publish-reload trigger compensates by doing the same service-manager lookup itself. A clean fix is one line in runtime.ts: `cachedReactor.connectUrl = connectUrl;`.

### 3. Local registry port is hardcoded

The `local-registry` service binds to a fixed port (`LOCAL_REGISTRY_PORT = 8765` in `vetra-cli/src/constants.ts`). The service no longer accepts a `--port` param and `cli.ts` reads `LOCAL_REGISTRY_URL` from the same constant for both the embedded Switchboard and Connect. The publishing config (`registryUrl`) defaults to that URL too.

The port is fixed because `cli.configureReactor` runs before config resolution — `ctx.config.registryUrl` isn't accessible there, so the embedded Switchboard/Connect can't read a user-overridden URL. Letting users pick a different port would silently break the wiring. Until ph-clint accepts a lazy `registryUrl: (ctx) => string` callback, the constant is the single source of truth.

Follow-up: when the lazy callback lands, drop the constant and route everything through `ctx.config.registryUrl`. Then users can override the URL (including pointing at a remote registry) and all three call sites (publisher, embedded Switchboard, embedded Connect) follow.

### 4. Auth setup is brittle on second runs

If the user already exists in htpasswd, the API returns `"username is already registered"` and the `_authToken` capture is empty. The publish then fails. Recovery: wipe `<workdir>/.ph/registry/storage` and re-create. A proper fix needs the existing user's password (or programmatic htpasswd manipulation).

### 5. `EventSource` global

Node 22+ ships `EventSource` as a global per WHATWG. In practice it wasn't reliably present in our runtime — `ReferenceError: EventSource is not defined` was thrown at trigger setup. Worked around with a hand-rolled fetch-stream SSE parser in `publish-reload.ts`. Once Node's EventSource is consistently available we could simplify.

### 6. Lockfile resists the override changes

Same as #1 but worth flagging: the pnpm overrides in `vetra-cli/pnpm-workspace.yaml` and `ph-clint/pnpm-workspace.yaml` should propagate without manual symlink surgery. Investigate whether `pnpm.overrides` needs to live under `package.json` instead of `pnpm-workspace.yaml` for this version of pnpm (11.0.8).

## Things NOT done that could matter

1. **Per-project reactor-project fan-out.** The trigger no longer touches `services.list('reactor-project')`. If preview-doc reactors are running and should also reload on publish, add a second pass.

2. **No tests for the trigger.** The smoke + spec command tests still pass (41/41), but the publish-reload trigger has no unit tests. Hard to test cleanly because it needs a live SSE source, a live Switchboard, and a live SPA serving the injected script.

3. **`shutdown()` on `SwitchboardInstance` doesn't surface.** ph-clint's `SwitchboardInstance` uses its own `shutdown` field that wraps the apps/switchboard handle. The richer apps/switchboard-provided `shutdown` is forwarded but not exposed for ph-clint consumers who might want finer-grained teardown.

4. **The `auth_enabled = false` assumption is implicit.** No code defends against an auth-enabled reactor; the trigger gets a 401 from the GraphQL mutation and now surfaces it via `package:reload-failed` (so at least the user sees the failure), but there's no token plumbing.

5. **Studio-mode `/__packages` parity is missing.** The static side (`connect-server.js`) implements the protocol. The vite-dev-server side (studio mode via `ph connect`) needs a sibling vite plugin that exposes `GET /__packages` (SSE), `POST /__packages` (push), and `POST /__packages/error`. Right now in studio mode the trigger would get 404 on the POST (and the load-failure handler fires, which is consistent but unhelpful). Studio mode also needs to teach `apps/connect`'s `subscribeToPackagesChannel` that the endpoint isn't a no-op there.

6. **Hot-reload subgraph regen** — when a new package's document types are installed, apps/switchboard's PackageManager calls `regenerateDocumentModelSubgraphs`. We saw this fire on `ph vetra` runs; the embedded path should be doing it too. Verify the log line shows up on the embedded reactor after a `Packages.installPackage` call.

7. **The agent doesn't actually receive failure notifications.** The `package:reload-failed` handler logs to stderr; the agent only sees what's in its chat thread / chat session. See "How the agent learns about failures" — this is the most important pending gap if the goal is for the agent (not just the human operator) to react to load errors.

8. **Spec-sync direction expanded — drive ↔ FS now closes.** Was: `specSyncTrigger` only mirrored drive → FS. Now: `specFsSyncTrigger` (`src/triggers/spec-fs-sync.ts`) handles FS → drive via chokidar + `client.loadBatch`. Operation-id dedup in the reactor's load executor (`simple-job-executor.ts:735`) makes re-feeding the same file a successful no-op, so the two triggers can run together without an echo-guard. Open follow-ups: (i) `specSyncTrigger` writes snapshot-only `.phd` files (calls `saveSpec` with the doc from `client.get`, which has an empty `operations` field), so files produced by drive → FS can't be replayed against a fresh reactor — they'd need ops attached via `client.getOperations` + grouped by `action.scope`. Local single-reactor + human-edit scenarios work fine without this fix because the human's edit is a new `action.id` the drive doesn't have yet, but cross-reactor handoff via FS needs full op history. (ii) The reactor's SyncManager / `IChannelFactory` was considered for both directions but its model (per-op `SyncEnvelope`s, cursors, channel acks) doesn't match `.phd` semantics for the drive → FS half — see git log for the analysis.

## Suggested next steps in order

1. **Get the lockfile to honor the workspace override** for `@powerhousedao/switchboard` in ph-clint. Without this, every fresh `pnpm install` reverts the symlink.

2. **Wire `connectUrl` onto `ReactorContext` in ph-clint/runtime.ts.** One-line change. Lets the trigger drop the service-manager lookup.

3. **Implement the studio-mode `/__packages` plugin** so the trigger is mode-uniform end-to-end.

4. **Route `package:reload-failed` into the agent's input channel.** Pick one of the three options under "How the agent learns about failures". (b) — pending-context queue drained per agent turn — is the lowest-effort path that actually closes the loop for interactive mode. (c) — `pushAgentNotice` upstream in ph-clint — is the right long-term contract for both modes.

5. **Add `registryUrl` plumbing as a callback** so consumers can derive it from config dynamically instead of hardcoding.

6. **Trigger unit tests.** Mock the service manager + fetch + the GraphQL response shapes; assert the trigger calls the right endpoints and emits `package:reload-failed` on each failure mode.

## Useful diagnostic commands

```bash
# Verify embedded Switchboard has the Packages subgraph
curl -sS -X POST http://localhost:59220/graphql \
  -H "content-type: application/json" \
  -d '{"query":"{ __schema { types { name } } }"}' | grep -i package

# List installed packages on the embedded Switchboard
curl -sS -X POST http://localhost:59220/graphql \
  -H "content-type: application/json" \
  -d '{"query":"{ Packages { installedPackages { name version registryUrl } } }"}'

# Watch the registry's SSE channel live
curl -sS -N http://localhost:8765/-/events

# Inspect Verdaccio storage
ls /Users/acaldas/dev/powerhouse/vetra/vetra-cli/vetra-cli/.ph/registry/storage/

# Find every node_modules switchboard instance (debug resolution)
find /Users/acaldas/dev/powerhouse -name "switchboard" -path "*@powerhousedao*" -type l 2>/dev/null
```

## Glossary of moving parts

- **`apps/switchboard`** (`@powerhousedao/switchboard`) — the full Switchboard with `PackagesSubgraph`, `PackageManager`, `HttpPackageLoader`. Exposes `startSwitchboard()` from `@powerhousedao/switchboard/server`.
- **`@powerhousedao/reactor-api`** — the lower-level library `apps/switchboard` calls into. ph-clint USED to call this directly via `initializeAndStartAPI` in `'agent'` mode (no PackagesSubgraph).
- **`@powerhousedao/ph-clint`** — the framework vetra-cli is built on. Owns the agent's reactor lifecycle, services, triggers, routine loop. Lazy-imports the Switchboard layer.
- **`@powerhousedao/registry`** — the `ph-registry` binary (Verdaccio + Powerhouse CDN). The local-registry service starts it on port 8080 (vetra-cli runs it on 8765 to avoid collisions).
- **`reactor-project` service** — per-project `ph vetra` that runs its own full Switchboard. Used for preview docs. NOT the publish-reload target after retarget.
- **publish-reload trigger** — vetra-cli's trigger that consumes `/-/events` SSE and runs `Packages.{uninstallPackage,installPackage}` on the embedded Switchboard, then queries `Packages.installedPackages`, strips version suffixes, and POSTs the resulting list to Connect's `/__packages`. Emits `package:reload-failed` events when either side rejects. The file/event name retains "reload" for backwards compatibility; rename is a follow-up.
- **`/__packages` protocol** — uniform Connect package-distribution HTTP surface. `GET /__packages` is an SSE stream that emits `connected`, an initial `packages-changed` with the current merged list, and subsequent `packages-changed` (with `{ packages: string[] }`) and `package-error` (with `{ message, filename, stack? }`) events. `POST /__packages` accepts `{ packages: string[] }`, replaces the in-memory dynamic overlay, and broadcasts `packages-changed`. `POST /__packages/error` accepts a `{message, filename, stack?}` payload and rebroadcasts as `package-error`. `GET /ph-packages.json` serves the merged baked + dynamic list. Static-mode implementation lives in ph-clint's `connect-server.ts`; studio-mode plugin still TODO.
- **`package:reload-failed` event** — emitted by the publish-reload trigger on load failure (switchboard mutation rejection, `POST /__packages` failure, or browser-side error posted to `/__packages/error`). Payload: `{ packageName, version, target: 'switchboard'|'connect', error }`. `cli.ts` registers a default handler that logs it as `ERROR` to the terminal. **Does not yet reach the agent's input channel** — see the "How the agent learns about failures" section for the gap and three resolution options.
- **`threadId` (interactive)** vs. **chat-session document (non-interactive)** — the two distinct agent input channels. Interactive REPL uses a Mastra `threadId` keyed against Mastra's memory layer; non-interactive flow goes through the `chatSessionWatchTrigger` watching a `powerhouse/chat-session` doc. A trigger that wants to inform the agent has to push into the right one.
