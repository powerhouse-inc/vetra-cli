#!/usr/bin/env bash
# One entrypoint for the prod-close e2e: the same script CI runs and a developer
# runs locally with docker. Brings up the registry-cache-lab-vcli stack, publishes
# vetra-cli + vetra-app to the disposable local origin against the released
# (catalog-pinned) ph-clint, builds the clint-agent image the prod way (hoisted
# `pnpm add -g`), runs it, and asserts the studio contract. Tears the stack and
# the studio container down on exit (pass or fail).
#
# Run locally from the repo root:
#   ./lab/ci/run-prodclose-e2e.sh
#
# Requires: docker (+ compose), node, pnpm, python3, curl. No ph-clint checkout
# and no secrets — ph-clint resolves from public npm at the catalog pin.
#
# Knobs (env):
#   BASE_IMAGE          default clint-runtime:labvcli  (built here if absent)
#   BUILD_BASE_IMAGE    default 1 — build the base from lab/base-image if missing.
#                       Set 0 + BASE_IMAGE=<pulled ref> to use a prebuilt base.
#   IMAGE_TAG           default vetra-cli:prodclose-e2e
#   VETRA_VERSION       default <vetra-cli pkg version + .e2e timestamp suffix>
#   KEEP_UP             default 0 — set 1 to leave the stack + studio running.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
LAB_DIR="$(cd "${HERE}/.." && pwd)"
STACK_DIR="${LAB_DIR}/registry-cache-lab-vcli"
REPO_ROOT="$(cd "${LAB_DIR}/.." && pwd)"

BASE_IMAGE="${BASE_IMAGE:-clint-runtime:labvcli}"
BUILD_BASE_IMAGE="${BUILD_BASE_IMAGE:-1}"
IMAGE_TAG="${IMAGE_TAG:-vetra-cli:prodclose-e2e}"
STUDIO_NAME="${STUDIO_NAME:-vetra-studio-prodclose}"
KEEP_UP="${KEEP_UP:-0}"

# Deterministic publish->build cache knobs (documented in lab/README.md):
# edge always revalidates the local origin, nginx holds a gate-confirmed
# packument long enough for the build to read it, no propagation lag.
export UPLINK_MAXAGE="${UPLINK_MAXAGE:-0s}"
export META_TTL="${META_TTL:-5m}"
export PROP_DELAY="${PROP_DELAY:-0s}"

# A fresh version per run so re-runs never collide with an already-published one
# on the (volume-backed) origin.
if [ -z "${VETRA_VERSION:-}" ]; then
  base="$(node -p "require('${REPO_ROOT}/vetra-cli/package.json').version")"
  VETRA_VERSION="${base}-e2e.$(date +%s)"
fi
export VETRA_VERSION

# publish-local-and-build.sh runs `pnpm build` in vetra-cli + vetra-app, which
# needs the workspace installed. Install once if it isn't (fresh CI checkout);
# a local dev clone is usually already installed, so this is a no-op then.
if [ ! -d "${REPO_ROOT}/vetra-cli/node_modules" ] || [ "${FORCE_INSTALL:-0}" = "1" ]; then
  echo "==> pnpm install (workspace)"
  ( cd "${REPO_ROOT}" && pnpm install --frozen-lockfile )
fi

cd "${STACK_DIR}"

teardown() {
  local code=$?
  echo "==> teardown (exit ${code})"
  docker rm -f "${STUDIO_NAME}" >/dev/null 2>&1 || true
  if [ "${KEEP_UP}" != "1" ]; then
    docker compose down -v >/dev/null 2>&1 || true
  else
    echo "    KEEP_UP=1 — leaving stack + studio running"
  fi
  exit "${code}"
}
trap teardown EXIT

echo "==> rendering lab config (UPLINK_MAXAGE=${UPLINK_MAXAGE} META_TTL=${META_TTL} PROP_DELAY=${PROP_DELAY})"
./render.sh

if [ "${BUILD_BASE_IMAGE}" = "1" ] && ! docker image inspect "${BASE_IMAGE}" >/dev/null 2>&1; then
  echo "==> building base image ${BASE_IMAGE} from lab/base-image"
  docker build -t "${BASE_IMAGE}" "${LAB_DIR}/base-image"
fi
docker image inspect "${BASE_IMAGE}" >/dev/null 2>&1 \
  || { echo "!! base image ${BASE_IMAGE} not present and BUILD_BASE_IMAGE!=1" >&2; exit 1; }

echo "==> bringing up the registry-cache-lab-vcli stack"
docker compose down -v >/dev/null 2>&1 || true
docker compose up -d

echo "==> waiting for nginx (:5100) to answer"
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null http://localhost:5100/healthz 2>/dev/null; then break; fi
  sleep 1
done
curl -fsS -o /dev/null http://localhost:5100/healthz || { echo "!! nginx never came up" >&2; exit 1; }

# The publish step authenticates directly against the origin verdaccio (:5101);
# verdaccio takes a few seconds past container start to serve. Gate on it so the
# adduser call doesn't race a not-yet-listening origin.
echo "==> waiting for origin verdaccio (:5101) to answer"
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null http://localhost:5101/-/ping 2>/dev/null; then break; fi
  sleep 1
done
curl -fsS -o /dev/null http://localhost:5101/-/ping || { echo "!! origin verdaccio never came up" >&2; exit 1; }

