#!/bin/bash
# Full rebuild of both Roomvi screenshot sets across every locale.
set -e
cd "$(dirname "$0")/.."
WORK="$HOME/Desktop/Roomvi — скриншоты/_work"
for set in A B; do
  echo "=== set $set ==="
  python3 "$WORK/build_state.py" "$set"
  sleep 3
  node cli/render-export.mjs --concurrency 5 || echo "set $set had failures"
done
