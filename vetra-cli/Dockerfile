# syntax=docker/dockerfile:1.7
#
# Prebuilt vetra-cli image. Derives from the generic clint-runtime base
# and bakes `vetra-cli` (+ full dependency tree) globally at BUILD time
# so container start is pull + exec, with no install-at-start.
#
# The entrypoint (tini + run.sh) is inherited from the base; run.sh
# exec's whatever SERVICE_COMMAND is set at runtime. vetra-cli exposes
# the `vetra` binary, so a typical command looks like:
#   SERVICE_COMMAND="vetra <subcommand> ..."
#
# Build args:
#   CLINT_VERSION       vetra-cli version or dist-tag, e.g. 0.0.1-dev.0
#   CLINT_REGISTRY      registry for vetra-cli install
#   PH_REGISTRY         registry for ph-cmd (defaults to host's local registry)
#   PH_VERSION          ph-cli / ph-cmd version (or dist-tag). Empty by default —
#                       the build reads DEFAULT_PH_VERSION from the installed
#                       vetra-cli so the runtime config and template scaffolding
#                       agree out of the box. Override to pin a different version
#                       and it propagates to the runtime VETRA_PH_VERSION env.
#   REACTOR_TEMPLATE_DIR  where `ph init` runs to bake the warm template
#   BASE_IMAGE          published clint-runtime image
#
# Build (local smoke, against local registry on the host):
#   docker build -t vetra-cli:local \
#     --build-arg BASE_IMAGE=clint-runtime:dev-pnpm10 \
#     --build-arg CLINT_VERSION=0.0.1-dev.0 \
#     --build-arg CLINT_REGISTRY=https://registry.dev.vetra.io \
#     --build-arg PH_REGISTRY=http://host.docker.internal:8181 \
#     .

ARG BASE_IMAGE=cr.vetra.io/powerhouse-inc-powerhouse/clint-runtime:dev
FROM ${BASE_IMAGE}

ARG CLINT_VERSION
ARG CLINT_REGISTRY=http://localhost:8181
ARG PH_REGISTRY=http://host.docker.internal:8181
ARG PH_VERSION=
ARG PNPM_VERSION=11.4.0
ARG REACTOR_TEMPLATE_DIR=/home/clint/.vetra/templates

RUN test -n "${CLINT_VERSION}" || (echo "CLINT_VERSION build-arg is required" >&2; exit 1)

USER root
RUN apt-get update && apt-get install -y --no-install-recommends time \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate \
 && chown -R clint:clint /home/clint/.cache
USER clint
RUN corepack prepare "pnpm@${PNPM_VERSION}" --activate \
 && pnpm --version

# --config.blockExoticSubdeps=false: pnpm 11 blocks URL-resolved subdeps;
#   vetra-cli's closure hits this via viem -> ox. Global install also skips
#   postinstall scripts (no `allowBuilds`) — matches clint-agent behavior.
# --config.minimumReleaseAge=0: pnpm 11 defaults to 1440min (24h). Local-registry
#   packages are freshly published; disable the age check at build time.
RUN pnpm add -g "vetra-cli@${CLINT_VERSION}" \
      --registry "${CLINT_REGISTRY}" \
      --config.blockExoticSubdeps=false \
      --config.minimumReleaseAge=0

# Install ph-cmd separately so the `ph init` template prewarm below has the
# --template-capable binary on PATH, and bake a scaffolded reactor-project
# that runtime inits clone via `ph init --clone`. The cost of the install
# + scaffold is paid here, once, so every runtime init is a directory copy.
# Resolve the ph version: explicit PH_VERSION build-arg wins; otherwise read
# DEFAULT_PH_VERSION from the just-installed vetra-cli so the runtime config
# and template scaffold can't drift.
RUN set -eu; \
    RESOLVED="${PH_VERSION}"; \
    if [ -z "$RESOLVED" ]; then \
      VERSION_FILE=$(find -L "$(pnpm root -g)" -path "*/vetra-cli/dist/ph-version.gen.js" -print -quit 2>/dev/null); \
      if [ -n "$VERSION_FILE" ] && [ -f "$VERSION_FILE" ]; then \
        RESOLVED=$(node -e "import('file://${VERSION_FILE}').then(m => process.stdout.write(m.DEFAULT_PH_VERSION))" || true); \
      fi; \
    fi; \
    if [ -z "$RESOLVED" ]; then RESOLVED="dev"; fi; \
    echo "$RESOLVED" > /home/clint/.ph-version; \
    echo "==> resolved PH_VERSION=$RESOLVED"

