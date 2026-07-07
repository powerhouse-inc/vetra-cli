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
#   VETRA_PM         package manager: npm | pnpm             (default: pnpm — offers to install it if missing, else npm)
#   VETRA_SKIP_PH=1  don't install ph-cmd (rely on first-boot ensure-ph)
#   VETRA_YES=1      non-interactive: accept defaults, never prompt
#   VETRA_NO_LAUNCH=1  install only, don't offer to launch
set -eu

VETRA_PKG="vetra-cli"
VETRA_BIN="vetra"
PH_PKG="ph-cmd"
PH_BIN="ph"
PNPM_MAJOR="11"
MIN_NODE_MAJOR=24

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
    "Node.js >= ${MIN_NODE_MAJOR} is required but not found.
    Install it from https://nodejs.org/en/download, then re-run this script."

  nv=$(node -p 'process.versions.node' 2>/dev/null) || die "could not run node."
  nmaj=$(printf '%s' "$nv" | cut -d. -f1)
  if [ "$nmaj" -lt "$MIN_NODE_MAJOR" ]; then
    die "Node >= ${MIN_NODE_MAJOR} required; found $nv.
    Upgrade from https://nodejs.org/en/download, then re-run this script."
  fi

  # Studio/Reactor/Switchboard ports have no fallback — warn early if taken.
  check_ports 8090 27370 59220
}

# Resolve the package manager. An explicit VETRA_PM must resolve (die if not);
# VETRA_PM=pnpm auto-installs pnpm when missing or older than PNPM_MAJOR. With no
# explicit choice, prefer a usable pnpm, else offer to install it, else npm.
resolve_pm() {
  if [ -n "$PM" ]; then
    if [ "$PM" = pnpm ] && ! pnpm_ok; then
      install_pnpm || die "package manager 'pnpm' (>= $PNPM_MAJOR) requested but install failed."
    fi
    command -v "$PM" >/dev/null 2>&1 || die "package manager '$PM' not found on PATH."
  elif pnpm_ok; then
    PM=pnpm
  elif offer_install_pnpm; then
    PM=pnpm
  else
    PM=npm
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
# Install the latest pnpm 11.x via npm (a method documented at
# https://pnpm.io/installation). npm ships with Node, so it's always available.
# Returns 0 only if pnpm is on PATH afterward.
install_pnpm() {
  step "Installing pnpm@latest-$PNPM_MAJOR with npm"
  npm install -g "pnpm@latest-$PNPM_MAJOR" || { warn "pnpm install failed; falling back to npm."; return 1; }
  command -v pnpm >/dev/null 2>&1
}

# 0 if a usable pnpm (major >= PNPM_MAJOR) is on PATH. Only the major is checked
# — any pnpm 11.x is fine.
pnpm_ok() {
  command -v pnpm >/dev/null 2>&1 || return 1
  pmaj=$(pnpm --version 2>/dev/null | cut -d. -f1)
  case "$pmaj" in ''|*[!0-9]*) return 1 ;; esac
  [ "$pmaj" -ge "$PNPM_MAJOR" ]
}

# pnpm missing or too old: offer to install pnpm 11. Yes (the default) installs;
# no falls back to npm. Non-interactive runs skip the prompt and fall back to npm
# (matching how finish() declines to auto-launch without a TTY).
offer_install_pnpm() {
  interactive || return 1
  if command -v pnpm >/dev/null 2>&1; then
    printf '\n    pnpm %s is older than %s. Upgrade it now (recommended)? [Y/n]: ' "$(pnpm --version 2>/dev/null)" "$PNPM_MAJOR"
  else
    printf '\n    pnpm is not installed. Install it now (recommended)? [Y/n]: '
  fi
  read -r ans < "$TTY" || ans=n
  case "$ans" in ""|y|Y|yes|YES) install_pnpm && return 0 ;; esac
  return 1
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
  info "open a new terminal (or run \`export PATH=\"$bin:\$PATH\"\`) so \`$VETRA_BIN\` resolves."
}

