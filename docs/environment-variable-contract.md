# Environment Variable Contract

Never place secret values in this document, source control, browser bundles or logs.

## Release and database

| Variable | Local | Testing | UAT Preview | Production | Notes |
|---|---|---|---|---|---|
| `APP_ENVIRONMENT` | `development` | `testing` | `uat-preview` | `production` | Explicit environment boundary; unknown or missing deployed identities fail closed |
| `APP_RELEASE_SHA` | optional | required for handoff identity | required, full 40-hex SHA | required | Immutable Git/base commit identity |
| `APP_RELEASE_SOURCE_DIGEST` | optional | required for handoff identity | required, 64 hex | required, 64 hex | Digest from `npm run release:source-digest` |
| `DATABASE_URL` | loopback DB | Testing DB | dedicated Preview DB | dedicated Production DB | Production rejects localhost; Preview permits it only for explicit non-deployed simulation |
| `SESSION_SECRET` | required | required | required, unique and >=32 chars | required, unique and >=32 chars | Server only |

## Controlled UAT Preview

`uat-preview` is a first-class, Production-grade runtime environment. It is not
a Testing alias and never falls back to development behavior. Only the `web`
startup scope is permitted; notification, analytics and WhatsApp workers are
startup errors.

The release validator requires all of the following before the web process may
start:

- exact Railway project, environment, web-service and database-service IDs;
- a dedicated database name plus a keyed, 64-hex database fingerprint;
- non-empty protected Testing/Production denylist sets for environment IDs,
  service IDs, database names and database fingerprints;
- the Preview access gate, synthetic fixture guard and Preview-only OTP
  interceptor;
- `NODE_ENV=production`, a full immutable Git SHA and the source digest;
- all payment, bank, government, PCB Production, official export, webhook,
  production storage, cron and worker switches set to `false`;
- all real SMS, Twilio, WhatsApp, email and AI credentials absent.

The database denylist is evaluated before the Preview allowlist. A protected
Testing/Production match can never be overridden by an expected Preview value.
The fixture guard repeats the identity and fingerprint checks before any write,
then accepts only an empty database or the fixed synthetic marker business.

Required Preview-only variables:

- `UAT_PREVIEW_EXPECTED_PROJECT_ID`
- `UAT_PREVIEW_EXPECTED_ENVIRONMENT_ID`
- `UAT_PREVIEW_EXPECTED_WEB_SERVICE_ID`
- `UAT_PREVIEW_EXPECTED_DATABASE_SERVICE_ID`
- `UAT_PREVIEW_DATABASE_NAME`
- `UAT_PREVIEW_DATABASE_FINGERPRINT_SECRET`
- `UAT_PREVIEW_EXPECTED_DATABASE_FINGERPRINT`
- `UAT_PREVIEW_GUARD_SECRET`
- `UAT_PREVIEW_FORBIDDEN_ENVIRONMENT_IDS`
- `UAT_PREVIEW_FORBIDDEN_SERVICE_IDS`
- `UAT_PREVIEW_FORBIDDEN_DATABASE_NAMES`
- `UAT_PREVIEW_FORBIDDEN_DATABASE_FINGERPRINTS`
- `UAT_PREVIEW_SYNTHETIC_FIXTURE_ENABLED=true`
- `UAT_PREVIEW_ACCESS_ENABLED=true` with a server-only username and password
- `UAT_PREVIEW_OTP_INTERCEPT_ENABLED=true`
- `UAT_PREVIEW_OTP_HMAC_SEED`
- `UAT_PREVIEW_SYNTHETIC_PHONE_ALLOWLIST`

`UAT_PREVIEW_LOCAL_SIMULATION=true` is allowed only with a loopback PostgreSQL
URL and with no Railway deployment identity. It must be `false` for a real
Preview deployment. This exception exists only for disposable local validation;
it must not be used with an SSH tunnel to a hosted database.

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

UAT Preview uses only `OTP_PROVIDER=uat_preview_intercept` and
`OTP_CHANNEL=intercept`. The HMAC-derived code is limited to the synthetic phone
allowlist and is never written to the database, logs, reports or a public
endpoint. Any incomplete Preview OTP configuration is a hard failure; it never
falls back to SMS123, Twilio or a development mock.

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

The validator checks immutable release identity, Production-grade secrets,
Preview platform/database identity, denylist-first isolation and fail-closed
provider/action rules. It intentionally never prints secret values.
