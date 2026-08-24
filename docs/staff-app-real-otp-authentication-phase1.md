# Staff App Real OTP Authentication Phase 1

> Historical note (2026-08-24): the active Staff OTP flow has migrated from
> Twilio Verify to SMS123 delivery with Tetamu-owned hashed verification. See
> `docs/staff-app-sms123-otp-migration.md`. The Twilio details below document
> the superseded Phase 1 architecture only.

## Scope and environment

This phase adds Twilio Verify SMS authentication to the existing Staff App identity and session architecture. Development and validation are limited to Local and Online Testing. Production was not accessed, deployed, migrated, configured or validated.

## Canonical flow

```text
Staff phone input
  -> Tetamu eligibility and anti-enumeration checks
  -> application phone/IP/device/provider rate limits
  -> Twilio Verify sends and owns the SMS code
  -> employee enters the received code
  -> Twilio Verify approves or rejects the code
  -> Tetamu re-checks employee/membership eligibility
  -> existing device, membership-selection and session flow
```

Twilio Verify owns code generation, delivery and verification. Tetamu never requests, receives or stores the SMS OTP plaintext or hash for `twilio_verify` challenges. Tetamu stores only lifecycle and correlation metadata such as provider, delivery channel, provider reference, timestamps, attempts and status. The nullable `otp_hash` column is retained only for legacy rows.

## Provider contract

- `OTP_PROVIDER=mock`, `OTP_CHANNEL=local`: Local automated regression only.
- `OTP_PROVIDER=twilio_verify`, `OTP_CHANNEL=sms`: real Online Testing and future Production-owner configuration.
- Start verification uses Twilio Verify with an E.164 phone number and the `sms` channel.
- Verification succeeds only when Twilio returns `approved`.
- Pending, expired/deleted, max-attempt, timeout, network and provider errors are mapped to safe application outcomes without exposing provider payloads or credentials.
- Production startup rejects mock mode and fixed mock OTP configuration.

## Security controls

- Generic request response prevents employee phone enumeration.
- Unknown, disabled or ineligible accounts do not trigger provider delivery.
- Request limits cover phone, IP, device and provider delivery.
- Verification limits independently cover phone and IP.
- Verification claims prevent concurrent provider calls for one challenge; stale claims are recoverable.
- Successful verification is one-time and replay-resistant.
- Employee and membership eligibility are re-read before session creation.
- Existing business, branch, device replacement, membership selection, expiry and HttpOnly session-cookie controls remain canonical.
- Audit and security events record safe identifiers and outcomes, never OTP values or Twilio secrets.

## Database and migrations

- `20260813120000_staff_app_twilio_verify_sms`: additive provider/delivery/verification metadata and provider-specific integrity constraints.
- `20260813121000_staff_otp_provider_reference_reuse`: permits provider reference reuse during a Twilio resend lifecycle while retaining lookup indexing.
- Draft/new provider challenges store `otp_hash = NULL`; legacy local rows retain compatibility.

## Testing status

Engineering tests cover provider request bodies, approved/rejected/expired/locked results, provider errors, fail-closed configuration, no OTP persistence, request/verify limits, replay, concurrency, disabled membership and canonical session completion.

Local mock browser acceptance is a regression of Tetamu UI/session behavior only. It is not evidence of SMS delivery.

Final Local results:

- unit: 863/863 passed
- integration: 160/160 passed on the Local embedded PostgreSQL database
- TypeScript, lint (0 errors), Prisma validate/generate/status, 173-migration fresh rebuild, Local production-mode build and dependency audit passed
- browser: phone request, six-digit entry, device verification and canonical Employee Session creation passed with a Local QA employee
- malformed persisted device identifiers are replaced before an auth request, preventing a stale client value from exceeding the API contract
- changed-content secret patterns, canonical workspace guard and `git diff --check` passed

Real Twilio Testing acceptance requires all of the following in the Testing web service:

- `OTP_PROVIDER=twilio_verify`
- `OTP_CHANNEL=sms`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_VERIFY_SERVICE_SID`
- either `TWILIO_AUTH_TOKEN`, or `TWILIO_API_KEY_SID` plus `TWILIO_API_KEY_SECRET`
- an eligible Testing employee phone able to receive the SMS

At the 2026-08-13 closure audit, these Testing variable names were absent. No value was read or printed. No Testing deployment was attempted because it could not produce a valid real-SMS acceptance. The live result is therefore `BLOCKED`, not `PASS`.

## Explicit boundaries

- Local mock OTP is not Production OTP.
- Online Testing credentials and Verify Service must be distinct from future Production credentials and service.
- Production provisioning, deployment, migration, account use and live smoke are Production Owner actions.
- WhatsApp OTP, voice fallback, password login, a second session system and broad auth redesign are not part of this phase.
