#!/usr/bin/env bash
# Builds dist/, serves it on 127.0.0.1 and runs every website check. Logs go to qa-output/.
set -uo pipefail
QA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBSITE="$(cd "$QA_DIR/../.." && pwd)"
PORT="${QA_PORT:-8790}"
export QA_BASE="http://127.0.0.1:$PORT/"
export QA_OUT="${QA_OUT:-$WEBSITE/qa-output}"
LOGS="$QA_OUT/logs"
mkdir -p "$LOGS"

if [ ! -x "$WEBSITE/node_modules/.bin/lighthouse" ]; then
  echo "QA dependencies missing: run 'pnpm install' in website/ first." >&2
  exit 2
fi

python3 -I "$WEBSITE/build.py" | tee "$LOGS/build.log" || exit 1

if curl -sS -o /dev/null "$QA_BASE" 2>/dev/null; then
  echo "port $PORT is already in use; stop that server or set QA_PORT" >&2
  exit 2
fi
: >"$LOGS/server-ready.log"
python3 -I "$QA_DIR/serve.py" "$PORT" "$WEBSITE/dist" >"$LOGS/server-ready.log" 2>"$LOGS/http.log" &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null' EXIT
for _ in $(seq 1 50); do
  grep -qx "listening $PORT" "$LOGS/server-ready.log" && break
  kill -0 "$SERVER" 2>/dev/null || break
  sleep 0.2
done
if ! grep -qx "listening $PORT" "$LOGS/server-ready.log" || ! kill -0 "$SERVER" 2>/dev/null ||
  ! curl -fsS -o /dev/null "$QA_BASE"; then
  echo "QA server did not start on $QA_BASE (see $LOGS/http.log)" >&2
  exit 1
fi

FAILED=()
check() {
  local name="$1"
  shift
  if "$@" >"$LOGS/$name.log" 2>&1; then
    echo "PASS $name"
  else
    echo "FAIL $name (see $LOGS/$name.log)"
    FAILED+=("$name")
  fi
}

check scan node "$QA_DIR/scan.cjs"
check qa-no-preference node "$QA_DIR/qa.cjs" no-preference
check qa-reduce node "$QA_DIR/qa.cjs" reduce
check nav node "$QA_DIR/nav.cjs"
for lang in en zh; do
  for width in 1440 768 390; do
    check "a11y-$lang-$width" env QA_LANG="$lang" QA_WIDTH="$width" node "$QA_DIR/a11y.cjs"
    check "csp-$lang-$width" env QA_LANG="$lang" QA_WIDTH="$width" node "$QA_DIR/csp.cjs"
    check "pause-$lang-$width" env QA_LANG="$lang" QA_WIDTH="$width" node "$QA_DIR/pause.cjs"
  done
done
check copy-generate node "$QA_DIR/../copy.cjs" "$QA_OUT/COPY.md"
check copy-current diff -u "$WEBSITE/docs/COPY.md" "$QA_OUT/COPY.md"
check lighthouse bash "$QA_DIR/lighthouse.sh"

{
  grep -h "^qa \|^nav:\|^pause:" "$LOGS"/qa-*.log "$LOGS"/nav.log "$LOGS"/pause-*.log
  grep -h "^lh-\|PASS lighthouse\|FAIL lighthouse" "$LOGS/lighthouse.log"
  grep -h "^files " "$LOGS/scan.log"
} >"$QA_OUT/summary.txt"
cat "$QA_OUT/summary.txt"

if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "FAILED: ${FAILED[*]}"
  exit 1
fi
echo "ALL WEBSITE CHECKS PASSED (artifacts: $QA_OUT)"
