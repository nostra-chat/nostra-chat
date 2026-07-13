#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
APP_URL="${E2E_APP_URL:-http://127.0.0.1:8080}"
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then kill "$SERVER_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

if ! curl --silent --fail --output /dev/null "$APP_URL"; then
  (cd "$ROOT_DIR" && pnpm start --host 127.0.0.1 --port 8080 --strictPort) > /tmp/nostra-e2e-vite.log 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 90); do
    if curl --silent --fail --output /dev/null "$APP_URL"; then break; fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      tail -100 /tmp/nostra-e2e-vite.log
      exit 1
    fi
    sleep 1
  done
  curl --silent --fail --output /dev/null "$APP_URL"
fi

TESTS=(
  e2e-dev-boot-smoke.ts
  e2e-no-telegram-network.ts
  e2e-seed-recovery.ts
  e2e-contacts-and-sending.ts
  e2e-p2p-edit.ts
  e2e-reactions-bilateral.ts
  e2e-read-receipts.ts
  e2e-send-image.ts
  e2e-send-file.ts
  e2e-groups-bilateral.ts
  e2e-broadcast-channel.ts
  e2e-update-popup.ts
  e2e-update-controlled.ts
)

for test in "${TESTS[@]}"; do
  echo "--- critical E2E: $test ---"
  E2E_APP_URL="$APP_URL" npx tsx "$SCRIPT_DIR/$test"
done

echo "Critical E2E suite passed (${#TESTS[@]} scripts)."
