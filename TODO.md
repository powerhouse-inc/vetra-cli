# TODO
- Stop `reactor-project` (and other vetra services) when the CLI/agent
  process exits. ph-clint spawns services `detached: true` by design
  (`types.ts:544-545`: "Services are spawned as detached processes that
  survive CLI exit"), so today they outlive vetra and the user must
  run `<svc>-stop` manually. Approach without patching ph-clint: capture
  `ctx.context.services` from a tiny startup trigger into a module-level
  handle, then add a lifecycle hook whose `shutdown` calls
  `manager.stop(id, instanceId)` for every running instance. Only covers
  clean exits — SIGKILL still orphans services (would need ph-clint to
  drop `detached: true` or add `PR_SET_PDEATHSIG`-equivalent).
- manage installed packages (vetra-studio-package-install)?
- Make npm login reliable. Root cause found (2026-06-03): the Verdaccio
  behind `registry.dev.vetra.io` issues 5-minute JWTs (`iat`/`exp` 300s
  apart in `~/.npmrc`), so any publish that takes longer than the token —
  e.g. waiting out the registry's stale caches — fails mid-flow with
  "Not authenticated". Fix server-side in the Verdaccio config
  (`security.api.jwt.sign.expiresIn`), same config touched by the
  stale-metadata fix below.
- Fix `registry.dev.vetra.io` stale/inconsistent metadata (lives in
  `powerhouse-k8s-hosting`, not vetra-cli). Symptom: just-published
  versions intermittently 404 on pre-flight (`ph-publish` external-dep
  checks, Kaniko `pnpm add`) — one request returns stale packument, the
  next returns fresh, for ~10 min after publish; affects both
  npm-proxied deps and packages published directly to the registry.
  Diagnosed 2026-06-03 (external probe + gcx/Loki + kube metrics):
  - Topology: nginx `npm-cache-proxy` (1 replica, `proxy_cache` with
    `proxy_cache_use_stale updating` — serves STALE while revalidating
    in background; confirmed via `x-cache-status` header and etag flip
    between consecutive responses) → `powerhouse-dev-registry`
    (Verdaccio, **10 replicas under an HPA**), single ingress IP.
  - Two cache layers stack: nginx hands out stale entries during
    revalidation, and each revalidation lands on 1 of 10 Verdaccio
    replicas with independent uplink/metadata caches, so consecutive
    requests disagree until every replica refreshes.
  Fix plan, in priority order:
  1. Make Verdaccio replica metadata consistent: shared storage backend
     or publish-time invalidation across replicas (with 10 replicas any
     per-replica cache makes reads non-deterministic).
  2. Lower `uplinks.npmjs.maxage` to ~1m (default ~10m dominates the
     delay for npm-proxied deps like `@powerhousedao/clint-common`).
  3. nginx: bypass `proxy_cache` for packument GETs (npm clients already
     etag-revalidate) or at least drop `proxy_cache_use_stale updating`.
  4. While in the config, fix the 5-min JWT TTL (see npm-login item).
  Related, already scoped in the platform report: point the image
  builder's `BUILD_REGISTRY` at the uncached cluster-internal registry
  (`infrastructure/clint-image-builder/k8s/03-deployment.yaml`).
- Generalize spec commands to work on any document model
- Surface Apollo supergraph composition errors from `spec-generate` /
  `spec-preview-show` so the agent stops declaring "Complete ✓" while the
  Connect preview iframe is blank. The error is already caught + logged
  inside reactor-api's `graphql-manager.ts` (line 441 for the supergraph,
  line 626 for per-subgraph) but not stored or queryable, and no
  Switchboard query exposes subgraph registration health.
  Upstream addition in `monorepo/packages/reactor-api/`:
  - `src/graphql/graphql-manager.ts` — add `subgraphErrors: Map<string,string>`
    and `supergraphError?: string`, populate them in the two catch blocks
    above (clear on success), expose a public `getSupergraphHealth()` that
    returns `{ healthy, error?, subgraphs: [{ name, path, healthy, error? }] }`
    using the existing `#getAllSubgraphs()` walk.
  - `src/graphql/system/subgraph.ts` — add `SupergraphHealth` /
    `SubgraphHealth` types and a `supergraphHealth: SupergraphHealth!` root
    query that delegates to `this.graphqlManager.getSupergraphHealth()`
    (the reference is already injected at `graphql-manager.ts:421`).
  vetra consumer: `spec-generate` polls `supergraphHealth` for ~3s
  post-codegen (Vite re-bundle is the async piece); `spec-preview-show`
  does a single read before returning the URL. Both filter by model
  subgraph name and throw a tool error carrying the upstream error
  string. Behind an interface (`checkSupergraphHealth(modelName)`) so the
  A2 log-tail fallback can stand in until the upstream lands. ~40 LOC in
  graphql-manager.ts, ~25 LOC in system/subgraph.ts, plus the vetra
  side.

