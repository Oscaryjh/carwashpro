#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
test ! -f .env
test ! -f .env.local
test "$(node --version)" = "v$(tr -d '\r\n' < .node-version)"
if [ "$(npm --version)" != "11.12.1" ]; then
  npm install --global npm@11.12.1
fi
npm ci
./node_modules/.bin/prisma generate
