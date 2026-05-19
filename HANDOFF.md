# Handoff: publish→reload pipeline across vetra-cli, ph-clint, and apps/switchboard

This document captures the state of the work to make `agent publishes a Reactor package → local registry → embedded Switchboard + Connect dynamically reload` actually work end-to-end. Read it cover-to-cover before touching the code — there are non-obvious pnpm + Node ESM resolution traps.

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

1. **Embedded reactor stays as source of truth.** `cli.configureReactor` in `vetra-cli/src/cli.ts` continues to build the reactor via `buildDefaultReactor`. The agent's drive (chat sessions, agent state) keeps its in-process `IReactorClient` access.

2. **Embedded Switchboard uses `apps/switchboard`, not `reactor-api.initializeAndStartAPI`.** The slim `reactor-api` agent-mode API does NOT register `PackagesSubgraph`; only `apps/switchboard` does. Without the subgraph, the publish-reload trigger can't call `Packages.installPackage` / `uninstallPackage`. The swap is enabled by adding `reactor?: ReactorClientModule` to switchboard's `StartServerOptions` so it accepts a pre-built reactor instead of always building its own.

3. **Connect speaks a uniform `/__reload` HTTP protocol regardless of mode.** Static mode (`connect-server.js`) exposes `GET /__reload` (SSE) + `POST /__reload` (broadcast) and injects a tiny `<script>` into every served HTML that runs `location.reload()` on each SSE event. Studio mode (vite dev) should expose the same endpoints via a vite plugin — still TODO. Either way the caller does a single `POST <connect-url>/__reload`; no mode-awareness in the trigger.

4. **Connect forwards `PH_CONNECT_PACKAGES_REGISTRY` to its vite config** so the browser resolves Powerhouse package bundles from the local registry CDN.

5. **publish-reload trigger targets the embedded reactor only.** Per-project `reactor-project` instances are NOT in the fan-out — that's a deliberate scope choice for the current iteration. The trigger uses `ctx.reactor().switchboardUrl` for the switchboard mutations and `services.list()` scanning for `endpoints['connect-studio']` for the Connect URL (because ph-clint doesn't populate `ReactorContext.connectUrl` — flagged as Known Issue #2).

6. **No-auth GraphQL works in dev.** With `auth_enabled` undefined (the default) the `isAdmin` gate collapses to `() => true` (see `reactor-api/src/graphql/graphql-manager.ts:486`). The publish-reload trigger relies on this — there's no token plumbing.

7. **Load failures are surfaced via `package:reload-failed` events.** When `installPackage` returns a GraphQL error or `POST /__reload` fails, the trigger emits a structured event (`{packageName, version, target, error}`) on the event bus. `cli.ts` registers a handler that logs it as a visible `ERROR` line. The agent and the user both see the failure.

## Repositories touched

- **`/Users/acaldas/dev/powerhouse/vetra/vetra-cli/`** — the CLI itself (this repo).
- **`/Users/acaldas/dev/powerhouse/ph-clint/`** — ph-clint framework.
- **`/Users/acaldas/dev/powerhouse/monorepo/.claude/worktrees/vetra-codegen-agent-api/`** — Powerhouse monorepo worktree (apps/switchboard lives here).

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
  - `GET /__reload` (SSE) + `POST /__reload` (broadcast) endpoints.
  - Injects a small `<script>` into every served HTML that opens an `EventSource('/__reload')` and runs `location.reload()` on each `reload` event. This is the static-mode side of the uniform Connect reload protocol.

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
  - `cli.configureReactor`'s `switchboard:` carries `registryUrl: 'http://localhost:8765'`.
  - `cli.configureReactor`'s `connect:` carries `registryUrl: 'http://localhost:8765'`.
  - Hardcoded — `ctx.config.registryUrl` isn't accessible at `configureReactor` call time.
  - `events:` registers a `'package:reload-failed'` handler that logs the structured failure as a visible `ERROR` line.

- `vetra-cli/src/triggers/publish-reload.ts`
  - Targets the embedded reactor: `(await ctx.reactor())?.switchboardUrl` for switchboard, `services.list().find(s => s.endpoints?.['connect-studio'])` for Connect.
  - Switchboard mutations: list installed packages, uninstall every entry matching `<name>` or `<name>@*`, install version-qualified `<name>@<version>`. Version suffix bust Node's ESM URL cache on reinstall.
  - Connect reload: single `POST <connect-url>/__reload`. No transport detection — both static and studio modes will expose the same endpoint.
  - Captures load errors: `installPackage` GraphQL errors (200 OK with `data.errors[]`) and `POST /__reload` HTTP failures are surfaced via the `package:reload-failed` event with `{packageName, version, target: 'switchboard'|'connect', error}`.
  - SSE consumption is a hand-rolled fetch-stream reader because `globalThis.EventSource` isn't reliably present on the Node runtime we use.

