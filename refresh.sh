#!/usr/bin/env bash
# Refresh the site: rebuild the reference pages, then overlay live ShelterLuv data.
set -euo pipefail
cd "$(dirname "$0")"

# Never let two syncs write the site at the same time.
exec 9>.sync.lock
flock -n 9 || { echo "Another sync is already running; nothing to do."; exit 0; }

python3 build.py
python3 sync.py
echo
echo "Site is up to date in files/foss-clone."
