# Vetra registry/agent lab — usage guide

A local, Docker-based reproduction of the `registry.dev.vetra.io` stack and the
publish → build → deploy pipeline. Used to reproduce and fix the cache/version
issues (publish pre-flight false-negative, build-side `NO_MATCHING_VERSION`,
the reactor-attachments `ERR_PACKAGE_PATH_NOT_EXPORTED` crash) without touching
prod, npm, or git.

Nothing here is committed (`vetra/` is not a git repo). Read-only against the
real registry; never publishes to npm or pushes to git.

## The three lab variants

All live under `/Users/acaldas/dev/powerhouse/vetra/`. Each is its own
`docker compose` project (named after its dir) on its own host ports, so they
run side by side.

| Dir | Purpose | Host ports (nginx / origin / edge / npm-cdn / extra) |
|---|---|---|
| `registry-cache-lab` | Core cache-stack repro + fix tests | 4900 / 4901 / 4902 / 4904 |
| `registry-cache-lab-s3` | MinIO-backed, **2 edge replicas**, fleet-wide invalidation | 5010 / 5011 / 5012+5013 / 5014, MinIO 9100/9101 |
| `registry-cache-lab-vcli` | **Dual-uplink** (local + real npmjs), deploys a real vetra-cli | 5100 / 5101 / 5102 / 5104 |

**Topology** (all variants): `client → nginx (npm-cache-proxy copy) → edge verdaccio (uplink maxage) → npm-cdn (propagation-lag mock) → upstream verdaccio (npm origin / publish target)`. The `-vcli` edge additionally uplinks real `registry.npmjs.org` for third-party deps. See each dir's `README.md` for the measured findings.

## Prereqs

- Docker + `docker compose`.
- `gcx` (Grafana Cloud CLI) — only for checking the *real* prod builder/deploys (Loki, `namespace="clint-builds"` for builds, `namespace="warm-newt-75-…", container="clint"` for a deployed agent).
- macOS note: port `5000` is taken by ControlCenter — the `-s3` lab uses `5010+`.

## Lifecycle (any variant)

```bash
cd registry-cache-lab            # or -s3 / -vcli
./render.sh                      # render config templates from env knobs
docker compose up -d             # (-s3/vcli: add -f docker-compose.multi.yml for 2nd edge)
# register a publish token once (origin port differs per lab — see table):
curl -sX PUT localhost:4901/-/user/org.couchdb.user:lab -H 'Content-Type: application/json' \
  -d '{"name":"lab","password":"labpass123"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])' > /tmp/lab_up_token
#   (-s3 → /tmp/labs3_up_token, -vcli → /tmp/labvcli_up_token)
docker compose down -v           # teardown (removes volumes)
```

### render.sh knobs (env vars)

| Var | Default | Meaning |
|---|---|---|
| `UPLINK_MAXAGE` | `2m` | verdaccio uplink cache TTL (the dominant staleness floor) |
| `META_TTL` | `30s` | nginx metadata cache TTL |
| `PROP_DELAY` | `60s` | npm-cdn propagation-lag mock (set high to model slow npm) |
| `BACKGROUND_UPDATE` | `on` | nginx stale-while-revalidate (the 2026-06-02 `UPDATING` mechanism) |
| `PURGE_TOKEN` | `lab-purge-token` | token for the nginx bypass-refresh purge |
| `XFP` | `http` | X-Forwarded-Proto (lab is http; prod is https) |
| `NGINX_UPSTREAM` | single edge | set to list both edges for the multi-replica override |

Re-render + `docker compose restart <svc>` to apply.

## Workflows

### A. Reproduce the publish / build cache failure (`registry-cache-lab`)

