# TRUE MFA / TOTP Foundation

## A. Objective

Tetamu now supports genuine sensitive-action MFA for password-authenticated users: current password plus an RFC 6238 TOTP or one unused recovery code. Login MFA, SMS, WhatsApp, email OTP, push MFA, WebAuthn, passkeys and administrator reset remain out of scope. All implementation and verification in this phase is Local / Testing only.

## B. Existing Auth Audit

The existing `AuthSession`, bcrypt password re-authentication, same-origin enforcement, security-event logging, rate limiting and `SensitiveActionAuthorization` framework were reused. The authorization was already user/session/action/resource/business/fingerprint bound, short-lived, opaque-token hashed and one-time. Existing AES-256-GCM versioned keyring patterns in payroll/payment artifacts were adapted rather than creating a second security framework. Employee mock OTP is explicitly not treated as MFA.

## C. MFA Threat Model

The design addresses database disclosure, enrollment hijacking, stolen/replayed TOTP values, recovery-code reuse, cross-session or cross-resource elevation, concurrent confirmation/consumption and secret leakage. MFA never replaces RBAC, module entitlement, current session validity or password re-authentication. A lost authenticator is recoverable with pre-generated codes; a formal support break-glass workflow remains deferred.

## D. TOTP Standard

TOTP uses `otpauth@9.5.1` with RFC 6238 configuration: HMAC-SHA1, six digits, 30-second period and a bounded previous/current/next window. The dependency has no install/postinstall script, exposes TypeScript declarations and has one runtime dependency (`@noble/hashes`). `otpauth://totp/...` uses issuer `Tetamu` and the account email as the label. QR images are generated locally with `qrcode`; no enrollment URI is sent to a third party.

## E. Credential Model

Additive `UserMfaCredential` and `UserMfaRecoveryCode` models support versioned TOTP credentials, `PENDING`, `ACTIVE` and `REVOKED` states, enrollment-session binding, pending expiry, enrollment/verification/revocation audit times, last accepted TOTP counter and versioned recovery sets. Database constraints allow one active and one pending TOTP per user for version one while leaving room for future credential types.

## F. Secret Encryption

TOTP secrets use AES-256-GCM with a random 12-byte nonce, a 16-byte authentication tag and credential/user/type AAD. Ciphertext, nonce, tag and key version are stored separately. Keys come only from `MFA_ACTIVE_KEY_VERSION` and `MFA_ENCRYPTION_KEYS`; missing configuration fails closed as `MFA_ENCRYPTION_NOT_CONFIGURED`. `npm run mfa:setup-local` creates a Local `.env.local` keyring without printing or committing the key. The model is compatible with future key rotation.

## G. Enrollment

An authenticated user may enroll only their own account. Password re-authentication creates a 10-minute, user/session-bound encrypted pending credential. A valid TOTP atomically promotes it to active and generates recovery codes. Merely generating the QR or manual key never activates MFA. Manual secrets and the full enrollment URI exist only during pending enrollment and are not returned by the normal enrolled-state query.

## H. Verification

Sensitive-action verification requires a live session, valid current password, one active credential and a valid TOTP or recovery code. Success creates a five-minute `assuranceLevel=MFA` authorization whose verification method is `TOTP` or `RECOVERY_CODE`. Safe error codes do not expose credential or encryption state.

## I. Replay Protection

The credential stores `lastAcceptedCounter`. Acceptance uses an atomic conditional update, so a previously accepted time step and concurrent reuse cannot issue unrestricted elevations. Sensitive authorizations remain one-time and independently protected by atomic consumption.

## J. Rate Limiting

MFA failures reuse the auth-security locking and event foundation and are limited by user, session, credential-derived identifier and trusted IP hash. Limits are evaluated inside serializable transactions. Raw factors are never written to rate-limit keys or events.

## K. Recovery Codes

Ten cryptographically random, human-readable codes are generated per set. Only bcrypt cost-12 hashes are stored. Codes are returned once, consumed atomically once and cannot be used as a password replacement. Regeneration requires current password plus a fresh TOTP/recovery factor, revokes all old unused codes and creates one new versioned set.

## L. Disable / Recovery

Disabling MFA requires current password plus a current TOTP or unused recovery code. It revokes the active credential, unused recovery codes and current sensitive authorizations. Administrator reset is deliberately unsupported (`ADMIN_MFA_RESET_NOT_SUPPORTED` policy); formal manual support recovery is deferred.

## M. Sensitive Action Integration

The MFA verifier upgrades the existing authorization rather than bypassing it. The execution order remains authenticated session, RBAC, scope, module entitlement, password verification, possession/recovery factor, scoped authorization issuance, exact action execution and one-time consumption. Token material remains in an HttpOnly, Secure-when-applicable, SameSite cookie.

