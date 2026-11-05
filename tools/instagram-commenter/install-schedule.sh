#!/bin/bash
# Put the commenter on a timer: three batches a day, from your login session.
# Sign in first (node comment-gates.js --login) or every run will stop saying so.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.kitabi.instagram-commenter.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cp "$HERE/com.kitabi.instagram-commenter.plist" "$PLIST"
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "loaded — three runs a day (09:42, 14:17, 19:31)"
echo "stop it any time with:  launchctl unload $PLIST"
