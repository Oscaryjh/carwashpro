# POS Authentication Security Hardening

## A. Objective

Harden Tetamu POS authentication, server-side sessions, authorization boundaries, and abuse protection so a valid credential grants only the intended identity, business, branch, capability, and session lifetime. Authentication failures must not become an account-enumeration or brute-force oracle.

## B. Environment Boundary

This work and its validation are restricted to Local and Testing. Production access, deployment, migration, variables, accounts, secrets, sessions, and traffic are explicitly out of scope.

The implementation was exercised against the canonical Local workspace and Local PostgreSQL database. A production-mode build may be run locally; it is not a Production deployment.

## C. Existing Auth Architecture

Tetamu has two application authentication surfaces:

- Backoffice POS uses email/password, bcrypt, a signed `car_wash_session` cookie, and live database authorization.
- Staff PWA uses phone OTP, device binding, and a separate hashed server-side `EmployeeSession` token.

Platform admin, business owner, direct staff, group owner, and group manager all enter through the password surface. Business/group access is resolved from live database membership and capability data. Middleware is an early routing layer only; server components, server actions, and APIs remain the authority.

There is no customer-facing password-reset-token flow, invitation-token flow, impersonation flow, remember-me option, MFA, passkey, or SSO flow. Platform admin can directly reset an account password. Business owners can create staff accounts through authenticated server actions.

## D. Login Flows

| AUTH FLOW | ENTRY POINT | AUTH METHOD | RATE LIMITED? | ENUMERATION SAFE? | SESSION ROTATED? | SERVER-SIDE VERIFIED? | TENANT-SCOPED? | RISK |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Platform admin / owner / manager / cashier | `/login` | Email + bcrypt password | Yes: identifier, IP, identifier+IP | Yes: uniform invalid-credential result and dummy bcrypt comparison | Yes: random session ID and new JWT on login | Yes: database session plus live user state | Yes for business users; platform boundary is explicit | Testing proxy hop count must be configured correctly |
| Group recovery / business switch | `/business-context/recover` and context-switch server action | Existing session + live group membership | N/A | N/A | Context version and JWT are rotated; old business-context token is rejected | Yes | Yes | No frozen group capability is trusted |
| Branch selection | Business-scoped actions and branch resolver | Existing session + live branch assignments | N/A | N/A | Session context is persisted when the active branch changes | Yes | Yes | Query/cookie branch IDs are never authority |
| Staff PWA OTP request | Employee attendance API | Phone + device request | Yes: phone, IP, device, purpose, resend/burst windows | Yes: uniform response | N/A | Yes | Yes | Live SMS provider acceptance remains separate |
| Staff PWA OTP verify | Employee attendance API | Six-digit OTP + device binding | Yes: challenge attempts and contextual dimensions | Yes | Yes: random hashed server session token | Yes | Yes | Testing uses safe delivery/mock behavior |
| Logout | `POST /logout` | Current cookie session | N/A | N/A | Session is revoked and cookie deleted | Yes | Yes | Cross-site requests are denied |
| Platform password reset | Authenticated platform-admin action | Live platform-admin session + bcrypt replacement | N/A | Not publicly reachable | All target user sessions are revoked | Yes | Explicit admin boundary | No public reset token exists |
| Staff account creation/change | Authenticated team actions | Live owner/team capability | N/A | Not publicly reachable | Password change/disable revokes target sessions | Yes | Yes | No invitation token exists |
| WhatsApp webhook | API webhook routes | Existing fail-closed webhook secret | Separate surface | N/A | N/A | Yes | Business resolution remains scoped | Replay hardening is deferred to the authorized WhatsApp phase |

## E. Rate Limiting

Password login reuses PostgreSQL rather than introducing a second cache. A 15-minute rolling window applies temporary limits of five failures per normalized account identifier, 25 per trusted client IP, and five per identifier/IP pair. Identifiers and addresses are HMAC-SHA-256 keys; raw email, phone, and IP values are not stored in the security-event table.

