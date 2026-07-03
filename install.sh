#!/bin/sh
# Vetra CLI installer.
#
#   curl -fsSL https://raw.githubusercontent.com/powerhouse-inc/vetra-cli/main/install.sh | sh
#
# Installs `ph-cmd` (the `ph` bin) and `vetra-cli` (the `vetra` bin) globally,
# then optionally sets up Claude auth. Advanced users can skip this script and
# run:  npm install -g ph-cmd vetra-cli
#
# Env knobs (all optional):
#   VETRA_VERSION    vetra-cli version to install            (default: latest)
#   VETRA_INSTALL_SPEC  install this spec instead of vetra-cli@$VERSION (e.g. a local tarball; used in CI)
#   PH_VERSION       ph-cmd version to install               (default: pin baked into vetra-cli)
#   VETRA_REGISTRY   registry to pull from                   (default: your npm default)
#   VETRA_PM         package manager: npm | pnpm             (default: npm)
#   VETRA_SKIP_PH=1  don't install ph-cmd (rely on first-boot ensure-ph)
#   VETRA_YES=1      non-interactive: accept defaults, never prompt
#   VETRA_NO_LAUNCH=1  install only, don't offer to launch
#   ANTHROPIC_API_KEY  if already set, the auth step is skipped
set -eu

VETRA_PKG="vetra-cli"
VETRA_BIN="vetra"
PH_PKG="ph-cmd"
PNPM_PIN="11.5.0"
MIN_NODE_MAJOR=22
MIN_NODE_MINOR=13

VERSION="${VETRA_VERSION:-latest}"
REGISTRY="${VETRA_REGISTRY:-}"
PM="${VETRA_PM:-npm}"

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

# Global bin dir for the active PM (npm's differs from pnpm's).
global_bin() {
  if [ "$PM" = pnpm ]; then pnpm bin -g 2>/dev/null
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

# Verify the chosen PM resolves. Runs after setup_pnpm so `VETRA_PM=pnpm` works
# on a host where corepack (not a pre-existing pnpm) provides it.
require_pm() {
  command -v "$PM" >/dev/null 2>&1 || die "package manager '$PM' not found on PATH."
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
# `ph init` picks the resolved package manager (npm works out of the box). pnpm
# is only needed when it's the chosen PM or for the --clone image fast path, so
# provide a pinned pnpm best-effort. COREPACK_DEFAULT_TO_LATEST=0 keeps the inner
# pnpm from floating to a release whose verifier rejects fresh pre-release deps.
setup_pnpm() {
  command -v corepack >/dev/null 2>&1 || return 0
  step "Preparing pnpm@$PNPM_PIN (used when pnpm is the resolved package manager)"
  COREPACK_DEFAULT_TO_LATEST=0 corepack enable >/dev/null 2>&1 || true
  COREPACK_DEFAULT_TO_LATEST=0 corepack prepare "pnpm@$PNPM_PIN" --activate >/dev/null 2>&1 || true
}

# ------------------------------------------------------------- install -------
# One install helper for both packages. npm needs no special flags; pnpm needs
# blockExoticSubdeps=false (ph-cmd's viem->ox URL subdep) and minimumReleaseAge=0
# (pnpm 11's 24h age gate vs. fresh pre-release pins).
pm_install() {
  if [ "$PM" = pnpm ]; then
    set -- add -g "$@" --config.blockExoticSubdeps=false --config.minimumReleaseAge=0
  else
    set -- install -g "$@"
  fi
  [ -n "$REGISTRY" ] && set -- "$@" --registry "$REGISTRY"
  "$PM" "$@"
}

install_vetra() {
  spec="${VETRA_INSTALL_SPEC:-$VETRA_PKG@$VERSION}"
  step "Installing $spec with $PM${REGISTRY:+ from $REGISTRY}"
  pm_install "$spec" || die "failed to install $VETRA_PKG."
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
  pm_install "$PH_PKG@$phv" || warn "failed to install $PH_PKG; the first \`vetra\` run will install it automatically."
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

# ------------------------------------------------------------- auth ----------
persist_env() {
  # $1 = VAR, $2 = value. Single-quoted (escaping embedded quotes) so special
  # characters can't corrupt the profile; skipped if the exact line is present.
  prof=$(detect_profile)
  esc=$(printf '%s' "$2" | sed "s/'/'\\\\''/g")
  line="export $1='$esc'"
  [ -f "$prof" ] && grep -qxF "$line" "$prof" 2>/dev/null && return 0
  { printf '\n# vetra-cli\n%s\n' "$line" >> "$prof"; } 2>/dev/null \
    && info "saved $1 to $prof" \
    || warn "could not write $prof — set $1 in your shell yourself."
}

setup_auth() {
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    info "ANTHROPIC_API_KEY already set — skipping auth setup."
    return 0
  fi
  if ! interactive; then
    step "Claude auth (set up later)"
    info "Vetra calls Claude. Authenticate with either:"
    info "  • an API key:      export ANTHROPIC_API_KEY=sk-ant-...   (get one at https://console.anthropic.com)"
    info "  • a subscription:  $VETRA_BIN claude-login"
    return 0
  fi

  step "Set up Claude auth"
  info "Vetra calls Claude. How do you want to authenticate?"
  info "  [1] Paste an Anthropic API key  (console.anthropic.com)"
  info "  [2] Log in with a Claude.ai subscription"
  info "  [3] Skip — set it up later"
  printf '    Choose [1/2/3]: '
  read -r choice < "$TTY" || choice=3
  case "$choice" in
    1)
      printf '    Paste your ANTHROPIC_API_KEY (hidden): '
      stty -echo 2>/dev/null < "$TTY" || true
      read -r key < "$TTY" || key=
      stty echo 2>/dev/null < "$TTY" || true
      printf '\n'
      if [ -n "$key" ]; then
        ANTHROPIC_API_KEY="$key"; export ANTHROPIC_API_KEY
        persist_env ANTHROPIC_API_KEY "$key"
      else
        warn "no key entered — skipping."
      fi
      ;;
    2)
      vbin=$(vetra_path || true)
      if [ -n "$vbin" ]; then
        step "Launching \`$VETRA_BIN claude-login\`"
        "$vbin" claude-login < "$TTY" || warn "claude-login did not complete — run \`$VETRA_BIN claude-login\` again anytime."
      else
        warn "\`$VETRA_BIN\` not resolvable yet — open a new terminal, then run \`$VETRA_BIN claude-login\`."
      fi
      ;;
    *)
      info "Skipped. Authenticate later with \`export ANTHROPIC_API_KEY=...\` or \`$VETRA_BIN claude-login\`."
      ;;
  esac
}

# ------------------------------------------------------------- launch --------
finish() {
  vbin=$(vetra_path || true)
  printf '\n'
  ok "Vetra CLI installed."
  [ -n "$vbin" ] && info "$("$vbin" --version 2>/dev/null | head -1 || echo "$VETRA_PKG")"
  info "Run ${c_blu}$VETRA_BIN${c_rst} to start the agent — it prints ${c_dim}http://localhost:8090/d/<driveId>${c_rst}."

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
require_pm
[ -n "$REGISTRY" ] && { export CLINT_REGISTRY="$REGISTRY"; }  # ensure-ph + runtime hit the same registry
export APOLLO_TELEMETRY_DISABLED=1
install_vetra
install_ph
ensure_path
setup_auth
finish
