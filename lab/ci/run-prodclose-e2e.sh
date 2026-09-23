#!/usr/bin/env bash
# One entrypoint for the prod-close e2e: the same script CI runs and a developer
# runs locally with docker. Brings up the prod stack, publishes
# vetra + vetra-app to the disposable local origin against the released
# (catalog-pinned) ph-clint, builds the clint-agent image the prod way (hoisted
# `pnpm add -g`), runs it, then drives the seeded Playwright replay against the
# baked image — the real functional gate. A fast URL tripwire early-exits first
# if the studio isn't even serving. Tears the stack and the studio container
# down on exit (pass or fail).
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
#   IMAGE_TAG           default vetra:prodclose-e2e
#   VETRA_VERSION       default <vetra pkg version + .e2e timestamp suffix>
#   KEEP_UP             default 0 — set 1 to leave the stack + studio running.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
LAB_DIR="$(cd "${HERE}/.." && pwd)"
STACK_DIR="${LAB_DIR}/prod"
REPO_ROOT="$(cd "${LAB_DIR}/.." && pwd)"

BASE_IMAGE="${BASE_IMAGE:-clint-runtime:labvcli}"
BUILD_BASE_IMAGE="${BUILD_BASE_IMAGE:-1}"
IMAGE_TAG="${IMAGE_TAG:-vetra:prodclose-e2e}"
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

# publish-local-and-build.sh runs `pnpm build` in vetra + vetra-app, which
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

echo "==> bringing up the prod stack"
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

# --- Fast tripwire ----------------------------------------------------------
# Fail early (before the heavy Playwright install + browser drive) if the studio
# isn't even serving. This is a smoke check for a clean early exit, NOT the
# functional contract — the seeded replay below is the real gate. Status codes
# alone can't catch a studio that serves a stale/broken bundle (every URL still
# returns 200): PR #38's precompress regression passed exactly this kind of
# check. So keep this minimal and let the replay do the real asserting.
echo "==> tripwire: is the studio serving?"
line="$(docker logs "${STUDIO_NAME}" 2>&1 | grep -m1 'Vetra Studio:' || true)"
DRIVE="$(echo "${line}" | sed -E 's#.*/d/([A-Za-z0-9_-]+).*#\1#')"
[ -n "${DRIVE}" ] || { echo "!! no driveId from studio logs — studio never started" >&2; docker logs "${STUDIO_NAME}" 2>&1 | tail -60; exit 1; }

trip=0
code() { # desc want url
  # `|| true`: a connection-level failure (curl exit 7) must record trip=1 and
  # reach the log dump below, not abort the script under set -e.
  local got; got="$(curl -s -o /dev/null -w '%{http_code}' "$3" || true)"
  if [ "${got}" = "$2" ]; then echo "    OK  $1 (${got})"; else echo "    FAIL $1: want $2, got ${got} ($3)"; trip=1; fi
}
# `|| true` on both: a refused :8090 (studio logged its URL but the proxy isn't
# serving) must fall through to the trip=1 log dump, not abort under set -e.
routes="$(curl -s http://localhost:8090/_proxy/routes || true)"
root="$(curl -sI http://localhost:8090/ 2>/dev/null | awk 'toupper($1) ~ /HTTP/ {print $2; exit}' || true)"
echo "${root}" | grep -qE '^(200|302)$' && echo "    OK  / reachable (${root})" || { echo "    FAIL / : want 200 or 302, got ${root}"; trip=1; }
echo "${routes}" | grep -q 'service:vetra-studio' && echo "    OK  /_proxy/routes has service:vetra-studio" || { echo "    FAIL /_proxy/routes missing service:vetra-studio"; trip=1; }
code "/assets/ -> 200" 200 http://localhost:8090/assets/
code "/d/${DRIVE}/ -> 200" 200 "http://localhost:8090/d/${DRIVE}/"
if [ "${trip}" != 0 ]; then
  echo "!! studio not serving — failing before the replay" >&2
  docker logs "${STUDIO_NAME}" 2>&1 | tail -80; echo "--- routes ---"; echo "${routes}"
  exit 1
fi

# --- The functional gate ----------------------------------------------------
# The seeded Playwright replay drives the recorded build (the container's agent
# is in replay mode) against the prod-built studio and asserts the generated
# editor renders in the BUILD-pane iframe with the preview data — the whole
# boot -> chat -> build -> codegen -> preview pipeline on the baked image. This
# is THE check. RUN_REPLAY=0 is a local-dev tripwire-only shortcut; it exits
# without the green PASS so a skipped run can never be mistaken for a full one.
if [ "${RUN_REPLAY:-1}" != "1" ]; then
  echo "!! RUN_REPLAY=0 — ran the URL tripwire ONLY. This is NOT a full e2e pass." >&2
  exit 0
fi
echo "==> seeded replay against the prod-close image (the functional gate)"
( cd "${REPO_ROOT}" && pnpm --filter vetra exec playwright install --with-deps chromium )
if ! ( cd "${REPO_ROOT}" \
    && VETRA_E2E_BASE_URL="http://localhost:8090" VETRA_E2E_DRIVE_ID="${DRIVE}" \
       pnpm --filter vetra test:e2e ); then
  echo "!! seeded replay failed against the prod image — dumping studio logs" >&2
  docker logs "${STUDIO_NAME}" 2>&1 | tail -120
  exit 1
fi

echo
echo "PASS: prod-close e2e green (studio serving + seeded replay). image=${IMAGE_TAG} vetra=${VETRA_VERSION} driveId=${DRIVE}"
