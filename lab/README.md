# vetra e2e lab

A local, Docker-based reproduction of the `registry.dev.vetra.io` stack and the
publish → build → run pipeline. It validates framework/CLI edits and the
packaging/resolution path without touching prod, public npm, or git: everything
publishes to a disposable local origin.

The CI job `.github/workflows/e2e-prodclose.yml` runs the prod-close flow on
every PR via the single entrypoint `lab/ci/run-prodclose-e2e.sh` — the same
script you run locally.

## Layout

- `ci/run-prodclose-e2e.sh` — the one entrypoint (CI and local). Brings the
  stack up, publishes, builds the image, runs it, asserts the studio contract,
  tears down.
- `prod/` — the dual-uplink registry stack (local origin +
  real npmjs) and the prod-close publish/build/run scripts.
- `base-image/` — the self-contained `clint-runtime` base image
  (`FROM node:24-bookworm-slim`, no ph-clint source). The entrypoint builds it
  locally when absent.
- `run-local-e2e.sh` — option 1: run vetra from source against the lab
  registry (no publish, no image build). Requires a local ph-clint link.

## Run prod-close e2e locally

From the repo root, with docker running:

```sh
./lab/ci/run-prodclose-e2e.sh
```

That reproduces CI exactly. It:

1. `pnpm install`s the workspace if needed (the build step needs it).
2. Renders the lab config with deterministic publish→build cache knobs
   (`UPLINK_MAXAGE=0s META_TTL=5m PROP_DELAY=0s`).
3. Builds the `clint-runtime` base image from `base-image/` if absent.
4. Brings up the `prod` compose stack.
5. Runs `publish-local-and-build.sh` with `SKIP_PH_CLINT=1` — publishes
   vetra + vetra-app to the local origin against the **released**
   (catalog-pinned) ph-clint resolved from public npm, then builds the
   clint-agent image the prod way (hoisted `pnpm add -g`).
6. Runs `run-prodclose.sh` to start the image with the studio ports published.
7. Asserts the studio contract (what the prod-built image must serve):
   - `/` reachable (200 or 302)
   - `/_proxy/routes` contains the `service:vetra-studio` route
   - `/assets/` → 200
   - `/d/<driveId>/` → 200

   The full root-redirect contract (`/` → 302 `/d/<id>`, plus
   `studio-redirect` + `studio-announce` proxy routes) depends on the
   studio-redirect trigger, which is not on `main` yet. Set
   `ASSERT_ROOT_REDIRECT=1` to enable those checks once that trigger lands.
8. Tears the stack + studio container down (on success or failure).

Knobs (env): `BASE_IMAGE`, `BUILD_BASE_IMAGE` (default 1), `IMAGE_TAG`,
`VETRA_VERSION` (default a per-run `-e2e.<ts>` suffix), `KEEP_UP` (set 1 to
leave the stack + studio up for inspection).

## The base image

The clint-agent image builds `FROM` a `clint-runtime` base. In prod that base is
the published `cr.vetra.io/.../clint-runtime:dev` (private registry, needs auth).
The base is self-contained — `FROM node:24-bookworm-slim` plus pnpm, git, and the
runtime entrypoints; it carries **no** ph-clint code (the agent package is
installed at image-build time). So CI builds it locally from the vendored
`base-image/` (Dockerfile + `entrypoint.sh` + `run.sh`, copied verbatim from
`ph-clint/docker/clint-runtime`) in ~10s and skips the private registry
entirely. To use a prebuilt/pulled base instead, set `BUILD_BASE_IMAGE=0` and
`BASE_IMAGE=<ref>`.

Keep `base-image/` in sync with `ph-clint/docker/clint-runtime` if the runtime
base changes; otherwise the lab base drifts from prod.

---

## Option 1 — source run (local ph-clint)

Run vetra from source with local ph-clint linked, against the lab registry —
no publish, no image build. Validates framework/CLI edits without cutting a
`dev.N`.

1. Link local ph-clint. In `pnpm-workspace.yaml` under `overrides`:
   `'@powerhousedao/ph-clint': 'link:<path>/ph-clint/packages/ph-clint'`
   (add a line per linked package, e.g. `-observability`, `-dev`).
   Rebuild ph-clint dist (`pnpm --filter @powerhousedao/ph-clint build`) — the
   source run loads `dist`, not `src`.
2. Install through the lab registry:
   `pnpm install --registry http://localhost:5100`.
3. Bring up the lab:
   `cd lab/prod && UPLINK_MAXAGE=10s META_TTL=5s PROP_DELAY=0s ./render.sh && docker compose up -d`.
4. Free the fixed ports 8090/27370/59220 — stop any prior `vetra-studio`
   container. vetra derives switchboard/connect ports from the CLI name, so a
   collision is fatal with no fallback.
5. Run from source: `lab/run-local-e2e.sh`. A placeholder Anthropic key boots
   studio; only chat needs a real key. Wait for
   `Vetra Studio: http://localhost:8090/d/<driveId>`.

Validate against the proxy port:

```sh
curl -sI http://localhost:8090/                       # 302 -> /d/<driveId>
curl -s  http://localhost:8090/_proxy/routes           # studio-redirect + studio-announce
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8090/assets/   # 200
```

Undo: remove the `link:` override line(s), then `pnpm install` against the
normal registry — deps resolve from the catalog pin again.

## Option 2 — prod-close: publish local + build the image the real way

This is what `lab/ci/run-prodclose-e2e.sh` automates. You can also drive the
underlying scripts directly. It exercises the packaging/resolution path option 1
skips: `catalog:` → concrete inlining, `workspace:*` rewrite, and the hoisted
global install. Use it for prod-close confidence and to catch
publish/resolution bugs (catalog inlining a wrong range, a dep that only fails
under `pnpm add -g`, a tarball-URL or cache-staleness issue).

