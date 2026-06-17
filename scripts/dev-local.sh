#!/usr/bin/env bash
# One command to run Grimoire locally: kills stale processes, clears the Next
# cache, then starts API (:3001) and web (:3000). Ctrl+C stops both.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/web"

bash "$ROOT/scripts/dev-stop.sh"
sleep 1

echo "Clearing Next.js cache ($WEB/.next)..."
rm -rf "$WEB/.next"

cleanup() {
  echo ""
  echo "Shutting down..."
  kill "$API_PID" "$WEB_PID" 2>/dev/null || true
  wait "$API_PID" "$WEB_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "Starting API on http://localhost:3001 ..."
(
  cd "$ROOT"
  PORT=3001 exec node index.js
) &
API_PID=$!

echo "Starting web on http://localhost:3000 ..."
(
  cd "$WEB"
  exec npm run dev
) &
WEB_PID=$!

echo ""
echo "Grimoire is running."
echo "  Web: http://localhost:3000"
echo "  API: http://localhost:3001"
echo "Press Ctrl+C to stop both."
echo ""

wait "$API_PID" "$WEB_PID"
