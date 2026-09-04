# Environment Variable Contract

Never place secret values in this document, source control, browser bundles or logs.

## Release and database

| Variable | Local | Testing | Production | Notes |
|---|---|---|---|---|
| `APP_ENVIRONMENT` | `development` | `testing` | `production` | Explicit environment boundary |
| `APP_RELEASE_SHA` | optional | required for handoff identity | required | Immutable Git/base commit identity |
| `APP_RELEASE_SOURCE_DIGEST` | optional | required for handoff identity | required, 64 hex | Digest from `npm run release:source-digest` |
| `DATABASE_URL` | loopback DB | Testing DB | dedicated Production DB | Production localhost is rejected |
| `SESSION_SECRET` | required | required | required, unique and >=32 chars | Server only |

## Platform MFA and payroll payment encryption

- `MFA_ACTIVE_KEY_VERSION`
- `MFA_ENCRYPTION_KEYS`
- `PAYROLL_PAYMENT_ACTIVE_KEY_VERSION`
- `PAYROLL_PAYMENT_ENCRYPTION_KEYS`
- `PAYROLL_PAYMENT_FINGERPRINT_KEY`

All are required in Production, must be Production-specific and must follow the existing key-version format. Never overwrite an old decryption key while records still depend on it.

## Employee OTP

- `OTP_PROVIDER`: `mock` for Local automated regression; `twilio_verify` or `sms123` for real SMS.
- `OTP_CHANNEL`: `local` with mock; `sms` with Twilio Verify or SMS123.
- `EMPLOYEE_OTP_SEND_MODE`: temporary compatibility alias; new configuration should use `OTP_PROVIDER`.
- `EMPLOYEE_OTP_MOCK_CODE`: forbidden in Production.
- `EMPLOYEE_OTP_MOCK_ACCESS_KEY`: Local/Testing only; never expose through an API response.
- `TWILIO_ACCOUNT_SID`
- `TWILIO_VERIFY_SERVICE_SID`
- `TWILIO_AUTH_TOKEN`, or the preferred `TWILIO_API_KEY_SID` + `TWILIO_API_KEY_SECRET` pair
- `SMS123_API_KEY` when `OTP_PROVIDER=sms123`
- `STAFF_OTP_VERIFY_PHONE_HOURLY_LIMIT`
- `STAFF_OTP_VERIFY_IP_HOURLY_LIMIT`
- `STAFF_OTP_PROVIDER_TIMEOUT_MS`

Credentials are server-only and must never use a `NEXT_PUBLIC_` prefix. Twilio Verify owns code generation and checking for `twilio_verify`. With `sms123`, Tetamu generates a six-digit code, sends it through SMS123, and stores only a keyed OTP hash; plaintext codes and the SMS123 key are never persisted or logged. Testing and Production credentials must remain separate. Production configuration and smoke remain Production Owner actions.

## WhatsApp

- `WHATSAPP_SEND_MODE`: Local/Testing may use `mock`; Production workers require `live`.
- `WHATSAPP_CONNECTOR_URL`
- `WHATSAPP_CONNECTOR_SECRET`
- connector port/session storage variables used by the connector service

Use distinct Testing and Production connector sessions. `mock` is a startup error for Production notification/WhatsApp worker scopes.

## OpenAI

- `AI_GLOBAL_ENABLED`: set `false` for safe disablement.
- `AI_PROVIDER`: Production AI, when enabled, requires `openai`.
- `OPENAI_API_KEY`: required only when Production AI is enabled; server-side only.
- Model/usage/quota variables documented by the AI usage module.

Testing and Production must use separate Projects and keys. Quota/provider errors must be surfaced safely and must not enable write actions.

## Private attachment storage

- `CLAIM_PRIVATE_STORAGE_PROVIDER`
- `CLAIM_PRIVATE_STORAGE_ROOT` for Local filesystem mode only
- `CLAIM_PRIVATE_STORAGE_S3_ENDPOINT`
- `CLAIM_PRIVATE_STORAGE_S3_REGION`
- `CLAIM_PRIVATE_STORAGE_S3_BUCKET`
- `CLAIM_PRIVATE_STORAGE_S3_ACCESS_KEY_ID`
- `CLAIM_PRIVATE_STORAGE_S3_SECRET_ACCESS_KEY`
- `CLAIM_PRIVATE_STORAGE_S3_PREFIX`
- `CLAIM_PRIVATE_STORAGE_S3_FORCE_PATH_STYLE`

Production should use a private S3-compatible bucket, least-privilege credentials, HTTPS and a malware/privacy scan workflow. Until scan status is `CLEAN` and metadata status is `SAFE` or `SANITIZED`, download remains blocked.

## Public logo and profile-photo storage

- `PUBLIC_IMAGE_STORAGE_PROVIDER`: `s3` for the independently deployed Staff App. Local development may leave this unset to retain filesystem uploads.
- `PUBLIC_IMAGE_S3_ENDPOINT`, `PUBLIC_IMAGE_S3_REGION`, `PUBLIC_IMAGE_S3_BUCKET`, `PUBLIC_IMAGE_S3_ACCESS_KEY_ID`, `PUBLIC_IMAGE_S3_SECRET_ACCESS_KEY`, `PUBLIC_IMAGE_S3_FORCE_PATH_STYLE`: server-only S3-compatible storage configuration.
- `PUBLIC_IMAGE_S3_PREFIX`: must be `public-images/<local|testing|production>/vN`, matching the application environment. Never use a claim-receipt or leave-evidence prefix. The bucket stays private; only strict UUID filenames in the three image namespaces can be served by the image routes.
- `PUBLIC_IMAGE_BASE_URL`: HTTPS Staff serving origin. New image records store absolute URLs so the POS can display them without sharing the Staff container filesystem.
- `PUBLIC_IMAGE_LEGACY_ORIGIN`: optional trusted HTTPS POS origin, with no path or credentials. Missing legacy images can be read from its persistent upload volume. Requests never forward employee cookies, follow redirects, or recursively proxy between services.

Testing may reuse the existing S3 account/bucket through separately configured image variables and the isolated `public-images/testing/v1` prefix. Do not change bucket visibility, private attachment configuration, or attachment authorization. Production must use its own explicit configuration.

The existing POS release can continue saving legacy images to its persistent upload volume; Staff reads those through the legacy origin. Staff uploads use S3 and an absolute serving URL immediately, without requiring a POS deployment or database migration. When POS adopts this image adapter, configure the same environment-specific S3 prefix there too.

Before publishing, verify a synthetic image write/read, a second-process read, and the known existing logo path. After publishing, verify the same synthetic object through the public image route, remove only that synthetic object, and verify a deleted/missing image falls back to employee initials. Never substitute a synthetic image for a real employee's missing photo.

## Controlled Platform Admin bootstrap

- `ALLOW_PRODUCTION_PLATFORM_ADMIN_BOOTSTRAP`: normally `false`; set `true` only during an authorised one-time bootstrap.
- `SEED_ADMIN_EMAIL`: explicit Production identifier; no default.
- `SEED_ADMIN_PASSWORD`: explicit strong value, at least 16 characters; no default.

Production seeding refuses to run when a Platform Admin already exists. Return the allow flag to `false` immediately after bootstrap and enroll TOTP MFA.

## Validation

Run the appropriate startup command or:

```text
node scripts/validate-release-environment.mjs web
node scripts/validate-release-environment.mjs notification
node scripts/validate-release-environment.mjs analytics
node scripts/validate-release-environment.mjs whatsapp
```

The validator checks names/presence and fail-closed mock rules. It intentionally never prints secret values.