# --------------------------------------------------------- stale copies ------
# A bin already on PATH before we install can shadow the fresh one — most
# commonly an older copy under a *different* package manager's global bin (e.g. a
# past `npm i -g` while we now install with pnpm), which stays earlier on PATH.
# $1 = the bin's pre-install path (captured in main before resolve_pm mutates
# PATH), $2 = bin name, $3 = package name to uninstall.
check_shadow() {
  stale="$1"; bin="$2"; pkg="$3"
  [ -n "$stale" ] || return 0
  mine=$(global_bin)/"$bin"
  [ "$stale" = "$mine" ] && return 0   # reinstalled in place — fine
  npmbin=$(npm prefix -g 2>/dev/null)/bin
  pnpmbin="${PNPM_HOME:-$HOME/.local/share/pnpm}/bin"
  ucmd=
  case "$stale" in
    "$npmbin"/*)  ucmd="npm rm -g $pkg" ;;
    "$pnpmbin"/*) command -v pnpm >/dev/null 2>&1 && ucmd="pnpm rm -g $pkg" ;;
  esac
  warn "an older \`$bin\` at $stale may shadow the one just installed at $mine."
  if [ -n "$ucmd" ] && interactive; then
    printf '    Remove the old copy now (%s)? [Y/n]: ' "$ucmd"
    read -r a < "$TTY" || a=n
    case "$a" in
      ""|y|Y|yes|YES) step "Removing the old $pkg"
        $ucmd >/dev/null 2>&1 && info "removed $stale" || warn "removal failed; run: $ucmd" ;;
    esac
  elif [ -n "$ucmd" ]; then
    info "remove it with: $ucmd"
  else
    info "remove $stale manually, or ensure $(global_bin) precedes it on your PATH."
  fi
}

# Check both bins we install. Skip ph when we didn't install it (VETRA_SKIP_PH).
warn_if_shadowed() {
  check_shadow "${STALE_VETRA:-}" "$VETRA_BIN" "$VETRA_PKG"
  [ "${VETRA_SKIP_PH:-}" = "1" ] || check_shadow "${STALE_PH:-}" "$PH_BIN" "$PH_PKG"
}

# ---------------------------------------------------------------- verify -----
# Final sanity check: each bin we installed exists at our global bin, actually
# executes (`--version` — catches a broken install: dangling module / wrong
# NODE_PATH), and is what the shell resolves when you type it (catches a leftover
# copy still winning on PATH). Runs after warn_if_shadowed so any removal counts.
verify_install() {
  set -- "$VETRA_BIN:$VETRA_PKG"
  [ "${VETRA_SKIP_PH:-}" = "1" ] || set -- "$@" "$PH_BIN:$PH_PKG"
  problems=0
  for pair in "$@"; do
    bin=${pair%%:*}; pkg=${pair#*:}
    mine=$(global_bin)/"$bin"
    if [ ! -x "$mine" ]; then
      warn "$pkg: \`$bin\` not found at $mine after install."; problems=1; continue
    fi
    if ! "$mine" --version >/dev/null 2>&1; then
      warn "$pkg: \`$bin\` at $mine does not run (\`$bin --version\` failed)."; problems=1; continue
    fi
    resolved=$(command -v "$bin" 2>/dev/null || true)
    if [ "$resolved" != "$mine" ]; then
      warn "\`$bin\` resolves to ${resolved:-<nothing on PATH>}, not $mine — restart your shell or fix PATH order."; problems=1
    fi
  done
  [ "$problems" = 0 ] && info "verified: the installed bins run and resolve from $(global_bin)."
  return 0
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
# capture any pre-existing bins before resolve_pm touches PATH (shadow check)
STALE_VETRA=$(command -v "$VETRA_BIN" 2>/dev/null || true)
STALE_PH=$(command -v "$PH_BIN" 2>/dev/null || true)
resolve_pm
export APOLLO_TELEMETRY_DISABLED=1
install_vetra
install_ph
ensure_path
warn_if_shadowed
verify_install
finish
