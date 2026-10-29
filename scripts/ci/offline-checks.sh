#!/usr/bin/env bash
# Run inside a fresh Linux network namespace, after dependency installation.
set -euo pipefail
cd "$(dirname "$0")/../.."
test ! -f .env
test ! -f .env.local
ip link set lo up
export CI=true NODE_OPTIONS=--max-old-space-size=8192
export DATABASE_URL='postgresql://postgres@127.0.0.1:1/tetamu_ci_offline?schema=public'
export APP_ENVIRONMENT=development AI_GLOBAL_ENABLED=false
export WHATSAPP_SEND_MODE=mock OTP_PROVIDER=mock OTP_CHANNEL=local
export TESTING_EMAIL_MODE=disabled PAYMENT_EXPORT_ENABLED=false STATUTORY_OFFICIAL_SUBMISSION_ENABLED=false
node --import tsx --test \
  tests/unit/canonical-migration-manifest.test.ts \
  tests/unit/canonical-migration-history.test.ts \
  tests/unit/release-environment-validator.test.ts \
  tests/unit/login-feedback.test.ts \
  tests/unit/pwa-runtime-update.test.ts
npx --no-install next typegen
npx --no-install tsc --noEmit --incremental false
npx --no-install eslint scripts/ci/migration-disposable.mjs
npm run build
