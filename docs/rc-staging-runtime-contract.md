# Isolated RC Staging deployment policy

This is a deployment policy, not a new application environment or a Production
approval. `APP_ENVIRONMENT=production` and `NODE_ENV=production` remain mandatory.
The only additional platform name accepted is `Production-RC-Staging-20260920`,
with explicit `APP_DEPLOYMENT_PROFILE=rc-staging`. No other named staging
environment is implicitly approved. Removing the marker cannot downgrade it to
Testing or select a live communications provider.

## Identity provisioning prerequisite

Before any future resource write, independently establish the target and protected
inventory. This local candidate does not create resources or attest real IDs.
`RC_STAGING_IDENTITY` is a reviewed JSON object, held in deployment configuration:

- `projectId`, `environmentId`, `databaseServiceId`, `databaseName`,
  `databaseFingerprint` (SHA-256 from `databaseIdentityFingerprint`).
- `services`: exactly `web`, `staff`, `analytics`, `notification`, `whatsapp`,
  `monitor`; all six IDs and the database ID must be distinct.
- `protected`: required `testing`, `preview`, `production` inventories. Each has
  `environmentId`, nonempty `serviceIds`, `databaseNames`,
  `databaseFingerprints`, `secretFingerprints`. Include every protected legacy
  database, including old US resources, without connecting to customer data.

All actual IDs must match this manifest AND the existing `PRODUCTION_EXPECTED_*`
bindings. Protected identities take precedence. Database name and fingerprint
must be independently verified, not inferred from service display names. Both
database and replica region must be `asia-southeast1-eqsg3a` for this approved
rc-staging profile. Legacy, missing, unknown, non-Singapore and mismatched regions
are rejected; do not override the platform-provided replica region to disguise
its actual location. The formal Production profile retains its original
`asia-southeast1` contract unchanged. All original source proof,
deployment ID, MFA, encryption/key-version, proxy, alert and singleton checks
remain mandatory for every scope. No staging migration bypass exists.

Protected secret fingerprints must cover all existing protected environments;
runtime checks do not establish the completeness of an operator-provided
inventory. Use independently generated staging secrets, including the database
password (at least 32 bytes) and OTP seed. Reuse across protected inventories or
within application/encryption/database/OTP domains is rejected. Do not log secret
values or connection URLs. Store configuration outside source control.

## Synthetic OTP and communications

Required: `OTP_PROVIDER=rc_staging_intercept`, `OTP_CHANNEL=intercept`,
`EMPLOYEE_OTP_SEND_MODE=provider`, independent `RC_STAGING_OTP_HMAC_SEED` and
`RC_STAGING_SYNTHETIC_PHONE_ALLOWLIST` (canonical E.164, unique, at most 100).
Populate the allowlist from authoritative synthetic artifacts, never real users.
Request, verification and session creation also require every membership of the
employee account to have `isTestAccount=true`. The phone allowlist alone never
authorizes a non-synthetic account.

The interceptor derives per-challenge, per-phone, per-expiry HMAC codes. There is
no fixed code, SMS delivery, code log or public retrieval endpoint. Existing
database single-use, expiry, attempt limits, throttling, devices, membership
selection and logout remain in force. Authorized future test harnesses may derive
codes in process using the guarded configuration; do not print or persist them.
Existing schema stores the compatibility provider label `mock` plus the distinct
`RC_STAGING_INTERCEPT_V1` marker; this is not the mock provider or mock OTP mode.

Other customer communications are fully disabled (a stricter zero-recipient
allowlist): `WHATSAPP_SEND_MODE=disabled`, `EMAIL_SEND_MODE=disabled`,
`AI_GLOBAL_ENABLED=false`; live provider/connector credentials must be absent.
Notification and WhatsApp workers validate the full contract then idle until
normal shutdown, without consuming queues, restoring sessions, or marking
simulated messages delivered. They do not test customer-message delivery.
Operational monitor/alert HTTPS endpoints still require separate approved test
receivers at infrastructure provisioning; local tests inject a non-network sink.

## Authenticated operational alerts

`OPS_ALERT_WEBHOOK_BEARER_TOKEN` is required for RC Staging in all six runtime
scopes and in both the monitor/application and backup alert transports. Generate
an independent random secret (at least 32 characters; base64url recommended),
store it in a worktree-external 0600 handoff and isolated service secrets. It must
not match an application, encryption, database, OTP or protected-environment
secret. No value belongs in source, evidence, logs or reports.

The only credential transport is `Authorization: Bearer ...`. HTTPS destinations
must not contain URL credentials, query parameters, fragments or the bearer
value. Requests use manual redirect handling and reject 3xx without following
the Location header. 401 is terminal; 429, 5xx and transport failures retain
bounded retries. Transport exceptions and receiver echoes must not disclose the
secret. Payloads and emitted logs redact the configured bearer independently of
metadata key names. A receiver response is not authority to expose its body.

Outside RC Staging, an absent bearer preserves the existing optional-auth alert
contract; any configured bearer must be valid and receives the same protections.
This does not authorize Production activation or change Payroll/PCB semantics.
The temporary Staging receiver retains only synthetic event type, timestamp and
correlation ID; it rejects unauthenticated requests and non-allowlisted events.

## Features and publication boundary

`PRODUCTION_ELIGIBLE=false`; PCB activation/official exports/government submission,
bank execution and Payroll Payment Export remain false. POS customer payments,
Payroll/PCB calculations and historical correction semantics are unchanged.
No schema, migration, role defaults, fixture data or UI changes are required.

Local passing gates authorize only a new RC candidate. Publication and any
Railway/remote validation require a separate approval naming the new candidate
SHA/tree/archive/lockfile identities; never rewrite the original frozen source.
