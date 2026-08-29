#!/bin/sh
# -----------------------------------------------------------------------------
# Supervises the two processes that make up the combined image:
#   1. apps/server  on $SERVER_PORT   (internal — only Next's rewrites hit it)
#   2. apps/web     on $PORT          (public — Render routes traffic here)
#
# If EITHER process exits, tear down the other and exit non-zero so the
# orchestrator restarts the whole container rather than leaving it half-up.
# SIGTERM/SIGINT are forwarded to both so the server's graceful shutdown
# (db/connection.ts registerGracefulShutdown) runs on `render` deploys/stops.
# -----------------------------------------------------------------------------
set -eu

SERVER_PORT="${SERVER_PORT:-4000}"
WEB_PORT="${PORT:-3000}"

# The server reads PORT from its own env — give it the internal one. It's
# not EXPOSEd and nothing outside the container can route to it; Next
# proxies /api and /socket.io to 127.0.0.1:$SERVER_PORT (baked API_ORIGIN).
PORT="$SERVER_PORT" node apps/server/dist/index.js &
server_pid=$!

PORT="$WEB_PORT" HOSTNAME=0.0.0.0 node apps/web-standalone/apps/web/server.js &
web_pid=$!

shutdown() {
  trap - TERM INT
  kill -TERM "$server_pid" "$web_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
  wait "$web_pid" 2>/dev/null || true
}
trap 'shutdown; exit 143' TERM INT

# Portable supervise loop (busybox ash has no reliable `wait -n`): poll both
# pids ~1s. First exit wins; propagate its status.
while kill -0 "$server_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do
  sleep 1
done

if kill -0 "$server_pid" 2>/dev/null; then
  # web died first
  wait "$web_pid" 2>/dev/null; exit_code=$?
else
  wait "$server_pid" 2>/dev/null; exit_code=$?
fi

shutdown
exit "${exit_code:-1}"
