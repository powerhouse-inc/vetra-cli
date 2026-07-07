#!/bin/sh
# Vetra CLI installer.
#
#   curl -fsSL https://get.vetra.io | sh
#
# Installs `ph-cmd` (the `ph` bin) and `vetra-cli` (the `vetra` bin) globally.
# Claude auth is set up on first `vetra` launch, not here. Advanced users can
# skip this script and run:  npm install -g ph-cmd vetra-cli
#
# Env knobs (all optional):
#   VETRA_VERSION    vetra-cli version to install            (default: latest)
#   VETRA_INSTALL_SPEC  install this spec instead of vetra-cli@$VERSION (e.g. a local tarball; used in CI)
#   PH_VERSION       ph-cmd version to install               (default: pin baked into vetra-cli)
#   VETRA_REGISTRY   registry for the vetra-cli package only  (default: https://registry.dev.vetra.io, the pre-release registry; ph-cmd + deps always use your npm default)
#   VETRA_PM         package manager: npm | pnpm             (default: pnpm, falling back to npm if pnpm is unavailable)
#   VETRA_SKIP_PH=1  don't install ph-cmd (rely on first-boot ensure-ph)
#   VETRA_YES=1      non-interactive: accept defaults, never prompt
#   VETRA_NO_LAUNCH=1  install only, don't offer to launch
set -eu

VETRA_PKG="vetra-cli"
VETRA_BIN="vetra"
PH_PKG="ph-cmd"
PNPM_PIN="11.5.0"
MIN_NODE_MAJOR=22
MIN_NODE_MINOR=13

VERSION="${VETRA_VERSION:-latest}"
REGISTRY="${VETRA_REGISTRY:-https://registry.dev.vetra.io}"
PM="${VETRA_PM:-}"   # empty = infer in resolve_pm (prefer pnpm, fall back to npm)

# ---------------------------------------------------------------- output ----
if [ -t 1 ]; then
  c_red=$(printf '\033[31m'); c_grn=$(printf '\033[32m'); c_ylw=$(printf '\033[33m')
  c_blu=$(printf '\033[34m'); c_dim=$(printf '\033[2m'); c_rst=$(printf '\033[0m')
else
  c_red=; c_grn=; c_ylw=; c_blu=; c_dim=; c_rst=
fi
step() { printf '%s==>%s %s\n' "$c_blu" "$c_rst" "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '%swarning:%s %s\n' "$c_ylw" "$c_rst" "$*" >&2; }
ok()   { printf '%s%s%s\n' "$c_grn" "$*" "$c_rst"; }
die()  { printf '%serror:%s %s\n' "$c_red" "$c_rst" "$*" >&2; exit 1; }

# Prompt on the controlling terminal so it works under `curl | sh` (which has
# no stdin). Falls back to the default when no terminal is attached.
TTY=
[ -r /dev/tty ] && TTY=/dev/tty
interactive() { [ -n "$TTY" ] && [ "${VETRA_YES:-}" != "1" ]; }

# Global bin dir for the active PM (npm's differs from pnpm's). resolve_pm pins
# PNPM_HOME, so pnpm's global bin dir is deterministically $PNPM_HOME/bin.
global_bin() {
  if [ "$PM" = pnpm ]; then printf '%s' "${PNPM_HOME:-$HOME/.local/share/pnpm}/bin"
  else p=$(npm prefix -g 2>/dev/null) && printf '%s/bin' "$p"; fi
}
# Absolute path to the just-installed vetra bin (don't trust a stale one on PATH).
vetra_path() {
  b=$(global_bin) || return 1
  [ -x "$b/$VETRA_BIN" ] && printf '%s/%s' "$b" "$VETRA_BIN" && return 0
  command -v "$VETRA_BIN" 2>/dev/null
}

# ------------------------------------------------------------- preflight ----
preflight() {
  case "$(uname -s)" in
    Linux|Darwin) ;;
    *) die "unsupported OS '$(uname -s)'. This installer supports macOS and Linux." ;;
  esac

  command -v node >/dev/null 2>&1 || die \
    "Node.js is required but not found. Install Node >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} from https://nodejs.org (or via nvm/fnm), then re-run."

  nv=$(node -p 'process.versions.node' 2>/dev/null) || die "could not run node."
  nmaj=$(printf '%s' "$nv" | cut -d. -f1)
  nmin=$(printf '%s' "$nv" | cut -d. -f2)
  if [ "$nmaj" -lt "$MIN_NODE_MAJOR" ] || { [ "$nmaj" -eq "$MIN_NODE_MAJOR" ] && [ "$nmin" -lt "$MIN_NODE_MINOR" ]; }; then
    die "Node >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} required; found $nv. Upgrade Node and re-run."
  fi

  # Studio/Reactor/Switchboard ports have no fallback — warn early if taken.
  check_ports 8090 27370 59220
}

