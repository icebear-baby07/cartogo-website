#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if command -v aws >/dev/null 2>&1; then
  bash "$ROOT/start_aws_login.sh"
else
  echo "AWS CLI was not found; continuing without Bedrock sign-in." >&2
fi

bash "$ROOT/apps/chatbot/start_chat.sh" &
CHATBOT_PID=$!
cleanup() {
  kill "$CHATBOT_PID" 2>/dev/null || true
  wait "$CHATBOT_PID" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

bash "$ROOT/start_site.sh"