## N. Assurance Levels

`REAUTH` means current password verification. `MFA` means current password plus a newly verified active TOTP/recovery factor. Password re-authentication, mock OTP and a stored “MFA enabled” flag cannot satisfy an MFA policy. An MFA authorization may satisfy a REAUTH policy, never the reverse.

## O. Statutory Sign-off

`STATUTORY_RULESET_SIGNOFF` requires MFA. The sign-off service consumes a separate authorization inside the same serializable transaction, bound to the reviewer, AuthSession, exact RuleSet and current evidence digest. A Local `TEST_ONLY` RuleSet proved the precondition and transaction integration. No canonical RuleSet was signed.

## P. Statutory Activation

`STATUTORY_RULESET_ACTIVATE` requires a separate MFA authorization and existing two-person control. An isolated, dedicated Activator QA identity proved the activation precondition independently from the Reviewer identity. No RuleSet activation was executed.

## Q. Payroll High-risk Actions

The centralized policy matrix supports all requested action keys. Runtime integration beyond the statutory lifecycle remains intentionally partial:

| Action | Current assurance |
| --- | --- |
| Statutory Rule Sign-off | MFA |
| Statutory Activation | MFA |
| Payroll Finalize | REAUTH |
| Payroll Reopen | REAUTH |
| Payment File Export | REAUTH |
| Bank Account Edit | REAUTH |
| Statutory Export | REAUTH |
| Statutory Submit | MFA |

Existing assurance was not reduced. Wiring every payroll/payment mutation to authorization consumption is deferred to its own bounded phase.

## R. Session / Revocation

Session revocation invalidates pending enrollment usability and both REAUTH/MFA sensitive authorizations. Password-change and account-disable flows already revoke sessions; `revokeUserSessions` now explicitly revokes unconsumed sensitive authorizations. TOTP credentials are retained across ordinary password changes rather than silently deleted. Disabled users or revoked sessions cannot verify or consume MFA authorization.

## S. Audit Events

Events cover enrollment start/completion, failed/successful verification, credential revoke, recovery regeneration, step-up issuance/consumption/failure and rate limiting. Metadata includes identity/session/action/method and safe digests where relevant. It excludes TOTP secrets, full enrollment URIs, TOTP values, recovery codes, ciphertext and encryption keys.

## T. Privacy

The normal security UI exposes only enrollment state, method, enrolled time and unused recovery-code count. It never exposes encrypted secrets or hashes. The manual secret and recovery codes are deliberately one-time views during their respective creation flows.

## U. UI

`Security → Multi-factor authentication` supports password re-authentication, pending QR/manual enrollment, verification, show-once recovery codes, recovery regeneration and MFA disable. The statutory page reports personal enrollment and whether a new scoped challenge is required. The Local QA challenge has no fake bypass.

## V. Concurrency / Idempotency

Enrollment completion, accepted TOTP counters, recovery use/regeneration, MFA disable and authorization consumption use user-scoped advisory locks, serializable transactions, conditional updates and database uniqueness. Concurrent enrollment confirmation produces one active credential. Repeated completion cannot generate a second active credential or another valid recovery set.

## W. Tests

Coverage includes standard TOTP vectors/skew/URI, encryption and tamper failure, key-missing failure, enrollment pending/invalid/expiry/session binding, concurrency, replay, rate limits, recovery hashing and one-time use, regeneration, disable, session revoke, action/resource/one-time scope, dedicated Reviewer/Activator statutory preconditions and migration constraints. Browser E2E verified real Local login, enrollment, QR/manual state, RFC-compatible TOTP, show-once recovery codes, TOTP sensitive-action consumption, recovery-code statutory precondition and a clean post-fix console.

## X. Remaining Risks

Login-time MFA, WebAuthn/passkeys, secure human support recovery and complete payroll/payment action wiring remain deferred. Key rotation is version-compatible but not automated. The repository's production dependency audit still reports four pre-existing high-severity findings in the Next.js/nanoid/postcss/sharp dependency paths; `otpauth` introduced none. Production configuration and deployment were not inspected or validated.

## Y. Next Human Action

NEXT: an authorised Human Reviewer may enroll personal TOTP MFA, review the canonical UNKNOWN inventory, complete evidence-backed decisions, complete the 17-item checklist, perform MFA step-up, execute Human sign-off, then STOP. Activation is not part of that next action.

## Z. Final Status

`TRUE MFA / TOTP → READY` for Local / Testing sensitive-action step-up. `STATUTORY SIGN-OFF MFA → READY`, while Human sign-off remains not executed. Canonical statutory activation remains not active. Production was not accessed or validated.
