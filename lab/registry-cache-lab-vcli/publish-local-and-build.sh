#!/usr/bin/env bash
# Option 2 (prod-close): publish LOCAL ph-clint + vetra-cli to the lab origin at
# fresh versions, then build vetra-cli's own production Dockerfile the prod way
# (hoisted `pnpm add -g` against the lab registry). Exercises real
# packaging/resolution (catalog inlining, caret/exact pinning, hoisted global
# install) AND the shipped image definition (entrypoint shim, template prewarm)
# that the source-link path (option 1) skips.
#
# Flow:
#   1. bump the 4 ph-clint packages vetra-cli depends on to PH_CLINT_VERSION,
#      rebuild dist, pnpm-pack + publish each to the lab origin.
#   2. bump vetra-cli's catalog pin for those packages to PH_CLINT_VERSION.
#   3. bump vetra-cli + vetra-app to VETRA_VERSION, pnpm-pack + publish.
#   4. DOCKER_BUILDKIT=1 docker build vetra-cli's own production Dockerfile from
#      the lab nginx (its entrypoint shim + `ph init` template prewarm).
#
# Isolation: the manifests this script mutates (vetra-cli pnpm-workspace.yaml +
# the two package.json, the four ph-clint package.json) are snapshotted up front
# and restored on exit (trap), so a run — pass or fail — leaves both checkouts'
# manifests pristine. `pnpm pack` reads the catalog from pnpm-workspace.yaml and
# inlines it (and workspace:* -> concrete) at pack time, so no lockfile refresh
# or install is needed; the dev lockfile is never touched.
#
# Tarball URLs: the build resolves the locally-published tarballs by their
# dist.tarball, which verdaccio rewrites from the inbound Host header. nginx
# forwards $http_host (host:port preserved); with the build on --network host
# and CLINT_REGISTRY=http://localhost:5100 the tarballs come back as
# http://localhost:5100/... — reachable. (Using $host dropped the port, giving
# an unreachable http://localhost/...; see nginx.template.conf.)
#
# Speed: the warm lab registry caches (edge + nginx volumes persist the
# npmjs-uplinked closure across runs) keep repeat builds fast. The pnpm store
# deliberately lives in the image layer, not a BuildKit cache mount — the
# hoisted `pnpm add -g` hardlinks node_modules from the store, and a
# cache-mount store would leave the runtime image with dangling hardlinks.
#
# The edge must serve the ph-clint packages from the local origin (the default
# -vcli edge proxies @powerhousedao/* from npmjs, which has no dev.N). Run
# ./use-local-ph-clint-edge.sh first (or set EDGE_LOCAL_PH_CLINT=1 here to apply
# + restart the edge automatically).
#
# Parameters (env):
#   PH_CLINT_VERSION   default 0.1.0-dev.84   version to publish ph-clint at
#   VETRA_VERSION      default <pkg+1 dev>    version to publish vetra-cli/app at
#   IMAGE_TAG          default vetra-cli:local-prodclose
#   BASE_IMAGE         default clint-runtime:labvcli
#   NGINX_REGISTRY     default http://localhost:5100  (build-time, --network host)
#   ORIGIN             default http://localhost:5101/  (publish target)
#   EDGE_LOCAL_PH_CLINT  set to 1 to auto-apply the edge override + restart
#   SKIP_PH_CLINT      set to 1 to skip step 1 (ph-clint already published)
set -euo pipefail
cd "$(dirname "$0")"
LAB_DIR="$(pwd)"

# VETRA_ROOT is the repo root (the workspace holding vetra-cli/ + vetra-app/ +
# pnpm-workspace.yaml). The lab lives at <repo>/lab/registry-cache-lab-vcli, so
# default it to three levels up from this script — resolves from a fresh
# checkout (CI) and a local dev clone alike. PH_CLINT_ROOT is only used when
# SKIP_PH_CLINT != 1 (CI uses SKIP_PH_CLINT=1 against the catalog-pinned release).
VETRA_ROOT="${VETRA_ROOT:-$(cd "${LAB_DIR}/../.." && pwd)}"
PH_CLINT_ROOT="${PH_CLINT_ROOT:-/Users/acaldas/dev/powerhouse/ph-clint}"
PH_CLINT_VERSION="${PH_CLINT_VERSION:-0.1.0-dev.84}"
IMAGE_TAG="${IMAGE_TAG:-vetra-cli:local-prodclose}"
BASE_IMAGE="${BASE_IMAGE:-clint-runtime:labvcli}"
# Build runs with --network host so the build container reaches the lab nginx at
# localhost:5100 and the dist.tarball URLs (http://localhost:5100/...) resolve.
NGINX_REGISTRY="${NGINX_REGISTRY:-http://localhost:5100}"
ORIGIN="${ORIGIN:-http://localhost:5101/}"
TOKEN_FILE="${TOKEN_FILE:-/tmp/labvcli_up_token}"
OUT="${OUT:-/tmp/labvcli_tarballs}"
TAG="${TAG:-dev}"