Prereqs:
- Base image present (`docker images`) or `BUILD_BASE_IMAGE=1` (default in the
  entrypoint).
- Stack up with cache knobs tuned for deterministic publish→build:
  `cd lab/prod && UPLINK_MAXAGE=0s META_TTL=5m PROP_DELAY=0s ./render.sh && docker compose up -d`.

Driver (manual, against released ph-clint — the CI path):

```sh
cd lab/prod
SKIP_PH_CLINT=1 VETRA_VERSION=0.0.1-e2e.1 BASE_IMAGE=clint-runtime:labvcli \
  ./publish-local-and-build.sh
./run-prodclose.sh vetra:local-prodclose
```

To also publish a **local** ph-clint (dev workflow, needs a ph-clint checkout),
drop `SKIP_PH_CLINT=1` and set `PH_CLINT_ROOT`, `PH_CLINT_VERSION`, and
`EDGE_LOCAL_PH_CLINT=1` (routes the four ph-clint packages from the local
origin via the edge, since the default edge proxies `@powerhousedao/*` from
npmjs which has no local `dev.N`).

A full run is ~2 min with warm lab registry caches; the dominant cost is the
image-layer export of the baked pnpm store.

### What `publish-local-and-build.sh` does

Params: `PH_CLINT_VERSION`, `VETRA_VERSION`, `IMAGE_TAG`, `BASE_IMAGE`,
`NGINX_REGISTRY`, `SKIP_PH_CLINT`. `VETRA_ROOT` defaults to the repo root
(three levels up from the lab dir); `PH_CLINT_ROOT` is only used when
`SKIP_PH_CLINT != 1`.

1. (Skipped under `SKIP_PH_CLINT=1`) Bumps the four ph-clint packages
   (`@powerhousedao/ph-clint`, `-observability`, `-dev`, `clint-common`) to
   `PH_CLINT_VERSION`, rebuilds dist, `pnpm pack` + publishes each to the local
   origin (`:5101`).
2. (Skipped under `SKIP_PH_CLINT=1`) Bumps vetra's catalog pins for those
   packages to the same version.
3. Bumps vetra + vetra-app to `VETRA_VERSION`, rebuilds their dist
   (`pnpm build`), `pnpm pack` (inlines catalog → concrete, `workspace:*` →
   `VETRA_VERSION`) + publishes both.
4. Waits for the build registry (nginx `:5100`) to actually serve every
   published version (purging both `%2f`/`%2F` cache keys, then requiring two
   consecutive confirming reads of the **abbreviated** packument
   `Accept: application/vnd.npm.install-v1+json` that pnpm fetches) before
   building — so the build never races the cache layers.
5. `DOCKER_BUILDKIT=1 docker build --network host` of vetra's own
   `Dockerfile` (the shipped production image: hoisted `pnpm add -g` plus the
   `vetra-run.sh` entrypoint with the codegen NODE_PATH fix and the `ph init`
   template prewarm) with `CLINT_VERSION=<ver>`,
   `CLINT_REGISTRY=PH_REGISTRY=http://localhost:5100`, `BASE_IMAGE`, and
   `PH_VERSION` left empty (read from the installed vetra, as in prod). So
   the image definition itself is exercised, not just package resolution.

Isolation: every manifest the script edits (`pnpm-workspace.yaml`, the two
`package.json`, and — only when publishing local ph-clint — the four ph-clint
`package.json`) is snapshotted up front and restored on exit, so a run leaves
the checkout's manifests byte-identical. `dist/` is rebuilt in place (a build
artifact). A `kill -9` skips the restore trap — re-run or `git checkout` the
manifests if a run is hard-killed.

### Cache determinism

Three layers cache the packument: nginx (`META_TTL`), the edge `upstream`
uplink (`UPLINK_MAXAGE`), and the npm-cdn lag mock (`PROP_DELAY`). Publish→build
races all three. The render knobs (`UPLINK_MAXAGE=0s` so the edge always
revalidates the local origin, `META_TTL=5m` so a gate-confirmed nginx entry
survives until the build reads it, `PROP_DELAY=0s`) plus the wait-gate make it
deterministic. verdaccio sends `Vary: Accept-Encoding`; `nginx.template.conf`
sets `proxy_ignore_headers Vary` so one URI maps to one cache entry.

### Tarball URLs

verdaccio bakes `dist.tarball` from the inbound `Host` header. nginx forwards
`Host: $http_host` (host:port preserved), so with the build on `--network host`
+ `CLINT_REGISTRY=http://localhost:5100` the URLs come back
`http://localhost:5100/...` — reachable. `$host` drops the port, giving an
unreachable `http://localhost/...`. `--network host` is mandatory (the default
builder can't join the compose network). If a build hits the registry with a
different Host (e.g. `host.docker.internal`), the edge `edge-storage` volume is
poisoned with unreachable tarball URLs served to every later build — reset with
`docker compose down -v && ./render.sh && docker compose up -d`.

Do **not** add a BuildKit cache mount for the pnpm store: the hoisted
`pnpm add -g` hardlinks the global `node_modules` from the store, and a
cache-mount store leaves the runtime image with dangling hardlinks
(`Cannot find module` at start). Keep the store in the image layer, as prod's
Kaniko build does.

### Studio port collision

`run-prodclose.sh` stops any prior `vetra-studio`/`vetra-studio-prodclose`
first (fixed ports 8090/27370/59220, no fallback).
