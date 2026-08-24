# Environment Variable Contract

Never place secret values in this document, source control, browser bundles or logs.

## Release and database

| Variable                    | Local         | Testing                       | Production                      | Notes                                       |
| --------------------------- | ------------- | ----------------------------- | ------------------------------- | ------------------------------------------- |
| `APP_ENVIRONMENT`           | `development` | `testing`                     | `production`                    | Explicit environment boundary               |
| `APP_RELEASE_SHA`           | optional      | required for handoff identity | required                        | Immutable Git/base commit identity          |
| `APP_RELEASE_SOURCE_DIGEST` | optional      | required for handoff identity | required, 64 hex                | Digest from `npm run release:source-digest` |
| `DATABASE_URL`              | loopback DB   | Testing DB                    | dedicated Production DB         | Production localhost is rejected            |
| `SESSION_SECRET`            | required      | required                      | required, unique and >=32 chars | Server only                                 |

## Platform MFA and payroll payment encryption

- `MFA_ACTIVE_KEY_VERSION`
- `MFA_ENCRYPTION_KEYS`
- `PAYROLL_PAYMENT_ACTIVE_KEY_VERSION`
- `PAYROLL_PAYMENT_ENCRYPTION_KEYS`
- `PAYROLL_PAYMENT_FINGERPRINT_KEY`

All are required in Production, must be Production-specific and must follow the existing key-version format. Never overwrite an old decryption key while records still depend on it.

## Employee OTP

- `SMS_PROVIDER`: `mock` for Local automated regression; `sms123` for real Online Testing and future Production.
- `OTP_PROVIDER`: temporary compatibility alias; new configuration should use `SMS_PROVIDER`.
- `OTP_CHANNEL`: `local` with mock, `sms` with SMS123.
- `EMPLOYEE_OTP_SEND_MODE`: legacy compatibility alias.
- `EMPLOYEE_OTP_TESTING_ENABLED`: permits mock only when explicitly `true` and `RAILWAY_ENVIRONMENT_NAME=testing`.
- `EMPLOYEE_OTP_MOCK_CODE`: forbidden in the Production deployment; allowed in an explicitly marked Railway Testing deployment.
- `EMPLOYEE_OTP_MOCK_ACCESS_KEY`: Local/Testing only; never expose through an API response.
- `SMS123_ENABLED`
- `SMS123_API_KEY`
- `SMS123_API_BASE_URL`
- `SMS123_MESSAGE_PREFIX`
- `OTP_LENGTH`, fixed at `6`
- `OTP_TTL_SECONDS`
- `OTP_RESEND_COOLDOWN_SECONDS`
- `OTP_MAX_VERIFY_ATTEMPTS`
- `STAFF_OTP_VERIFY_PHONE_HOURLY_LIMIT`
- `STAFF_OTP_VERIFY_IP_HOURLY_LIMIT`
- `STAFF_OTP_PROVIDER_TIMEOUT_MS`

Credentials are server-only and must never use a `NEXT_PUBLIC_` prefix. SMS123 only delivers the message. Tetamu generates the code with a cryptographic RNG, stores a challenge-bound HMAC and performs expiry, attempt and one-time verification. Online Testing normally uses separate SMS123 credentials, but may temporarily use the explicit testing-only mock gate while delivery is blocked. Production configuration and smoke remain Production Owner actions.

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
