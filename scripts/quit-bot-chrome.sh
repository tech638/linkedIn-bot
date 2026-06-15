#!/usr/bin/env bash
# Close only the bot/dummy Chrome profile (does not touch your personal Chrome).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BOT_DATA="$(node -e "require('$ROOT/lib/bootstrap'); console.log(process.env.CHROME_BOT_DATA_DIR)")"
LOCK="$BOT_DATA/SingletonLock"

echo "Closing bot Chrome ($BOT_DATA)..."

if [ -L "$LOCK" ]; then
  target="$(readlink "$LOCK" 2>/dev/null || true)"
  pid="${target##*-}"
  if [ -n "$pid" ] && [ "$pid" -eq "$pid" ] 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 1
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$LOCK" "$BOT_DATA/SingletonSocket" "$BOT_DATA/SingletonCookie" 2>/dev/null || true
fi

echo "Bot Chrome closed."