PostgreSQL transaction-scoped advisory locks serialize concurrent attempts across the same dimensions. The login flow uses a serializable transaction. Rate-limit storage failure is fail-closed and returns a safe temporary-unavailable message rather than silently allowing unlimited attempts. A successful login does not erase the failure history or global IP protection.

OTP request and verify continue to use their established database-backed phone, IP, device, purpose, resend, burst, attempt, expiry, and consumed-state protections.

## F. Account Enumeration

Unknown, disabled, login-disabled, business-inactive, and wrong-password cases use the same `Invalid login details.` response. Unknown or unusable users still execute a fixed bcrypt comparison to reduce timing differences. Rate-limit responses reveal neither internal counters nor whether an account exists.

OTP requests retain the existing uniform response for registered and unregistered phone numbers. Password reset and invitation lookup are not applicable because no public flow exists.

## G. OTP

OTP codes are HMAC-hashed, have server-side expiry, maintain attempt counts, are consumed once, and are bound to the intended challenge, employee membership, device, business, and branch selection. Transaction locking prevents concurrent double verification. Expired, exhausted, or consumed challenges fail; the code cannot be replayed. Passwords, OTP values, session tokens, and secret material are not written to audit or security logs.

## H. Password Security

Passwords use the existing mature `bcryptjs` implementation with per-hash salts and cost 12. Password input is bounded to 256 characters and email to 254 characters. No plaintext or reversible password storage was introduced. Password comparisons are performed by bcrypt, and public errors do not expose database errors, hashes, internal IDs, or stack traces.

Platform-admin password reset and business account password change revoke every active server-side session for the target user. Disabled accounts are rejected on the next request through live user-state verification.

## I. Sessions

Every successful password login creates a cryptographically random UUID session ID and a new signed JWT whose `jti` is that ID. The corresponding `AuthSession` row is the server-side source of truth. An anonymous or attacker-chosen identifier is not promoted into the authenticated session.

Sessions have a 12-hour idle expiry and fixed seven-day absolute expiry. Activity may extend idle expiry only up to the original absolute deadline. Middleware no longer refreshes or re-signs the JWT indefinitely. Each protected request verifies JWT integrity, session ID, user ID, active business, branch, context version, revocation, both expiry clocks, live account status, `loginEnabled`, live role/permissions, and active business status.

Business or branch context changes update the persisted context version and issue a matching token. A stale token with the former version or context is rejected.

## J. Logout / Revocation

Logout is a same-origin POST mutation. It revokes the matching `AuthSession`, records a security event, deletes the cookie, and redirects to login. `GET /logout` does not mutate state. Refreshing or revisiting a protected URL with the old token fails.

Password reset, password change, and account disable revoke active sessions. Membership, role, and capability changes are evaluated live on each protected request and action rather than relying on login-time permission claims.

## K. Business Switching

Business selection is authorized from live direct ownership or group membership. Switching persists the target business and context version in the same database transaction used by the switch flow, then issues the corresponding cookie. Old context tokens fail server-side comparison. Business IDs in URLs or form data remain filtered by the trusted active business.

## L. Branch Switching

Branch scope is derived from live business access, direct branch assignment, group scope, or authorized all-branch capability. User-supplied branch IDs pass through business/branch resolvers and database filters. Branch query values and cookies are not authorization sources.

## M. RBAC

Live capability gates cover cashier/checkout, appointment mutation, work-order mutation, closing, reports, CRM mutation, invoices/refunds, business and branch settings, team/payroll areas, and WhatsApp session management. Route loaders are gated before sensitive queries, and mutations repeat the gate server-side.

The audit found and fixed routes where a hidden menu was stronger than the server gate: direct `/cashier` access after POS revocation, vehicle-size settings actions, CRM mutations, invoice refund/void actions, and selected appointment/work-order/closing/settings/connector paths. Group managers retain their intentional read-only capability set; new mutation capabilities are not granted to them.

Platform admin remains a distinct source in business-access resolution and does not inherit a business-owner identity accidentally.

## N. IDOR

