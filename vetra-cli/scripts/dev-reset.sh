#!/usr/bin/env bash
# Wipe the vetra dev workspace store (full nuke of {workdir}/.ph/{cli}).
# The workdir + cli mirror the `dev` script (`tsx src/main.ts --workdir
# ../../vetra-test`). Service state in ~/.ph/vetra is left intact.
#
# The reactor store is an embedded PGlite (Postgres) data dir held open by
# the running reactor; deleting it from under a live process can corrupt
# state, so this refuses to run while the reactor is up.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI_NAME="vetra"
# Same relative target the dev script passes to --workdir, resolved from CLI_ROOT.
WORKDIR="$(cd "$CLI_ROOT/../../vetra-test" 2>/dev/null && pwd || echo "$CLI_ROOT/../../vetra-test")"
STORE="$WORKDIR/.ph/$CLI_NAME"

if [ ! -d "$STORE" ]; then
  echo "nothing to wipe — no store at $STORE"
  exit 0
fi

# Best-effort: stop the detached studio service (frees the Connect daemon).
if command -v tsx >/dev/null 2>&1; then
  (cd "$CLI_ROOT" && tsx src/main.ts "${CLI_NAME}-studio-stop" >/dev/null 2>&1) || true
fi

# Safety guard: refuse if anything still holds the PGlite store open.
# (postmaster.pid is a PGlite/wasm placeholder, not a real OS pid, so we
# check actual open file handles instead.)
if command -v lsof >/dev/null 2>&1 && [ -d "$STORE/reactor-storage" ]; then
  holders="$(lsof -t +D "$STORE/reactor-storage" 2>/dev/null | sort -u | tr '\n' ' ' || true)"
  if [ -n "${holders// /}" ]; then
    echo "✗ reactor still running (pid(s) ${holders}hold $STORE/reactor-storage)."
    echo "  Stop it first: Ctrl+C your \`pnpm dev\`, then re-run this."
    exit 1
  fi
fi

echo "wiping $STORE"
rm -rf "$STORE"
echo "✓ workspace store wiped — next \`pnpm dev\` starts clean"
