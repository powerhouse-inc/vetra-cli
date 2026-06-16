#!/usr/bin/env bash
# Cross-lever CONCURRENT measurement harness (CODEGEN-MEMORY-PLAN.md §9.3): the
# whole-container cgroup memory.peak of a LIVE studio, across the 4-arm matrix
# {none, codegen-kept, connect-on, both}. The open question the isolated A/Bs
# leave: in a live studio (reactor-project-start resident + a spec-generate
# burst), how much does each lever (codegen F1+F2, Connect externalize-vendor)
# move the whole-container peak, and do they STACK.
#
# Topology, ONE fresh container per run:
#   1. Boot reactor-project-start  -> the project's own reactor + Switchboard +
#      Vite/Connect dev server + the studio proxy (binds :8090). This is the
#      RESIDENT floor.
#   2. Drive the Connect preview to steady state (Vite dep optimizer settled),
#      same as measure-reactor-start.sh — fetch the importmap HTML, pull entry
#      modules, re-poll across a settle window.
#   3. While the reactor is still resident, fire `vetra spec-generate` — the
#      transient codegen BURST that sets the high-water above the resident floor.
#   4. Read the whole-container cgroup memory.peak (the additive high-water).
#
# Why a fresh container per run: cgroup v2 memory.peak is a monotonic,
# non-resettable high-water mark — a clean read needs a fresh cgroup. N=RUNS
# median, --memory MEM_LIMIT (default 7g; VM ceiling ~7.65 GiB).
#
# The :8090 collision (handled): dev.23 bundles ph-clint 0.1.0-dev.86, which
# PREDATES the one-shot proxy fix (ph-clint 325ea4f). So `vetra spec-generate`
# starts the studio proxy too, and with reactor-project-start ALREADY holding
# :8090 it dies with `EADDRINUSE 0.0.0.0:8090` (verified). The burst invocation
# therefore sets VETRA_PROXY_PORT (manifest env override for proxyPort) to a free
# port (BURST_PROXY_PORT, default 18090) so its proxy binds elsewhere — codegen
# then runs to completion concurrently with the resident reactor. (An image built
# on a newer ph-clint with the one-shot fix would not need this, but the override
# is harmless there.)
#
# Reused gotchas (proven in measure-codegen.sh / measure-reactor-start.sh):
#   - Run THROUGH the entrypoint (SERVICE_COMMAND), never override it — the
#     entrypoint exports NODE_PATH the codegen Zod plugin needs.
#   - `--workdir` MUST precede the subcommand (Commander enablePositionalOptions).
#   - node_modules mounted at a SEPARATE top-level path /nm/node_modules (NOT a
#     flat /nm, NOT nested under the /work mount) + symlink <project>/node_modules
#     -> /nm/node_modules. Nested bind mounts are intermittently invisible on
#     macOS virtiofs (silently skips tsc/eslint and the vendor build); the
#     separate top-level mount + symlink is visible deterministically. The mount
#     path must END in `node_modules` so the vendor build worker's
#     import.meta.resolve walks up to a node_modules ancestor.
#   - node_modules must be WRITABLE (ph vetra's deps-status check reconciles it on
#     boot; a read-only mount fails EROFS) and MATCH the image platform
#     (linux/amd64) — a host-installed (macOS) tree forces a full reinstall on
#     boot. Point FIXTURE at a linux-installed tree (see /tmp/fix-linux).
#   - Strip ANSI before matching Vite's colorized `Local:` readiness line (Vite
#     embeds escapes INSIDE the URL).
#   - Read the studio URL from the DETACHED service .log, not the start command's
#     stdout (its synchronous readiness wait returns transient failures).
#
# Arms (one fresh container each; the per-arm image carries the lever's edits —
# verify the in-image markers BEFORE measuring, see verify-arm-images below):
#   none          stock dev.23                          (no F1/F2, no toggle)
#   codegen-kept  F1+F2 codegen overlay on dev.23       (frees ts-morph AST before
#                 checks + caps tsc/eslint child heaps; cuts the BURST)
#   connect-on    connect-live overlay + the env        (builder-tools working-
#                 vendor build + toggle dist; VETRA_CONNECT_EXTERNALIZE_VENDOR=1;
#                 warm .ph-vendor pre-seeded; cuts the resident FLOOR)
#   both          F1+F2 AND connect-live overlays + env  (both levers; tests STACK)
#
# Each arm names its IMAGE and whether the Connect toggle is armed + warm vendor
# seeded, via the ARM_SPECS table below (arm:image:connect[:warm]). Override with
# the ARM_SPECS env var (newline- or space-separated entries).
#
# Connect correctness (ON arms only, mirrors measure-reactor-start.sh): the served
# importmap HTML must name a /__vendor__/ entry AND that URL must serve 200 —
# otherwise the toggle was inert (env never reached the dev server, or the vendor
# build silently fell back) and the "win" would be a lie. A failing arm is
# REJECTED, not recorded. Codegen correctness: `Generated N module(s)` with N>=1,
# `Generated-file checks:` present (tsc+eslint actually ran), spec-generate exit 0.
#
# Env knobs
#   ARM_SPECS         arm:image:connect[:warm] entries (default: the 4-arm matrix)
#   FIXTURE           reactor project, linux-installed node_modules (default /tmp/fix-linux)
#   PROJECT           project sub-dir name (default basename FIXTURE)
#   ARMS              space-separated arm names to run (default all in ARM_SPECS)
#   MEM_LIMIT         docker --memory (default 7g)
#   RUNS              measured runs per arm, median reported (default 2)
#   SETTLE_SEC        seconds to let Vite's optimizer settle before the burst (default 20)
#   CONNECT_PORT      in-container Connect/Vite port (default 3000)
#   BURST_PROXY_PORT  VETRA_PROXY_PORT for the spec-generate burst (default 18090)
#   VENDOR_CACHE      prebuilt .ph-vendor dir to seed warm ON arms (default
#                     /tmp/concurrent-vendor-cache; built once, see README at end)
#   WORK_BASE         scratch dir (default /tmp/concurrent-measure)
#   OUT_JSON          JSON result path (default $WORK_BASE/concurrent.json)
#
# Output: human log to stderr, machine JSON to OUT_JSON (and echoed to stdout).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/measure-lib.sh"

