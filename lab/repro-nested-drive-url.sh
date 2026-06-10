#!/usr/bin/env bash
# Repro: nested-studio drive URLs must carry the proxy origin when vetra-cli
# runs behind its proxy (publicUrl set).
#
# Starts vetra-cli from source with VETRA_PROXY_PUBLIC_URL, scaffolds and
# starts a reactor project the way the agent tools do (one-shot
# reactor-project-init, then /reactor-project-start over the streaming REPL),
# then asserts on the nested studio's served runtime config
# (<proxy>/reactor-project/vetra-studio/powerhouse.config.json):
#
#   FAIL (exit 1)  any connect.drives.defaultDrives[].url has a non-proxy
#                  origin (e.g. http://localhost:4001) — unreachable from a
#                  remote browser.
#   PASS (exit 0)  every drive URL is under
#                  <proxy>/reactor-project/switchboard/d/ and the proxied
#                  drive endpoint answers 200.
#
# Env:
#   PROXY_PORT     proxy port (default 8090)
#   PH_CLI_LINK    optional path to a local @powerhousedao/ph-cli checkout;
#                  linked into the scaffolded project before start so `ph
#                  vetra` runs the local build.
#   REUSE_WORKDIR  reuse an existing workdir (skips the slow ph init) when it
#                  already contains demo/; otherwise a fresh mktemp dir.
#   KEEP_WORKDIR   set to 1 to keep the workdir after the run.
set -u

PROXY_PORT="${PROXY_PORT:-8090}"
PROXY_URL="http://localhost:${PROXY_PORT}"
PROJECT_NAME="demo"
CLI_DIR="$(cd "$(dirname "$0")/../vetra-cli" && pwd)"
LOG="/tmp/repro-nested-drive-url.log"
INIT_LOG="/tmp/repro-nested-drive-url-init.log"

MAIN_PID=""
WORKDIR=""
CLEAN_WORKDIR=0

log() { printf '%s\n' "== $*"; }
fail() { printf '%s\n' "REPRO ERROR: $*" >&2; exit 2; }

cleanup() {
  if [ -n "$MAIN_PID" ] && kill -0 "$MAIN_PID" 2>/dev/null; then
    kill -TERM "$MAIN_PID" 2>/dev/null
    for _ in $(seq 1 30); do
      kill -0 "$MAIN_PID" 2>/dev/null || break
      sleep 1
    done
    kill -KILL "$MAIN_PID" 2>/dev/null
  fi
  # services are spawned via shell; sweep anything still holding our ports
  for p in "$PROXY_PORT" 27370 59220 3001 4001; do
    pids="$(lsof -ti tcp:"$p" 2>/dev/null || true)"
    [ -n "$pids" ] && kill -KILL $pids 2>/dev/null
  done
  if [ "$CLEAN_WORKDIR" = "1" ] && [ -n "$WORKDIR" ] && [ "${KEEP_WORKDIR:-0}" != "1" ]; then
    rm -rf "$WORKDIR"
  fi
}
trap cleanup EXIT

# ── 1. free ports ───────────────────────────────────────────────────────────
for p in "$PROXY_PORT" 27370 59220 3000 3001 4001; do
  pids="$(lsof -ti tcp:"$p" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    log "port $p busy — killing pid(s): $(echo $pids | tr '\n' ' ')"
    kill $pids 2>/dev/null
    sleep 1
    pids="$(lsof -ti tcp:"$p" 2>/dev/null || true)"
    [ -n "$pids" ] && kill -KILL $pids 2>/dev/null
  fi
done

# ── 2. workdir + scaffold ─────────────────────────────────────────────────────
if [ -n "${REUSE_WORKDIR:-}" ]; then
  WORKDIR="$REUSE_WORKDIR"
  mkdir -p "$WORKDIR"
else
  WORKDIR="$(mktemp -d /tmp/vetra-repro.XXXXXX)"
  CLEAN_WORKDIR=1
fi
log "workdir: $WORKDIR"

cd "$CLI_DIR"

export VETRA_ANTHROPIC_API_KEY="${VETRA_ANTHROPIC_API_KEY:-sk-ant-placeholder}"
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-sk-ant-placeholder}"

if [ -f "$WORKDIR/$PROJECT_NAME/package.json" ] && [ -f "$WORKDIR/$PROJECT_NAME/powerhouse.config.json" ]; then
  log "project $PROJECT_NAME already scaffolded — skipping init"
else
  log "scaffolding reactor project (one-shot reactor-project-init; this runs ph init and is slow)"
  if ! pnpm exec tsx src/main.ts --workdir "$WORKDIR" reactor-project-init --name "$PROJECT_NAME" >"$INIT_LOG" 2>&1; then
    tail -40 "$INIT_LOG" >&2
    fail "reactor-project-init failed (full log: $INIT_LOG)"
  fi
  log "init done"
fi

