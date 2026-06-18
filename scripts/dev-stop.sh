#!/usr/bin/env bash
# Stop all Grimoire local dev processes (API :3001, web :3000, stray nodemon).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti :"$port" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "Stopping process(es) on port $port: $pids"
    kill -9 $pids 2>/dev/null || true
  fi
}

kill_port 3000
kill_port 3001

# Orphaned nodemon watchers survive closed terminals and respawn index.js.
while IFS= read -r pid; do
  [ -n "$pid" ] || continue
  echo "Stopping nodemon $pid"
  kill -9 "$pid" 2>/dev/null || true
done < <(pgrep -f "$ROOT/node_modules/.bin/nodemon index.js" 2>/dev/null || true)

# Stray API processes survive port kills if they restarted on a different port.
while IFS= read -r pid; do
  [ -n "$pid" ] || continue
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
  [ "$cwd" = "$ROOT" ] || continue
  echo "Stopping node index.js $pid"
  kill -9 "$pid" 2>/dev/null || true
done < <(pgrep -f "node index.js" 2>/dev/null || true)

echo "Grimoire dev processes stopped."
