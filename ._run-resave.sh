#!/bin/bash
cd /Users/mujahidomer/Documents/my-grimoire/grimoire
LOG=/private/tmp/claude-501/-Users-mujahidomer-kitabi/6cd5dba4-0f26-4a5d-8409-a049b0ae6e62/scratchpad
mkdir -p "$LOG"
ALLOW_DEV_USER_FALLBACK=true NODE_ENV=development node index.js > "$LOG/server.log" 2>&1 &
SRV=$!
for i in $(seq 1 30); do
  sleep 1
  curl -sf -m 2 http://localhost:3001/health > /dev/null && break
done
echo "server up (pid $SRV)"
node ._resave.js 2>&1 | grep -v "^\[anthropic\]"
echo "--- done, stopping server ---"
kill $SRV 2>/dev/null
rm -f ._resave.js ._run-resave.sh