# vetra-cli's 4 ph-clint deps (catalog-pinned), in dependency order so each
# pnpm pack inlines an already-bumped workspace:* sibling. The published name is
# always @powerhousedao/<dir> — derived inline so this runs under bash 3.2
# (macOS system bash, no associative arrays).
PH_CLINT_PKGS=(ph-clint clint-common ph-clint-observability ph-clint-dev)
pkg_name() { echo "@powerhousedao/$1"; }

mkdir -p "${OUT}"

# --- manifest isolation: snapshot + restore-on-exit --------------------------
# Every file this script edits is backed up before any mutation and restored on
# exit, so a run leaves the vetra-cli and ph-clint checkouts' manifests pristine.
SNAP_DIR="$(mktemp -d /tmp/labvcli_snap.XXXXXX)"
MANIFESTS=(
  "${VETRA_ROOT}/pnpm-workspace.yaml"
  "${VETRA_ROOT}/vetra-cli/package.json"
  "${VETRA_ROOT}/vetra-app/package.json"
)
# ph-clint manifests are only mutated (and must only exist) when we publish a
# local ph-clint. CI runs SKIP_PH_CLINT=1 with no ph-clint checkout, so leave
# them out of the snapshot set in that case.
if [ "${SKIP_PH_CLINT:-0}" != "1" ]; then
  for key in "${PH_CLINT_PKGS[@]}"; do
    MANIFESTS+=("${PH_CLINT_ROOT}/packages/${key}/package.json")
  done
fi
for i in "${!MANIFESTS[@]}"; do
  cp "${MANIFESTS[$i]}" "${SNAP_DIR}/m${i}"
done
restore_manifests() {
  for i in "${!MANIFESTS[@]}"; do
    cp "${SNAP_DIR}/m${i}" "${MANIFESTS[$i]}"
  done
  rm -rf "${SNAP_DIR}"
  echo "==> restored manifests (vetra-cli + ph-clint left pristine)"
}
trap restore_manifests EXIT

auth() {
  # --user re-auths an already-registered labvcli user (first run registers it).
  curl -s -X PUT "${ORIGIN}-/user/org.couchdb.user:labvcli" \
    -H 'Content-Type: application/json' \
    -d '{"name":"labvcli","password":"labpass123"}' --user 'labvcli:labpass123' \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])' > "${TOKEN_FILE}"
  cat > "${OUT}/.npmrc" <<EOF
registry=${ORIGIN}
//${ORIGIN#http://}:_authToken=$(cat "${TOKEN_FILE}")
EOF
}

# Poll the build registry (nginx) until it serves <version> for <pkg>, purging
# both cache-key encodings each miss. Publish -> immediate build hits the cache
# staleness window the stack models; this gate makes the build deterministic
# instead of racing the TTLs. Bounded so a genuinely-missing version still fails.
wait_for_version() {
  local pkg="$1" ver="$2" reg="${NGINX_REGISTRY}"
  local enc_pkg="${pkg//\//%2f}"
  # Purge once (both cache-key encodings) so the stale entry is evicted, then
  # poll PLAIN reads. A plain GET re-fetches on miss and serves the cached entry
  # on hit; requiring the version on two consecutive plain reads proves the
  # stored entry — not a stale-while-revalidate serve — carries it, so the build
  # (a later plain read within META_TTL) sees the same. Bypassing on every
  # iteration instead would keep triggering background refreshes and race them.
  for enc in "${enc_pkg}" "${enc_pkg/\%2f/%2F}"; do
    curl -s -o /dev/null -H 'X-Purge-Token: lab-purge-token' "${reg}/${enc}" || true
  done
  # Request the abbreviated packument pnpm fetches (Accept install-v1). nginx
  # keys the cache by URI only (Accept-blind), and verdaccio serves a different
  # body per Accept, so the gate must validate the exact representation pnpm
  # will read or it can pass on the full packument while pnpm gets a stale
  # abbreviated one.
  local acc='application/vnd.npm.install-v1+json'
  local ok=0
  for _ in $(seq 1 40); do
    if curl -s -H "Accept: ${acc}" "${reg}/${enc_pkg}" \
        | python3 -c "import sys,json;sys.exit(0 if '${ver}' in json.load(sys.stdin).get('versions',{}) else 1)" 2>/dev/null; then
      ok=$((ok+1))
      [ "${ok}" -ge 2 ] && { echo "    ${reg} serves ${pkg}@${ver}"; return 0; }
    else
      ok=0
    fi
    sleep 1
  done
  echo "!! ${reg} never served ${pkg}@${ver} (cache stuck or publish failed)" >&2
  return 1
}

