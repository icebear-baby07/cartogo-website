#!/usr/bin/env bash
set -euo pipefail

CHATBOT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$CHATBOT_ROOT/../.." && pwd)"
ENVIRONMENT_PATH="$PROJECT_ROOT/.venv-chatbot"
ENVIRONMENT_PYTHON="$ENVIRONMENT_PATH/bin/python"
PORT="${CARTOGO_CHAT_PORT:-8003}"

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1024 || PORT > 65535 )); then
  echo "CARTOGO_CHAT_PORT must be a port number between 1024 and 65535." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3.10 or newer is required." >&2
  exit 1
fi
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || {
  echo "Python 3.10 or newer is required." >&2
  exit 1
}

if [[ ! -x "$ENVIRONMENT_PYTHON" ]]; then
  echo "Creating the isolated chatbot Python environment..."
  python3 -m venv "$ENVIRONMENT_PATH"
fi

"$ENVIRONMENT_PYTHON" -m pip install -r "$CHATBOT_ROOT/requirements.txt"

if [[ ! -f "$CHATBOT_ROOT/.env" && -f "$CHATBOT_ROOT/.env.example" ]]; then
  cp "$CHATBOT_ROOT/.env.example" "$CHATBOT_ROOT/.env"
  echo "Created apps/chatbot/.env from its example. Configure MongoDB and AWS settings to enable full chatbot features." >&2
fi

export PORT
cd "$CHATBOT_ROOT"
echo "Starting the Version II chatbot on port $PORT..."
exec "$ENVIRONMENT_PYTHON" -u "$CHATBOT_ROOT/server.py"
