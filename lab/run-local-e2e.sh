#!/usr/bin/env sh
# Run vetra from source with local ph-clint linked, against the lab
# registry. No publish, no image build. See vetra/CLAUDE.md ->
# "Testing local ph-clint/vetra-cli changes e2e on the lab".
#
#   LAB_REGISTRY  lab nginx (dual-uplink), default http://localhost:5100
#   WORKDIR       agent workdir (fresh dir => fresh drive), default /tmp/vetra-lab-test
#   PROXY_PORT    studio proxy port, default 8090
#
# Prereq: the link override for @powerhousedao/ph-clint is in
# pnpm-workspace.yaml and `pnpm install` has run; ph-clint dist is built;
# the prod stack is up. Ports 8090/27370/59220 must be
# free (stop any prior docker `vetra-studio`).
set -e

LAB_REGISTRY="${LAB_REGISTRY:-http://localhost:5100}"
WORKDIR="${WORKDIR:-/tmp/vetra-lab-test}"
PROXY_PORT="${PROXY_PORT:-8090}"

cd "$(dirname "$0")/../vetra-cli"

mkdir -p "$WORKDIR"

CLINT_REGISTRY="$LAB_REGISTRY" \
SERVICE_COMMAND=vetra \
VETRA_PROXY_PORT="$PROXY_PORT" \
VETRA_ANTHROPIC_API_KEY="${VETRA_ANTHROPIC_API_KEY:-sk-ant-placeholder}" \
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-sk-ant-placeholder}" \
  exec pnpm exec tsx src/main.ts --workdir "$WORKDIR"
