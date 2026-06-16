#!/usr/bin/env bash
# Measurement harness for the Connect `externalize-vendor` lever of the vetra-cli
# memory-optimization workflow (CODEGEN-MEMORY-PLAN.md §9). Measures the
# `reactor-project-start` Vite/Connect dev server's cgroup memory.peak at steady
# state, A/B'd across the PH_CONNECT_EXTERNALIZE_VENDOR env toggle.
#
# Lever: builder-tools' devReactImportmapPlugin reads PH_CONNECT_EXTERNALIZE_VENDOR
# at module scope; when set, Connect's heavy stable deps (design-system,
# reactor-browser, document-engineering, …) are served from a prebuilt static
# vendor bundle (node_modules/.ph-vendor) instead of being held in the long-lived
# dev server's dep optimizer / module graph (~1 GB / ~50% off that server).
# vetra-cli wires the toggle through the reactor-project service env via a
# vetra-cli-level signal (VETRA_CONNECT_EXTERNALIZE_VENDOR=1); see
# src/helpers/connect-vendor.ts.
#
# Method (mirrors measure-codegen.sh)
#   - One fresh `docker run` per measured run. cgroup v2 memory.peak is a
#     monotonic high-water mark that is not resettable, so a fresh container per
#     run is the only way to read a clean peak.
#   - Run THROUGH the image entrypoint (/usr/local/bin/vetra-run.sh via
#     SERVICE_COMMAND), never by overriding it (the entrypoint sets NODE_PATH the
#     in-process tooling needs).
#   - A fresh project copy per run (pristine source) so each arm starts from a
#     known state. node_modules is staged ONCE into a WRITABLE dir and mounted RW
#     at a SEPARATE top-level path (/nm) with a symlink <project>/node_modules ->
#     /nm inside the run dir — NOT nested under the /work mount. (A nested bind
#     mount is intermittently invisible to the container on macOS virtiofs; the
#     separate mount + symlink is visible deterministically. See measure-codegen.sh.)
#     It must be WRITABLE: unlike codegen, reactor-project-start runs `ph vetra`,
#     whose pnpm deps-status check reconciles the modules dir on boot (a read-only
#     mount fails EROFS). The vendor cache (.ph-vendor) lives under node_modules
#     but is redirected to a SEPARATE writable mount (/nm-vendor) so each arm can
#     pre-fill (on-warm) or clear (on-cold) it independently of the shared stage.
#
# Arms (A/B the toggle)
#   off       env unset            — baseline; heavy libs dep-optimized (resident).
#   on-warm   env set, .ph-vendor pre-built — steady-state win, no cold build cost.
#   on-cold   env set, .ph-vendor absent     — first-run vendor-build subprocess peak.
#
# Correctness gate (functional, not byte-identical): the Connect preview must
# render/respond identically ON vs OFF. Encoded as:
#   - HTTP 200 on the preview root + key routes.
#   - The served index HTML contains an <script type="importmap"> block.
#   - NO failure signature in BOTH the start command's stdout (start.out) AND
#     every dev-server service .log: the false-fallback warning
#     ("PH_CONNECT_EXTERNALIZE_VENDOR set but vendor prebuild failed"), a missing
#     named export ("no named export"), or a vendor/shim 404. (The warning can
#     land in either stream depending on how `ph vetra` wires the dev server's
#     console, so the driver dumps both into the container log the host greps.)
#   - POSITIVE ON gate: for an ON arm the served import map MUST name a
#     /__vendor__/ entry AND that URL must serve 200. A silently-inert ON arm
#     (env never reached the dev server, or the prebuild failed without printing
#     the fallback warning) loads the SAME graph as OFF and would report a false
#     win; this gate REJECTS it. A failing arm is REJECTED, not recorded (this is
#     what catches the stale-cache / false-fallback / inert-toggle bug class).
#
# Env knobs
#   IMAGE        measured image (default dev.23 prod image)
#   FIXTURE      reactor project to measure (default vetra-test/todo-list)
#   PROJECT      project sub-dir name (default basename FIXTURE)
#   ARMS         space-separated arms to run (default "off on-warm on-cold")
#   MEM_LIMIT    docker --memory (default 6g — the dev server is heavier than codegen)
#   RUNS         measured runs per arm, median reported (default 3)
#   SETTLE_SEC   seconds to let Vite's dep optimizer settle after driving routes (default 25)
#   CONNECT_PORT in-container Connect/Vite port (default 3000)
#   VENDOR_EXTRA passthrough PH_CONNECT_VENDOR_EXTRA (comma-separated, optional)
#   WORK_BASE    scratch dir (default /tmp/reactor-start-measure)
#   OUT_JSON     JSON result path (default $WORK_BASE/reactor-start.json)
#
# Output: human log to stderr, machine JSON to OUT_JSON (and echoed to stdout).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/measure-lib.sh"