DEV23="cr.vetra.io/powerhouse-inc-powerhouse/clint-agent/vetra-cli:0.0.1-dev.23"

# arm:image:connect[:warm]  (connect=1 arms the VETRA_CONNECT_EXTERNALIZE_VENDOR
# env; warm=1 seeds VENDOR_CACHE into the staged .ph-vendor so the vendor build
# is a warm no-op, not the cold first-run penalty).
DEFAULT_ARM_SPECS="none:${DEV23}:0
codegen-kept:vetra-cli:f1f2-codegen:0
connect-on:vetra-cli:connect-live-v2:1:1
both:vetra-cli:both-f1f2-connect:1:1"

ARM_SPECS="${ARM_SPECS:-$DEFAULT_ARM_SPECS}"
FIXTURE="${FIXTURE:-/tmp/fix-linux}"
PROJECT="${PROJECT:-$(basename "$FIXTURE")}"
MEM_LIMIT="${MEM_LIMIT:-7g}"
RUNS="${RUNS:-2}"
SETTLE_SEC="${SETTLE_SEC:-20}"
CONNECT_PORT="${CONNECT_PORT:-3000}"
BURST_PROXY_PORT="${BURST_PROXY_PORT:-18090}"
VENDOR_CACHE="${VENDOR_CACHE:-/tmp/concurrent-vendor-cache}"
WORK_BASE="${WORK_BASE:-/tmp/concurrent-measure}"
OUT_JSON="${OUT_JSON:-$WORK_BASE/concurrent.json}"

TEMPLATE="$WORK_BASE/template"
NM_RW="$WORK_BASE/nm-rw"
NODE_MODULES="$FIXTURE/node_modules"

# --- preconditions -----------------------------------------------------------
require_tools rsync curl
[ -f "$FIXTURE/powerhouse.config.json" ] || { log "ERROR: $FIXTURE is not a reactor project (no powerhouse.config.json)"; exit 1; }
[ -d "$NODE_MODULES" ] || { log "ERROR: fixture has no node_modules ($NODE_MODULES). Install the fixture (linux/amd64) first."; exit 1; }

