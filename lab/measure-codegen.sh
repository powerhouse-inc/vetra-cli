#!/usr/bin/env bash
# Phase-0 measurement harness for the spec-generate codegen-memory plan
# (vetra-cli/CODEGEN-MEMORY-PLAN.md §5). Measures the spec-generate codegen
# burst in isolation: cgroup memory.peak, wall time, and a sha256 of the
# regenerated gen/ tree (the correctness oracle).
#
# Method
#   - One fresh `docker run` per measured run. cgroup v2 memory.peak is a
#     monotonic high-water mark that is not resettable, so a fresh container
#     per run is the only way to read a clean peak.
#   - Run THROUGH the image entrypoint (/usr/local/bin/vetra-run.sh via
#     SERVICE_COMMAND), never by overriding it: the entrypoint sets NODE_PATH
#     so the graphql-codegen Zod validation-schema plugin resolves. Overriding
#     the entrypoint leaves NODE_PATH unset, codegen errors early, and the peak
#     is under-measured.
#   - A fresh project copy per run (pristine source, gen/ deleted) so the gen/
#     tree hash is comparable run-to-run. node_modules is a constant input,
#     bind-mounted read-only from the fixture (it is never written by codegen;
#     it only supplies the project's tsc/eslint binaries for runChecks).
#     node_modules is mounted at a SEPARATE top-level path (/nm) with a symlink
#     <project>/node_modules -> /nm inside the run dir — NOT nested under the
#     /work mount. A nested bind mount (node_modules under the run-dir mount) is
#     intermittently invisible to the container on macOS virtiofs, which makes
#     runChecks silently skip tsc/eslint ("tsc not found") and under-measures the
#     peak by ~3x. The separate mount + symlink is visible deterministically.
#
# Env knobs
#   IMAGE       measured image (default dev.23 prod image)
#   FIXTURE     reactor project to measure (default vetra-test/todo-list)
#   PROJECT     project sub-dir name passed to --project (default basename FIXTURE)
#   MEM_LIMIT   docker --memory (default 4g)
#   RUNS        measured runs, median reported (default 3)
#   WORK_BASE   scratch dir (default /tmp/codegen-measure)
#   OUT_JSON    JSON result path (default $WORK_BASE/baseline.json)
#
# Output: human log to stderr, machine JSON to OUT_JSON (and echoed to stdout).
#
# Shared measurement core (log, median) is sourced from measure-lib.sh.
set -euo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/measure-lib.sh"

IMAGE="${IMAGE:-cr.vetra.io/powerhouse-inc-powerhouse/clint-agent/vetra-cli:0.0.1-dev.23}"
FIXTURE="${FIXTURE:-/Users/acaldas/dev/powerhouse/vetra/vetra-test/todo-list}"
PROJECT="${PROJECT:-$(basename "$FIXTURE")}"
MEM_LIMIT="${MEM_LIMIT:-4g}"
RUNS="${RUNS:-3}"
WORK_BASE="${WORK_BASE:-/tmp/codegen-measure}"
OUT_JSON="${OUT_JSON:-$WORK_BASE/baseline.json}"

TEMPLATE="$WORK_BASE/template"
NODE_MODULES="$FIXTURE/node_modules"

# --- preconditions -----------------------------------------------------------
command -v docker >/dev/null || { log "ERROR: docker not on PATH"; exit 1; }
command -v rsync  >/dev/null || { log "ERROR: rsync not on PATH"; exit 1; }
command -v jq     >/dev/null || { log "ERROR: jq not on PATH"; exit 1; }
command -v python3 >/dev/null || { log "ERROR: python3 not on PATH"; exit 1; }
[ -f "$FIXTURE/powerhouse.config.json" ] || { log "ERROR: $FIXTURE is not a reactor project (no powerhouse.config.json)"; exit 1; }
[ -d "$NODE_MODULES" ] || { log "ERROR: fixture has no node_modules ($NODE_MODULES) — runChecks (tsc/eslint) would be skipped and the peak under-measured. Run an install in the fixture first."; exit 1; }
docker image inspect "$IMAGE" >/dev/null 2>&1 || { log "ERROR: image not present locally: $IMAGE"; exit 1; }

if command -v sha256sum >/dev/null; then SHA() { sha256sum "$@"; }; else SHA() { shasum -a 256 "$@"; }; fi

# Order-independent digest of every file under any gen/ dir in a project tree.
# Hashes "relpath\0filehash" per file, sorted by relpath, then hashes the
# aggregate — stable regardless of filesystem walk order.
gen_tree_hash() {
  local root="$1"
  ( cd "$root" && \
    find . -type d -name gen -not -path './node_modules/*' -exec find {} -type f \; \
    | LC_ALL=C sort \
    | while IFS= read -r f; do
        printf '%s  %s\n' "$(SHA "$f" | awk '{print $1}')" "$f"
      done \
    | SHA - | awk '{print $1}' )
}