IMAGE="${IMAGE:-cr.vetra.io/powerhouse-inc-powerhouse/clint-agent/vetra-cli:0.0.1-dev.23}"
FIXTURE="${FIXTURE:-/Users/acaldas/dev/powerhouse/vetra/vetra-test/todo-list}"
PROJECT="${PROJECT:-$(basename "$FIXTURE")}"
ARMS="${ARMS:-off on-warm on-cold}"
MEM_LIMIT="${MEM_LIMIT:-6g}"
RUNS="${RUNS:-3}"
SETTLE_SEC="${SETTLE_SEC:-25}"
CONNECT_PORT="${CONNECT_PORT:-3000}"
VENDOR_EXTRA="${VENDOR_EXTRA:-}"
WORK_BASE="${WORK_BASE:-/tmp/reactor-start-measure}"
OUT_JSON="${OUT_JSON:-$WORK_BASE/reactor-start.json}"

TEMPLATE="$WORK_BASE/template"
NODE_MODULES="$FIXTURE/node_modules"

# --- preconditions -----------------------------------------------------------
require_tools rsync curl
[ -f "$FIXTURE/powerhouse.config.json" ] || { log "ERROR: $FIXTURE is not a reactor project (no powerhouse.config.json)"; exit 1; }
[ -d "$NODE_MODULES" ] || { log "ERROR: fixture has no node_modules ($NODE_MODULES). Run an install in the fixture first."; exit 1; }
require_image "$IMAGE"

NM_RW="$WORK_BASE/nm-rw"

# --- one-time template + writable node_modules staging (NOT measured) --------
log "==> Building pristine template (source only, node_modules staged separately)"
rm -rf "$WORK_BASE"
mkdir -p "$TEMPLATE"
rsync -a \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'dist' \
  --exclude 'tsconfig.tsbuildinfo' \
  "$FIXTURE"/ "$TEMPLATE"/

# node_modules must be WRITABLE for reactor-project-start: `ph vetra` runs a pnpm
# deps-status check on boot that reconciles the modules dir in place (a read-only
# mount fails with EROFS: read-only file system, unlink .modules.yaml). It is
# staged ONCE into a shared writable dir (not per-run — the reconcile is
# idempotent, so runs share it) mounted RW. Still a SEPARATE top-level mount
# (/nm) symlinked in as <project>/node_modules — never nested under the /work
# mount — to dodge the macOS virtiofs nested-bind-mount race (see measure-codegen.sh).
# NOTE: a host-installed (macOS) node_modules can be platform-mismatched, forcing
# a full reinstall on first boot; for a clean measurement install the fixture
# inside a matching linux container first (see "Running the full A/B" below).
log "==> Staging writable node_modules ($(du -sh "$NODE_MODULES" 2>/dev/null | awk '{print $1}')) — one-time copy"
mkdir -p "$NM_RW"
rsync -a "$NODE_MODULES"/ "$NM_RW"/
log "    template: $(du -sh "$TEMPLATE" 2>/dev/null | awk '{print $1}'), node_modules (rw stage): $(du -sh "$NM_RW" 2>/dev/null | awk '{print $1}')"

