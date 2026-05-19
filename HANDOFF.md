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

2. **Embedded Switchboard now uses `apps/switchboard`, not `reactor-api.initializeAndStartAPI`.** The slim `reactor-api` agent-mode API does NOT register `PackagesSubgraph`; only `apps/switchboard` does. Without the subgraph, the publish-reload trigger can't call `Packages.installPackage` / `uninstallPackage`. Swap is implemented by adding `reactor?: ReactorClientModule` to switchboard's `StartServerOptions` so it can accept a pre-built reactor instead of always building its own.

3. **Connect runs in studio mode** (`ph connect` → vite dev server). We forward `PH_CONNECT_PACKAGES_REGISTRY` to it so its vite config resolves Powerhouse packages from the local registry CDN.

4. **publish-reload trigger targets the embedded reactor only** (after retarget). Per-project `reactor-project` instances are NOT included in the fan-out yet — they'd be a follow-up if you want runtime reloading of preview-doc reactors too. The trigger uses `ctx.reactor().switchboardUrl` for the switchboard, and `services.list()` looking for `endpoints['connect-studio']` for Connect (because ph-clint doesn't populate `ReactorContext.connectUrl`).

5. **No-auth GraphQL works in dev.** With `auth_enabled` undefined (the default) the `isAdmin` gate collapses to `() => true` (see `reactor-api/src/graphql/graphql-manager.ts:486`). The publish-reload trigger relies on this — there's no token plumbing.

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
  - Add `@powerhousedao/switchboard: "^6.0.0-dev.253"` to `peerDependencies` and `peerDependenciesMeta` (optional).

- `src/integrations/powerhouse/types.ts`
  - Add `registryUrl?: string` to `SwitchboardConfig` (forwarded to apps/switchboard).
  - Add `registryUrl?: string` to `ConnectConfig` (forwarded to `ph connect` as `PH_CONNECT_PACKAGES_REGISTRY`).

- `src/integrations/powerhouse/switchboard.ts`
  - Header comment rewritten — no historical narration.
  - `StartSwitchboardOptions` gains `registryUrl?: string`.
  - `SwitchboardApi` type renamed to `SwitchboardHandle` and reduced to `{ shutdown: () => Promise<void> }`.
  - `buildSwitchboardInstance` takes the handle and forwards `shutdown` directly.
  - `startSwitchboard` now lazy-imports `@powerhousedao/switchboard/server` (not `@powerhousedao/reactor-api`) and calls `startSwitchboardImpl({ reactor, port, dbPath, mcp:true, packages:[], registryUrl, strictPort:true })`.

- `src/integrations/powerhouse/connect.ts`
  - `env()` forwards `connectConfig.registryUrl` as `PH_CONNECT_PACKAGES_REGISTRY` when set.

- `src/core/runtime.ts`
  - Passes `registryUrl: reactorConfig.switchboard.registryUrl` to `startSwitchboard()`.

- `pnpm-workspace.yaml`
  - Added top-level `overrides:` block with `@powerhousedao/switchboard: link:../monorepo/.claude/worktrees/vetra-codegen-agent-api/apps/switchboard`. **NOTE: this override is NOT actually being honored by pnpm in this repo right now.** See "Known issues" below.

- Build with `CI=true pnpm run build` from inside `packages/ph-clint/`. Plain `tsc`.

### vetra-cli (`vetra/vetra-cli/`)

- `pnpm-workspace.yaml`
  - Added overrides linking `@powerhousedao/switchboard`, `@powerhousedao/ph-clint`, `@powerhousedao/ph-clint-dev`, `@powerhousedao/ph-clint-observability`, `@powerhousedao/clint-common` to local checkouts.

- `vetra-cli/package.json`
  - Added `@powerhousedao/switchboard: 6.0.0-dev.253` as a direct dependency so pnpm pulls the linked package.

- `vetra-cli/src/cli.ts`
  - `cli.configureReactor`'s `switchboard:` now carries `registryUrl: 'http://localhost:8765'`.
  - `cli.configureReactor`'s `connect:` now carries `registryUrl: 'http://localhost:8765'`.
  - Hardcoded for now — `ctx.config.registryUrl` isn't accessible at `configureReactor` call time.

- `vetra-cli/src/triggers/publish-reload.ts`
  - Doc header rewritten to describe targeting the embedded reactor (no more reactor-project fan-out).
  - `poll()` resolves switchboard URL from `(await ctx.reactor())?.switchboardUrl` and Connect URL from `services.list().find(s => s.endpoints?.['connect-studio'])`.
  - Switchboard mutations: list installed packages, uninstall every entry matching `<name>` or `<name>@*`, install version-qualified `<name>@<version>`. Version suffix is essential to bust Node's ESM URL cache on reinstall.
  - Connect reload: open `ws://<connectUrl>` with subprotocol `vite-hmr`, send `{"type":"full-reload"}`.
  - SSE consumption is a hand-rolled fetch-stream reader because `globalThis.EventSource` isn't reliably present on the Node runtime we use.

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

7. Watch the vetra-cli log for trigger output:
   ```
   [DEBUG] [publish-reload] switchboard reloaded vetra-app@1.0.0
   [DEBUG] [publish-reload] connect full-reload sent for vetra-app@1.0.0
   ```

