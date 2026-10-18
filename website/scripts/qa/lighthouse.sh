#!/usr/bin/env bash
# Runs Lighthouse mobile then desktop (sequentially) against the served dist/ and checks the scores.
set -euo pipefail
QA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBSITE="$(cd "$QA_DIR/../.." && pwd)"
BASE="${QA_BASE:-http://127.0.0.1:8790/}"
OUT="${QA_OUT:-$WEBSITE/qa-output}"
LIGHTHOUSE="$WEBSITE/node_modules/.bin/lighthouse"
mkdir -p "$OUT"
"$LIGHTHOUSE" "$BASE" --chrome-flags='--headless=new --no-sandbox' --output=json \
  --output-path="$OUT/lh-mobile.json" --quiet 2>"$OUT/lh-mobile.err"
"$LIGHTHOUSE" "$BASE" --preset=desktop --chrome-flags='--headless=new --no-sandbox' --output=json \
  --output-path="$OUT/lh-desktop.json" --quiet 2>"$OUT/lh-desktop.err"
node "$QA_DIR/lighthouse-check.cjs" "$OUT/lh-mobile.json" "$OUT/lh-desktop.json"