RUN set -eu; \
    PH_VERSION=$(cat /home/clint/.ph-version); \
    case "$PH_VERSION" in \
      dev|staging|latest) PH_INIT_FLAG="--${PH_VERSION}" ;; \
      *) PH_INIT_FLAG="--version ${PH_VERSION}" ;; \
    esac; \
    pnpm add -g "ph-cmd@${PH_VERSION}" \
      --registry "${PH_REGISTRY}" \
      --config.blockExoticSubdeps=false \
      --config.minimumReleaseAge=0 \
 && mkdir -p "${REACTOR_TEMPLATE_DIR}" \
 && cd "${REACTOR_TEMPLATE_DIR}" \
 && ph init reactor-template --pnpm ${PH_INIT_FLAG} \
 && cd reactor-template \
 # vite-plugin-externalize-dependencies is builder-tools' optional peer that
 # activates the prebuilt vendor; ph vetra resolves it from the project's hoisted
 # node_modules (on its NODE_PATH), so install it into the template.
 && pnpm add -D \
      --config.blockExoticSubdeps=false \
      --config.minimumReleaseAge=0 \
      "@powerhousedao/codegen@${PH_VERSION}" \
      "vite-plugin-externalize-dependencies@^1.0.1" \
 && printf '\nenableGlobalVirtualStore: true\nminimumReleaseAge: 0\n' >> pnpm-workspace.yaml \
 && rm -rf node_modules \
 && pnpm install --frozen-lockfile --offline --config.minimumReleaseAge=0 \
 # Prebuild Connect's vendor bundle into the template's node_modules/.ph-vendor.
 # ph init --clone reinstalls node_modules from the lockfile, so reactor-project-
 # init reseeds this into the clone (digest matches) and ph vetra warm-hits it.
 # builder-tools is ESM-only and lives in the global store; resolve by absolute
 # path (NODE_PATH doesn't help ESM). The build worker self-resolves vite from cwd.
 && VETRA_SHIM="$(command -v vetra)" \
 && NODE_PATH="$(dirname "$VETRA_SHIM")/../$(grep -oE 'global/v11/[^/]+/node_modules' "$VETRA_SHIM" | head -1)/.pnpm/node_modules" \
    BT_PATH="$(find "$(pnpm store path)/links/@powerhousedao/builder-tools" -path '*/dist/index.mjs' | head -1)" \
    PH_CONNECT_EXTERNALIZE_VENDOR=1 \
    node --input-type=module -e 'const {pathToFileURL}=await import("node:url");const m=await import(pathToFileURL(process.env.BT_PATH).href);const e={};const r=await m.prebuildConnectVendor({dirname:process.cwd(),errorRef:e});if(!r){console.error("[vendor-prebuild] FAILED: "+(e.message||"unknown"));process.exit(1);}console.log("[vendor-prebuild] ok imports="+Object.keys(r.imports).length);' \
 && test -f node_modules/.ph-vendor/import-map.json \
 # Image-size trim — folded into THIS RUN (a separate `rm` RUN only writes a
 # whiteout; the bytes would survive in the lower layer). Removes the pnpm
 # download cache (.cache/pnpm/v11 — registry packument metadata; frozen/offline
 # installs do no version resolution) and store/v11/files CAS blobs not hardlinked
 # into the live store/v11/links tree (enableGlobalVirtualStore makes the install
 # resolve through links/). Most of files/ IS hardlinked to links/ in a fresh
 # build, so the real reclaim is ~1.24 GiB rootfs / ~130 MiB compressed — a naive
 # `du` double-counts the shared CAS bytes and overstates it (~2.68 GiB).
 # Validated head-to-head (trim vs untrimmed same-base vs stock dev.23): behavior
 # is byte-identical — spec-generate PASSES (codegen plugins resolve via NODE_PATH
 # through links/); reactor-project-init is unchanged (it hits a pre-existing
 # offline pglite gap present in stock dev.23 too, independent of this trim). The
 # trim regresses nothing. index.db (~30 MiB) is kept.
 && rm -rf "$(pnpm store path)/files" /home/clint/.cache/pnpm/v11