# Parse ARM_SPECS into name->{image,connect,warm}. Image may itself contain ':'
# only for a registry port, but our local arms use untagged-host:tag at most one
# colon in the image; to keep parsing unambiguous we split into at most 5 fields
# from the LEFT-most arm name, then re-join the middle as the image.
declare -a SPEC_ARM=() SPEC_IMAGE=() SPEC_CONNECT=() SPEC_WARM=()
while IFS= read -r line; do
  line="$(printf '%s' "$line" | tr -s ' ' '\n')"
  for entry in $line; do
    [ -z "$entry" ] && continue
    # entry = arm:image[:image2...]:connect[:warm]; arm is field1, warm/connect
    # are the trailing 0/1 fields, image is everything between.
    arm="${entry%%:*}"
    rest="${entry#*:}"
    # trailing fields: last is warm OR connect. Pull from the right.
    last="${rest##*:}"; rest2="${rest%:*}"
    if [ "$rest2" = "$rest" ]; then
      log "ERROR: malformed ARM_SPECS entry '$entry' (need arm:image:connect[:warm])"; exit 1
    fi
    prev="${rest2##*:}"; rest3="${rest2%:*}"
    if printf '%s' "$last" | grep -qE '^[01]$' && printf '%s' "$prev" | grep -qE '^[01]$' && [ "$rest3" != "$rest2" ]; then
      # arm:image:connect:warm
      warm="$last"; connect="$prev"; image="$rest3"
    elif printf '%s' "$last" | grep -qE '^[01]$'; then
      # arm:image:connect
      warm="0"; connect="$last"; image="$rest2"
    else
      log "ERROR: malformed ARM_SPECS entry '$entry'"; exit 1
    fi
    SPEC_ARM+=("$arm"); SPEC_IMAGE+=("$image"); SPEC_CONNECT+=("$connect"); SPEC_WARM+=("$warm")
  done
done <<< "$ARM_SPECS"

ARMS="${ARMS:-$(printf '%s ' "${SPEC_ARM[@]}")}"

# Look up a per-arm field (bash 3.2: no namerefs). field in {image,connect,warm}.
spec_field() { # arm field
  local want="$1" field="$2" i
  for i in "${!SPEC_ARM[@]}"; do
    if [ "${SPEC_ARM[$i]}" = "$want" ]; then
      case "$field" in
        image)   printf '%s' "${SPEC_IMAGE[$i]}" ;;
        connect) printf '%s' "${SPEC_CONNECT[$i]}" ;;
        warm)    printf '%s' "${SPEC_WARM[$i]}" ;;
      esac
      return
    fi
  done
}

# --- verify in-image markers (the last run shipped a misnamed empty image) ----
# Each arm's claim is asserted against the baked dist BEFORE any measurement:
#   codegen arms  -> F1 (tsProject = null in generate.js+extract.js) + F2 (checkNodeOptions)
#   connect arms  -> toggle wiring (connectExternalizeVendorEnv) + builder-tools
#                    working vendor build (prebuildConnectVendor)
verify_arm_images() {
  local i arm image connect ok
  log "==> Verifying in-image markers for each arm (refusing to measure a mislabeled image)"
  for arm in $ARMS; do
    image="$(spec_field "$arm" image)"
    connect="$(spec_field "$arm" connect)"
    require_image "$image"
    # expected markers depend on the arm name (codegen levers carry F1/F2).
    local want_codegen=0
    case "$arm" in codegen-kept|both) want_codegen=1 ;; esac
    ok=$(docker run --rm --entrypoint sh "$image" -c '
      VC=$(find / -type d -path "*/vetra-cli/dist" 2>/dev/null | head -1)
      F1G=$(grep -c "tsProject = null" "$VC/commands/spec/generate.js" 2>/dev/null || echo 0)
      F1E=$(grep -c "tsProject = null" "$VC/commands/spec/extract.js" 2>/dev/null || echo 0)
      F2=$(grep -c "checkNodeOptions" "$VC/helpers/project-checks.js" 2>/dev/null || echo 0)
      TOG=$(grep -c "connectExternalizeVendorEnv" "$VC/services/reactor-project.js" 2>/dev/null || echo 0)
      BT=$(find / -type f -path "*/@powerhousedao/builder-tools/dist/index.mjs" 2>/dev/null | head -1)
      VEN=$(grep -c "prebuildConnectVendor" "$BT" 2>/dev/null || echo 0)
      echo "F1G=$F1G F1E=$F1E F2=$F2 TOG=$TOG VEN=$VEN"
    ' 2>/dev/null)
    log "    $arm ($image): $ok"
    local F1G F1E F2 TOG VEN
    F1G=$(printf '%s' "$ok" | grep -oE 'F1G=[0-9]+' | cut -d= -f2)
    F1E=$(printf '%s' "$ok" | grep -oE 'F1E=[0-9]+' | cut -d= -f2)
    F2=$(printf '%s' "$ok" | grep -oE 'F2=[0-9]+' | cut -d= -f2)
    TOG=$(printf '%s' "$ok" | grep -oE 'TOG=[0-9]+' | cut -d= -f2)
    VEN=$(printf '%s' "$ok" | grep -oE 'VEN=[0-9]+' | cut -d= -f2)
    if [ "$want_codegen" = 1 ]; then
      [ "${F1G:-0}" -ge 1 ] && [ "${F1E:-0}" -ge 1 ] && [ "${F2:-0}" -ge 1 ] || {
        log "ERROR: arm '$arm' image $image is MISSING F1/F2 codegen markers (F1G=$F1G F1E=$F1E F2=$F2)"; exit 1; }
    else
      [ "${F1G:-0}" = 0 ] || log "    note: arm '$arm' carries F1 markers though not declared codegen (informational)"
    fi
    if [ "$connect" = 1 ]; then
      [ "${TOG:-0}" -ge 1 ] && [ "${VEN:-0}" -ge 1 ] || {
        log "ERROR: arm '$arm' image $image is MISSING Connect markers (toggle=$TOG vendorBuild=$VEN)"; exit 1; }
    fi
  done
  log "    all arm images verified"
}