if [ "${EDGE_LOCAL_PH_CLINT:-0}" = "1" ]; then
  echo "==> applying local ph-clint edge override + restarting edge"
  ./use-local-ph-clint-edge.sh
fi

auth

# --- step 0: rebuild vetra dist from src -------------------------------------
# pnpm pack ships the on-disk dist as-is, so a moved src/ (e.g. the
# studio-redirect trigger) only reaches the image if dist is fresh. Build
# BEFORE bumping the catalog: `pnpm build` re-resolves against the catalog, and
# a catalog already pointing at the lab-only PH_CLINT_VERSION would fail to
# resolve from npmjs. Built against the dev tree's existing install (tsc + asset
# copy), so the lockfile/manifests stay untouched.
echo "==> building vetra-cli + vetra-app dist"
( cd "${VETRA_ROOT}/vetra-app" && pnpm build )
# pnpm build (ph-cli build) emits dist/{browser,node,types} but NOT the Connect
# SPA bundle the embedded connect-server serves. That is a separate command, and
# a fresh checkout has no pre-built dist/connect. Build it via the package's
# build:connect script (the single source of truth for the invocation — it
# carries --dynamic-base so the bundle stays subpath-mountable) so the published
# tarball carries it; the __ph_drive_url__ placeholder is stamped at runtime by
# the connect-drive-url lifecycle hook. See ARCHITECTURE.md "Build-output split".
( cd "${VETRA_ROOT}/vetra-app" && pnpm run build:connect )
# Guard: the bundle must carry the runtime-base placeholder. Without it the
# artifact ships a concrete root base and 404s under any subpath mount — a
# drift class the root-mount validation in run-prodclose.sh can't see.
grep -q '/__PH_DYNAMIC_BASE__/' "${VETRA_ROOT}/vetra-app/dist/connect/index.html" || {
  echo "!! dist/connect/index.html lacks the /__PH_DYNAMIC_BASE__/ placeholder — Connect was built without --dynamic-base" >&2
  exit 1
}
( cd "${VETRA_ROOT}/vetra-cli" && pnpm build )

# --- step 1: publish local ph-clint at PH_CLINT_VERSION -----------------------
if [ "${SKIP_PH_CLINT:-0}" != "1" ]; then
  echo "==> bumping ph-clint packages to ${PH_CLINT_VERSION}"
  for key in "${PH_CLINT_PKGS[@]}"; do
    node -e "const f='${PH_CLINT_ROOT}/packages/${key}/package.json';const fs=require('fs');const p=require(f);p.version='${PH_CLINT_VERSION}';fs.writeFileSync(f, JSON.stringify(p,null,2)+'\n');"
  done

  echo "==> rebuilding ph-clint dist (tsc)"
  ( cd "${PH_CLINT_ROOT}" && pnpm --filter '@powerhousedao/ph-clint' --filter '@powerhousedao/clint-common' \
      --filter '@powerhousedao/ph-clint-observability' --filter '@powerhousedao/ph-clint-dev' build )

  echo "==> packing + publishing ph-clint packages to ${ORIGIN}"
  for key in "${PH_CLINT_PKGS[@]}"; do
    name="$(pkg_name "${key}")"
    # pnpm pack rewrites workspace:* siblings to PH_CLINT_VERSION.
    ( cd "${PH_CLINT_ROOT}/packages/${key}" && pnpm pack --pack-destination "${OUT}" )
    # pnpm names scoped tarballs "<scope>-<name>-<ver>.tgz" (e.g.
    # powerhousedao-ph-clint-0.1.0-dev.84.tgz).
    tgz="$(ls -t "${OUT}/$(echo "${name#@}" | tr '/' '-')-${PH_CLINT_VERSION}".tgz | head -1)"
    npm publish "${tgz}" --userconfig "${OUT}/.npmrc" --registry "${ORIGIN}" --tag "${TAG}"
    echo "    published ${name}@${PH_CLINT_VERSION}"
  done

  # nginx may hold stale npmjs-uplinked metadata for @powerhousedao/ph-clint
  # (the most-cached package) from before the edge override. Purge both cache-key
  # encodings so the build resolves the freshly-published dev version.
  for key in "${PH_CLINT_PKGS[@]}"; do
    enc_pkg="$(pkg_name "${key}" | sed 's#/#%2f#')"
    for enc in "${enc_pkg}" "${enc_pkg/\%2f/%2F}"; do
      curl -s -o /dev/null -H 'X-Purge-Token: lab-purge-token' "http://localhost:5100/${enc}" || true
    done
  done
fi