```bash
./measure.sh @lab/widget 1.0.1        # publish a new version, time when each layer sees it
./build-repro.sh @lab/widget 2.0.0    # publish, then loop `pnpm add @pkg@ver` (the clint build) until it resolves
```
`build-repro.sh` reproduces the build-side `ERR_PNPM_NO_MATCHING_VERSION`. Use
prerelease versions (`0.0.1-dev.N`) to mirror prod — they auto-get `--tag dev`.
`build-repro-target.sh <pkg> <ver> <registry-url>` runs the same against a
chosen layer (e.g. `http://edge:4873` to prove bypassing nginx doesn't fix it).

### B. Test the fixes

```bash
./test-bounded-retry.sh retrytest-a 1.0.1   # Frank's bounded retry: 10×30s absorbs the window
```
Findings live in each `README.md`: total staleness ≈ `max(npm propagation, uplink maxage) + nginx TTL` (nested timers, not additive); the `%2f` vs `%2F` cache-key fragmentation; nginx `UPDATING` serving stale past TTL on upstream error.

### C. Fleet-wide cache invalidation (`registry-cache-lab-s3`)

Two edge replicas share one MinIO S3 bucket (prod-faithful). One purge refreshes
the whole fleet:
```bash
cd registry-cache-lab-s3
./invalidate.sh @lab/somepkg   # deletes the S3 metadata object + purges nginx for BOTH %2f and %2F
```
This is the only verdaccio-native invalidation lever (verdaccio has no API; `notify` fires only for local publishes, never uplinked). MinIO console: http://localhost:9101.

### D. Deploy & run a real vetra-cli + open the studio (`registry-cache-lab-vcli`)

```bash
cd registry-cache-lab-vcli
./publish-vetra.sh             # pnpm-pack + publish vetra-cli AND vetra-app to the lab origin
./deploy-vetra.sh              # run it via the clint-runtime install-at-start entrypoint
# full recipe + dual-uplink details in RUN-VETRA-LAB.md
```

### E. Build the prod-style image for an already-published version, and run the studio

Build the clint-agent image the way prod does (hoisted bake), then run with the
studio ports published to the host:
```bash
# build (BuildKit; pulls the published version from the real registry):
DOCKER_BUILDKIT=1 docker build -t vetra-cli:dev9 \
  --build-arg BASE_IMAGE=clint-runtime:labvcli \
  --build-arg CLINT_PACKAGE=vetra-cli --build-arg CLINT_VERSION=0.0.1-dev.9 \
  --build-arg CLINT_REGISTRY=https://registry.dev.vetra.io \
  /Users/acaldas/dev/powerhouse/ph-clint/docker/clint-agent

# run with studio reachable from the host + a REAL Anthropic key:
KEY='sk-ant-…'
docker run -d --name vetra-studio -p 8090:8090 -p 27370:27370 -p 59220:59220 \
  -e SERVICE_COMMAND=vetra \
  -e VETRA_ANTHROPIC_API_KEY="$KEY" -e ANTHROPIC_API_KEY="$KEY" \
  --entrypoint sh vetra-cli:dev9 -c 'export PATH=$PNPM_HOME/bin:$PATH; exec vetra'
docker logs vetra-studio 2>&1 | grep 'Vetra Studio:'   # the /d/<drive-id> URL to open
```
- **Studio** = proxy on **:8090** (`http://localhost:8090/d/<drive-id>`), **Connect** :27370, **GraphQL** :59220/graphql.
- The LLM/chat needs **`VETRA_ANTHROPIC_API_KEY`** set to a real key — a placeholder or empty value drops the agent into "demo agent" mode (it does NOT use `ANTHROPIC_API_KEY` alone).
- Set env via a real shell var (`KEY=…; -e VAR="$KEY"`), not a command-prefix (`VAR=… docker run -e OTHER="$VAR"` expands to empty).
- Stop: `docker rm -f vetra-studio`.

## Gotchas (learned the hard way)

- **`catalog:` deps publish as `^X` via ph-publish**, and a caret over a prerelease (`^6.1.0-dev.21`) admits the regressed stable `6.1.0` → runtime crash. Fixed in ph-publish `deps.ts` (catalog → exact); a literal version in package.json also bypasses it.
- **The `_cb` cache-bust in ph-publish caused publish hangs** (every read MISSes nginx → unbounded 5 MB uplink fetch, no timeout). Removed + 15–60s fetch timeout added; pre-flight should ride the cache + retry, not bust it.
- **Three cache-key encodings** for a scoped package: S3 object path (literal `/`), nginx `%2f` (clients), nginx `%2F` (verdaccio uplink) — any purge must cover all three.
- **vetra-cli's publish is NOT linked to the local ph-clint** — it uses the registry-published `ph-clint-dev` (catalog pin). Editing local ph-clint has no effect on publish unless you republish it or patch the pnpm store copy.

## Checking the real prod pipeline (not the lab)

```bash
gcx logs query '{namespace="clint-builds"} |= "vetra-cli" |= "0.0.1-dev.9"' --since 30m -o raw   # build
gcx logs query '{namespace="warm-newt-75-aa726a95", container="clint"}' --from now-1h --to now   # deployed agent
```