# --- clear fixed ports before each run (8090/27370/59220, no fallback) --------
free_fixed_ports() {
  # Stop any container holding the studio fixed ports + this harness's leftovers.
  local c
  for c in $(docker ps -a --format '{{.Names}}' | grep -iE 'vetra-studio|concurrent-measure-|reactor-start-measure-|codegen-measure-' || true); do
    docker rm -f "$c" >/dev/null 2>&1 || true
  done
}

# --- one-time template + writable node_modules staging (NOT measured) --------
log "==> Building pristine template (source only, node_modules staged separately)"
rm -rf "$WORK_BASE"; mkdir -p "$TEMPLATE"
rsync -a --exclude node_modules --exclude .git --exclude dist --exclude tsconfig.tsbuildinfo "$FIXTURE"/ "$TEMPLATE"/
log "==> Staging writable node_modules ($(du -sh "$NODE_MODULES" 2>/dev/null | awk '{print $1}')) — one-time copy"
mkdir -p "$NM_RW"; rsync -a "$NODE_MODULES"/ "$NM_RW"/
log "    template: $(du -sh "$TEMPLATE" 2>/dev/null | awk '{print $1}'), node_modules (rw stage): $(du -sh "$NM_RW" 2>/dev/null | awk '{print $1}')"

if [ -d "$VENDOR_CACHE" ] && [ -f "$VENDOR_CACHE/import-map.json" ]; then
  log "    warm vendor cache: $(du -sh "$VENDOR_CACHE" 2>/dev/null | awk '{print $1}') ($(ls "$VENDOR_CACHE"/*.js 2>/dev/null | wc -l | tr -d ' ') entries)"
else
  log "    WARNING: no warm vendor cache at $VENDOR_CACHE — ON arms will measure a COLD first-run vendor build (or fail the warm assumption). Build it once (see README at end)."
fi

# --- in-container driver -----------------------------------------------------
# argv: PROJECT CONNECT_PORT SETTLE_SEC BURST_PROXY_PORT
# Boots reactor-project-start, drives the preview to steady state, reads the
# resident floor peak, fires spec-generate (with the proxy override) while the
# reactor is resident, reads the whole-container high-water. Echoes markers the
# host parses + dumps logs for the gate.
DRIVER="$WORK_BASE/driver.sh"
cat > "$DRIVER" <<'DRIVER_EOF'
#!/bin/sh
set -u
PROJECT="$1"; PORT="$2"; SETTLE="$3"; BURST_PROXY="$4"
PEAK() { cat /sys/fs/cgroup/memory.peak 2>/dev/null || echo 0; }
SVC_LOG_DIR="$HOME/.ph/vetra/services/reactor-project"
strip() { sed -E 's/\x1b\[[0-9;]*m//g'; }
studio_url_from_log() {
  f="$(ls -t "$SVC_LOG_DIR"/*.log 2>/dev/null | head -1)"; [ -z "$f" ] && return 0
  strip < "$f" | grep -oE 'Local:[[:space:]]*http://(localhost|127\.0\.0\.1):[0-9]+[^[:space:]]*' \
    | tail -1 | sed -E 's/^Local:[[:space:]]*//'
}

echo "DRIVER: boot reactor-project-start (project=$PROJECT port=$PORT)"
vetra --workdir /work reactor-project-start --workdir "$PROJECT" --connectPort "$PORT" > /tmp/start.out 2>&1 &
READY_DEADLINE=300; STUDIO_URL=""; t=0
while [ "$t" -lt "$READY_DEADLINE" ]; do
  STUDIO_URL="$(studio_url_from_log)"; [ -n "$STUDIO_URL" ] && break
  sleep 3; t=$((t + 3))