# --- step 2: bump vetra-cli catalog pin --------------------------------------
# Only when a local ph-clint was published. With SKIP_PH_CLINT=1 the catalog
# already pins the released ph-clint versions, which is exactly what CI tests
# vetra-cli against — leave them untouched.
if [ "${SKIP_PH_CLINT:-0}" != "1" ]; then
  echo "==> bumping vetra-cli catalog pins to ${PH_CLINT_VERSION}"
  WS="${VETRA_ROOT}/pnpm-workspace.yaml"
  # Anchor on the catalog pin lines (leading two spaces + quote) so a commented
  # option-1 link: override on the same key is left alone.
  PHV="${PH_CLINT_VERSION}" perl -pi -e \
    "s{^(  '\@powerhousedao/(?:ph-clint|ph-clint-observability|ph-clint-dev|clint-common)':\s*')[^']*(')}{\$1\$ENV{PHV}\$2}" \
    "${WS}"
  grep -E "'\@powerhousedao/(ph-clint|clint-common)" "${WS}" | grep "${PH_CLINT_VERSION}" || true
fi

# --- step 3: publish vetra-cli + vetra-app -----------------------------------
if [ -z "${VETRA_VERSION:-}" ]; then
  cur="$(node -p "require('${VETRA_ROOT}/vetra-cli/package.json').version")"
  # bump the dev.N suffix
  base="${cur%.*}"; n="${cur##*.}"; VETRA_VERSION="${base}.$((n+1))"
fi
echo "==> bumping vetra-cli + vetra-app to ${VETRA_VERSION}"
for pkg in vetra-cli vetra-app; do
  f="${VETRA_ROOT}/${pkg}/package.json"
  node -e "const fs=require('fs');const p=require('${f}');p.version='${VETRA_VERSION}';fs.writeFileSync('${f}', JSON.stringify(p,null,2)+'\n');"
done

echo "==> packing + publishing vetra-cli + vetra-app to ${ORIGIN}"
# pnpm pack inlines catalog: -> concrete and workspace:* -> ${VETRA_VERSION}
# straight from pnpm-workspace.yaml; no install/lockfile step needed.
( cd "${VETRA_ROOT}/vetra-app" && pnpm pack --pack-destination "${OUT}" )
( cd "${VETRA_ROOT}/vetra-cli" && pnpm pack --pack-destination "${OUT}" )
for pkg in vetra-app vetra-cli; do
  npm publish "${OUT}/${pkg}-${VETRA_VERSION}.tgz" \
    --userconfig "${OUT}/.npmrc" --registry "${ORIGIN}" --tag "${TAG}"
done
echo "    published vetra-cli@${VETRA_VERSION} + vetra-app@${VETRA_VERSION}"

# Gate the build on the registry actually serving the freshly-published
# versions (vetra-cli depends on vetra-app@${VETRA_VERSION}, so both must be
# visible or `pnpm add -g` hits NO_MATCHING_VERSION mid-resolve). Also wait on
# the ph-clint packages, which route from the local origin.
echo "==> waiting for ${NGINX_REGISTRY} to serve the published versions"
wait_for_version vetra-app "${VETRA_VERSION}"
wait_for_version vetra-cli "${VETRA_VERSION}"
if [ "${SKIP_PH_CLINT:-0}" != "1" ]; then
  for key in "${PH_CLINT_PKGS[@]}"; do
    wait_for_version "$(pkg_name "${key}")" "${PH_CLINT_VERSION}"
  done
fi

# --- step 4: build vetra-cli's own production image --------------------------
echo "==> building vetra-cli image ${IMAGE_TAG} from ${NGINX_REGISTRY}"
# Build vetra-cli/Dockerfile (the shipped production image: hoisted `pnpm add
# -g` + the vetra-run.sh entrypoint with the codegen NODE_PATH fix + the
# `ph init` template prewarm), so the image definition itself is exercised,
# not just package resolution.
# CLINT_REGISTRY (vetra-cli) and PH_REGISTRY (ph-cmd + codegen prewarm) both
# point at the lab nginx; PH_VERSION is left empty so the build reads
# DEFAULT_PH_VERSION from the installed vetra-cli, matching prod.
# Context is LAB_DIR (small); the Dockerfile COPYs nothing from it.
DOCKER_BUILDKIT=1 docker build --network host -t "${IMAGE_TAG}" \
  -f "${VETRA_ROOT}/vetra-cli/Dockerfile" \
  --build-arg BASE_IMAGE="${BASE_IMAGE}" \
  --build-arg CLINT_VERSION="${VETRA_VERSION}" \
  --build-arg CLINT_REGISTRY="${NGINX_REGISTRY}" \
  --build-arg PH_REGISTRY="${NGINX_REGISTRY}" \
  "${LAB_DIR}"

echo
echo "DONE. image=${IMAGE_TAG} vetra=${VETRA_VERSION} ph-clint=${PH_CLINT_VERSION}"
echo "Run + validate with: ./run-prodclose.sh ${IMAGE_TAG}"