- `vetra-cli/jest.config.js`
  - `modulePathIgnorePatterns` + `watchPathIgnorePatterns` exclude `<rootDir>/.ph/`. Without this the local-registry's `cdn-cache/<pkg>/<version>/package.json` clones make Jest's Haste map abort with "lookup is ambiguous".

- `vetra-cli/src/services/local-registry.ts` — defines the `local-registry` service that spawns `ph-registry` on port 8080 (default) with storage at `<workdir>/.ph/registry/{storage,cdn-cache}/`.

- `vetra-cli/src/services/reactor-project.ts` — unchanged in this round but relevant context.

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

7. Optionally pre-open the Connect reload SSE channel in a sidecar shell so you can see the broadcast hit the static server:
   ```bash
   curl -sS -N http://localhost:27370/__reload
   ```
   First line is `event: connected\ndata: {}\n\n`; each reload broadcast adds `event: reload\ndata: {}\n\n`.

8. Watch the vetra-cli log for trigger output:
   ```
   [DEBUG] [publish-reload] switchboard reloaded vetra-app@1.0.0
   [DEBUG] [publish-reload] connect reload broadcast for vetra-app@1.0.0 (1 client)
   ```
   The client-count comes from the `X-Reload-Clients` response header on `POST /__reload`.

9. Bump and republish to test the reload:
   ```bash
   node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); const [a,b,c]=j.version.split('.'); j.version=\`\${a}.\${b}.\${parseInt(c)+1}\`; fs.writeFileSync(p, JSON.stringify(j,null,2)+'\n');"
   pnpm exec ph-cli build
   npm publish --registry http://localhost:8765/
   ```
   Trigger should: list installed packages (sees `vetra-app@1.0.0`), uninstall it, install `vetra-app@1.0.1`, broadcast reload to Connect.

10. Verify on the Switchboard:
    ```bash
    curl -sS -X POST http://localhost:59220/graphql \
      -H "content-type: application/json" \
      -d '{"query":"{ Packages { installedPackages { name } } }"}'
    ```
    Expected: `{"data":{"Packages":{"installedPackages":[{"name":"vetra-app@1.0.1"}]}}}`.

11. Verify on Connect: open `http://localhost:27370/` in a browser. View the page source and confirm the injected `<script>` near `</body>` opens `EventSource('/__reload')`. Republish; the page should refresh automatically.

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

Three end-to-end scenarios verified with vetra-cli running interactive, the apps/switchboard swap active, ph-clint locally linked, and `connect-server.js` exposing `/__reload`:

### Scenario A — clean publish round-trip
1. Boot vetra-cli → `Registered /graphql/packages subgraph` (apps/switchboard swap active), `[publish-reload] subscribing to http://localhost:8765/-/events`.
2. `pnpm dev local-registry-start --port 8765` started the registry; trigger's poll-retry subscribed to SSE on the next tick.
3. Created Verdaccio user via `PUT /-/user/org.couchdb.user:test` with Basic auth, wrote token to `vetra-app/.npmrc`, published `vetra-app@1.0.0`.
4. Trigger log: `[publish-reload] switchboard reloaded vetra-app@1.0.0` and `connect reload broadcast for vetra-app@1.0.0 (1 client)` (a `curl -N /__reload` subscriber was open). `installedPackages` query returned `[{"name":"vetra-app@1.0.0","documentTypes":[]}]`.
5. The simulated browser SSE subscriber received `event: reload\ndata: {}` — confirming the broadcast path.

### Scenario B — bump + republish
6. Bumped to `vetra-app@1.0.1`, rebuilt, republished. Trigger logged `switchboard reloaded vetra-app@1.0.1`. `installedPackages` now `[{"name":"vetra-app@1.0.1"}]` — confirming uninstall + install correctly busts Node's ESM URL cache via the version-qualified spec.

