# Sensitive Action / Step-up Authentication Foundation

## A. Objective

Provide one reusable server-side step-up foundation for sensitive actions. It extends the existing authenticated `AuthSession`; it is not a second login system and it is not Statutory-only.

Environment boundary: **LOCAL / TESTING ONLY**. Production was not accessed or validated.

## B. Existing Auth Audit

| Area | Status | Evidence / decision |
| --- | --- | --- |
| Password login and bcrypt verification | READY | Canonical comparison remains in `password-login.ts`; step-up reuses `verifyPasswordHash` |
| Database-backed `AuthSession` | READY | Random session ID, signed cookie, live user/session checks |
| Idle / absolute expiry | READY | 12-hour idle and 7-day absolute session limits |
| Logout / admin revocation | READY | Revoked sessions cannot consume an elevation |
| Password-login rate limiting | READY | Identifier/IP/combination limits and advisory locks |
| Step-up rate limiting | READY | User/session/action/resource/IP dimensions and advisory locks |
| CSRF / same-origin | READY | Next Server Actions plus explicit same-origin header guard |
| `AuthSecurityEvent` | READY | Reused; no third audit store |
| Attendance Staff OTP | LEGACY / NOT MFA | Secure challenge mechanics exist, but Testing mock delivery is not Platform MFA |
| Password re-auth | READY | Current password is re-read and verified server-side |
| Elevated sensitive-action authorization | READY | New bounded database model and opaque cookie |
| TOTP | MISSING | No enrollment, encrypted secret storage or recovery |
| WebAuthn / Passkey | MISSING | No credential lifecycle exists |
| True MFA | MISSING | No method may claim MFA assurance |

No duplicated password hashing logic, mock MFA flag, URL credential or client-side authorization boolean was added.

## C. Threat Model

The controls address stolen normal sessions, credential replay, cross-action or cross-resource replay, session transfer, stale elevation, concurrent double use, client tampering, brute force, token leakage through URLs/storage/logs, and use after logout, disablement or password-change session revocation.

## D. Sensitive Action Registry

The static centralized registry covers Statutory sign-off/activation, Payroll finalization/reopen, payment-file export, Statutory export/submit, bank-account edit, high-risk permission changes, and an isolated Local/Testing QA action. Each policy declares capability, module where applicable, assurance, TTL, reason requirement, one-time use and resource type.

Public Bank adapter/export implementation remains out of scope; only a future policy hook exists.

## E. Assurance Levels

- `REAUTH`: recent verification of the current password.
- `MFA`: a true independent second factor. No current method can mint this level.

`REAUTH` never satisfies an `MFA` policy. An MFA authorization could satisfy a REAUTH policy in a future reviewed implementation.

## F. Step-up Authorization Model

`SensitiveActionAuthorization` stores user, AuthSession, action, resource, optional business, method, assurance, issued/expiry/consumed/revoked timestamps, optional request fingerprint, and only the SHA-256 hash of a cryptographically random opaque credential.

## G. Session Binding

Issuance and consumption both require the same live `AuthSession`. Revoked, idle-expired or absolute-expired sessions fail closed. A credential from Session A cannot be used by Session B.

## H. Action Binding

An authorization is minted for exactly one registry action. It cannot be replayed for another action even when both actions use the same assurance level.

## I. Resource Binding

Every current policy is resource-bound. Resource type must match the registry and the exact resource ID must match at consumption. Business scope must also match.

## J. TTL / Consumption

All current policies use a five-minute server-authoritative TTL and one-time consumption. The conditional `updateMany` inside a Serializable transaction makes concurrent use single-winner. A newly verified authorization revokes an older unconsumed authorization for the same session/action/resource.

## K. Password Re-auth

The current authenticated user enters the current password. The service re-reads the live user and session, reuses canonical bcrypt verification, applies rate limits, emits safe events, and mints only `REAUTH`. Wrong and old passwords fail without enumeration or secret logging.

## L. True MFA Readiness

**NOT READY.** There is no TOTP secret encryption/key management, enrollment, recovery/backup codes, Passkey/WebAuthn registration, or independently verified provider. Attendance mock OTP `000000` is never accepted as MFA.

## M. Rate Limiting

The 15-minute window uses scope (user + session + action + resource), user and trusted-IP counters. Advisory transaction locks prevent parallel attempts from bypassing counters. Failure and rate-limit events are committed without storing the supplied password.