# Resolve the package manager. An explicit VETRA_PM must resolve (die if not).
# Otherwise default to pnpm, falling back to npm when pnpm isn't available (even
# after setup_pnpm). Runs after setup_pnpm so the default sees a corepack pnpm.
resolve_pm() {
  if [ -n "$PM" ]; then
    command -v "$PM" >/dev/null 2>&1 || die "package manager '$PM' not found on PATH."
  else
    if command -v pnpm >/dev/null 2>&1; then PM=pnpm; else PM=npm; fi
    info "using $PM"
  fi
  # pnpm refuses `add -g` unless its global bin dir ($PNPM_HOME/bin) is on PATH.
  # Pin PNPM_HOME so the dir is deterministic, and put it on PATH for this run
  # (ensure_path persists it for the user's shell afterward).
  if [ "$PM" = pnpm ]; then
    PNPM_HOME="${PNPM_HOME:-$HOME/.local/share/pnpm}"; export PNPM_HOME
    gbin="$PNPM_HOME/bin"
    case ":$PATH:" in
      *":$gbin:"*) ;;
      *) PATH="$gbin:$PATH"; export PATH ;;
    esac
  fi
}

check_ports() {
  probe=
  if command -v lsof >/dev/null 2>&1; then probe=lsof
  elif command -v nc >/dev/null 2>&1; then probe=nc
  else return 0; fi
  busy=
  for p in "$@"; do
    if [ "$probe" = lsof ]; then
      lsof -nP -i ":$p" >/dev/null 2>&1 && busy="$busy $p"
    else
      nc -z 127.0.0.1 "$p" >/dev/null 2>&1 && busy="$busy $p"
    fi
  done
  [ -n "$busy" ] && warn "port(s) in use:$busy — Vetra needs 8090/27370/59220 (no fallback). Free them (e.g. \`vetra vetra-studio-stop\`) before launching."
  return 0
}

# ---------------------------------------------------------------- pnpm -------
# pnpm is the default package manager; activate a pinned pnpm best-effort via
# corepack so the default works without a pre-existing pnpm (resolve_pm falls
# back to npm if this doesn't provide one). COREPACK_DEFAULT_TO_LATEST=0 keeps
# the inner pnpm from floating to a release whose verifier rejects fresh
# pre-release deps.
setup_pnpm() {
  command -v corepack >/dev/null 2>&1 || return 0
  step "Preparing pnpm@$PNPM_PIN (used when pnpm is the resolved package manager)"
  COREPACK_DEFAULT_TO_LATEST=0 corepack enable >/dev/null 2>&1 || true
  COREPACK_DEFAULT_TO_LATEST=0 corepack prepare "pnpm@$PNPM_PIN" --activate >/dev/null 2>&1 || true
}

# ------------------------------------------------------------- install -------
# One install helper for both packages. $1 is the registry (empty = npm default);
# npm needs no special flags; pnpm needs blockExoticSubdeps=false (ph-cmd's
# viem->ox URL subdep) and minimumReleaseAge=0 (pnpm 11's 24h age gate vs. fresh
# pre-release pins).
pm_install() {
  reg="$1"; shift
  if [ "$PM" = pnpm ]; then
    set -- add -g "$@" --config.blockExoticSubdeps=false --config.minimumReleaseAge=0
  else
    set -- install -g "$@"
  fi
  [ -n "$reg" ] && set -- "$@" --registry "$reg"
  "$PM" "$@"
}

