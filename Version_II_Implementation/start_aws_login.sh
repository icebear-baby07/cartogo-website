#!/usr/bin/env bash
set -euo pipefail

if ! command -v aws >/dev/null 2>&1; then
  echo "AWS CLI was not found. Install AWS CLI v2 to use the Bedrock chatbot." >&2
  exit 1
fi

echo "Starting AWS sign-in. Complete the browser/device verification if prompted."
aws login
echo "AWS login completed."
