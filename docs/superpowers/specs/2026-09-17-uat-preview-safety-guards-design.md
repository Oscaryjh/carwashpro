# UAT Preview Safety Guards Design

## Goal

Make `uat-preview` a production-build, production-grade runtime with an isolated OTP interceptor, an application-wide access gate, and a database-bound synthetic fixture path. The result must be locally reproducible without creating Railway resources or changing Testing or Production.

## Trust boundaries

1. Runtime identity is established before feature configuration. An unknown explicit environment, or a Railway deployment without an environment identity, is an error rather than `development`.
2. `uat-preview` runs with `NODE_ENV=production` and inherits production-grade release, secret, database, and restricted-feature validation without becoming Production or becoming production-eligible.
3. Preview access protection runs before existing login, Staff authentication, RBAC, and sensitive-action checks. Passing the access gate grants no application permission.
4. Preview OTP is a separate provider. It has no fallback to mock, SMS123, or Twilio, accepts only allowlisted synthetic phone numbers, and derives short-lived challenge-bound codes with a Preview-only HMAC seed. Plaintext codes never enter the database, health response, application logs, reports, screenshots, or public endpoints.
5. Database denylist checks run before allowlist checks. A Testing or Production environment ID, service ID, database name, or keyed database fingerprint is an unconditional rejection.
6. Fixture environment, service, database, fingerprint, restricted-integration, and existing-data checks finish before the first write. The only accepted non-empty target contains the exact synthetic fixture marker.

## Architecture

### Shared runtime environment contract

`src/lib/release/environment-contract.mjs` is the single executable parser used by the Next.js runtime and `scripts/validate-release-environment.mjs`. `environment-contract.d.mts` supplies the strict TypeScript surface. It recognizes `development`, `testing`, `uat-preview`, and `production`; `test` is the existing alias for `testing`.

### Preview OTP interceptor

`UatPreviewEmployeeOtpProvider` implements the existing provider interface with `verificationMode="provider"`. The provider reference carries only a version, challenge ID, and expiry epoch. The six-digit code is derived from the Preview HMAC seed, normalized synthetic phone, challenge ID, and expiry. Existing durable challenge state continues to enforce request limits, verification attempt limits, expiry, invalidation, and single use.

A local CLI helper accepts a challenge ID, reads the matching Preview challenge from the guarded database, and prints the current code only to its invoking terminal. It requires the same Preview identity and HMAC seed and refuses Testing, Production, non-synthetic phones, and expired challenges. It is not an HTTP route.

### Preview access protection

The existing Next.js middleware is widened to cover business pages, Staff pages, and business APIs while excluding `/api/health` and necessary static assets. A pure helper validates HTTP Basic credentials with a fixed-work constant-time byte comparison. Outside `uat-preview`, the helper is inert and the existing login/RBAC behavior remains authoritative.

### Database and fixture identity

The fixture contract supports two modes:

- local disposable: non-production Node runtime and an exact loopback PostgreSQL host;
- UAT Preview: production Node runtime, `uat-preview`, exact Railway project/environment/Web/database service identities, exact database name, matching HMAC database fingerprint, Preview guard secret, synthetic fixture enablement, and all external/restricted actions disabled.

The fingerprint canonicalizes protocol, lower-cased hostname, effective port, decoded database name, normalized username, and declared database service ID. Only the resulting HMAC SHA-256 digest is compared or reported.

The Preview fixture uses a fixed synthetic business slug as its marker. Before writes it rejects any unrelated business, customer, employee, or user population. On a matching marker it reconstructs the fixture artifact and upserts/reuses records rather than creating a second fixture. An integration snapshot compares Business, employee, device, Attendance, Leave, Payroll, and Payslip counts across two runs.

### Release validation and evidence

The release validator imports the shared environment parser. `uat-preview` requires full immutable release identity, Preview access/OTP/fixture contracts, disabled outbound providers/workers/cron/restricted actions, and `productionEligible=false`. Production retains its current provider contract; Testing and development retain their current controlled behavior.

The final evidence commit records the local production build simulation, outbound-call audit, browser/viewport evidence stored outside the worktree, full regression, immutable Git/tree/archive identities, Manifest V2 sections, and the safety report. It does not push or deploy.

## Failure behavior

All guard errors use category-level codes and never echo a secret, OTP, full phone number, raw `DATABASE_URL`, host, username, or password. Misconfigured Preview OTP cannot select another provider. Denylist matches stop before allowlist evaluation. Failed fixture checks occur before any database mutation.

## Commit boundaries

1. `feat(runtime): add production-grade uat preview identity`
2. `feat(auth): add isolated uat preview otp interceptor`
3. `feat(security): protect uat preview application access`
4. `feat(uat): bind preview fixture to railway database identity`
5. `fix(release): enforce production-grade uat preview contract`
6. `docs(release): record uat preview safety guard evidence`