# The in-container driver, written once and bind-mounted in. argv: PROJECT,
# CONNECT_PORT, SETTLE_SEC. Boots reactor-project-start, captures the Vite studio
# URL, reads the startup high-water, drives the preview to steady state, reads
# the steady-state peak, then runs the correctness checks — echoing markers the
# host parses. Kept as a file (not an inline -c) so the quoting stays sane.
DRIVER="$WORK_BASE/driver.sh"
cat > "$DRIVER" <<'DRIVER_EOF'
#!/bin/sh
set -u
PROJECT="$1"; PORT="$2"; SETTLE="$3"
PEAK() { cat /sys/fs/cgroup/memory.peak 2>/dev/null || echo 0; }
SVC_LOG_DIR="$HOME/.ph/vetra/services/reactor-project"

# Read the studio URL straight from the service log. The start command's own
# stdout is unreliable: its synchronous readiness wait can return a transient
# failure (the service then auto-restarts and comes up moments later), so the
# Vite `Local:` line in the detached service log — not the start stdout — is the
# source of truth for readiness and for the studio URL (incl. its --base path,
# which varies by image, e.g. /reactor-project/vetra-studio/).
studio_url_from_log() {
  local f; f="$(ls -t "$SVC_LOG_DIR"/*.log 2>/dev/null | head -1)"
  [ -z "$f" ] && return 0
  # Vite colorizes the readiness line and embeds ANSI escapes INSIDE the URL
  # (around the port), so strip all ANSI first, THEN match the `Local:` URL.
  sed -E 's/\x1b\[[0-9;]*m//g' "$f" \
    | grep -oE 'Local:[[:space:]]*http://(localhost|127\.0\.0\.1):[0-9]+[^[:space:]]*' \
    | tail -1 | sed -E 's/^Local:[[:space:]]*//'
}

echo "DRIVER: starting reactor-project-start (project=$PROJECT port=$PORT)"
# The CLI --workdir is /work; the project lives in the sub-dir $PROJECT, passed
# as the command's own --workdir (resolved relative to the CLI workdir). Flags
# are the camelCase schema keys (--connectPort). --watch is omitted so the
# command's optional boolean defaults to false (file watcher off). Run in the
# background so we can read the cgroup peak / poll the log while it (and the
# detached dev server it spawns) run.
vetra --workdir /work reactor-project-start --workdir "$PROJECT" --connectPort "$PORT" > /tmp/start.out 2>&1 &
START_PID=$!

# Poll the service log until the dev server prints its Local: URL (readiness) or
# a deadline elapses. ph-clint's reactor-project readiness timeout is 90s and the
# service auto-restarts up to 3x, so allow generous headroom under qemu.
READY_DEADLINE=240
STUDIO_URL=""
t=0
while [ "$t" -lt "$READY_DEADLINE" ]; do
  STUDIO_URL="$(studio_url_from_log)"
  [ -n "$STUDIO_URL" ] && break
  sleep 2
  t=$((t + 2))
done
cat /tmp/start.out 2>/dev/null || true

# Startup high-water: read once readiness is reached (or the deadline elapsed),
# so a cold vendor-build subprocess peak (ON-cold) is captured even though that
# subprocess has already exited.
echo "STARTUP_PEAK_BYTES=$(PEAK)"
echo "STUDIO_URL=${STUDIO_URL:-<none>}"

if [ -z "$STUDIO_URL" ]; then
  echo "DRIVER: no studio URL after ${READY_DEADLINE}s — reactor-project-start did not become ready"
  echo "GATE_READY=0"
  echo "PEAK_BYTES=$(PEAK)"
  LOGF="$(ls -t "$SVC_LOG_DIR"/*.log 2>/dev/null | head -1)"
  [ -n "$LOGF" ] && { echo "===SERVICE_LOG_BEGIN==="; cat "$LOGF"; echo "===SERVICE_LOG_END==="; }
  exit 0
fi
echo "GATE_READY=1"

# Normalize to a base ending in '/'. The path component carries the dev server's
# --base (e.g. /reactor-project/vetra-studio/), so derive PREFIX from it too.
case "$STUDIO_URL" in
  */) BASE="$STUDIO_URL" ;;
  *)  BASE="$STUDIO_URL/" ;;
esac
ORIGIN="$(printf '%s' "$BASE" | sed -E 's#^(http://[^/]+).*#\1#')"