done
echo "RESIDENT_PEAK_BYTES=$(PEAK)"
echo "STUDIO_URL=${STUDIO_URL:-<none>}"
if [ -z "$STUDIO_URL" ]; then
  echo "GATE_READY=0"; echo "PEAK_BYTES=$(PEAK)"
  echo "===START_OUT_BEGIN==="; strip < /tmp/start.out 2>/dev/null; echo "===START_OUT_END==="
  for L in $(ls -t "$SVC_LOG_DIR"/*.log 2>/dev/null); do echo "===SERVICE_LOG_BEGIN $L==="; strip < "$L"; echo "===SERVICE_LOG_END==="; done
  exit 0
fi
echo "GATE_READY=1"

case "$STUDIO_URL" in */) BASE="$STUDIO_URL" ;; *) BASE="$STUDIO_URL/" ;; esac
ORIGIN="$(printf '%s' "$BASE" | sed -E 's#^(http://[^/]+).*#\1#')"

# Drive preview to steady state + capture the gate signals.
ROOT_HTML="$(curl -fsS --max-time 30 "$BASE" 2>/dev/null || true)"
GATE_ROOT_STATUS="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$BASE" 2>/dev/null || echo 000)"
echo "GATE_ROOT_STATUS=$GATE_ROOT_STATUS"
printf '%s' "$ROOT_HTML" | grep -q '<script type="importmap"' && echo "GATE_IMPORTMAP=1" || echo "GATE_IMPORTMAP=0"

