#!/bin/sh
# Runtime entrypoint for prebuilt clint-agent images.
# The agent package is ALREADY installed (baked at image-build time by
# docker/clint-agent/Dockerfile), so this script does NOT install anything.
# It only validates the service command, surfaces announce wiring in logs,
# and exec's the agent. See docker/clint-runtime/Dockerfile.

set -eu

if [ -z "${SERVICE_COMMAND:-}" ]; then
  echo "==> ERROR: required env SERVICE_COMMAND is unset" >&2
  exit 1
fi

if [ -n "${SERVICE_ANNOUNCE_URL:-}" ]; then
  echo "==> clint-runtime: SERVICE_ANNOUNCE_URL is configured"
fi

echo "==> clint-runtime: starting prebuilt agent"
echo "    \$ ${SERVICE_COMMAND}"
exec sh -c "${SERVICE_COMMAND}"