### Scenario C — load-failure surfacing
7. Bumped to `vetra-app@1.0.3`, built, overwrote `dist/node/document-models/index.mjs` with deliberately invalid JS, published. Output:
   ```
   [ERROR] [publish-reload] installPackage(vetra-app@1.0.3) failed: Unexpected identifier 'is'
   [ERROR] ✗ Failed to reload vetra-app@1.0.3 on switchboard: Unexpected identifier 'is'
   ```
   The first line is the trigger's per-failure log; the second is the `cli.ts` `package:reload-failed` event handler. The structured event carries `{packageName, version, target, error}` — the agent and user both see why the package didn't land.

**Both the Switchboard reload pathway and the load-failure notification pathway are proven end-to-end through a running vetra-cli.**

## Connect reload protocol

`connect-server.js` (static mode) exposes:
- `GET /__reload` — SSE stream. Browser tabs subscribe; receive `event: reload\ndata: {}` on broadcast.
- `POST /__reload` — broadcast. Returns `204 No Content` with `X-Reload-Clients: <count>` header.

Every served HTML has a `<script>` injected just before `</body>` that opens an `EventSource('/__reload')` and calls `location.reload()` on each `reload` event.

The trigger calls `POST <connect-url>/__reload` regardless of mode. Static mode is fully implemented; studio mode (vite dev server) still needs a parallel vite plugin that exposes the same endpoints + injects the same script — see "Things NOT done" #5.

Background: ph-clint's `cli.ts:286` auto-detects Connect mode by checking for `<connect-workdir>/dist/connect/index.html`. vetra-app's prebuilt bundle exists, so the embedded Connect always runs static in vetra-cli today. That's fine because static mode now supports `/__reload`.

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

### 3. Registry URL is hardcoded in cli.ts

```ts
switchboard: { enabled: true, registryUrl: 'http://localhost:8765' },
connect:    { enabled: true, registryUrl: 'http://localhost:8765' },
```

`ctx.config.registryUrl` isn't accessible at `cli.configureReactor` time (the call happens before config resolution). Options:
- ph-clint accepts `registryUrl: string | ((ctx) => string)` and resolves lazily.
- Read from `process.env.VETRA_REGISTRY_URL` at module load.
- Leave hardcoded since the local-registry default is fixed.

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

5. **Studio-mode `/__reload` parity is missing.** The static side (`connect-server.js`) implements the protocol. The vite-dev-server side (studio mode via `ph connect`) needs a sibling vite plugin that exposes the same `GET /__reload` SSE + `POST /__reload` broadcast and injects the same `<script>` into the index transform. Right now in studio mode the trigger would get 404 on the POST (and the load-failure handler fires, which is consistent but unhelpful).

6. **Connect-side load failures aren't surfaced.** If switchboard's `installPackage` succeeds but the package crashes at runtime inside the browser (Connect dynamic-imports it), Connect knows but the server doesn't. To surface this we'd need a feedback channel — e.g. extend the injected script to POST `/__reload/error` with `window.addEventListener('error', …)` filtered to the package's module URL. Then the trigger emits another `package:reload-failed` event with `target: 'connect'`. The structured event payload already supports this case; the wiring is missing.

7. **Hot-reload subgraph regen** — when a new package's document types are installed, apps/switchboard's PackageManager calls `regenerateDocumentModelSubgraphs`. We saw this fire on `ph vetra` runs; the embedded path should be doing it too. Verify the log line shows up on the embedded reactor after a `Packages.installPackage` call.

## Suggested next steps in order

1. **Get the lockfile to honor the workspace override** for `@powerhousedao/switchboard` in ph-clint. Without this, every fresh `pnpm install` reverts the symlink.

2. **Wire `connectUrl` onto `ReactorContext` in ph-clint/runtime.ts.** One-line change. Lets the trigger drop the service-manager lookup.

3. **Implement the studio-mode `/__reload` plugin** so the trigger is mode-uniform end-to-end.

4. **Add Connect-side error feedback** so runtime browser-side import failures surface alongside Switchboard ones.

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
- **publish-reload trigger** — vetra-cli's trigger that consumes `/-/events` SSE and runs `Packages.{uninstallPackage,installPackage}` on the embedded Switchboard + `POST /__reload` on Connect. Emits `package:reload-failed` events when either side rejects.
- **`/__reload` protocol** — uniform Connect reload HTTP surface. `GET` is the SSE stream a browser tab subscribes to; `POST` broadcasts. Static-mode implementation lives in ph-clint's `connect-server.ts`; studio-mode plugin still TODO.
- **`package:reload-failed` event** — emitted by the publish-reload trigger on load failure. Payload: `{ packageName, version, target: 'switchboard'|'connect', error }`. `cli.ts` registers a default handler that logs it as `ERROR`.