## N. Security Events

The existing `AuthSecurityEvent` records `STEP_UP_FAILED`, `STEP_UP_RATE_LIMITED`, `STEP_UP_VERIFIED` and `STEP_UP_CONSUMED`. Metadata contains action/resource/method/assurance and authorization ID where applicable, never passwords, codes, raw tokens or secrets.

## O. Revocation

Logout, administrative session revocation, password-change session revocation, inactive users and `loginEnabled=false` all invalidate associated authorizations at consumption. Explicit authorization revocation fields also support supersession and future security operations.

## P. Statutory Integration

Statutory sign-off and activation are registered as resource-bound, one-time `MFA` actions. The governance service checks the centralized policy and remains fail-closed with `STATUTORY_STEP_UP_AUTH_NOT_READY`. Password re-auth and QA references do not bypass this requirement. No canonical RuleSet was signed or activated.

## Q. Payroll Integration

Payroll finalization and reopen are registered as `REAUTH`, resource-bound Payroll policies after their existing capability/module checks. Existing Payroll UI/services were not silently changed because the prior product workflow did not define a step-up UX contract. Integration is therefore a ready policy hook but partial end-to-end Payroll adoption.

## R. Payment / Export Future Hooks

Payment file, Statutory export/submit and bank-account edit policies are centralized. Public Bank generation, real bank transmission and production export were not executed or implemented.

## S. UI

The Local/Testing QA page explicitly says “Additional verification required”, identifies password re-auth as non-MFA, never renders the opaque token, and only shows the consume action after verification. The credential is an HttpOnly, SameSite=Strict cookie and is deleted after use or failure.

## T. RBAC / Entitlement Ordering

Ordering is authenticated session → live capability → required module entitlement → domain scope → step-up → action. `assertSensitiveActionAccessPreconditions` rejects missing capability before offering step-up and rejects disabled modules before verification. Step-up never grants permissions or modules.

## U. Concurrency

Database state predicates (`consumedAt IS NULL`, `revokedAt IS NULL`, unexpired) and Serializable transactions ensure two concurrent consumers cannot both succeed. Integration coverage asserts one winner.

## V. Privacy

No password, OTP/TOTP value, MFA secret, backup code or raw authorization token is stored in the database, event metadata, URL, localStorage or sessionStorage. Rate-limit identifiers and network context use keyed hashes.

## W. Tests

Coverage includes registry policies, RBAC/module ordering, cookie/token handling, same-origin rejection, password success/failure, true-MFA refusal, rate limits, action/resource/session mismatch, TTL, one-time and concurrent consumption, logout/password-change revocation behavior, security event privacy, Statutory blocker regression, schema validation and migration rebuild.

## X. Remaining Risks

- True MFA is absent.
- No TOTP encrypted-secret/recovery lifecycle or Passkey implementation has been independently reviewed.
- Payroll/payment/export policies are hooks and require product-specific UI/service adoption before those modules may be marked complete.
- A single browser cookie represents the currently verified action; simultaneous step-up flows in separate tabs supersede/replace the browser credential.

## Y. Next Security Requirement

Design and independently review a complete true-MFA lifecycle (preferably Passkey/WebAuthn or encrypted TOTP with enrollment, recovery, revocation and operational monitoring). Only then may statutory sign-off and activation consume an `MFA` authorization. That future phase must not sign or activate canonical RuleSets without separate human decisions and authorization.

## Z. Final Status

```text
GENERIC STEP-UP FOUNDATION → READY
SENSITIVE ACTION REGISTRY → READY
PASSWORD RE-AUTH → READY
TRUE MFA → NOT READY
STATUTORY HUMAN SIGN-OFF → BLOCKED_TRUE_MFA
PAYROLL HIGH-RISK STEP-UP → PARTIAL
```

Canonical Statutory state remains:

```text
EPF / SOCSO / EIS / LINDUNG24
RuleSet: REGISTERED
Unknown Review: PENDING
Human Sign-off: NOT EXECUTED
Step-up: BLOCKED_TRUE_MFA
Activation: NOT ACTIVE
```

PCB remains PARTIAL. Claims status is unchanged. Public Bank remains `PUBLIC_BANK_SPEC_NOT_READY`.