## Spec ownership migration
Goal: vetra owns the spec-document workflow; drop `@powerhousedao/vetra/codegen` coupling.

Motivation: we needed spec lookups (`spec-get`/`spec-update`/`spec-delete`/`spec-generate`) to accept `name | slug | id`, which required `spec-create` and `spec-extract` to actually populate `header.slug` (upstream `createDocument` leaves it `""`). The slug invariant currently lives only on the vetra side of the upstream boundary, so any future caller going through `@powerhousedao/vetra/codegen` directly can still produce slug-less docs. Owning spec creation here makes the invariant universal.

- Inline a spec FS layer in vetra (`getDocument(s)WithPaths`, `saveSpec`, `deleteDocument`, `specPath`/`specDir`, registry via `listSpecDocumentTypes`/`getSpecEntry`, `createDocument`, `addActions`/`validateActions`). Keep importing reducers/factories/jsonSpecs from the public `@powerhousedao/vetra/document-models/*` exports.
- Have the new `getDocuments` return `{ doc, path }` pairs so `findByName` no longer recomputes paths via `specPath` — fixes the wrong-file delete bug surfaced when two docs share a kebab-name but live under different extensions (`.editor.phd` vs `.phdm.phd`).
- Move `extract*Documents` + `generate*FromDocument` adapters in too, so vetra's `spec-extract`/`spec-generate` no longer reach into vetra/codegen.
- Once vetra is self-sufficient, decide ph-cli's fate:
  - Option A: drop spec notion from ph-cli entirely (`--extract`/`--document` flags on `generate-*` commands go away). Direct codegen via args/JSON stays. Users use `vetra spec-extract`/`vetra spec-generate` for spec flows.
  - Option B: keep ph-cli `--document` by inlining the `.phd` loader there too — `document-model/node`'s `baseLoadFromFile` plus the 5 trivial `generate*FromDocument` wrappers. No vetra dep.
- After ph-cli is detached, remove `@powerhousedao/vetra` from ph-cli's dependencies.

### Local workarounds in place until the migration lands
- `spec-create` and `spec-extract` patch `doc.header.slug = slugify(name)` after calling upstream `createDocument`/`extract*Documents`. Upstream's factories still emit `slug: ""`, so any consumer that bypasses these two commands will keep producing slug-less docs (current `spec-list` shows `—` for legacy specs that predate the patch). Folding slug into the inlined `createDocument` will remove this patch.
- `findByName` in `vetra-cli/src/commands/spec/_helpers.ts` ships its own `iterateSpecFiles` / `getDocumentsWithPaths` pair that duplicates upstream's `getDocuments` loop just to keep the on-disk path (and to enable the filename-fast-path lookup that avoids loading every spec on every command). The walkers become the canonical `getDocuments` once we own the FS layer; delete the local pair then.

## Code-review backlog (int/* integration branches, 2026-06-10)
Nice-to-haves from the pre-PR review of `int/connect-dynamic-base` (monorepo),
`int/phc-vetra-enable` (ph-clint), `int/vc-vetra-enable` (vetra-cli). All
correctness must-fixes landed on the branches; these are deferred cleanups.

### ph-clint
- Precompute route-static values (`target`, `forwardedPrefix`) at `addRoute`
  instead of per request/upgrade; exact-route matching could be a Map lookup
  instead of two linear scans (`src/core/proxy.ts`).
- Move the `PH_PROXY_*` timeout knobs into the zod config schema in
  `src/core/cli.ts` — `envMs` silently falls back on bad values, unlike every
  other config field.
