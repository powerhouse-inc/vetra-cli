#!/usr/bin/env bash
# Run the prod-close clint-agent image with the studio ports published to the
# host, then validate the studio redirect e2e.
#
# Frees the fixed studio ports first (8090/27370/59220) — vetra derives the
# switchboard/connect ports from the CLI name with no fallback, so a collision
# is fatal. Stops any prior vetra-studio container.
#
#   ./run-prodclose.sh [IMAGE_TAG]
set -euo pipefail

IMAGE="${1:-${IMAGE_TAG:-vetra-cli:local-prodclose}}"
NAME="${NAME:-vetra-studio-prodclose}"
KEY="${VETRA_ANTHROPIC_API_KEY:-sk-ant-placeholder}"

echo "==> freeing studio ports (stopping any vetra-studio*)"
docker rm -f vetra-studio vetra-studio-prodclose >/dev/null 2>&1 || true

echo "==> running ${IMAGE} as ${NAME}"
docker run -d --name "${NAME}" \
  -p 8090:8090 -p 27370:27370 -p 59220:59220 \
  -e SERVICE_COMMAND=vetra \
  -e VETRA_ANTHROPIC_API_KEY="${KEY}" -e ANTHROPIC_API_KEY="${KEY}" \
  --entrypoint sh "${IMAGE}" -c 'export PATH=$PNPM_HOME/bin:$PATH; exec vetra'

echo "==> waiting for studio to come up"
DRIVE=""
for i in $(seq 1 60); do
  line="$(docker logs "${NAME}" 2>&1 | grep -m1 'Vetra Studio:' || true)"
  if [ -n "${line}" ]; then
    DRIVE="$(echo "${line}" | sed -E 's#.*/d/([A-Za-z0-9_-]+).*#\1#')"
    echo "    ${line}"
    break
  fi
  sleep 2
done
[ -n "${DRIVE}" ] || { echo "studio did not start; logs:"; docker logs "${NAME}" 2>&1 | tail -40; exit 1; }

echo
echo "==> VALIDATION (driveId=${DRIVE})"
echo "--- curl -sI http://localhost:8090/ (expect 302 -> /d/${DRIVE}) ---"
curl -sI http://localhost:8090/ | grep -iE 'HTTP/|location'
echo "--- /_proxy/routes (expect studio-redirect + studio-announce) ---"
curl -s http://localhost:8090/_proxy/routes | python3 -m json.tool 2>/dev/null || curl -s http://localhost:8090/_proxy/routes
echo "--- /assets/ (expect 200) ---"
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8090/assets/
echo "--- /d/${DRIVE}/ (expect 200) ---"
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:8090/d/${DRIVE}/"
