#!/usr/bin/env bash
# Reconfigure the -vcli edge so the four @powerhousedao/ph-clint* packages
# resolve from the LOCAL origin instead of npmjs, then restart the edge.
#
# Default edge config proxies @powerhousedao/* from npmjs (which has no
# locally-published dev.84). Option 2 publishes our ph-clint to the local
# origin, so the edge must prefer `upstream` for those package paths. We rewrite
# the rendered edge/config.yaml in place (render.sh regenerates from the
# template, which still defaults to npmjs — re-run this after a render).
set -euo pipefail
cd "$(dirname "$0")"

CFG=edge/config.yaml
[ -f "${CFG}" ] || { echo "render first: ./render.sh" >&2; exit 1; }

# Insert per-package blocks pointing at the local origin (upstream) ABOVE the
# catch-all @*/* rule, if not already present.
if grep -q "@powerhousedao/ph-clint" "${CFG}"; then
  echo "edge already routes ph-clint from local origin"
else
  python3 - "${CFG}" <<'PY'
import sys, re
path = sys.argv[1]
src = open(path).read()
block = """  '@powerhousedao/ph-clint':
    access: $all
    publish: $all
    unpublish: $all
    proxy: upstream
  '@powerhousedao/ph-clint-observability':
    access: $all
    publish: $all
    unpublish: $all
    proxy: upstream
  '@powerhousedao/ph-clint-dev':
    access: $all
    publish: $all
    unpublish: $all
    proxy: upstream
  '@powerhousedao/clint-common':
    access: $all
    publish: $all
    unpublish: $all
    proxy: upstream
"""
# Insert just before the catch-all scoped rule '@*/*'.
src = src.replace("  '@*/*':", block + "  '@*/*':", 1)
open(path, "w").write(src)
print("inserted ph-clint local-origin routes")
PY
fi

echo "==> restarting edge"
docker compose restart edge
echo "done. ph-clint* now resolves from the local origin via the edge."
