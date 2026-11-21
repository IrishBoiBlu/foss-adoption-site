#!/usr/bin/env bash
# Keeps the pet pages current: pulls ShelterLuv data every 30 minutes.
#   ./scheduler.sh          # foreground (or use nohup/setsid in the background)
#   SYNC_INTERVAL=600 ./scheduler.sh
set -uo pipefail
cd "$(dirname "$0")"

INTERVAL="${SYNC_INTERVAL:-1800}"

echo "=== scheduler started $(date '+%Y-%m-%d %H:%M:%S'), every ${INTERVAL}s" >> sync.log
while true; do
  echo "--- $(date '+%Y-%m-%d %H:%M:%S') syncing" >> sync.log
  # A normal cycle only needs sync.py (seconds, and it only fetches what
  # changed). refresh.sh is the slower rebuild used when the site is missing.
  if [ -f "files/foss-clone/index.html" ]; then
    TASK=./sync-one.sh
  else
    TASK=./refresh.sh
  fi
  if $TASK >> sync.log 2>&1; then
    echo "--- $(date '+%Y-%m-%d %H:%M:%S') ok" >> sync.log
  else
    echo "--- $(date '+%Y-%m-%d %H:%M:%S') FAILED" >> sync.log
  fi
  sleep "$INTERVAL"
done