8. Bump and republish to test the reload:
   ```bash
   node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); const [a,b,c]=j.version.split('.'); j.version=\`\${a}.\${b}.\${parseInt(c)+1}\`; fs.writeFileSync(p, JSON.stringify(j,null,2)+'\n');"
   pnpm exec ph-cli build
   npm publish --registry http://localhost:8765/
   ```
   Trigger should: list installed packages (sees `vetra-app@1.0.0`), uninstall it, install `vetra-app@1.0.1`, send full-reload to Connect.

9. Verify on the Switchboard:
   ```bash
   curl -sS -X POST http://localhost:59220/graphql \
     -H "content-type: application/json" \
     -d '{"query":"{ Packages { installedPackages { name } } }"}'
   ```
   Expected: `{"data":{"Packages":{"installedPackages":[{"name":"vetra-app@1.0.1"}]}}}`.

10. Verify on Connect: open `http://localhost:27370/` in a browser — it should refresh automatically when you republish.

## Live test result

Performed end-to-end with vetra-cli running interactive, the new trigger, the apps/switchboard swap, and ph-clint's local link in place:

1. Boot vetra-cli → log emits `Registered /graphql/packages subgraph` (proves the apps/switchboard swap is active) and `[publish-reload] subscribing to http://localhost:8765/-/events`.
2. Started `local-registry` via `pnpm dev local-registry-start --port 8765`. The trigger's `setup()` retries on poll and successfully subscribed once the registry was up.
3. Created Verdaccio user via `PUT /-/user/org.couchdb.user:test` with Basic auth, wrote the returned JWT into `vetra-app/.npmrc`, published `vetra-app@1.0.0`.
4. Trigger log: `[publish-reload] switchboard reloaded vetra-app@1.0.0`. Switchboard `installedPackages` query confirmed: `[{"name":"vetra-app@1.0.0","documentTypes":[]}]`.
5. Bumped to `vetra-app@1.0.1`, rebuilt, republished. Trigger log: `[publish-reload] switchboard reloaded vetra-app@1.0.1`. Switchboard now reports only `[{"name":"vetra-app@1.0.1"}]` — uninstall + install pathway works correctly.

**The Switchboard side of publish→reload is proven end-to-end against the running embedded reactor.**

Connect side warned `[publish-reload] connect full-reload failed (ws://localhost:27370/): ws error` — see "Connect static-mode trap" below. Not a trigger bug; the vite-hmr WS protocol only applies in studio mode.

## Connect static-mode trap

ph-clint's `cli.ts:286` auto-detects Connect mode: if `<connect-workdir>/dist/connect/index.html` exists, it sets `assetsDir` automatically, which switches Connect to static-server mode (`connect-server.js --dir ...`, no vite). vetra-app's prebuilt `dist/connect/` exists (from `ph-cli build`), so the embedded Connect always runs static.

In static mode the vite-hmr full-reload doesn't apply — there's no WebSocket server. The trigger logs a `ws error` and moves on. Three ways forward:

1. **Force studio mode** by removing/renaming `vetra-app/dist/connect/` before booting vetra-cli, OR by adding an explicit ph-clint flag like `connect.studio: true` to opt out of the auto-detection.
2. **Wire `RegistryClient.onPublish` in `apps/connect`** (the real fix) so the SPA listens to the registry's SSE stream itself. Out of vetra-cli scope but the right long-term answer.
3. **Accept the warning** — in production deployments Connect is always static; reload happens through different paths (manual refresh, dynamic-import cache invalidation).

For dev iteration today, option 1 is the easiest unblocker.

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

2. **No tests for the trigger.** The smoke + spec command tests still pass (41/41), but the publish-reload trigger has no unit tests. Hard to test cleanly because it needs a live SSE source, a live Switchboard, and a live vite WS server.

3. **No commit yet** of any of the changes in this branch. The apps/switchboard, ph-clint, and vetra-cli changes are all in the working tree. Three separate commits in three separate repos.

4. **`shutdown()` on `SwitchboardInstance` doesn't surface.** ph-clint's `SwitchboardInstance` still uses its own `shutdown` field that wraps the handle. The apps/switchboard-provided `shutdown` is forwarded but not exposed for ph-clint consumers who might want richer teardown.

5. **The `auth_enabled = false` assumption is implicit.** No code defends against an auth-enabled reactor; the trigger silently fails with 401 from the mutation. Worth a clearer log line.

6. **Hot reload assumption.** When running the embedded reactor, repeated reinstall+publish should refresh subgraphs. We saw the subgraph regen log line on apps/switchboard's standalone run; verify it still fires on the embedded path.

## Suggested next steps in order

1. **Get the lockfile to honor the workspace override** for `@powerhousedao/switchboard` in ph-clint. Without this, every fresh `pnpm install` reverts the symlink.

2. **Wire `connectUrl` onto `ReactorContext` in ph-clint/runtime.ts.** One-line change. Lets the trigger drop the service-manager lookup.

3. **End-to-end smoke test from scratch.** Follow the "How to test" section above on a clean repo state. Document any divergence from the expected log lines.

4. **Commit the changes**, three commits across three repos. Reference each other by SHA.

5. **Add `registryUrl` plumbing as a callback** so consumers can derive it from config dynamically.

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
- **publish-reload trigger** — vetra-cli's trigger that consumes `/-/events` SSE and fires mutations on the embedded Switchboard + vite-hmr full-reload on Connect.