Business-sensitive reads and writes include `businessId` in database predicates, and branch-sensitive operations use trusted branch resolvers. Customer, invoice, payment, appointment, work-order, branch, package, and closing identifiers are therefore not sufficient by themselves. Cross-business guessed IDs resolve to not-found/denied behavior without exposing the other tenant's record.

Existing tenant-isolation and business-context integration suites cover cross-business and cross-branch references. PDF, connector, and sensitive page loaders now also perform a live capability gate before database access, preventing unauthorized SSR data flash.

## O. Cookies / Tokens

The POS session cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, has an explicit bounded age, and becomes `Secure` under the project's production-mode runtime (including HTTPS Testing deployment mode). Local HTTP intentionally omits `Secure`; this does not weaken Testing HTTPS configuration. No auth token is placed in a URL or browser storage.

The staff PWA session cookie remains `HttpOnly`, `SameSite=Strict`, scoped, expiring, and backed by a hashed server-side token. Client `sessionStorage` financial operation IDs remain business idempotency values, not authentication credentials.

Next server actions provide framework origin validation for browser mutations. Logout additionally performs explicit Origin/Host and Fetch Metadata validation. Trusted proxy parsing is opt-in through an exact proxy-hop count; arbitrary `X-Forwarded-For` is ignored by default.

## P. Password Reset

Public password-reset request/token flow: **NOT APPLICABLE**. The only reset is an authenticated platform-admin action. It hashes the replacement password and revokes the target user's server-side sessions in the same transaction.

## Q. Invitations

Invitation-token flow: **NOT APPLICABLE**. Staff accounts are created directly through authenticated, tenant-scoped server actions. There is therefore no invite token, URL token, expiry, recipient binding, or replay surface in the current product.

## R. Security Logging

`AuthSecurityEvent` is separate from financial/business audit records. It records structured outcomes such as `LOGIN_SUCCESS`, `LOGIN_FAILED`, `LOGIN_RATE_LIMITED`, `SESSION_CREATED`, `SESSION_REVOKED`, `OTP_RATE_LIMITED`, `OTP_FAILED`, `OTP_VERIFIED`, and `PERMISSION_DENIED`.

Identifiers, IP addresses, and user agents are keyed hashes where required. Reasons are bounded and metadata is intentionally limited. Tests scan serialized security records to confirm passwords, attempted passwords, raw email identifiers, OTPs, and tokens are absent.

## S. Tenant Isolation

The server resolves user, direct business, group membership, active business, branch, and capability from live database state. Session claims are hints that must exactly match the persisted context; they are not database authority. Business and branch changes cannot reuse a stale context token. Permission caches are request-local React caches keyed by the requested capability, and authorization is re-established from the trusted session/database scope.

## T. Testing Abuse Validation

Local deterministic tests cover known and unknown accounts, repeated wrong passwords, 20 additional rapid attempts after throttling, rate-limit recovery through an injected server clock, identifier hashing, trusted-proxy spoof resistance, IPv4-mapped IPv6 normalization, storage fail-safe behavior, OTP request/verify throttling, expiry, one-time consumption, replay denial, and concurrent verification behavior.

Browser validation confirmed safe invalid-credential UX followed by `Too many attempts. Try again later.` without counters or account-existence detail. It also confirmed logout revocation and a live role-revocation test: removing Cashier POS capability immediately denied direct `/cashier` access without rendering POS content; restoring the capability restored access.

## U. Authenticated POS Regression

### Post-Auth Financial Regression Closure

The Local browser regression used newly created, clearly labelled synthetic QA records and the normal password-login form. It did not inject a cookie, forge a session, reuse an already authenticated tab, or bypass an application authorization check.

Salon closure completed the authenticated owner flow through customer/appointment loading, Cashier POS, service checkout, cash payment, invoice creation, reload/revisit, and daily closing. The final invoice was paid at RM88.00 with a zero balance. Reloading and revisiting the same appointment showed the existing invoice and did not create a second invoice, payment, or financial operation. The closing snapshot reconciled gross, net, collection, expected cash, and counted cash to RM88.00 with a zero difference and no unexplained exception.

