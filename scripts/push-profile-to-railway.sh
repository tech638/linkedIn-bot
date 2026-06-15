#!/usr/bin/env bash
# Export local bot Chrome session and import it into Railway /app/data volume.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ARCHIVE="${1:-chrome-profile-export.tar.gz}"

if ! command -v railway >/dev/null 2>&1; then
  echo "Railway CLI not found. Install: npm i -g @railway/cli"
  echo "Then: railway login && railway link"
  exit 1
fi

echo "=== Step 1: Close local bot Chrome ==="
bash scripts/quit-bot-chrome.sh

echo ""
echo "=== Step 2: Export local profile ==="
node scripts/export-chrome-profile.js "$ARCHIVE"

echo ""
echo "=== Step 3: Upload archive (0x0.st) ==="
UPLOAD_URL="$(
  curl -fsS -F "file=@${ARCHIVE}" https://0x0.st 2>/dev/null | tr -d '\r'
)"
if [[ -z "$UPLOAD_URL" || "$UPLOAD_URL" != http* ]]; then
  echo "Upload failed. Upload $ARCHIVE manually, then run:"
  echo "  railway run node scripts/import-chrome-profile.js --url=YOUR_URL"
  exit 1
fi
echo "  Uploaded: $UPLOAD_URL"
echo "  (Link expires — import within a few hours.)"

echo ""
echo "=== Step 4: Import on Railway (volume at /app/data) ==="
echo "  Pause or restart Railway service if the bot is running."
railway run node scripts/import-chrome-profile.js --url="$UPLOAD_URL"

echo ""
echo "✓ Done. Restart Railway service — production should skip login."
