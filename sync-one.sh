#!/usr/bin/env bash
# One incremental ShelterLuv pass: update the pet pages that already exist.
# Used by scheduler.sh; use refresh.sh for a full rebuild.
set -euo pipefail
cd "$(dirname "$0")"

exec 9>.sync.lock
flock -n 9 || { echo "Another sync is already running; nothing to do."; exit 0; }

python3 sync.py
