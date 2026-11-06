#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js 22 or newer and npm are required." >&2
  exit 1
fi
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || {
  echo "Node.js 22 or newer is required." >&2
  exit 1
}

created_env=0
if [[ ! -f apps/api/.env ]]; then
  cp apps/api/.env.example apps/api/.env
  created_env=1
fi
if [[ ! -f apps/website/.env ]]; then
  cp apps/website/.env.example apps/website/.env
  created_env=1
fi
if (( created_env )); then
  echo "Created missing environment files from their examples." >&2
  echo "Configure apps/api/.env and apps/website/.env, then run this script again." >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "Installing Version II JavaScript dependencies..."
  npm ci
fi

echo "Starting Version II API and website..."
exec npm run dev
