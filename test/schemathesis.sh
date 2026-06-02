#!/usr/bin/env bash
set -euo pipefail

# Schemathesis contract test runner
# Validates every API endpoint against the OpenAPI specification.
#
# Usage:
#   ./test/schemathesis.sh                  # quick smoke (5 examples per endpoint)
#   ./test/schemathesis.sh --full           # exhaustive (50 examples per endpoint)
#   SKIP_SERVER=1 ./test/schemathesis.sh    # skip server start (server already running)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OPENAPI_SPEC="$PROJECT_DIR/docs/openapi.yaml"

if [ ! -f "$OPENAPI_SPEC" ]; then
  echo "ERROR: OpenAPI spec not found at $OPENAPI_SPEC"
  echo "Run 'npm run generate:openapi' first."
  exit 1
fi

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-3001}"
BASE_URL="http://${HOST}:${PORT}"
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    echo "Stopping server (PID $SERVER_PID)..."
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# Determine checks and hypotheses count
if [ "${1:-}" = "--full" ]; then
  HYPOTHESES=50
  CHECKS="all"
else
  HYPOTHESES=5
  CHECKS="status_code_convention"
fi

if [ -z "${SKIP_SERVER:-}" ]; then
  echo "Starting API server on $BASE_URL..."
  cd "$PROJECT_DIR"
  npm run build 2>/dev/null || echo "Build skipped (using ts-node)"
  node dist/main.js &
  SERVER_PID=$!

  # Wait for server to be ready
  for i in $(seq 1 30); do
    if curl -s "$BASE_URL/health" >/dev/null 2>&1; then
      echo "Server is ready."
      break
    fi
    if [ "$i" -eq 30 ]; then
      echo "ERROR: Server failed to start within 30 seconds."
      exit 1
    fi
    sleep 1
  done
fi

echo "Running Schemathesis against $OPENAPI_SPEC..."
echo "Base URL: $BASE_URL"
echo "Hypotheses per endpoint: $HYPOTHESES"
echo "Checks: $CHECKS"
echo ""

schemathesis run \
  --url "$BASE_URL" \
  --checks "$CHECKS" \
  --max-examples "$HYPOTHESES" \
  --request-timeout 5000 \
  "$OPENAPI_SPEC" 2>&1

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "SUCCESS: All contract tests passed."
else
  echo "FAILURE: Some contract tests failed (exit code $EXIT_CODE)."
fi

exit $EXIT_CODE