install_vetra() {
  spec="${VETRA_INSTALL_SPEC:-$VETRA_PKG@$VERSION}"
  step "Installing $spec with $PM${REGISTRY:+ from $REGISTRY}"
  pm_install "$REGISTRY" "$spec" || die "failed to install $VETRA_PKG."
}

# ph-cmd is a separate package with its own dependency closure. Pin it to the
# version vetra-cli was built against (baked into the shipped bundle) so first
# boot isn't a slow surprise install by the ensure-ph safety net.
resolve_ph_version() {
  [ -n "${PH_VERSION:-}" ] && { printf '%s' "$PH_VERSION"; return 0; }
  # Ask the just-installed CLI — its banner reads "vetra-cli vX (ph <ver>)".
  vbin=$(vetra_path 2>/dev/null || true)
  [ -n "$vbin" ] || return 1
  "$vbin" --version 2>/dev/null | sed -n 's/.*(ph \([^)]*\)).*/\1/p' | head -1
}

install_ph() {
  [ "${VETRA_SKIP_PH:-}" = "1" ] && { info "skipping ph-cmd (VETRA_SKIP_PH=1); first boot will install it."; return 0; }
  phv=$(resolve_ph_version 2>/dev/null || true)
  if [ -z "$phv" ]; then
    phv=latest
    warn "could not resolve the ph-cmd pin from the installed bundle; installing ph-cmd@latest (first boot's ensure-ph will correct it if needed)."
  fi
  step "Installing $PH_PKG@$phv (provides the \`ph\` bin)"
  # ph-cmd + its closure always resolve from the npm default, not VETRA_REGISTRY.
  pm_install "" "$PH_PKG@$phv" || die "failed to install $PH_PKG@$phv."
}

# ------------------------------------------------------------- PATH ----------
detect_profile() {
  case "${SHELL:-}" in
    *zsh)  printf '%s' "${ZDOTDIR:-$HOME}/.zshrc" ;;
    *bash) [ "$(uname -s)" = Darwin ] && printf '%s' "$HOME/.bash_profile" || printf '%s' "$HOME/.bashrc" ;;
    *)     printf '%s' "$HOME/.profile" ;;
  esac
}

ensure_path() {
  bin=$(global_bin) && [ -n "$bin" ] || return 0
  case ":$PATH:" in *":$bin:"*) return 0 ;; esac
  prof=$(detect_profile)
  line="export PATH=\"$bin:\$PATH\""
  if [ -f "$prof" ] && grep -Fq "$line" "$prof" 2>/dev/null; then
    :
  else
    { printf '\n# vetra-cli (global bin)\n%s\n' "$line" >> "$prof"; } 2>/dev/null \
      && info "added the global bin to PATH in $prof" \
      || warn "add \"$bin\" to your PATH — the \`vetra\`/\`ph\` bins live there."
  fi
  warn "open a new terminal (or run \`export PATH=\"$bin:\$PATH\"\`) so \`$VETRA_BIN\` resolves."
}

# ------------------------------------------------------------- launch --------
finish() {
  vbin=$(vetra_path || true)
  printf '\n'
  ok "Vetra CLI installed."
  [ -n "$vbin" ] && info "$("$vbin" --version 2>/dev/null | head -1 || echo "$VETRA_PKG")"
  info "Run ${c_blu}$VETRA_BIN${c_rst} to start the agent — first launch sets up Claude auth, then prints ${c_dim}http://localhost:8090/d/<driveId>${c_rst}."

  [ "${VETRA_NO_LAUNCH:-}" = "1" ] && return 0
  interactive || return 0
  [ -n "$vbin" ] || return 0
  printf '\n    Start Vetra now? [Y/n]: '
  read -r go < "$TTY" || go=n
  case "$go" in
    ""|y|Y|yes|YES) exec "$vbin" < "$TTY" ;;
    *) : ;;
  esac
}

# ---------------------------------------------------------------- main -------
printf '%sVetra CLI installer%s\n' "$c_blu" "$c_rst"
preflight
setup_pnpm
resolve_pm
export APOLLO_TELEMETRY_DISABLED=1
install_vetra
install_ph
ensure_path
finish
