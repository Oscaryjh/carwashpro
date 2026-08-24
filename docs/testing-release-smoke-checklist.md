# Testing Release Smoke Checklist

All items target the `testing` environment only.

## Identity and infrastructure

- Confirm deployment base SHA and source digest match the accepted release.
- Confirm web `/api/health` returns HTTP 200, `database=ready`, `environment=testing` and the expected deployment identity.
- Confirm notification and analytics workers start with the Testing environment contract.
- Confirm WhatsApp connector `/health` is reachable for the Testing connector.
- Run Testing `prisma migrate status`; it must report up to date.

## Authentication and scope

- Login with an authorised Testing QA account.
- Verify invalid credentials and revoked membership are denied.
- Verify secure session/logout behavior.
- Verify branch/tenant switching cannot expose another business.
- Verify module entitlement hides UI and server APIs deny disabled modules.

## Master business smoke

- Open business dashboard and confirm no blocking console/hydration errors.
- Create one clearly named QA sale and complete payment once.
- Re-submit the same operation/idempotency key and confirm no duplicate financial effect.
- Verify receipt/invoice view is usable at 390px.
- Open Inventory, Expense/AP, HR/Payroll and Approval Center routes permitted to the QA account.
- Confirm finance/dashboard values reconcile to canonical facts used by the smoke scenario.

## Provider smoke

- Employee OTP automated regression may use mock only on Local. Online Testing acceptance requires `SMS_PROVIDER=sms123` + `OTP_CHANNEL=sms`, Testing-only credentials, an eligible Testing employee, delivery to a real device and successful login with the code received by that human. Never report mock delivery as real OTP acceptance.
- Confirm invalid/expired/replayed codes, resend cooldown, app verification limits, disabled/revoked membership and provider-unavailable behavior. Confirm no plaintext OTP or provider secret appears in the database, response, logs or browser.
- WhatsApp: verify Testing mock queue semantics and, when a Testing live session is configured, one controlled outbound message and status reconciliation.
- OpenAI: keep disabled/mock unless the Testing Project/key and quota acceptance are explicitly in scope; never reuse the key for Production.

## Exit

- Browser console errors: zero.
- Hydration errors: zero.
- No Production URL, account, database, secret, provider or deployment touched.
- Record deployment IDs and the final PASS/FAIL result in the handoff audit.