# Drive the preview to steady state: the importmap HTML (root), then re-fetch a
# few times so Vite's dep optimizer discovers + pre-bundles the module graph.
# Capture the root HTML once for the gate.
ROOT_HTML="$(curl -fsS --max-time 30 "$BASE" 2>/dev/null || true)"
GATE_ROOT_STATUS="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$BASE" 2>/dev/null || echo 000)"
echo "GATE_ROOT_STATUS=$GATE_ROOT_STATUS"
# Has an import map? (devReactImportmapPlugin rewrites it on every page load.)
if printf '%s' "$ROOT_HTML" | grep -q '<script type="importmap"'; then
  echo "GATE_IMPORTMAP=1"
else
  echo "GATE_IMPORTMAP=0"
fi

# Vendor-active signal (the positive ON gate). devReactImportmapPlugin only adds
# vendor entries to the import map — bare specifier -> "<base>/__vendor__/<entry>.js"
# (VENDOR_URL_PREFIX) — when the prebuild SUCCEEDED. On a silent fallback (the
# prebuild failed, OR the env never reached the dev server) the import map carries
# ONLY the React-shim entries (__ph/dev-react-shim/) and NO __vendor__ entry. So an
# ON arm whose served HTML has no __vendor__ import-map entry behaved like OFF — a
# false win. Detect it and (host-side) REJECT the ON arm. Also fetch one vendor
# entry to confirm the bundle is actually served (the import map could name a URL
# the middleware 404s).
VENDOR_HTML_HIT="$(printf '%s' "$ROOT_HTML" | grep -oE '"[^"]*/__vendor__/[^"]+\.js"' | head -1 | sed -E 's/^"//; s/"$//')"
if [ -n "$VENDOR_HTML_HIT" ]; then
  echo "GATE_VENDOR_IMPORTMAP=1"
  case "$VENDOR_HTML_HIT" in
    http*) vurl="$VENDOR_HTML_HIT" ;;
    /*)    vurl="$ORIGIN$VENDOR_HTML_HIT" ;;
    *)     vurl="$BASE$VENDOR_HTML_HIT" ;;
  esac
  VCODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$vurl" 2>/dev/null || echo 000)"
  echo "GATE_VENDOR_SERVED=$VCODE $vurl"
else
  echo "GATE_VENDOR_IMPORTMAP=0"
  echo "GATE_VENDOR_SERVED=000 <none>"
fi

# Pull the entry module(s) referenced by the HTML to force the optimizer to run
# over the real graph, plus the Vite client. Best-effort; statuses recorded.
ENTRIES="$(printf '%s' "$ROOT_HTML" | grep -oE 'src="[^"]+\.[mc]?[jt]sx?"' | sed -E 's/^src="//; s/"$//' | head -5)"
GATE_ENTRY_BAD=0
for rel in $ENTRIES; do
  case "$rel" in
    http*) url="$rel" ;;
    /*)    url="$ORIGIN$rel" ;;
    *)     url="$BASE$rel" ;;
  esac
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$url" 2>/dev/null || echo 000)"
  echo "ENTRY $code $url"
  case "$code" in 200|304) ;; *) GATE_ENTRY_BAD=1 ;; esac
done
echo "GATE_ENTRY_BAD=$GATE_ENTRY_BAD"

# Re-poll the root a few times across the settle window so the optimizer reaches
# steady state before the peak read.
echo "DRIVER: settling ${SETTLE}s"
i=0
while [ "$i" -lt "$SETTLE" ]; do
  curl -s -o /dev/null --max-time 10 "$BASE" 2>/dev/null || true
  sleep 1
  i=$((i + 1))
done

# Steady-state peak (overall cgroup high-water).
echo "PEAK_BYTES=$(PEAK)"
echo "MAX_BYTES=$(cat /sys/fs/cgroup/memory.max 2>/dev/null || echo 0)"

# Surface BOTH logs so the host gate can scan them for failure signatures. The
# vendor-prebuild fallback warning ("PH_CONNECT_EXTERNALIZE_VENDOR set but vendor
# prebuild failed") can land in EITHER stream depending on how `ph vetra` wires
# the dev server's console: the reactor-project-start command's own stdout
# (start.out) OR the detached dev-server service .log. Earlier this driver only
# dumped the service .log, so a fallback warning printed to start.out slipped the
# gate. Re-cat start.out at the END too (it's a redirect file, so this captures a
# warning printed after the readiness snapshot). The host greps the whole
# container log (both blocks) for the fallback / no-named-export / __vendor__ 404
# signatures.
echo "===START_OUT_BEGIN==="
cat /tmp/start.out 2>/dev/null || true
echo "===START_OUT_END==="
# Scan EVERY service .log (not just the newest): an auto-restart rotates the
# log, and the early vendor-prebuild warning lives in the FIRST instance's log.
for LOGF in $(ls -t "$SVC_LOG_DIR"/*.log 2>/dev/null); do
  echo "===SERVICE_LOG_BEGIN $LOGF==="
  cat "$LOGF"
  echo "===SERVICE_LOG_END==="
done
DRIVER_EOF
chmod +x "$DRIVER"

# --- per-arm env -------------------------------------------------------------
# Echo the docker `-e` args for an arm (off vs on-*). ON arms set both the
# vetra-cli signal and (for visibility) the framework-native var.
arm_env_args() {
  case "$1" in
    off) : ;;
    on-warm|on-cold)
      printf -- '-e VETRA_CONNECT_EXTERNALIZE_VENDOR=1 '
      [ -n "$VENDOR_EXTRA" ] && printf -- '-e PH_CONNECT_VENDOR_EXTRA=%s ' "$VENDOR_EXTRA"
      ;;
  esac
}

# --- measured runs -----------------------------------------------------------
declare -a ARM_NAMES=() ARM_MED_PEAK=() ARM_MED_STARTUP=() ARM_MED_WALL=() ARM_GATE=() ARM_RUNS_JSON=()

reject_run() { log "    !! ${1} run ${2} REJECTED: ${3}"; log "       (full container log: ${4})"; }

run_arm() {
  local arm="$1"
  local -a peaks=() startups=() walls=()
  local runs_json="["
  local arm_gate_pass="true"

  for i in $(seq 0 $(( RUNS - 1 )) ); do
    local RUN="$WORK_BASE/$arm/run-$i"
    local LOGF="$WORK_BASE/$arm/run-$i.log"
    local VENDOR_DIR="$WORK_BASE/$arm/vendor-$i"   # per-run writable .ph-vendor (arm-controlled)
    rm -rf "$RUN" "$VENDOR_DIR"; mkdir -p "$RUN" "$VENDOR_DIR"
    rsync -a "$TEMPLATE"/ "$RUN/$PROJECT"/
    # node_modules: the shared writable stage (/nm, RW). The vendor cache lives
    # under node_modules but is mounted SEPARATELY (/nm-vendor) so each arm can
    # pre-fill (on-warm) or clear (on-cold) it without disturbing the shared
    # node_modules. The project's node_modules symlinks to the /nm mount; the
    # stage's .ph-vendor symlinks to the /nm-vendor mount (recreated each run so
    # the vendor cache is the per-run mount, not stale stage contents).
    ln -s /nm "$RUN/$PROJECT/node_modules"
    rm -rf "$NM_RW/.ph-vendor"
    ln -s /nm-vendor "$NM_RW/.ph-vendor"

    # on-warm wants a pre-built vendor cache; on-cold wants it absent. The full
    # A/B requires a real prebuilt .ph-vendor (see "Running the full A/B" below);
    # a missing cache in on-warm degrades it to a first-run build (logged).
    case "$arm" in
      on-warm)
        if [ -n "${VENDOR_CACHE:-}" ] && [ -d "$VENDOR_CACHE" ]; then
          rsync -a "$VENDOR_CACHE"/ "$VENDOR_DIR"/
        else
          log "    note: on-warm has no VENDOR_CACHE prebuilt — this run measures a cold build, not the warm steady state"
        fi
        ;;
      on-cold) : ;;  # leave $VENDOR_DIR empty
    esac

    log "==> arm=$arm  run $(( i + 1 ))/$RUNS  (mem=$MEM_LIMIT, settle=${SETTLE_SEC}s)"
    local CNAME="reactor-start-measure-$$-$arm-$i"
    docker rm -f "$CNAME" >/dev/null 2>&1 || true

    local SERVICE_CMD="sh /driver.sh ${PROJECT} ${CONNECT_PORT} ${SETTLE_SEC}"
    local START END WALL
    START=$(now_s)
    set +e
    # shellcheck disable=SC2046
    docker run --rm --memory "$MEM_LIMIT" --name "$CNAME" \
      -v "$RUN":/work \
      -v "$NM_RW":/nm \
      -v "$VENDOR_DIR":/nm-vendor \
      -v "$DRIVER":/driver.sh:ro \
      -e CI=true \
      $(arm_env_args "$arm") \
      -e SERVICE_COMMAND="$SERVICE_CMD" \
      "$IMAGE" >"$LOGF" 2>&1
    local DOCKER_RC=$?
    set -e
    END=$(now_s)
    WALL=$(wall_sec "$START" "$END")

    local PEAK_BYTES STARTUP_BYTES READY GROOT GIMPORT GENTRYBAD GVIMPORT GVSERVED
    PEAK_BYTES=$(last_marker_int "$LOGF" "PEAK_BYTES")
    STARTUP_BYTES=$(last_marker_int "$LOGF" "STARTUP_PEAK_BYTES")
    READY=$(last_marker_int "$LOGF" "GATE_READY")
    GROOT=$(grep -oE 'GATE_ROOT_STATUS=[0-9]+' "$LOGF" | tail -1 | cut -d= -f2 || true)
    GIMPORT=$(last_marker_int "$LOGF" "GATE_IMPORTMAP")
    GENTRYBAD=$(last_marker_int "$LOGF" "GATE_ENTRY_BAD")
    # Vendor-active markers (the positive ON gate): the served import map names a
    # /__vendor__/ entry (GVIMPORT=1) AND that URL serves 200 (GVSERVED).
    GVIMPORT=$(last_marker_int "$LOGF" "GATE_VENDOR_IMPORTMAP")
    GVSERVED=$(grep -oE 'GATE_VENDOR_SERVED=[0-9]+' "$LOGF" | tail -1 | cut -d= -f2 || true)

    # --- correctness gate + sanity --------------------------------------------
    local status="ok" gate="pass"
    if [ "$DOCKER_RC" -ne 0 ]; then
      status="rejected: docker run exited $DOCKER_RC (likely OOM at mem=$MEM_LIMIT)"; gate="fail"
      reject_run "$arm" "$(( i + 1 ))" "docker run exited $DOCKER_RC" "$LOGF"
    elif [ -z "$PEAK_BYTES" ] || [ "${PEAK_BYTES:-0}" = "0" ]; then
      status="rejected: no PEAK_BYTES (cgroup read / boot failed)"; gate="fail"
      reject_run "$arm" "$(( i + 1 ))" "no PEAK_BYTES" "$LOGF"
    elif [ "${READY:-0}" != "1" ]; then
      status="rejected: reactor-project-start never became ready (no studio URL)"; gate="fail"
      reject_run "$arm" "$(( i + 1 ))" "service not ready" "$LOGF"
    elif [ "${GROOT:-000}" != "200" ]; then
      status="rejected: preview root HTTP ${GROOT:-000} (expected 200)"; gate="fail"
      reject_run "$arm" "$(( i + 1 ))" "preview root status ${GROOT:-000}" "$LOGF"
    elif [ "${GIMPORT:-0}" != "1" ]; then
      status="rejected: served HTML had no <script type=importmap> (devReactImportmapPlugin inactive)"; gate="fail"
      reject_run "$arm" "$(( i + 1 ))" "no importmap in HTML" "$LOGF"
    elif [ "${GENTRYBAD:-0}" != "0" ]; then
      status="rejected: an entry module returned non-200/304"; gate="fail"
      reject_run "$arm" "$(( i + 1 ))" "entry module bad status" "$LOGF"
    elif grep -qiE 'PH_CONNECT_EXTERNALIZE_VENDOR set but vendor prebuild failed' "$LOGF"; then
      # False-fallback: the toggle was armed but the vendor build silently failed
      # and the server fell back to dep-optimizing — the "win" would be a lie.
      status="rejected: vendor prebuild failed + fell back (false ON measurement)"; gate="fail"
      reject_run "$arm" "$(( i + 1 ))" "vendor prebuild fell back" "$LOGF"
    elif grep -qiE 'no named export|does not provide an export named|SyntaxError: The requested module' "$LOGF"; then
      status="rejected: React/named-export error in dev-server log"; gate="fail"
      reject_run "$arm" "$(( i + 1 ))" "named-export error" "$LOGF"
    elif grep -qE 'ENTRY (404|500) .*(__vendor__|dev-react-shim)' "$LOGF"; then
      status="rejected: vendor/shim URL 404/500 (import map points at missing module)"; gate="fail"
      reject_run "$arm" "$(( i + 1 ))" "vendor/shim 404" "$LOGF"
    fi

    # Positive ON gate: an ON arm MUST genuinely externalize the vendor. The
    # import map has to name a /__vendor__/ entry AND that URL must serve 200.
    # Without this a silently-inert ON arm (env never reached the dev server, or
    # the prebuild failed without emitting the fallback warning) measures the
    # SAME graph as OFF and reports a false win. This is the hard-fail the
    # deliberately-broken-build test must trip. (OFF arms have no vendor by
    # design, so they're exempt.)
    if [ "$status" = "ok" ]; then
      case "$arm" in
        on-warm|on-cold)
          if [ "${GVIMPORT:-0}" != "1" ]; then
            status="rejected: ON arm but import map has no /__vendor__/ entry (vendor inert — would be a false win)"; gate="fail"
            reject_run "$arm" "$(( i + 1 ))" "vendor not in import map (inert ON)" "$LOGF"
          elif [ "${GVSERVED:-000}" != "200" ]; then
            status="rejected: ON arm vendor URL served ${GVSERVED:-000} (expected 200 — bundle not actually served)"; gate="fail"
            reject_run "$arm" "$(( i + 1 ))" "vendor URL not served (status ${GVSERVED:-000})" "$LOGF"
          fi
          ;;
      esac
    fi

    local peak_mib="" startup_mib=""
    if [ "$status" = "ok" ]; then
      peak_mib=$(bytes_to_mib "$PEAK_BYTES")
      [ -n "$STARTUP_BYTES" ] && [ "$STARTUP_BYTES" != "0" ] && startup_mib=$(bytes_to_mib "$STARTUP_BYTES")
      peaks+=("$peak_mib"); walls+=("$WALL")
      [ -n "$startup_mib" ] && startups+=("$startup_mib")
      log "    ok: peak=${peak_mib} MiB  startup=${startup_mib:-?} MiB  wall=${WALL}s"
    else
      arm_gate_pass="false"
    fi

    [ "$i" -gt 0 ] && runs_json+=","
    runs_json+=$(jq -nc \
      --argjson idx "$(( i + 1 ))" \
      --arg status "$status" \
      --arg gate "$gate" \
      --arg peak "${peak_mib}" \
      --arg startup "${startup_mib}" \
      --arg wall "${WALL}" \
      --arg rootStatus "${GROOT:-}" \
      --arg importmap "${GIMPORT:-}" \
      --arg vendorImportmap "${GVIMPORT:-}" \
      --arg vendorServed "${GVSERVED:-}" \
      --arg logf "$LOGF" \
      '{run:$idx,status:$status,gate:$gate,
        peakMiB:($peak|if .=="" then null else tonumber end),
        startupPeakMiB:($startup|if .=="" then null else tonumber end),
        wallSec:($wall|if .=="" then null else tonumber end),
        previewRootStatus:($rootStatus|if .=="" then null else tonumber end),
        hasImportmap:($importmap|if .=="" then null else (.=="1") end),
        vendorActive:($vendorImportmap|if .=="" then null else (.=="1") end),
        vendorServedStatus:($vendorServed|if .=="" then null else tonumber end),
        log:$logf}')
  done
  runs_json+="]"

  local med_peak med_startup med_wall
  if [ "${#peaks[@]}" -eq 0 ]; then med_peak=null; med_wall=null; else med_peak=$(median "${peaks[@]}"); med_wall=$(median "${walls[@]}"); fi
  if [ "${#startups[@]}" -eq 0 ]; then med_startup=null; else med_startup=$(median "${startups[@]}"); fi

  ARM_NAMES+=("$arm")
  ARM_MED_PEAK+=("$med_peak")
  ARM_MED_STARTUP+=("$med_startup")
  ARM_MED_WALL+=("$med_wall")
  ARM_GATE+=("$arm_gate_pass")
  ARM_RUNS_JSON+=("$runs_json")
}

for arm in $ARMS; do
  case "$arm" in off|on-warm|on-cold) run_arm "$arm" ;; *) log "WARN: unknown arm '$arm' (skipping)";; esac
done

# --- emit JSON ---------------------------------------------------------------
ARMS_JSON="["
for n in "${!ARM_NAMES[@]}"; do
  [ "$n" -gt 0 ] && ARMS_JSON+=","
  ARMS_JSON+=$(jq -nc \
    --arg arm "${ARM_NAMES[$n]}" \
    --argjson medPeak "${ARM_MED_PEAK[$n]}" \
    --argjson medStartup "${ARM_MED_STARTUP[$n]}" \
    --argjson medWall "${ARM_MED_WALL[$n]}" \
    --argjson gatePass "${ARM_GATE[$n]}" \
    --argjson perRun "${ARM_RUNS_JSON[$n]}" \
    '{arm:$arm,
      medianPeakMiB:$medPeak,
      startupPeakMiB:$medStartup,
      medianWallSec:$medWall,
      gatePass:$gatePass,
      perRun:$perRun}')
done
ARMS_JSON+="]"

jq -n \
  --arg label "C-vendor" \
  --arg image "$IMAGE" \
  --arg fixture "$FIXTURE" \
  --arg project "$PROJECT" \
  --arg mem "$MEM_LIMIT" \
  --argjson runs "$RUNS" \
  --argjson settle "$SETTLE_SEC" \
  --arg toggle "VETRA_CONNECT_EXTERNALIZE_VENDOR=1 -> PH_CONNECT_EXTERNALIZE_VENDOR=1" \
  --argjson arms "$ARMS_JSON" \
  '{label:$label,
    lever:"connect-externalize-vendor",
    image:$image, fixture:$fixture, project:$project,
    memLimit:$mem, runsPerArm:$runs, settleSec:$settle,
    toggle:$toggle,
    arms:$arms}' | tee "$OUT_JSON"

log ""
log "==> JSON written to $OUT_JSON"
log ""
log "Running the full ON/OFF A/B (this harness shows a win only once the branch is live):"
log "  0. node_modules must MATCH the image platform (linux/amd64). A host-installed"
log "     (macOS) fixture forces a full pnpm reinstall on first boot (ph vetra's"
log "     deps-status check). For clean numbers, install the fixture inside a matching"
log "     linux container once, then point FIXTURE at that tree. (The harness already"
log "     stages a WRITABLE copy of node_modules: ph vetra mutates it on boot — a"
log "     read-only mount fails EROFS.)"
log "  1. Build + link the monorepo branch perf/connect-externalize-vendor into the IMAGE"
log "     (builder-tools' devReactImportmapPlugin must be the one ph vetra loads). Until"
log "     then ON behaves like OFF (no vendor bundle), so ON vs OFF peaks match — the"
log "     dev.23 baseline image has no vendor support, so only the off arm is meaningful."
log "  2. Prebuild the vendor cache once for the on-warm arm and point VENDOR_CACHE at it:"
log "       VETRA_CONNECT_EXTERNALIZE_VENDOR=1 vetra --workdir <proj> reactor-project-start ...  # builds node_modules/.ph-vendor"
log "       then: VENDOR_CACHE=<proj>/node_modules/.ph-vendor ARMS='off on-warm on-cold' $0"
log "  3. on-cold needs no cache (it measures the first-run vendor-build subprocess peak)."