ENV VETRA_REACTOR_PROJECT_CLONE_PATH=${REACTOR_TEMPLATE_DIR}/reactor-template

# Arm the Connect externalize-vendor lever so ph vetra serves the prebuilt
# vendor (warm-hit on the reseeded .ph-vendor). Must match the baked include
# set — do NOT also set PH_CONNECT_VENDOR_EXTRA, or the digest mismatches.
ENV VETRA_CONNECT_EXTERNALIZE_VENDOR=1

# Observability consent is supplied at runtime via VETRA_TELEMETRY_CONSENT
# (the observability `telemetryConsent` config key), which is authoritative and
# skips both the prompt and the on-disk decision — so nothing is baked here. A
# non-TTY run without it defaults to denied.

LABEL io.vetra.clint.package="vetra-cli" \
      io.vetra.clint.version="${CLINT_VERSION}"

# Self-contained non-installing entrypoint. Inlined (instead of relying on
# the base image's /home/clint/run.sh) so older clint-runtime tags whose
# ENTRYPOINT is still the legacy install-at-start `entrypoint.sh` work too.
USER root
RUN printf '%s\n' \
      '#!/bin/sh' \
      'set -eu' \
      'if [ -z "${SERVICE_COMMAND:-}" ]; then' \
      '  echo "==> ERROR: required env SERVICE_COMMAND is unset" >&2' \
      '  exit 1' \
      'fi' \
      '# Propagate the build-resolved ph version to vetra-cli (ph-clint config' \
      '# layer reads UPPER_SNAKE env vars; VETRA_PH_VERSION -> config.phVersion).' \
      'if [ -z "${VETRA_PH_VERSION:-}" ] && [ -f /home/clint/.ph-version ]; then' \
      '  VETRA_PH_VERSION=$(cat /home/clint/.ph-version)' \
      '  export VETRA_PH_VERSION' \
      'fi' \
      'if [ -n "${SERVICE_ANNOUNCE_URL:-}" ]; then' \
      '  echo "==> vetra-cli: SERVICE_ANNOUNCE_URL is configured"' \
      'fi' \
      '# Global virtual store: pnpm hoists deps to <install>/.pnpm/node_modules but' \
      '# does not put it on NODE_PATH for a global bin shim. graphql-codegen plugins' \
      '# (e.g. graphql-codegen-typescript-validation-schema) require @graphql-codegen/' \
      '# typescript without declaring it, so the in-process codegen needs that hoisted' \
      '# dir on NODE_PATH to resolve them.' \
      'VETRA_SHIM="$(command -v vetra || true)"' \
      'if [ -n "$VETRA_SHIM" ]; then' \
      '  SEG="$(grep -oE "global/v11/[^/]+/node_modules" "$VETRA_SHIM" | head -1)"' \
      '  if [ -n "$SEG" ]; then' \
      '    NODE_PATH="$(dirname "$VETRA_SHIM")/../$SEG/.pnpm/node_modules"' \
      '    export NODE_PATH' \
      '  fi' \
      'fi' \
      'echo "==> vetra-cli: starting prebuilt agent"' \
      'echo "    \$ ${SERVICE_COMMAND}"' \
      'exec sh -c "${SERVICE_COMMAND}"' \
    > /usr/local/bin/vetra-run.sh \
 && chmod +x /usr/local/bin/vetra-run.sh
USER clint

RUN mkdir -p /home/clint/workspace
WORKDIR /home/clint/workspace

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/vetra-run.sh"]