VENDOR_HIT="$(printf '%s' "$ROOT_HTML" | grep -oE '"[^"]*/__vendor__/[^"]+\.js"' | head -1 | sed -E 's/^"//; s/"$//')"
if [ -n "$VENDOR_HIT" ]; then
  echo "GATE_VENDOR_IMPORTMAP=1"
  case "$VENDOR_HIT" in http*) vurl="$VENDOR_HIT" ;; /*) vurl="$ORIGIN$VENDOR_HIT" ;; *) vurl="$BASE$VENDOR_HIT" ;; esac
  echo "GATE_VENDOR_SERVED=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$vurl" 2>/dev/null || echo 000) $vurl"
else
  echo "GATE_VENDOR_IMPORTMAP=0"; echo "GATE_VENDOR_SERVED=000 <none>"
fi

# Pull entry modules to force the optimizer to run over the real graph.
ENTRIES="$(printf '%s' "$ROOT_HTML" | grep -oE 'src="[^"]+\.[mc]?[jt]sx?"' | sed -E 's/^src="//; s/"$//' | head -5)"
for rel in $ENTRIES; do
  case "$rel" in http*) url="$rel" ;; /*) url="$ORIGIN$rel" ;; *) url="$BASE$rel" ;; esac
  echo "ENTRY $(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$url" 2>/dev/null || echo 000) $url"
done

echo "DRIVER: settling ${SETTLE}s"
i=0; while [ "$i" -lt "$SETTLE" ]; do curl -s -o /dev/null --max-time 10 "$BASE" 2>/dev/null || true; sleep 1; i=$((i + 1)); done

# Steady-state RESIDENT floor (before the burst).
echo "FLOOR_PEAK_BYTES=$(PEAK)"

# --- the BURST: spec-generate while the reactor is resident ------------------
# VETRA_PROXY_PORT moves the one-shot's proxy off :8090 (held by the resident
# reactor) so it doesn't EADDRINUSE. Regenerate from specs (clear gen/ first so
# the burst is real work, and the codegen correctness gate is meaningful).
echo "DRIVER: clearing gen/ + firing spec-generate (VETRA_PROXY_PORT=$BURST_PROXY)"
find "/work/$PROJECT" -type d -name gen -not -path '*/node_modules/*' -exec rm -rf {} + 2>/dev/null || true
VETRA_PROXY_PORT="$BURST_PROXY" vetra --workdir /work spec-generate --project "$PROJECT" > /tmp/sg.out 2>&1
SG_RC=$?
echo "SG_RC=$SG_RC"
strip < /tmp/sg.out | grep -E 'Generated [0-9]+ module\(s\)|Generated-file checks:|EADDRINUSE|Cannot find module|Failed to load schema' | head -10

# Whole-container high-water (the additive peak: resident reactor + burst).
echo "PEAK_BYTES=$(PEAK)"
echo "MAX_BYTES=$(cat /sys/fs/cgroup/memory.max 2>/dev/null || echo 0)"

echo "===SG_OUT_BEGIN==="; strip < /tmp/sg.out 2>/dev/null | tail -15; echo "===SG_OUT_END==="
echo "===START_OUT_BEGIN==="; strip < /tmp/start.out 2>/dev/null; echo "===START_OUT_END==="
for L in $(ls -t "$SVC_LOG_DIR"/*.log 2>/dev/null); do echo "===SERVICE_LOG_BEGIN $L==="; strip < "$L"; echo "===SERVICE_LOG_END==="; done
DRIVER_EOF
chmod +x "$DRIVER"

verify_arm_images

# --- measured runs -----------------------------------------------------------
declare -a ARM_NAMES=() ARM_MED_PEAK=() ARM_MED_FLOOR=() ARM_MED_WALL=() ARM_GATE=() ARM_RUNS_JSON=() ARM_IMAGE=()

reject_run() { log "    !! ${1} run ${2} REJECTED: ${3}"; log "       (full container log: ${4})"; }

run_arm() {
  local arm="$1"
  local image connect warm
  image="$(spec_field "$arm" image)"
  connect="$(spec_field "$arm" connect)"
  warm="$(spec_field "$arm" warm)"
  local -a peaks=() floors=() walls=()
  local runs_json="[" arm_gate_pass="true"

  for i in $(seq 0 $(( RUNS - 1 )) ); do
    local RUN="$WORK_BASE/$arm/run-$i"
    local LOGF="$WORK_BASE/$arm/run-$i.log"
    local NM_RUN="$WORK_BASE/$arm/nm-$i"          # per-run writable node_modules (warm cache differs per arm)
    rm -rf "$RUN" "$NM_RUN"; mkdir -p "$RUN"
    rsync -a "$TEMPLATE"/ "$RUN/$PROJECT"/
    # Per-run node_modules copy so a warm .ph-vendor seeded for ON arms doesn't
    # leak into OFF arms / other runs. (rsync from the shared stage.)
    rsync -a "$NM_RW"/ "$NM_RUN"/
    rm -rf "$NM_RUN/.ph-vendor"
    if [ "$warm" = "1" ]; then
      if [ -d "$VENDOR_CACHE" ] && [ -f "$VENDOR_CACHE/import-map.json" ]; then
        # Seed .ph-vendor as a REAL dir inside node_modules (where the build's
        # renameSync persists it), so the warm digest matches and the vendor
        # build is a no-op rather than a cold first-run peak.
        mkdir -p "$NM_RUN/.ph-vendor"; rsync -a "$VENDOR_CACHE"/ "$NM_RUN/.ph-vendor"/
      else
        log "    note: warm arm '$arm' has no VENDOR_CACHE — this run measures a COLD vendor build"
      fi
    fi
    ln -s /nm/node_modules "$RUN/$PROJECT/node_modules"

    local -a ENVARGS=(-e CI=true)
    [ "$connect" = "1" ] && ENVARGS+=(-e VETRA_CONNECT_EXTERNALIZE_VENDOR=1)

    log "==> arm=$arm  run $(( i + 1 ))/$RUNS  (image=$image mem=$MEM_LIMIT settle=${SETTLE_SEC}s connect=$connect warm=$warm)"
    free_fixed_ports
    local CNAME="concurrent-measure-$$-$arm-$i"
    docker rm -f "$CNAME" >/dev/null 2>&1 || true

    local SERVICE_CMD="sh /driver.sh ${PROJECT} ${CONNECT_PORT} ${SETTLE_SEC} ${BURST_PROXY_PORT}"
    local START END WALL
    START=$(now_s)
    set +e
    docker run --rm --memory "$MEM_LIMIT" --name "$CNAME" \
      -v "$RUN":/work \
      -v "$NM_RUN":/nm/node_modules \
      -v "$DRIVER":/driver.sh:ro \
      "${ENVARGS[@]}" \
      -e SERVICE_COMMAND="$SERVICE_CMD" \
      "$image" >"$LOGF" 2>&1
    local DOCKER_RC=$?
    set -e
    END=$(now_s); WALL=$(wall_sec "$START" "$END")

    local PEAK_BYTES FLOOR_BYTES READY GROOT GIMPORT GVIMPORT GVSERVED SG_RC GEN_N
    PEAK_BYTES=$(last_marker_int "$LOGF" "PEAK_BYTES")
    FLOOR_BYTES=$(last_marker_int "$LOGF" "FLOOR_PEAK_BYTES")
    READY=$(last_marker_int "$LOGF" "GATE_READY")
    GROOT=$(grep -oE 'GATE_ROOT_STATUS=[0-9]+' "$LOGF" | tail -1 | cut -d= -f2 || true)
    GIMPORT=$(last_marker_int "$LOGF" "GATE_IMPORTMAP")
    GVIMPORT=$(last_marker_int "$LOGF" "GATE_VENDOR_IMPORTMAP")
    GVSERVED=$(grep -oE 'GATE_VENDOR_SERVED=[0-9]+' "$LOGF" | tail -1 | cut -d= -f2 || true)
    SG_RC=$(last_marker_int "$LOGF" "SG_RC")
    GEN_N=$(grep -oE 'Generated [0-9]+ module\(s\)' "$LOGF" | tail -1 | grep -oE '[0-9]+' | head -1 || true)

    local status="ok" gate="pass"
    if [ "$DOCKER_RC" -ne 0 ]; then
      status="rejected: docker run exited $DOCKER_RC (likely OOM at mem=$MEM_LIMIT)"; gate="fail"; reject_run "$arm" "$((i+1))" "docker exit $DOCKER_RC" "$LOGF"
    elif [ -z "$PEAK_BYTES" ] || [ "${PEAK_BYTES:-0}" = "0" ]; then
      status="rejected: no PEAK_BYTES (cgroup/boot failed)"; gate="fail"; reject_run "$arm" "$((i+1))" "no PEAK_BYTES" "$LOGF"
    elif [ "${READY:-0}" != "1" ]; then
      status="rejected: reactor-project-start never ready (no studio URL)"; gate="fail"; reject_run "$arm" "$((i+1))" "not ready" "$LOGF"
    elif [ "${GROOT:-000}" != "200" ]; then
      status="rejected: preview root HTTP ${GROOT:-000}"; gate="fail"; reject_run "$arm" "$((i+1))" "root ${GROOT:-000}" "$LOGF"
    elif [ "${GIMPORT:-0}" != "1" ]; then
      status="rejected: no <script type=importmap> (dev server inactive)"; gate="fail"; reject_run "$arm" "$((i+1))" "no importmap" "$LOGF"
    elif [ "${SG_RC:-1}" != "0" ]; then
      status="rejected: spec-generate exited ${SG_RC:-<none>} (burst failed — e.g. :8090 collision)"; gate="fail"; reject_run "$arm" "$((i+1))" "spec-generate rc ${SG_RC:-?}" "$LOGF"
    elif [ -z "$GEN_N" ] || [ "$GEN_N" -lt 1 ]; then
      status="rejected: codegen produced no modules (N<1)"; gate="fail"; reject_run "$arm" "$((i+1))" "no modules generated" "$LOGF"
    elif ! grep -qE 'Generated-file checks:' "$LOGF"; then
      status="rejected: no 'Generated-file checks:' (tsc/eslint did not run — burst under-measured)"; gate="fail"; reject_run "$arm" "$((i+1))" "checks did not run" "$LOGF"
    elif grep -qiE 'PH_CONNECT_EXTERNALIZE_VENDOR set but vendor prebuild failed' "$LOGF"; then
      status="rejected: vendor prebuild failed + fell back (false ON)"; gate="fail"; reject_run "$arm" "$((i+1))" "vendor fell back" "$LOGF"
    elif grep -qiE 'no named export|does not provide an export named' "$LOGF"; then
      status="rejected: named-export error in dev-server log"; gate="fail"; reject_run "$arm" "$((i+1))" "named-export error" "$LOGF"
    fi

    # Positive ON gate: ON arms must genuinely externalize the vendor.
    if [ "$status" = "ok" ] && [ "$connect" = "1" ]; then
      if [ "${GVIMPORT:-0}" != "1" ]; then
        status="rejected: ON arm but importmap has no /__vendor__/ entry (vendor inert — false win)"; gate="fail"; reject_run "$arm" "$((i+1))" "vendor inert" "$LOGF"
      elif [ "${GVSERVED:-000}" != "200" ]; then
        status="rejected: ON arm vendor URL served ${GVSERVED:-000} (expected 200)"; gate="fail"; reject_run "$arm" "$((i+1))" "vendor URL ${GVSERVED:-000}" "$LOGF"
      fi
    fi

    local peak_mib="" floor_mib=""
    if [ "$status" = "ok" ]; then
      peak_mib=$(bytes_to_mib "$PEAK_BYTES")
      [ -n "$FLOOR_BYTES" ] && [ "$FLOOR_BYTES" != "0" ] && floor_mib=$(bytes_to_mib "$FLOOR_BYTES")
      peaks+=("$peak_mib"); walls+=("$WALL"); [ -n "$floor_mib" ] && floors+=("$floor_mib")
      log "    ok: containerPeak=${peak_mib} MiB  residentFloor=${floor_mib:-?} MiB  wall=${WALL}s  modules=${GEN_N}  vendorActive=${GVIMPORT:-0}"
    else
      arm_gate_pass="false"
    fi

    [ "$i" -gt 0 ] && runs_json+=","
    runs_json+=$(jq -nc \
      --argjson idx "$(( i + 1 ))" --arg status "$status" --arg gate "$gate" \
      --arg peak "${peak_mib}" --arg floor "${floor_mib}" --arg wall "${WALL}" \
      --arg rootStatus "${GROOT:-}" --arg importmap "${GIMPORT:-}" \
      --arg vendorImportmap "${GVIMPORT:-}" --arg vendorServed "${GVSERVED:-}" \
      --arg sgRc "${SG_RC:-}" --arg modules "${GEN_N:-}" --arg logf "$LOGF" \
      '{run:$idx,status:$status,gate:$gate,
        containerPeakMiB:($peak|if .=="" then null else tonumber end),
        residentFloorMiB:($floor|if .=="" then null else tonumber end),
        wallSec:($wall|if .=="" then null else tonumber end),
        previewRootStatus:($rootStatus|if .=="" then null else tonumber end),
        hasImportmap:($importmap|if .=="" then null else (.=="1") end),
        vendorActive:($vendorImportmap|if .=="" then null else (.=="1") end),
        vendorServedStatus:($vendorServed|if .=="" then null else tonumber end),
        specGenerateRc:($sgRc|if .=="" then null else tonumber end),
        modulesGenerated:($modules|if .=="" then null else tonumber end),
        log:$logf}')
  done
  runs_json+="]"

  local med_peak med_floor med_wall
  if [ "${#peaks[@]}" -eq 0 ]; then med_peak=null; med_wall=null; else med_peak=$(median "${peaks[@]}"); med_wall=$(median "${walls[@]}"); fi
  if [ "${#floors[@]}" -eq 0 ]; then med_floor=null; else med_floor=$(median "${floors[@]}"); fi

  ARM_NAMES+=("$arm"); ARM_IMAGE+=("$image")
  ARM_MED_PEAK+=("$med_peak"); ARM_MED_FLOOR+=("$med_floor"); ARM_MED_WALL+=("$med_wall")
  ARM_GATE+=("$arm_gate_pass"); ARM_RUNS_JSON+=("$runs_json")
}

for arm in $ARMS; do run_arm "$arm"; done
free_fixed_ports

# --- emit JSON (+ delta vs 'none') -------------------------------------------
# Find none's median for the delta column.
NONE_PEAK="null"
for n in "${!ARM_NAMES[@]}"; do [ "${ARM_NAMES[$n]}" = "none" ] && NONE_PEAK="${ARM_MED_PEAK[$n]}"; done

ARMS_JSON="["
for n in "${!ARM_NAMES[@]}"; do
  [ "$n" -gt 0 ] && ARMS_JSON+=","
  DELTA="null"
  if [ "$NONE_PEAK" != "null" ] && [ "${ARM_MED_PEAK[$n]}" != "null" ]; then
    DELTA=$(python3 -c "print(round(${ARM_MED_PEAK[$n]} - ${NONE_PEAK}, 1))")
  fi
  ARMS_JSON+=$(jq -nc \
    --arg arm "${ARM_NAMES[$n]}" --arg image "${ARM_IMAGE[$n]}" \
    --argjson medPeak "${ARM_MED_PEAK[$n]}" --argjson medFloor "${ARM_MED_FLOOR[$n]}" \
    --argjson medWall "${ARM_MED_WALL[$n]}" --argjson gatePass "${ARM_GATE[$n]}" \
    --argjson delta "${DELTA}" --argjson perRun "${ARM_RUNS_JSON[$n]}" \
    '{arm:$arm,image:$image,
      medianContainerPeakMiB:$medPeak,
      deltaVsNoneMiB:$delta,
      medianResidentFloorMiB:$medFloor,
      medianWallSec:$medWall,
      gatePass:$gatePass,
      perRun:$perRun}')
done
ARMS_JSON+="]"

jq -n \
  --arg label "concurrent-matrix" \
  --arg fixture "$FIXTURE" --arg project "$PROJECT" --arg mem "$MEM_LIMIT" \
  --argjson runs "$RUNS" --argjson settle "$SETTLE_SEC" \
  --argjson burstProxy "$BURST_PROXY_PORT" --argjson arms "$ARMS_JSON" \
  '{label:$label,
    topology:"reactor-project-start resident + spec-generate burst, whole-container cgroup memory.peak",
    fixture:$fixture, project:$project, memLimit:$mem,
    runsPerArm:$runs, settleSec:$settle, burstProxyPort:$burstProxy,
    arms:$arms}' | tee "$OUT_JSON"

log ""
log "==> JSON written to $OUT_JSON"
log ""
log "Building the warm vendor cache once (for connect-on / both arms):"
log "  Run reactor-project-start with VETRA_CONNECT_EXTERNALIZE_VENDOR=1 against a"
log "  connect-live image, let the importmap show /__vendor__/ entries, then copy"
log "  the persisted <node_modules>/.ph-vendor out to \$VENDOR_CACHE (default"
log "  /tmp/concurrent-vendor-cache). The renameSync lands .ph-vendor as a real dir"
log "  on the node_modules mount, so harvest it from there."