gen_file_count() {
  local root="$1"
  ( cd "$root" && find . -type d -name gen -not -path './node_modules/*' -exec find {} -type f \; | wc -l | tr -d ' ' )
}

# --- one-time template (NOT measured) ----------------------------------------
log "==> Building pristine template (source only, node_modules bind-mounted separately)"
rm -rf "$WORK_BASE"
mkdir -p "$TEMPLATE"
rsync -a \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'dist' \
  --exclude 'tsconfig.tsbuildinfo' \
  "$FIXTURE"/ "$TEMPLATE"/
log "    template: $(du -sh "$TEMPLATE" 2>/dev/null | awk '{print $1}'), node_modules (ro mount): $(du -sh "$NODE_MODULES" 2>/dev/null | awk '{print $1}')"

# The SERVICE_COMMAND: run codegen through the entrypoint, then print the cgroup
# peak as the last line (memory.peak is the high-water mark of this container's
# cgroup, captured after codegen exits — it never resets).
SERVICE_CMD="vetra --workdir /work spec-generate --project ${PROJECT}; rc=\$?; echo \"EXIT_RC=\$rc\"; echo \"PEAK_BYTES=\$(cat /sys/fs/cgroup/memory.peak)\"; echo \"MAX_BYTES=\$(cat /sys/fs/cgroup/memory.max)\""

# --- measured runs -----------------------------------------------------------
declare -a PEAKS_MIB=() WALLS=() HASHES=() STATUSES=() RUNDIRS=()
declare -a FILECOUNTS=() RCS=()

reject() { # run_idx reason logfile
  STATUSES[$1]="rejected: $2"
  log "    !! run $(( $1 + 1 )) REJECTED: $2"
  log "       (full container log: $3)"
}

for i in $(seq 0 $(( RUNS - 1 )) ); do
  RUN="$WORK_BASE/run-$i"
  LOGF="$WORK_BASE/run-$i.log"
  RUNDIRS[$i]="$RUN"
  rm -rf "$RUN"; mkdir -p "$RUN"
  rsync -a "$TEMPLATE"/ "$RUN/$PROJECT"/
  # Remove generated output so codegen regenerates from specs.
  find "$RUN/$PROJECT" -type d -name gen -not -path '*/node_modules/*' -exec rm -rf {} + 2>/dev/null || true
  # node_modules is supplied via a separate /nm mount; symlink it in (see header).
  ln -s /nm "$RUN/$PROJECT/node_modules"

  log "==> Run $(( i + 1 ))/$RUNS  (mem=$MEM_LIMIT)"
  CNAME="codegen-measure-$$-$i"
  docker rm -f "$CNAME" >/dev/null 2>&1 || true

  START=$(python3 -c 'import time;print(time.time())')
  set +e
  docker run --rm --memory "$MEM_LIMIT" --name "$CNAME" \
    -v "$RUN":/work \
    -v "$NODE_MODULES":/nm:ro \
    -e SERVICE_COMMAND="$SERVICE_CMD" \
    "$IMAGE" >"$LOGF" 2>&1
  DOCKER_RC=$?
  set -e
  END=$(python3 -c 'import time;print(time.time())')
  WALL=$(python3 -c "print(round($END - $START, 2))")
  WALLS[$i]="$WALL"

  PEAK_BYTES=$(grep -oE 'PEAK_BYTES=[0-9]+' "$LOGF" | tail -1 | cut -d= -f2 || true)
  EXIT_RC=$(grep -oE 'EXIT_RC=[0-9]+' "$LOGF" | tail -1 | cut -d= -f2 || true)
  RCS[$i]="${EXIT_RC:-?}"
  FC=$(gen_file_count "$RUN/$PROJECT")
  FILECOUNTS[$i]="$FC"

  # --- early-error gate: a run that errored early must NOT be recorded as a low
  #     baseline. Require: docker ran, vetra exit 0, codegen actually generated
  #     >=1 module, and no known failure signature in the log.
  if [ "$DOCKER_RC" -ne 0 ]; then
    reject "$i" "docker run exited $DOCKER_RC (likely OOM-killed at mem=$MEM_LIMIT)" "$LOGF"; continue
  fi
  if [ -z "$PEAK_BYTES" ]; then
    reject "$i" "no PEAK_BYTES in log (entrypoint/cgroup read failed)" "$LOGF"; continue
  fi
  if [ "${EXIT_RC:-1}" != "0" ]; then
    reject "$i" "vetra spec-generate exited ${EXIT_RC:-<none>}" "$LOGF"; continue
  fi
  if grep -qiE 'Cannot find module|Failed to load schema|from another module or realm|graphql-codegen-typescript-validation-schema.*(not found|cannot)|\(no specs to generate\)' "$LOGF"; then
    reject "$i" "codegen early-error signature found in log" "$LOGF"; continue
  fi
  GEN_LINE=$(grep -oE 'Generated [0-9]+ module\(s\)' "$LOGF" | tail -1 || true)
  GEN_N=$(printf '%s' "$GEN_LINE" | grep -oE '[0-9]+' | head -1 || true)
  if [ -z "$GEN_N" ] || [ "$GEN_N" -lt 1 ]; then
    reject "$i" "no 'Generated N module(s)' with N>=1 in log" "$LOGF"; continue
  fi
  if [ "$FC" -lt 1 ]; then
    reject "$i" "no gen/ files regenerated on disk" "$LOGF"; continue
  fi
  # runChecks must have actually run tsc+eslint. A "tsc/eslint not found" note
  # means node_modules wasn't visible — the check subprocesses (the dominant
  # peak term this plan targets) were skipped, so the peak is under-measured.
  # Such a run is invalid and must NOT be recorded as a low baseline.
  if grep -qiE 'tsc not found in project node_modules|eslint not found in project node_modules' "$LOGF"; then
    reject "$i" "runChecks skipped tsc/eslint (node_modules not visible) — peak under-measured" "$LOGF"; continue
  fi
  if ! grep -qE 'Generated-file checks:' "$LOGF"; then
    reject "$i" "no 'Generated-file checks:' line — tsc/eslint did not run" "$LOGF"; continue
  fi

  PEAK_MIB=$(python3 -c "print(round($PEAK_BYTES/1048576, 1))")
  HASH=$(gen_tree_hash "$RUN/$PROJECT")
  PEAKS_MIB[$i]="$PEAK_MIB"
  HASHES[$i]="$HASH"
  STATUSES[$i]="ok"
  log "    ok: peak=${PEAK_MIB} MiB  wall=${WALL}s  gen_files=${FC}  modules=${GEN_N}  genHash=${HASH:0:16}…"
