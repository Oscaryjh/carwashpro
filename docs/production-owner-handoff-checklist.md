# Production Owner Handoff Checklist

This is a Production Owner runbook. Development does not execute these actions and has not accessed or validated Production.

## 1. Database

- Provision a dedicated Production PostgreSQL database in the correct region.
- Confirm network restrictions, TLS requirements, connection limits and pooling.
- Capture a pre-deploy backup and verify restore/PITR ownership.
- Run `npx prisma migrate status`, review the migration plan, then run `npx prisma migrate deploy` once.
- Do not use `migrate dev`, the Local golden UAT seed, reset, truncate or fresh rebuild in Production.

## 2. Secrets

- Supply all required variables from `environment-variable-contract.md` through a Production secret manager.
- Generate new Production-only session, MFA and payroll encryption/fingerprint keys.
- Never reuse Local/Testing OpenAI, OTP, WhatsApp or storage credentials.
- Set `APP_ENVIRONMENT=production`, immutable release SHA and source digest.

## 3. Backup and recovery

- Enable automated backup/PITR and document retention.
- Perform an isolated restore drill before launch.
- Record RPO/RTO, responsible person and emergency escalation path.

## 4. Employee OTP

- Provision a Production-only Twilio account/project boundary and Verify Service; do not reuse the Online Testing service or credentials.
- Configure `OTP_PROVIDER=twilio_verify`, `OTP_CHANNEL=sms`, the Production Account SID and Verify Service SID, plus either an Auth Token or a least-privilege API key pair.
- Confirm the approved country, sender, regulatory and fraud-guard policy for the launch markets.
- Run real-device SMS delivery, expiry, one-time use, replay, resend, rate-limit, provider-failure and session-creation smoke tests with Production-owned QA identities.
- Keep Staff App disabled until real OTP is operational; never enable mock mode or a fixed OTP.

## 5. WhatsApp

- Provision a dedicated Production connector/session and persistent private session storage.
- Set `WHATSAPP_SEND_MODE=live` and Production-only connector authentication.
- Verify inbound webhook authenticity, outbound send, retry, idempotency and delivery-status reconciliation.
- Monitor the notification worker and connector separately.

## 6. OpenAI

- Create an independent Production OpenAI Project and key with a spend limit.
- Keep the key server-side; set `AI_GLOBAL_ENABLED=false` until explicitly enabled.
- If enabled, set `AI_PROVIDER=openai` and run the read-only AI acceptance against Production-safe test data.
- Confirm graceful quota/provider failure and no privileged write path.

## 7. Domain and TLS

- Configure the Production domain, TLS, DNS and canonical public base URL.
- Update allowed origins/callback URLs and trusted proxy settings.
- Validate secure cookies, redirect targets and webhook URLs on the final domain.

## 8. Deployment

- Deploy the identical base commit and source digest handed over by Development.
- Use Node 22–24 and run Prisma generate/build in the immutable artifact pipeline.
- Run migration deploy before web traffic; start web, notification worker, analytics worker and WhatsApp connector as separate services.
- Capture deployment IDs and `/api/health` identity. Do not deploy from an unidentified dirty source.

## 9. Monitoring

- Alert on web health, error rate, latency and database connectivity.
- Alert on worker exits, stale leases, retry exhaustion and queue age.
- Alert on WhatsApp connector disconnection, webhook failures and delivery reconciliation gaps.
- Configure audit-log retention and redact credentials, OTPs, TOTP secrets/recovery codes and attachment content.

## 10. Production smoke and go/no-go

- Execute `production-smoke-checklist.md` with Production-owned QA identities and controlled data.
- Confirm the first Platform Admin is created through the explicit one-time bootstrap, immediately change/secure credentials and enroll TOTP MFA.
- Disable the bootstrap flag after the account exists.
- Obtain statutory human sign-off separately; do not activate statutory rule sets through deployment automation.
- Record go/no-go, rollback/forward-fix owner and post-launch observation window.

These ten action groups are `PRODUCTION_OWNER_ACTION_REQUIRED`, not Development defects.