- One shared route-view serializer for `/_proxy/routes` (proxy.ts) and
  `CommandContext.routes()` (cli.ts); the two copies already render the same
  route differently.
- Unify tool-result truncation: `summarizeToolResult`
  (`integrations/mastra/logging.ts`) is a third policy beside `truncateResult`
  (`core/stream.ts`) and `sanitizeForStore` (`clint-common/chat/chat-bridge.ts`).
- Drop the unused `collectorUrl` option on `SentryInitInput`
  (`ph-clint-observability/src/sentry.ts`) — plumbed nowhere.
- Re-add an unknown-chunk-type test for `mapMastraStream` (deleted in the
  mastra-1.41 bump; the ignore branch is uncovered).
- Latent: the chat interrupt listener's module-global one-shot flag binds to
  the first `defineCli` event bus (`clint-common/chat/chat-session-watch.ts`)
  — fine with one CLI per process, stale in tests/embedded reuse.

### vetra-cli
- `vetra-app/editors/vetra-studio/ChatPane.tsx` — replace
  `indexOf('/switchboard')` with a segment-boundary match (or strip the known
  `/d/<driveId>` suffix from the drive remoteUrl).
- `src/triggers/studio-redirect.ts` — early-return when no Connect `/`
  catch-all route exists instead of falling back to the proxy's own URL as
  upstream (only reachable under `--no-studio`, but the failure mode is a
  self-proxy loop).
- `src/lifecycle/ensure-ph.ts` — reuse ph-clint's `createProcessManager` /
  `checkCommand` instead of the hand-rolled exec wrappers; revisit the
  documented stopgap of halting all boot when the install fails.
- Dedupe `tailOutput` (`src/helpers/project-checks.ts`) with the inline tail
  in `src/helpers/cli-errors.ts` (divergent limits and markers).

### monorepo
- `builder-tools/connect-utils/vite-plugins/dynamic-base.ts` — import
  `escapeRegExp` from `@powerhousedao/shared/document-drive` instead of the
  local `escapeForRegExp`.
- `apps/connect/src/connect.config.ts` — drop the dead `?? "/"` fallbacks
  (lines ~142/168); `getDeployBasePath` always returns a string.
- Latent: `WORKER_PRELUDE`'s hardcoded `assets/` strip in dynamic-base.ts —
  unreachable with the pinned build config, a trap if the options surface
  grows an `assetsDir` knob.
- Optional hardening: a build-mode `define` for `getDeployBasePath` instead of
  sniffing `globalThis.__PH_DYNAMIC_BASE__` (connect-server's token-gating
  already prevents the concrete-build misfire).

## Proxy production hardening (ph-clint)
Both live in ph-clint's embedded proxy (`packages/ph-clint/src/core/proxy.ts`). Context + analysis: `reports/ph-clint-proxy-prod/ph-clint-proxy-prod.md`. Sequenced after the four P0/P1 fixes (WS-crash guard, dual-stack agent, fail-fast timeouts, streaming gate) on the proxy PR.

- Migrate the proxy off `http-proxy` to a hand-rolled `undici` forwarder. `http-proxy@1.18.1` is effectively unmaintained (last real release 2020). undici (maintained, Node-native) gives connection pooling, correct streaming/backpressure (SSE + large bodies, removing the manual buffer/zlib rewrite), and first-class `connect` family + `connectTimeout`/`headersTimeout`/`bodyTimeout` — i.e. the dual-stack and timeout fixes become config instead of custom code, and 502-vs-504 becomes precise. Cost: hand-roll the request forwarder AND the WebSocket upgrade (undici has no WS-proxy; today `proxy.ws()` does it). Do this at the same time as the isolation move below — that's the natural moment to swap the HTTP engine.
- Isolate the proxy on its own event loop (worker_thread, or child_process for stronger isolation). The proxy currently shares the Node event loop with the agent/reactor, so a CPU-heavy turn stalls all proxied traffic (the root cause behind the "windowed" request stalls). Move the HTTP listener + forwarding into a worker; the one real coupling is the dynamic route table (service-readiness captures + runtime `addRoute`/redirects), which must be streamed to the worker over `MessagePort`/IPC. The four P0/P1 fixes (esp. timeouts) only make a busy loop fail fast; isolation makes it not stall at all.