done

# --- aggregate ---------------------------------------------------------------
OK_PEAKS=(); OK_WALLS=(); OK_HASHES=()
for i in $(seq 0 $(( RUNS - 1 )) ); do
  if [ "${STATUSES[$i]}" = "ok" ]; then
    OK_PEAKS+=("${PEAKS_MIB[$i]}")
    OK_WALLS+=("${WALLS[$i]}")
    OK_HASHES+=("${HASHES[$i]}")
  fi
done

if [ "${#OK_PEAKS[@]}" -eq 0 ]; then
  MED_PEAK=null; MED_WALL=null
else
  MED_PEAK=$(median "${OK_PEAKS[@]}")
  MED_WALL=$(median "${OK_WALLS[@]}")
fi

# determinismHolds: all OK runs produced byte-identical gen/ trees.
DET="false"; LOCKED_HASH=null
if [ "${#OK_HASHES[@]}" -ge 1 ]; then
  uniq_count=$(printf '%s\n' "${OK_HASHES[@]}" | sort -u | wc -l | tr -d ' ')
  if [ "$uniq_count" -eq 1 ]; then DET="true"; LOCKED_HASH="\"${OK_HASHES[0]}\""; fi
fi

# --- emit JSON ---------------------------------------------------------------
RUNS_JSON="["
for i in $(seq 0 $(( RUNS - 1 )) ); do
  [ "$i" -gt 0 ] && RUNS_JSON+=","
  RUNS_JSON+=$(jq -nc \
    --argjson idx "$(( i + 1 ))" \
    --arg status "${STATUSES[$i]:-unknown}" \
    --arg peak "${PEAKS_MIB[$i]:-}" \
    --arg wall "${WALLS[$i]:-}" \
    --arg rc "${RCS[$i]:-?}" \
    --arg fc "${FILECOUNTS[$i]:-}" \
    --arg hash "${HASHES[$i]:-}" \
    --arg logf "$WORK_BASE/run-$i.log" \
    '{run:$idx,status:$status,
      peakMiB:($peak|if .=="" then null else tonumber end),
      wallSec:($wall|if .=="" then null else tonumber end),
      vetraExitRc:$rc,
      genFileCount:($fc|if .=="" then null else tonumber end),
      genHash:($hash|if .=="" then null else . end),
      log:$logf}')
done
RUNS_JSON+="]"

jq -n \
  --arg image "$IMAGE" \
  --arg fixture "$FIXTURE" \
  --arg project "$PROJECT" \
  --arg mem "$MEM_LIMIT" \
  --argjson runs "$RUNS" \
  --arg invocation "vetra --workdir /work spec-generate --project ${PROJECT}" \
  --argjson medPeak "$MED_PEAK" \
  --argjson medWall "$MED_WALL" \
  --argjson det "$DET" \
  --argjson lockedHash "$LOCKED_HASH" \
  --argjson perRun "$RUNS_JSON" \
  '{label:"B0",
    image:$image, fixture:$fixture, project:$project,
    memLimit:$mem, runs:$runs,
    cliInvocation:$invocation,
    determinismHolds:$det,
    lockedGenHash:$lockedHash,
    medianPeakMiB:$medPeak,
    medianWallSec:$medWall,
    perRun:$perRun}' | tee "$OUT_JSON"

log ""
log "==> JSON written to $OUT_JSON"
