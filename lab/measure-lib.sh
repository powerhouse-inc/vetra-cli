#!/usr/bin/env bash
# Shared core for the vetra-cli memory-measurement harnesses
# (measure-codegen.sh, measure-reactor-start.sh). The discipline these harnesses
# share: one fresh `docker run` per measured run (cgroup v2 memory.peak is a
# monotonic, non-resettable high-water mark, so a clean read needs a fresh
# container), an N-run median, and machine-readable JSON emit alongside a human
# log to stderr.
#
# Source it: `. "$(dirname "$0")/measure-lib.sh"`.

# Human log line to stderr (machine JSON stays on stdout / OUT_JSON).
log() { printf '%s\n' "$*" >&2; }

# Median of the numeric args (sorted, middle element; "null" when none).
median() {
  printf '%s\n' "$@" | LC_ALL=C sort -g | python3 -c \
    'import sys;v=[float(x) for x in sys.stdin.read().split()];print("null" if not v else round(v[len(v)//2],2))'
}

# Round a byte count to MiB (1 decimal).
bytes_to_mib() { python3 -c "print(round($1/1048576, 1))"; }

# Epoch seconds with sub-second precision.
now_s() { python3 -c 'import time;print(time.time())'; }

# Wall delta in seconds (2 decimals): wall_sec START END.
wall_sec() { python3 -c "print(round($2 - $1, 2))"; }

# Assert the harness toolchain is present; exits non-zero (via the caller's
# set -e) with a clear message otherwise. Pass extra required commands as args.
require_tools() {
  local tool
  for tool in docker jq python3 "$@"; do
    command -v "$tool" >/dev/null || { log "ERROR: $tool not on PATH"; return 1; }
  done
}

# Assert an image is present locally (the harnesses never pull/build).
require_image() {
  docker image inspect "$1" >/dev/null 2>&1 || { log "ERROR: image not present locally: $1"; return 1; }
}

# Extract the last `<KEY>=<int>` value from a container log file ("" if absent).
# Used to read the PEAK_BYTES / MAX_BYTES markers the SERVICE_COMMAND echoes.
last_marker_int() { grep -oE "$2=[0-9]+" "$1" | tail -1 | cut -d= -f2 || true; }