echo "==> publish-local-and-build (SKIP_PH_CLINT=1, against released ph-clint)"
SKIP_PH_CLINT=1 \
IMAGE_TAG="${IMAGE_TAG}" \
BASE_IMAGE="${BASE_IMAGE}" \
VETRA_VERSION="${VETRA_VERSION}" \
  ./publish-local-and-build.sh

echo "==> run-prodclose: start the image (replay mode) + capture driveId"
IMAGE_TAG="${IMAGE_TAG}" NAME="${STUDIO_NAME}" \
VETRA_REPLAY_FIXTURE_HOST="${REPO_ROOT}/vetra-cli/e2e/fixtures/todo-list.replay.json" \
  ./run-prodclose.sh "${IMAGE_TAG}"

# run-prodclose.sh prints the validation; re-assert here so a contract miss is a
# hard, logged failure (run-prodclose only fails if studio never starts).
echo "==> asserting studio contract"
line="$(docker logs "${STUDIO_NAME}" 2>&1 | grep -m1 'Vetra Studio:' || true)"
DRIVE="$(echo "${line}" | sed -E 's#.*/d/([A-Za-z0-9_-]+).*#\1#')"
[ -n "${DRIVE}" ] || { echo "!! no driveId from studio logs" >&2; docker logs "${STUDIO_NAME}" 2>&1 | tail -40; exit 1; }

# Contract asserted on main: the prod-built studio comes up healthy and serves
# the proxied surface. The proxy exposes the studio service route and serves the
# SPA assets and the live drive. (The root-redirect contract — `/` -> 302
# /d/<id> plus studio-redirect/studio-announce proxy routes — depends on the
# studio-redirect trigger, which is not on main yet; ASSERT_ROOT_REDIRECT=1
# enables those checks once it lands.)
fail=0
assert_code() {
  local desc="$1" want="$2" url="$3"
  local got
  got="$(curl -s -o /dev/null -w '%{http_code}' "${url}")"
  if [ "${got}" = "${want}" ]; then echo "    OK  ${desc} (${got})"; else echo "    FAIL ${desc}: want ${want}, got ${got} (${url})"; fail=1; fi
}

routes="$(curl -s http://localhost:8090/_proxy/routes)"

# / is reachable through the proxy.
root_status="$(curl -sI http://localhost:8090/ | awk 'toupper($1) ~ /HTTP/ {print $2; exit}')"
if echo "${root_status}" | grep -qE '^(200|302)$'; then
  echo "    OK  / reachable (${root_status})"
else
  echo "    FAIL / : want 200 or 302, got ${root_status}"; fail=1
fi

# The studio service route is registered on the proxy.
if echo "${routes}" | grep -q 'service:vetra-studio'; then
  echo "    OK  /_proxy/routes has service:vetra-studio"
else
  echo "    FAIL /_proxy/routes missing service:vetra-studio"; fail=1
fi

assert_code "/assets/ -> 200" 200 http://localhost:8090/assets/
assert_code "/d/${DRIVE}/ -> 200" 200 "http://localhost:8090/d/${DRIVE}/"

# Optional: full root-redirect contract (enable once the studio-redirect trigger
# is on main).
if [ "${ASSERT_ROOT_REDIRECT:-0}" = "1" ]; then
  root_loc="$(curl -sI http://localhost:8090/ | awk 'tolower($1) ~ /^location:/ {print $2; exit}' | tr -d '\r')"
  if [ "${root_status}" = "302" ] && echo "${root_loc}" | grep -q "/d/${DRIVE}"; then
    echo "    OK  / -> 302 ${root_loc}"
  else
    echo "    FAIL / : want 302 -> /d/${DRIVE}, got ${root_status} ${root_loc}"; fail=1
  fi
  for r in studio-redirect studio-announce; do
    if echo "${routes}" | grep -q "${r}"; then echo "    OK  /_proxy/routes has ${r}"; else echo "    FAIL /_proxy/routes missing ${r}"; fail=1; fi
  done
fi

if [ "${fail}" != "0" ]; then
  echo "!! studio contract assertions failed — dumping studio logs" >&2
  docker logs "${STUDIO_NAME}" 2>&1 | tail -80
  echo "--- routes ---"; echo "${routes}"
  exit 1
fi

# The HTTP contract above is a fast tripwire. The real functional gate is the
# seeded Playwright replay driven against the prod-built studio: it drives the
# recorded build (the container's agent is in replay mode) and asserts the
# generated editor renders in the BUILD-pane iframe — exercising the whole
# boot -> chat -> build -> codegen -> preview pipeline on the baked image.
if [ "${RUN_REPLAY:-1}" = "1" ]; then
  echo "==> seeded replay against the prod-close image (attach mode)"
  ( cd "${REPO_ROOT}" && pnpm --filter vetra-cli exec playwright install --with-deps chromium )
  if ! ( cd "${REPO_ROOT}" \
      && VETRA_E2E_BASE_URL="http://localhost:8090" VETRA_E2E_DRIVE_ID="${DRIVE}" \
         pnpm --filter vetra-cli test:e2e ); then
    echo "!! seeded replay failed against the prod image — dumping studio logs" >&2
    docker logs "${STUDIO_NAME}" 2>&1 | tail -120
    exit 1
  fi
else
  echo "!! WARNING: RUN_REPLAY=0 — skipped the seeded replay (contract-only run)" >&2
fi

echo
echo "PASS: prod-close e2e green. image=${IMAGE_TAG} vetra=${VETRA_VERSION} driveId=${DRIVE}"