# ── 3. optional: link local ph-cli into the scaffolded project ───────────────
if [ -n "${PH_CLI_LINK:-}" ]; then
  log "linking local ph-cli from $PH_CLI_LINK"
  (cd "$WORKDIR/$PROJECT_NAME" && pnpm add "@powerhousedao/ph-cli@link:$PH_CLI_LINK" --config.minimum-release-age=0 >>"$INIT_LOG" 2>&1) \
    || fail "linking local ph-cli failed (see $INIT_LOG)"
fi

# ── 4. start vetra-cli with proxy publicUrl + start the project ──────────────
# Isolated HOME: ph-clint persists service state user-scope (~/.ph/<cli>/
# services) and adopts/restarts instances from other workdirs at boot, which
# breaks the single-instance reactor-project start. PATH still resolves the
# real `ph`/pnpm.
FAKE_HOME="$WORKDIR/home"
mkdir -p "$FAKE_HOME"
log "starting vetra-cli (proxy publicUrl: $PROXY_URL); log: $LOG"
printf '/reactor-project-start --workdir %s\n' "$PROJECT_NAME" | \
  HOME="$FAKE_HOME" \
  VETRA_PROXY_PUBLIC_URL="$PROXY_URL" \
  VETRA_PROXY_PORT="$PROXY_PORT" \
  pnpm exec tsx src/main.ts -i --workdir "$WORKDIR" >"$LOG" 2>&1 &
MAIN_PID=$!

deadline=$((SECONDS + 600))
while :; do
  if grep -q "Reactor Project is ready" "$LOG" 2>/dev/null; then break; fi
  if grep -Eq "Reactor Project failed|✗ reactor-project:" "$LOG" 2>/dev/null; then
    tail -60 "$LOG" >&2
    fail "reactor-project failed to start (full log: $LOG)"
  fi
  kill -0 "$MAIN_PID" 2>/dev/null || { tail -60 "$LOG" >&2; fail "vetra-cli exited early (full log: $LOG)"; }
  [ "$SECONDS" -ge "$deadline" ] && { tail -60 "$LOG" >&2; fail "timed out waiting for Reactor Project (full log: $LOG)"; }
  sleep 2
done
log "Reactor Project is ready"

# ── 5. assert on the nested studio's served runtime config ───────────────────
CONFIG_URL="$PROXY_URL/reactor-project/vetra-studio/powerhouse.config.json"
CONFIG_JSON=""
for _ in $(seq 1 15); do
  CONFIG_JSON="$(curl -sf "$CONFIG_URL" 2>/dev/null || true)"
  [ -n "$CONFIG_JSON" ] && break
  sleep 2
done
[ -n "$CONFIG_JSON" ] || fail "could not fetch $CONFIG_URL"

RESULT="$(printf '%s' "$CONFIG_JSON" | node -e '
  const chunks = [];
  process.stdin.on("data", (c) => chunks.push(c));
  process.stdin.on("end", () => {
    const cfg = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const drives = cfg.connect?.drives?.defaultDrives ?? [];
    if (drives.length === 0) { console.log("NO_DRIVES"); return; }
    const proxy = process.argv[1];
    for (const d of drives) {
      const ok = new URL(d.url).origin === new URL(proxy).origin ? "OK" : "BAD";
      console.log(`${ok} ${d.url}`);
    }
  });
' "$PROXY_URL")"

echo "$RESULT"
if [ "$RESULT" = "NO_DRIVES" ]; then
  fail "runtime config has no defaultDrives — assertion inconclusive"
fi

if printf '%s\n' "$RESULT" | grep -q '^BAD '; then
  echo
  echo "FAIL: nested studio advertises drive URL(s) with a non-proxy origin:"
  printf '%s\n' "$RESULT" | grep '^BAD ' | sed 's/^BAD /  /'
  echo "(unreachable from a remote browser; expected origin $PROXY_URL)"
  exit 1
fi

# ── 6. drive URLs carry the proxy origin — verify they actually resolve ─────
status=0
while read -r _ url; do
  case "$url" in
    "$PROXY_URL"/reactor-project/switchboard/d/*) ;;
    *) echo "FAIL: drive URL not under $PROXY_URL/reactor-project/switchboard/d/: $url"; status=1; continue ;;
  esac
  code="$(curl -s -o /dev/null -w '%{http_code}' "$url")"
  if [ "$code" != "200" ]; then
    echo "FAIL: proxied drive endpoint $url -> HTTP $code (expected 200)"
    status=1
  else
    echo "OK   proxied drive endpoint $url -> 200"
  fi
done <<EOF
$RESULT
EOF

# outer studio sanity: root must still 302 to /d/<driveId>
root_code="$(curl -s -o /dev/null -w '%{http_code}' "$PROXY_URL/")"
if [ "$root_code" != "302" ]; then
  echo "FAIL: outer studio root $PROXY_URL/ -> HTTP $root_code (expected 302)"
  status=1
else
  echo "OK   outer studio root -> 302"
fi

[ "$status" = "0" ] && echo "PASS: nested studio drive URLs carry the proxy origin"
exit "$status"