Auto closure completed the authenticated owner flow through customer/vehicle work order, real work-order status mutation, POS checkout, cash payment, invoice creation, reload/revisit, and daily closing. The final invoice was paid at RM150.00 with a zero balance. Reloading and revisiting the same work order showed the existing invoice with no amount due and did not create a second invoice, payment, or financial operation. The closing snapshot reconciled gross, net, collection, expected cash, and counted cash to RM150.00 with a zero difference and no unexplained exception.

Salon owner, manager, and cashier each completed a normal login. Auto owner completed a normal login. A live capability-revocation test removed the Salon cashier's POS permission after login: direct `/cashier` access was denied without POS content, a `PERMISSION_DENIED` security event was recorded, and restoring the capability restored access in the same session. Session state remained stable across login, navigation, checkout, reload/revisit, and closing. Logout revoked the session and a later protected-route request returned to login.

Browser console error and warning counts were both zero. The hidden Local development supervisor did not persist raw stdout/stderr to a log file, so this closure does not claim a file-based server-log review. Runtime requests surfaced no 5xx or failed transaction, both financial operations completed, both closing snapshots locked, and the Local login health check returned HTTP 200.

The only issue found was in the synthetic Auto fixture: its initial work order omitted a `WorkOrderItem`, so the UI correctly showed RM0.00. The Local QA fixture builder was corrected to create the service item and the current synthetic record was repaired before the real payment flow. No production behavior, schema, migration, or financial calculation was changed for that fixture correction.

## V. Tests

Final Local gates completed:

- Targeted authentication and financial regression: 9/9 unit and 5/5 integration tests passed.
- Full suites: 713/713 unit and 90/90 integration tests passed.
- TypeScript passed. Lint passed with only the pre-existing WhatsApp `<img>` advisory.
- Local production-mode build passed. Its existing CSS autoprefixer advisories remain non-blocking.
- Prisma generate and validate passed. Migration status found 142 migrations and reported the Local database schema up to date.
- This post-auth task changed no schema or migration, so it did not trigger another fresh migration rebuild. The fresh rebuild completed during the underlying authentication-hardening implementation remains the applicable schema evidence.
- The canonical workspace guard and `git diff --check` passed at final closure.

## W. Remaining Risks

- Testing must set `AUTH_TRUST_PROXY_HOPS` to the exact verified reverse-proxy hop count before enabling IP-based enforcement there. The secure default is `0`, which ignores forwarded IP headers and still enforces identifier/device dimensions.
- Public self-service password reset and invitation flows do not exist; adding either later requires one-time, short-lived, tenant/recipient-bound tokens and enumeration-safe requests.
- MFA, passkeys, and SSO remain out of scope.
- Security-event retention, alert thresholds, and operational incident routing should be decided during final Testing release audit.
- Live SMS provider delivery acceptance remains separate from the validated OTP security logic.
- WhatsApp webhook replay protection is intentionally deferred to the separately authorized WhatsApp Testing Hardening phase.

## X. Testing Variables Changed

No persistent Local or Testing environment variable value was changed during this implementation. The synthetic QA password was provided only to the fixture process through an ephemeral shell variable, was absent after the process exited, and has no persisted assignment in the workspace. No Production variable was read or modified.

New supported variable: `AUTH_TRUST_PROXY_HOPS` (integer `0`–`5`, default `0`). Testing should set it only after the deployed proxy topology is verified. Existing `SESSION_SECRET` must remain at least 32 characters; existing employee OTP secret and delivery configuration remain unchanged.

## Y. Recommended Next Action

Stop at this closure and await separate authorization. A later Testing release audit must use the verified Testing proxy-hop value and Testing-only QA accounts. Do not treat Local results as Production verification and do not enter WhatsApp hardening or another product phase from this task.

## Z. Final Status

`AUTHENTICATION SECURITY HARDENING — READY`

Environment statement:

`LOCAL / TESTING ONLY`

`PRODUCTION NOT ACCESSED`

`PRODUCTION NOT VALIDATED`
