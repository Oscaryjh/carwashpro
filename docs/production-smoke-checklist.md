# Production Smoke Checklist

This checklist must be executed by the Production Owner. Development has not run or validated it.

## Pre-traffic

- Confirm backup/PITR and rollback/forward-fix decision owner.
- Confirm release SHA/source digest and migration status.
- Confirm `/api/health` is 200 and reports `environment=production`, expected deployment ID and `database=ready`.
- Confirm HTTPS, canonical domain, secure cookies, allowed origins and redirect URLs.
- Confirm web and every worker are built from the same release.

## Security

- Create the first Platform Admin using the authorised one-time bootstrap only; disable the bootstrap flag immediately.
- Enroll Platform Admin TOTP MFA and securely store recovery codes outside logs/chat/source.
- Verify unauthenticated, cross-tenant, cross-branch and disabled-module requests are denied.
- Verify no mock OTP, fixed OTP, mock WhatsApp send or mock AI provider can start in Production.

## Core application

- Login/logout/session expiry.
- Business selection, branch scope and entitlement navigation.
- One controlled POS sale/payment/refund lifecycle with reconciliation.
- Inventory ordered/received/billed facts and AP outstanding behavior.
- Expense/claims/payroll/approval routes included in launch scope.
- Invoice/receipt rendering at desktop and 390px.

## Integrations

- Real employee OTP only if Staff App is enabled.
- Dedicated Production WhatsApp inbound/outbound/status flow.
- Production OpenAI read-only analysis only if AI is enabled.
- Private attachment upload, quarantine/scan and authorised download.
- Subscription payment only if an online payment adapter is in scope; otherwise confirm manual billing boundary.

## Operations

- Web health and error alerts fire to the Production Owner.
- Worker exit, queue age, retry exhaustion and connector disconnect alerts are active.
- Logs contain no passwords, session tokens, OTP/TOTP/recovery codes, provider secrets or attachment bodies.
- Observe the agreed post-launch window and record go/no-go.

Statutory human sign-off and activation are separate governed actions. Public Bank payroll payment remains blocked until the official bank specification is ready.
