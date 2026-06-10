#!/bin/sh
# Generic clint runtime entrypoint.
# See docker/clint-runtime/Dockerfile for full env contract.

set -eu

require() {
  # shellcheck disable=SC2039
  eval "val=\${$1:-}"
  if [ -z "${val}" ]; then
    echo "==> ERROR: required env $1 is unset" >&2
    exit 1
  fi
}

require CLINT_PACKAGE
require CLINT_VERSION
require CLINT_REGISTRY
require SERVICE_COMMAND

echo "==> clint-runtime: installing ${CLINT_PACKAGE}@${CLINT_VERSION} from ${CLINT_REGISTRY}"
pnpm add -g "${CLINT_PACKAGE}@${CLINT_VERSION}" --registry "${CLINT_REGISTRY}"

# Surface key env so logs show the announce URL is wired (or that it
# isn't, when serviceAnnouncement is off in the package manifest).
if [ -n "${SERVICE_ANNOUNCE_URL:-}" ]; then
  echo "==> clint-runtime: SERVICE_ANNOUNCE_URL is configured"
fi

echo "==> clint-runtime: starting agent"
echo "    \$ ${SERVICE_COMMAND}"
exec sh -c "${SERVICE_COMMAND}"
