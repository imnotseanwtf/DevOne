#!/usr/bin/env bash
# Launches the installed DevOne (Tauri) under a virtual display and checks that it
# really works: the server answers, and killing the app leaves nothing behind.
# Run as a normal user (PostgreSQL refuses root) with the .deb installed:
#   xvfb-run -a ./desktop-tauri/smoke-test.sh
set -u

APP="${DEVONE_APP:-devone-tauri}"
PORT="${DEVONE_PORT:-31337}"
DATA="$(mktemp -d)"
export XDG_DATA_HOME="$DATA"          # a fresh data folder, so this is a first launch
export WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 LIBGL_ALWAYS_SOFTWARE=1

fail() { echo "FAIL: $1"; dump_logs; exit 1; }
dump_logs() {
  for f in "$DATA"/*/devone.log; do [ -f "$f" ] && { echo "--- $f"; tail -40 "$f"; }; done
  [ -f "$DATA/app.log" ] && { echo "--- app output"; tail -20 "$DATA/app.log"; }
}
leftovers() { pgrep -u "$(id -u)" -x -a postgres; pgrep -u "$(id -u)" -f 'supervisor.cjs' -a; }

"$APP" > "$DATA/app.log" 2>&1 &
APP_PID=$!

# A fresh install asks where to keep its data. Seeding the choice stands in for
# clicking "Continue" with the built-in database.
sleep 3
APP_DATA="$(ls -d "$DATA"/*/ 2>/dev/null | head -1)"
[ -n "$APP_DATA" ] || fail "the app created no data folder"
echo "first launch: data folder $APP_DATA"
kill -TERM "$APP_PID" 2>/dev/null; wait "$APP_PID" 2>/dev/null
touch "$APP_DATA/setup-done"

"$APP" > "$DATA/app.log" 2>&1 &
APP_PID=$!

echo "waiting for the server on port $PORT"
for _ in $(seq 1 90); do
  kill -0 "$APP_PID" 2>/dev/null || fail "the app exited early"
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" || true)"
  case "$code" in 2*|3*|4*) echo "server answered HTTP $code"; break ;; esac
  sleep 2
done
case "${code:-}" in 2*|3*|4*) ;; *) fail "the server never answered" ;; esac

pgrep -u "$(id -u)" -x postgres >/dev/null || fail "no postgres process while running"

# Kill the shell without any chance to clean up. The supervisor must notice and
# stop Postgres and the server itself.
kill -KILL "$APP_PID"
for _ in $(seq 1 30); do
  [ -z "$(leftovers)" ] && { echo "PASS: server answered and nothing was left running"; exit 0; }
  sleep 1
done
echo "left running:"; leftovers
fail "processes were left running after the app was killed"
