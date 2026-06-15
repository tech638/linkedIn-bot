#!/usr/bin/env bash
# Run the v1.1 daemon (5 cycles/day, active hours, verify every 30 min).
# Use with systemd or: nohup ./scripts/run-daemon.sh >> logs/daemon.log 2>&1 &
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mkdir -p logs

export DISPLAY="${DISPLAY:-:0}"

echo "=== $(date -Iseconds) LinkedIn bot daemon starting ==="
echo "Project: $ROOT"
echo "Config: lib/hardcoded-config.js"
echo "DISPLAY=$DISPLAY"

exec node index.js
