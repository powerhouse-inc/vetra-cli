# Scope: one-line local installer (`curl … | sh`)

**Status:** proposal for review · **Branch:** `docs/local-installer-scope`
**Author:** scoped with Claude Code · **Date:** 2026-06-24

## Goal

A single command that takes someone from nothing to a running local Vetra
stack (interactive REPL + embedded Reactor + embedded Switchboard + Vetra
Studio), authenticated against Claude via **either** an Anthropic API key
**or** a Claude.ai subscription session.

```sh
curl -fsSL <host>/install.sh | sh
```

"Local-first" here means the **runtime stack runs locally**. The agent
still calls Claude — there is no local-model/offline-inference path today
(no Ollama, no local `baseURL` anywhere in the code).

## Decisions already made (product owner)

| Decision | Choice | Notes |
|---|---|---|
| Install target | **Native global install** | No Docker, no repo clone. A prebuilt-Docker path is explicitly *not* in v1. |
| Auth default (no key detected) | **Prompt: API key or subscription** | Mixed audience; let the user pick. |
| Hosting (the curl URL) | **Decide later** | `install.sh` lives in-repo regardless (proposed: `vetra-cli/scripts/install.sh`). |

## Why this needs a dev decision, not just a script

The "obvious" install (`npm install -g vetra`, per the current README) is
**broken**, and the real recipe has non-obvious constraints that the CI
e2e suite encodes. The sections below are the evidence a dev needs.

## Current install reality (CI-validated)

Source of truth is the `global-install` job in
[.github/workflows/e2e.yml](.github/workflows/e2e.yml#L149-L267) (matrix:
npm + pnpm, vanilla `node:24`) and the bundling commits `4406999`
(tsdown framework bundle), `d806d49` (inline vetra-app bundle),
`b1f4b5b` (the CI job).

1. **`vetra-cli` is bundled with tsdown** into `dist/main.js`: reactor,
   document-model, the engine-free spec API, ph-clint glue, and the
   `vetra-app` Studio SPA are all inlined. `catalog:` pins are resolved to
   concrete versions and `workspace:*` to real versions at pack time. The
   only declared runtime deps left are the native/wasm floor + OTel +
   `@powerhousedao/switchboard` (things that resist bundling). See
   [vetra-cli/package.json](vetra-cli/package.json) `dependencies`.

2. **The package is self-contained once installed** — it runs the full
   local stack with no repo and no Docker.

3. **`vetra-cli` is NOT on public npm.** `npm view vetra-cli` → 404 on
   npmjs; it publishes only to **`https://registry.dev.vetra.io`**
   (currently `0.0.1-dev.33`). The public `vetra` package on npmjs is an
   unrelated `0.0.1-dev` placeholder — **the README install line is wrong.**

4. **That dev registry uplinks to public npm.** Verified:
   `npm view react --registry https://registry.dev.vetra.io` → `19.2.7`.
   So a plain `--registry` install resolves both `vetra-cli` *and* its
   public deps. (This was the main open question; it is now answered.)

5. **npm install is flag-free; pnpm install is not.**
   - npm leg: `npm install -g <tarball>` — no special config.
   - pnpm leg still needs `--config.blockExoticSubdeps=false`
     (a `viem → ox` URL subdep) and `--config.minimumReleaseAge=0`
     (pnpm 11's 24 h age gate vs. fresh `dev.N` pins).
   See [e2e.yml:233-241](.github/workflows/e2e.yml#L233-L241).

## Non-obvious constraints the installer MUST handle

1. **pnpm@11.5.0 must be on PATH even when npm does the global install.**
   The reactor-project flow shells out to `ph init --pnpm`. Pin it and set
   `COREPACK_DEFAULT_TO_LATEST=0` so the inner pnpm doesn't float to a
   release whose supply-chain verifier rejects fresh `@powerhousedao`
   `dev.N` entries. See [e2e.yml:220-227](.github/workflows/e2e.yml#L220-L227).

2. **Global bin dir on PATH.** Classic global-install footgun; CI handles
   it explicitly via `PNPM_HOME` / `global-bin-dir`. The installer must
   detect the npm/pnpm global bin dir and append it to the user's shell
   profile if missing, else `vetra` / `ph` won't resolve in a new shell.

3. **`ph-cmd` pinned to `DEFAULT_PH_VERSION`** (currently `6.2.0-dev.31`,
   from [vetra-cli/src/ph-version.gen.ts](vetra-cli/src/ph-version.gen.ts#L3)).
   Install it explicitly so first boot isn't a surprise multi-minute
   install. **Safety net:** the [ensure-ph](vetra-cli/src/lifecycle/ensure-ph.ts)
   boot hook auto-installs `ph-cmd` (honoring `CLINT_REGISTRY`) if `ph` is
   missing — but relying on it means a slow, silent first boot. Resolve the
   version from the installed package, don't hardcode it in the script.

4. **Env the runtime expects:** export `CLINT_REGISTRY`
   (so ensure-ph and any runtime install hit the right registry) and
   `APOLLO_TELEMETRY_DISABLED=1` (the bundle sets this to silence Apollo
   Gateway's per-boot OTel callout).

5. **Node ≥ 22.13.0.** `node:24` is CI-proven. Do not silently install a
   Node toolchain for the user — detect and instruct (fnm/nvm) if missing.

6. **Ports 8090 / 27370 / 59220 have no fallback** — preflight-check and
   give a clear message ([README.md:145-147](README.md#L145-L147)).

## Proposed installer flow

1. **Preflight** — OS/arch (macOS + Linux; warn-bail elsewhere), Node ≥
   22.13 (instruct, don't auto-install), free ports.
2. **Toolchain** — `COREPACK_DEFAULT_TO_LATEST=0; corepack enable;
   corepack prepare pnpm@11.5.0 --activate`. Ensure global bin on PATH.
3. **Install** (core block below).
4. **Auth** — skip if `ANTHROPIC_API_KEY` already set; else prompt:
   **[1]** paste API key → persist to shell profile, or
   **[2]** subscription → `vetra claude-login`. See auth precedence in
   [vetra-cli/src/agents/agent.ts](vetra-cli/src/agents/agent.ts#L46-L57).
   **TTY caveat:** `curl | sh` has no stdin for prompts — when non-interactive,
   skip the prompt and print how to auth, and document the
   `curl -o install.sh && sh install.sh` form for the interactive path.
5. **Launch** — `exec vetra`; the REPL prints
   `Vetra Studio: http://localhost:8090/d/<driveId>`.
6. **Idempotent** — re-run upgrades in place and skips auth if configured.

### Core install block (recommended)

```sh
export COREPACK_DEFAULT_TO_LATEST=0
corepack enable && corepack prepare pnpm@11.5.0 --activate   # for `ph init --pnpm`
export APOLLO_TELEMETRY_DISABLED=1
export CLINT_REGISTRY="${VETRA_REGISTRY:-https://registry.dev.vetra.io}"

# Registry uplinks to public npm (verified), so a single --registry resolves
# vetra-cli AND its public deps. ph-cmd pinned to DEFAULT_PH_VERSION.
npm install -g \
  --registry "$CLINT_REGISTRY" \
  "ph-cmd@${PH_VERSION:-6.2.0-dev.31}" \
  "vetra-cli@${VETRA_VERSION:-latest}"
```

### Env knobs (non-interactive / CI)

`VETRA_VERSION`, `VETRA_REGISTRY`, `PH_VERSION`, `ANTHROPIC_API_KEY`,
`VETRA_YES=1`, `VETRA_NO_LAUNCH=1`.

## Open decisions for the dev

1. **How to fetch `vetra-cli` (registry routing).** Both work now that the
   uplink is confirmed:
   - **A. `--registry https://registry.dev.vetra.io`** (shown above) —
     one line; routes *all* fetches through the dev registry's uplink.
     Simplest. Risk: ties install reliability/latency to that registry and
     its uplink.
   - **B. Tarball URL** —
     `npm i -g "$(npm view vetra-cli dist.tarball --registry <dev>)"` so
     only the `vetra-cli` package comes from the dev registry and its
     public deps resolve from the user's default registry. Cleaner
     separation; one extra `npm view` round-trip.
   - Recommendation: **A** for v1 simplicity; revisit if/when `vetra-cli`
     gets mirrored to public npm (then drop `--registry` entirely).

2. **npm vs pnpm as the installer's PM.** Recommend **npm** for the global
   install (flag-free, universally present). pnpm is still required on PATH
   regardless (constraint #1), so the script sets up both either way.

3. **ph-cmd: install eagerly vs. lean on ensure-ph.** Recommend eager
   install (fast, predictable first boot). The boot hook stays as a net.

4. **Where install.sh lives + the curl host.** Proposed file location:
   `vetra-cli/scripts/install.sh`. Host TBD (vanity domain vs. raw GitHub).

5. **Out of scope for v1 (flag if priorities differ):** Docker path;
   local-model inference; the **Renown-token** auth axis used by the new
   `vetra-cloud-client` / live-deploy commands (commits `99ffeca`,
   `f8f1dd9`, `023b1ca`) — that is publish/deploy auth, distinct from the
   Claude auth this installer handles.

## Risks / things to validate before shipping

- **Reliance on the dev registry.** v1 installs from `registry.dev.vetra.io`.
  If/when a production registry or public-npm mirror exists, the default
  should move. Treat the registry URL as the single most likely thing to
  change.
- **Custom-registry availability/auth.** Confirm the dev registry allows
  anonymous reads for `vetra-cli` from arbitrary networks (it does from
  here; verify it isn't IP-allowlisted for external users).
- **`pnpm pack` parity.** CI installs a locally-packed tarball, not a
  registry-published one. Before relying on `--registry`, confirm the
  *published* `vetra-cli@latest` on the dev registry matches what CI packs
  (the publish pipeline rewrites `catalog:`/`workspace:*` — the
  `prodclose` lab e2e, [lab/ci/run-prodclose-e2e.sh](lab/ci/run-prodclose-e2e.sh),
  is the existing guard for this).
- **README fix.** Replace the broken `npm install -g vetra` with the
  installer (or the correct `vetra-cli` + registry) in the same change.

## Effort

Small and self-contained: one `install.sh` (~150–200 lines POSIX `sh`,
including non-TTY-safe prompting and PATH handling), a README section, and
the host decision. **No changes to the CLI itself.** Recommend wiring the
finished script into the existing `global-install` CI job (or a sibling)
so it's smoke-tested on every release.
