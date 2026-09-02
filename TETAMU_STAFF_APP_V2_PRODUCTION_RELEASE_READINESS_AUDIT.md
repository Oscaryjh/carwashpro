# TETAMU STAFF APP V2 PRODUCTION RELEASE READINESS AUDIT

Audit date: 2 Sep 2026 (Asia/Singapore)  
Audit scope: Staff App 3000 only  
Audit type: **AUDIT ONLY**  
Primary closure baseline: `TETAMU_STAFF_APP_V2_GLOBAL_FINAL_UAT_AND_CLOSURE_REPORT.md`

## 1. FINAL VERDICT

# REVIEW REQUIRED

TETAMU Staff App V2 has a clean, test-passing source snapshot and no newly identified cross-tenant, authentication-bypass, money-correctness, or build blocker. It is **not yet ready to enter Production rollout**, because the accepted Railway Testing deployment is materially different from the proposed release candidate, the candidate is not on a tracked remote release branch, the Production migration ledger and environment contract have not been owner-authorized for read-only verification, and Production storage/backup/region ownership is not confirmed.

This verdict does not authorize deployment. It means the engineering baseline is healthy, but the release package and operational prerequisites must be reconciled first.

## 2. EXECUTIVE SUMMARY

- Canonical Staff runtime: **Staff 3000**. Staff 3100 is reference-only, unused, and ready to retire.
- Proposed source snapshot: `94db430d894d1ee0712ae4201e43505138cbcd06` on `codex/staff-v2-global-closure` in the clean worktree `C:\CodexTetamuP0-global-uat-20260902`.
- The requested canonical workspace `C:\CodexTetamuP0` is **not release-safe**: it is on `9037025` with 311 working-tree changes and unrelated product work.
- Accepted Testing deployment: `0924624b-7261-4ec7-bb88-22e9ffa14b42`, SHA `c75b5d31d311bbb15cd0a6590e24cc3d23e53bdf`; current `/api/health` is green.
- Testing versus candidate classification: **DRIFT FOUND**. Their merge base is `6a5db247`; the Testing side has 94 unique commits and the candidate side 63. There are 554 changed files, including 294 runtime/build/schema/migration files.
- All accepted Staff V2 feature commits are ancestors of `94db430`.
- Current gates: unit 1,407/1,407, TypeScript, ESLint (0 errors), diff-check, production build, and fresh 212-migration rebuild all pass. The prior selected PostgreSQL Staff integration set remains 30/30 across 11 files because no runtime source changed after closure.
- Code-level OTP/session safety is strong. SMS123 is outside the database transaction; challenge/hash is committed before the provider side effect. Production mock/`000000` is rejected.
- No credible tracked Production secret was identified. Pattern hits were placeholders, local test URLs, or UI text.
- Main operational review items: exact release packaging, candidate redeployment to Testing, Production env/region/domain/SMS123 confirmation, Production migration-ledger reconciliation, verified backup/restore owner, persistent avatar storage, private attachment storage, and single package-manager/lockfile policy.

## 3. RELEASE CANDIDATE

| Item | Audited value | Assessment |
| --- | --- | --- |
| Canonical repository requested | `C:\CodexTetamuP0` | Repository root, but current worktree is unsafe for release |
| Clean candidate worktree | `C:\CodexTetamuP0-global-uat-20260902` | Clean and suitable as audit evidence |
| Branch | `codex/staff-v2-global-closure` | Local branch only |
| HEAD | `94db430d894d1ee0712ae4201e43505138cbcd06` | Exact proposed Staff V2 snapshot |
| HEAD subject | `docs(staff): close global V2 UAT` | Report-only closure commit; runtime parent is `ccbba5e` |
| Upstream | None | Must create/push a controlled release branch later |
| Remote contains candidate | No remote-tracking ref found | Source is not yet a Railway-consumable frozen release ref |
| Staff runtime path | `src/app/staff`, `src/components/staff-pwa`, employee APIs and shared Staff services | Canonical 3000 implementation |
| Staff 3100 | No runtime selected; tests assert port 3000 owns `/staff` | Reference-only; exclude from release |

The candidate is a valid **source-freeze baseline**, not yet the final deployable release package. Because this is a monolithic Next application, deploying `94db430` deploys all tracked runtime at that commit, not only `/staff`.

## 4. GIT / SOURCE FREEZE

`C:\CodexTetamuP0` is on local branch `codex/testing-release-2026-08-24`, HEAD `9037025b10adb215a17d19acf61df51e23ef95fb`, with no upstream and 311 modified/untracked entries. The dirty set includes `package.json`, `prisma/schema.prisma`, Next config, APIs, payroll, POS, AI, CRM, WhatsApp and Staff-related files. None may be staged or included implicitly.

`C:\CodexTetamuP0-global-uat-20260902` was clean before and after all gates. `git diff --check` passed. Ignored local material includes dependency/build/runtime classes such as `node_modules`, `.next`, `.env.local`, `.tmp` and runtime artifacts; the isolated archive build proved none is required as source input. Secrets and local artifacts must remain excluded.

Release freeze requirements:

1. Create a new owner-approved `release/staff-v2-...` or equivalent branch later from the confirmed Production baseline.
2. Bring in only the accepted Staff commits and required shared backend/migrations, or explicitly approve the whole monolith at `94db430`.
3. Push the branch and record immutable SHA plus source digest.
4. Ensure clean status and one canonical lockfile policy.
5. Do not use the dirty `C:\CodexTetamuP0` worktree for packaging.

## 5. TESTING VS RELEASE CANDIDATE

**Classification: DRIFT FOUND**

| Evidence | Testing | Candidate |
| --- | --- | --- |
| Deployment | `0924624b-7261-4ec7-bb88-22e9ffa14b42` | Not deployed |
| SHA | `c75b5d31d311bbb15cd0a6590e24cc3d23e53bdf` | `94db430d894d1ee0712ae4201e43505138cbcd06` |
| Health environment | `testing` | Local audit only |
| Health database | `ready` | Fresh disposable DB passed |
| Source digest | `null` | Must be produced at release freeze |
| Common ancestor | `6a5db247aa8c7ab76234a7ed918a6d5978d08683` | Same |
| Unique commits after split | 94 | 63 |

The exact diff command is:

```text
git diff --name-status c75b5d31d311bbb15cd0a6590e24cc3d23e53bdf..94db430d894d1ee0712ae4201e43505138cbcd06
```

The 554 file-level differences are exhaustively grouped below; the glob/count combination covers every runtime-relevant path rather than treating a large diff as equivalent.

| Exclusive group | Files | Runtime meaning |
| --- | ---: | --- |
| `src/app/staff/**` | 61 | V2 pages, loading/error states, Pay/Profile/Approvals/History/Requests routing |
| `src/components/staff-pwa/**` | 40 | V2 presentation and client behavior for every Staff module |
| employee/local UAT API routes | 6 | Employee appointment/correction/exception/avatar/logout and local helper behavior |
| Attendance/auth shared services | 32 | OTP lifecycle, sessions/devices, corrections, P2, Timesheet, OT and scope readers |
| Leave/Claim/Pay/Commission shared services | 20 | Employee money/request read models and attachment behavior |
| `prisma/**` | 8 | Schema plus seven migration-directory differences |
| Staff/PWA public assets | 7 | Six Staff icons and `sw.js` |
| package/build compatibility config | 5 | Build/runtime and Chrome 87 support |
| other tracked runtime/scripts | 118 | Monolith-wide AI, HR/payroll, POS/business and UAT-support changes; not automatically approved by Staff UAT |
| tests/artifacts | 177 | Automated and visual evidence, not runtime |
| Markdown reports/docs | 54 | Documentation only |
| other/configuration | 26 | Must be classified during release-branch construction |

Migration lineage also differs: Testing has `20260822010000_staff_app_appearance`, `20260822023000_development_concurrent_otp_challenges`, and `20260824130000_staff_app_sms123_otp`, while the candidate uses `20260824190000_staff_app_sms123_otp` and `20260829110000_canonical_staff_app_appearance`, plus later shared migrations. This is migration-ledger drift, not a cosmetic rename.

Owner UAT against `c75b5d3` remains valid behavioral evidence for Profile, workplace switch and logout, but it is **not proof that `94db430` is materially equivalent runtime**. Before Production, deploy the exact final candidate to Testing, confirm health SHA/source digest, rerun the short Staff smoke, and repeat the owner scenarios affected by the diff.

## 6. STAFF V2 MODULE LINEAGE

Git ancestry, not report text, confirms each accepted implementation is reachable from `94db430`:

| Module | Accepted runtime commits reachable from candidate |
| --- | --- |
| Home V2 | `5bbbfc5`, polish `b76070f` |
| Time V2 | `5dacfc1`, owner polish `ab76ba2` |
| Schedule V2 | `b06d3fc` |
| Attendance History V2 | `5b9cdd1` |
| Attendance Corrections | `b56d4fb`, `a0bc046`, P2 projection `cc85e91` |
| Timesheet & OT | `4b46000`, polish `7c0e948`, self-review fixes `92e674b`/`c9c4359` |
| Requests Hub | `daae682` |
| Leave | `e3f9d08`, form polish `81ba6c0` |
| Claims | `7bf0018` |
| Approval Center | `2ebf764`, manager history `d67b24b`, visual normalization `22c6b9f` |
| Pay Hub | read hardening `87f09e7`, V2 `18057f6` |
| Payslips | `ae1d389` |
| Commission | `772ff07` |
| Profile | `de367d2` |
| Global closure | `94db430` |

Profile V2 and every prior accepted Staff commit listed above return exit code 0 from `git merge-base --is-ancestor <commit> 94db430` or appear directly in the candidate ancestry range.

## 7. RELEASE PACKAGE

The future package must contain:

- canonical Staff 3000 routes/components/styles/icons/PWA manifest;
- employee auth/session/device/OTP APIs and services;
- Attendance, P2, correction, Timesheet/OT, Leave, Claims, Approval, Pay, Payslip and Commission shared readers/writers already accepted;
- server-side entitlement, capability and tenant-scope services;
- required Prisma schema and only the migration delta proven against Production;
- release environment validator, health endpoint, lockfile and build config.

It must exclude:

- visual screenshots and `artifacts/**`;
- `.tmp`, `.runtime`, local DB/WAL, local `.env*` and uploaded test files;
- local fixture/session helpers and UAT scripts from operational execution;
- test-only personas/seeds and non-production statutory fixtures;
- Staff 3100;
- unrelated dirty workspace changes;
- unapproved monolith runtime changes.

Because the application deploys as one monolith, “exclude unrelated runtime” requires a controlled release branch or explicit whole-commit approval; it cannot be achieved by a Railway path filter alone. No branch/tag was created in this audit.

## 8. ENVIRONMENT VARIABLE INVENTORY

No secret values were read or printed. “Testing configured” uses health and existing accepted documentation; “Production” remains unknown because Production was not accessed.

| Variable/group | Purpose | Prod required | Secret | Source of truth | Testing | Production | Missing risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `APP_ENVIRONMENT` | hard environment boundary | Yes | No | `.env.example`, validator | CONFIGURED (`testing`) | UNKNOWN | Production guards may not activate |
| `APP_RELEASE_SHA` | deployment identity | Yes | No | environment contract | CONFIGURED | UNKNOWN | Cannot prove running commit |
| `APP_RELEASE_SOURCE_DIGEST` | immutable source digest | Yes | No | environment contract | MISSING (`/api/health` returns null) | UNKNOWN | Cannot prove source parity |
| `DATABASE_URL` | PostgreSQL connection | Yes | Yes | Railway variable | CONFIGURED/healthy | UNKNOWN | App unavailable or wrong DB |
| `SESSION_SECRET` | main-app session signing | Yes | Yes | validator | UNKNOWN | UNKNOWN | Startup/session failure |
| `EMPLOYEE_AUTH_SECRET` | Staff token/hash domain secret | Yes | Yes | employee auth config | CONFIGURED by working auth | UNKNOWN | Staff startup/auth failure |
| `OTP_PROVIDER` | `sms123` canonical target | Yes | No | employee auth config | CONFIGURED by accepted Testing OTP | UNKNOWN | Wrong/disabled provider |
| `OTP_CHANNEL` | must be `sms` with SMS123 | Yes | No | employee auth config | CONFIGURED | UNKNOWN | fail-closed config error |
| `EMPLOYEE_OTP_SEND_MODE` | compatibility alias | No if `OTP_PROVIDER` set | No | environment contract | UNKNOWN | UNKNOWN | ambiguous provider selection |
| `SMS123_API_KEY` | provider credential | Yes for SMS123 | Yes | Railway secret | CONFIGURED by accepted Testing behavior | UNKNOWN | OTP cannot send |
| OTP expiry/attempt/resend/hourly limit/timeout vars | abuse and reliability bounds | Defaults exist; explicit recommended | No | `.env.example`, config | UNKNOWN | UNKNOWN | unsuitable rate/timeout policy |
| `EMPLOYEE_OTP_MOCK_CODE`, `EMPLOYEE_OTP_MOCK_ACCESS_KEY` | non-Production test support | Must be absent | Yes | config/validator | UNKNOWN | UNKNOWN | startup fails if mock code present in Prod |
| Employee session expiry/selection/touch vars | Staff session lifetime | Defaults exist; explicit recommended | No | config | UNKNOWN | UNKNOWN | policy differs from intended |
| `STAFF_APP_ORIGIN` / public domain | canonical public Staff URL | Yes operationally | No | `.env.example`/Railway domain | CONFIGURED by Testing URL | UNKNOWN | PWA/origin and communication errors |
| `RAILWAY_ENVIRONMENT_NAME`, release/deployment injected vars | environment and deployment identity | Yes on Railway | No | Railway | CONFIGURED | UNKNOWN | guard/health identity ambiguity |
| `CLAIM_PRIVATE_STORAGE_PROVIDER` | private Claim/Leave evidence backend | Yes when those modules enabled | No | storage config | CONFIGURED in documented Testing | UNKNOWN | upload fails closed |
| `CLAIM_PRIVATE_STORAGE_S3_*` | private object store endpoint/region/bucket/credentials/prefix | Yes for S3 mode | credentials secret | storage config | CONFIGURED in documented Testing | UNKNOWN | upload/read failure or data exposure |
| Avatar persistence mount at `public/uploads` | employee avatar durability | Required if avatar enabled | No | infrastructure, no env abstraction | Testing volume documented | UNKNOWN | avatars disappear after redeploy |
| Business/branch timezone data | Attendance calendar truth | DB configuration, not process env | No | canonical Business/Branch rows | Tested | REQUIRES READ-ONLY VERIFICATION | wrong work date/cutoff |
| `MFA_*`, `PAYROLL_PAYMENT_*` secrets | monolith startup/payroll protection | Yes under Production validator | Yes | environment contract | UNKNOWN | UNKNOWN | Production web startup fails |
| AI variables | shared monolith optional feature | Key only if enabled | Key secret | environment contract | UNKNOWN | UNKNOWN | validator fails unless AI disabled/configured |
| WhatsApp worker variables | shared worker integration | Only worker scopes | Yes | environment contract | UNKNOWN | UNKNOWN | worker startup/send failure |

Production status for all unknown rows must be resolved by owner-authorized configuration review without copying values into reports.

## 9. SMS123 PRODUCTION READINESS

**Classification: OWNER CONFIG REQUIRED**

- Canonical code supports `sms123`; Production must explicitly set `OTP_PROVIDER=sms123`, `OTP_CHANNEL=sms`, and a server-only `SMS123_API_KEY`.
- Malaysia numbers are normalized to canonical E.164; equivalent local and `+60` formats are tested.
- Request endpoint: `POST /api/employee-auth/request-otp`; verify endpoint: `POST /api/employee-auth/verify-otp`.
- Challenge, keyed OTP hash, cooldown and audit/security event are committed in a bounded Prisma transaction **before** `provider.sendVerification()`.
- SMS123 network I/O is outside the transaction. Provider failure invalidates the committed challenge where possible. Provider acceptance is followed by a retrying delivery-state update; the challenge is not rolled back after an SMS may already be on the handset.
- SMS123 verification uses the stored keyed hash and does not call the provider again.
- Phone/IP/device/provider request limits, verification attempt limits, resend cooldown, maximum attempts and provider timeout are configurable and bounded.
- Responses are uniform to resist account enumeration. Logs contain challenge/provider/failure codes and masked phone/audit context, not OTP or API key.
- Provider secrets are not sent to Staff UI and are not `NEXT_PUBLIC_*`.

Owner/provider confirmations required: Production SMS123 account enabled, approved sender/content/template, sufficient credit, Malaysian telco acceptance, credential installed only in Production, support contact, rate limits, and one controlled post-release OTP. No real OTP was sent in this audit.

## 10. AUTH / SESSION READINESS

Code-level status: **PASS, subject to Production env validation**.

- Cookie: `HttpOnly`, `SameSite=Strict`, path `/`, bounded max age; `Secure=true` when `NODE_ENV=production`.
- Session plaintext token exists only in the cookie; database stores a keyed token hash.
- Session rows bind employee account, membership, business, branch and authorized device, with expiry, activity and revocation state.
- Logout is same-origin protected, revokes the database session, writes audit events and expires the cookie.
- Membership/workplace switch revokes the old scoped session and creates a new tenant-scoped session; accepted owner UAT found no stale tenant data.
- Device replacement/revocation and inactive membership/device/session checks fail closed.
- Membership selection token is signed, issuer/audience/expiry bound, device-fingerprint bound and one-time consumed.
- Production mock mode is rejected. Explicit mock code is rejected outside non-Production mock mode. Default `000000` exists only in Development+mock.
- Production startup validator rejects mock provider/code and localhost database targets.

Release health must prove `APP_ENVIRONMENT=production`; otherwise code may not enforce the Production-only secure-cookie and provider branches.

## 11. TEST / FIXTURE GUARDS

| Surface | Classification | Evidence/risk |
| --- | --- | --- |
| `tests/**`, visual capture scripts | COMPILE-TIME/DEVELOPER ONLY | Not imported by Staff runtime |
| local fixture preparation scripts | LOCALHOST/TEST ENV or script guard | Must never run in Production release window |
| non-production statutory fixture migration | TEST ENV ONLY by runtime guard | Migration schema object exists, but writes require non-Production guard |
| `POST` mock OTP provider | TEST ENV ONLY | Production config and provider constructor reject it |
| `000000` | DEVELOPMENT MOCK ONLY | Production and provider mode reject it |
| `/api/local-uat/session` | LOCALHOST GUARDED, compiled in Production bundle | Returns 404 unless request hostname is loopback; should additionally be proxy-verified or route-excluded in final release hardening review |
| former `/staff/uat-sign-in` | NOT PRESENT in candidate | No built route |
| `.tmp` persona/session artifacts | LOCAL FILE ONLY | Not present in git archive; isolated build succeeds without them |
| seed/admin bootstrap | EXPLICIT PRODUCTION FLAG | `ALLOW_PRODUCTION_PLATFORM_ADMIN_BOOTSTRAP` must remain false except owner-approved one-time use |

No confirmed Production-capable Staff auth bypass was found. The localhost helper is not a blocker under the deployed-host contract, but the final reverse-proxy smoke should verify that spoofed `Host` cannot reach it; expected result is 404.

## 12. DATABASE MIGRATION READINESS

- Candidate migration directory: `prisma/migrations`.
- Count: **212**.
- Duplicate directory names: **0**.
- Missing `migration.sql`: **0**.
- Non-timestamp directory names: **0**.
- Fresh disposable PostgreSQL rebuild: **PASS**, all 212 applied in order.
- Candidate-wide scan found no `DROP TABLE`, `DROP COLUMN`, or `DELETE FROM` statements.
- Historical chain includes 41 migrations with enum-alter operations, 6 with `SET NOT NULL`, 27 data-update/backfill migrations, and 131 ordinary non-concurrent index creations. Counts are repository-wide, not the unknown Production delta.
- The Staff-relevant chain includes employee identity/account/membership/session/device/OTP, Attendance/P2/Timesheet/OT, Leave/evidence, Claims/reimbursement, Payroll/payslip, Commission, roster and Staff appearance migrations.

The Testing and candidate migration ledgers are not identical. Production migration state was not queried and cannot be inferred from Testing.

**PRODUCTION MIGRATION STATE → OWNER / RELEASE WINDOW VERIFICATION REQUIRED**  
**REQUIRES OWNER-AUTHORIZED PRODUCTION READ-ONLY VERIFICATION**

Before any `migrate deploy`, compare Production `_prisma_migrations` names/checksums with the frozen release branch, calculate the exact delta, reconcile renamed/divergent Staff migrations without reapplying equivalent DDL, and dry-run the delta on a restored copy.

## 13. MIGRATION RISK MATRIX

| Migration class / examples | Classification | Release treatment |
| --- | --- | --- |
| Staff appearance additive JSON/text columns | SAFE ONLINE | Confirm not already present under another migration ID |
| OTP provider/reference/hash/delivery fields and constraints | SHORT LOCK / MANUAL REVIEW REQUIRED | Reconcile Testing/candidate renamed migration lineage |
| Employee membership/session/device/account foundations | SHORT LOCK + DATA BACKFILL | Validate legacy phone/membership/device rows on restore copy |
| Attendance/P2/Timesheet/OT foundations | DATA BACKFILL + SHORT LOCK | Validate historical sessions/results and index duration |
| Leave final closure, custom types and evidence | DATA BACKFILL + SHORT LOCK | Validate nullable legacy evidence and storage readiness |
| Claims/reimbursement/payroll bridge | DATA BACKFILL / MANUAL REVIEW REQUIRED | Do not imply settlement; validate canonical status rows |
| Payroll/payslip/commission foundations | DATA BACKFILL + SHORT LOCK | High money sensitivity; dry-run and reconcile counts |
| `SET NOT NULL` migrations | POTENTIALLY DESTRUCTIVE if legacy rows violate precondition | Prove backfill before constraint |
| enum alterations | MANUAL REVIEW REQUIRED | Generally forward-only; confirm server version/transaction behavior |
| non-concurrent indexes | SHORT TO LONG LOCK depending table size | Measure on Production-size restore; schedule window |
| non-production fixture facility | SAFE only with environment guard | Verify no Production fixture writes are possible |
| unrelated shared-chain migrations | MANUAL REVIEW REQUIRED | Monolith release cannot assume Staff-only delta |

No currently inspected candidate migration contains direct table/column drops, but this does not justify applying an unknown 212-migration delta to Production.

## 14. BACKUP REQUIREMENT

# BACKUP REQUIRED BEFORE RELEASE

Required evidence before future migration/deploy:

1. Production PostgreSQL snapshot/backup completed immediately before the window.
2. UTC and Asia/Singapore timestamp, database/service identity, migration ledger export and release SHA recorded.
3. Retention long enough to cover pilot and financial/attendance reconciliation; owner should define policy, with at least one pre-release snapshot retained beyond the observation window.
4. Named operator and rollback decision owner.
5. Documented restore command/process and credentials access path.
6. Restore validation on a non-Production database: connection, migration ledger, representative employee/session/attendance/leave/claim/payroll/payslip/commission row counts and app smoke.
7. Storage backup/versioning for private evidence and avatar volume, not only PostgreSQL.

No backup was performed in this audit.

## 15. PRODUCTION DATA COMPATIBILITY

The code generally treats legacy/optional fields defensively: Profile omits unavailable `joinedAt`, employee code, employment type and device facts; Pay reads only published immutable records; Commission reads the current canonical revision; Attendance avoids guessing expected days; Leave/Claim evidence states are explicit.

Compatibility checks still required on a Production restore:

- active membership has a valid employee account and same-business primary branch assignment;
- phone normalization produces no duplicate active identity;
- legacy sessions/devices are expired/revoked or conform to current binding constraints;
- nullable `joinedAt`, employment type/code/avatar and default schedule fields do not violate pending `NOT NULL` changes;
- Attendance historical sessions have valid work date, branch, punches and result/resolution links;
- P2/Timesheet locks and digests are internally consistent;
- Leave rows have explicit policy/evidence lifecycle where required;
- Claim reimbursements distinguish approved, payroll-linked and settled;
- Payslips are published and ownership-scoped; unpublished payroll is not visible;
- Commission statements have a current revision and canonical status.

No Production row compatibility claim is made without the restore-copy validation.

## 16. MODULE ENTITLEMENTS

Staff navigation and server routes use canonical business module entitlements, not route existence alone.

| Module | Expected behavior when enabled | Disabled/partial behavior |
| --- | --- | --- |
| ATTENDANCE/HR | Home/Time punch and history according to employee attendance eligibility | server returns disabled/not-enabled; no mutation |
| LEAVE | Requests destination, own balances/requests/documents | route fails closed or is omitted |
| CLAIMS | own Claims and configured private evidence storage | omitted/fails closed; storage errors do not expose files |
| PAYROLL | Pay/Payslips only from published own records | route denied/omitted; no live payroll inference |
| COMMISSION | own current-revision statements | omitted/denied independently of Payroll |
| SALON | read-only Appointments shortcut/page | omitted/denied for non-Salon businesses |

APIs recheck auth/module/scope server-side. Partial configuration produces bounded empty/error states rather than granting access. Production must verify each pilot business’s entitlement rows.

## 17. MULTI-TENANT SAFETY

Automated evidence covers `businessId`, `membershipId`, `branchId` and `employeeAccountId` boundaries across Staff auth, Home/Time, Attendance, corrections, Timesheet/OT, Leave, Claims, Approvals, Pay/PDF, Commission, Profile and workplace switching.

High-risk conclusions:

- session context is membership/business/device bound;
- employee reads enforce own membership/account;
- manager queues enforce current business, authorized branches, capability and no self-review;
- Payslip PDF requires own immutable publication, returns private/no-store, and foreign IDs are not disclosed;
- Commission reads own current revision only;
- cursor/archive scopes bind business and membership;
- workplace switch revokes the old tenant session and forces a hard tenant refresh.

No unresolved cross-tenant path was reproduced. Any cross-tenant observation during exact-candidate Testing or Production pilot is an immediate stop/rollback trigger.

## 18. MANAGER SAFETY

- Home displays only a compact approval reminder when actionable pending work exists.
- Requests keeps a permanent Approvals entry only when the employee membership has review capability.
- Approval Center reuses canonical domain readers and workflows for Leave, Claims, Attendance and OT.
- Tenant, branch, capability, self-review, stale-state and locked-Timesheet guards are server-side.
- Manager status does not broaden own employee Payslips, Commission, Profile, Timesheet, Leave or Claims pages.
- Manager history is an immutable/read-model projection, not a second approval state model.

Automated tests pass; no final owner real-device approval sweep was fabricated. One controlled manager smoke remains required after exact-candidate Testing deployment.

## 19. PAY / MONEY SAFETY

Current Staff V2 wording remains safe:

- Payslip `Available` means published, not paid.
- Commission `Added to payroll` does not mean paid.
- Claim `Approved` does not mean paid; `PAYROLL_LINKED` is presented as processing/added to payroll.
- No salary `Paid` state is invented.
- No deductions are derived from Gross minus Net.
- No commission rate or item title is guessed.
- Pay/Payslip views read immutable published evidence and preserve canonical Net/Gross values.

No money-correctness blocker was found in the Staff read surfaces. Production smoke must use a controlled employee and must not mutate payroll.

## 20. CLAIM SETTLEMENT GAP

**Classification: NON-BLOCKING**, provided the existing wording and lifecycle remain unchanged.

`PAYROLL_LINKED → PAYROLL_SETTLED` has no complete canonical closing writer. Staff UI does not mark `PAYROLL_LINKED` as paid/settled, and the current Staff release does not require the absent writer for Payroll calculation. Do not implement or simulate settlement in this release. If a future feature starts depending on final claim settlement, this classification must be revisited.

## 21. STORAGE READINESS

| Asset | Current implementation | Production requirement | Status |
| --- | --- | --- | --- |
| Claim receipts | explicit private filesystem or S3-compatible store; checksum, MIME/content validation, size limit, quarantine metadata | private S3 bucket, HTTPS, least privilege, retention/backup, scan/privacy process | UNKNOWN / OWNER VERIFY |
| Leave documents | same private store and validation, business/membership/branch authorization, private no-store responses | same as Claims | UNKNOWN / OWNER VERIFY |
| Employee avatar | converted to WebP and written under `public/uploads/employee-avatars`; URL is public | persistent Railway volume mounted at the exact runtime path or future object-store abstraction; backup/retention policy | UNKNOWN / OWNER VERIFY |
| Staff/business logos | runtime upload route/path | durable volume/object storage and cache policy | UNKNOWN / OWNER VERIFY |

Claim/Leave downloads are scoped and audited. Files remain quarantined and cannot be released as “clean” until malware/privacy statuses satisfy policy. Avatar upload is optional but its current filesystem path is not intrinsically durable on Railway; either provision/verify a persistent volume or disable avatar changes during pilot. Storage confirmation is required before rollout.

## 22. PWA READINESS

- Staff manifest has `id`, `start_url` and `scope` at `/staff`, standalone display, portrait orientation and 192/512/maskable icons.
- Service worker is registered only in Production build mode.
- Navigations, all `/api/**`, Next chunks and protected PDFs are never cached.
- Cache contains only PWA icons and manifests.
- `/sw.js` is served `no-cache, no-store, must-revalidate`; worker calls `skipWaiting()` and `clients.claim()`.
- Install/activate refreshes the static cache and deletes differently named old caches.

No reinstall should be required. Release instructions should ask users to close/reopen the PWA or reload once after health is green. If a device remains stale, unregister/reopen is a support fallback, not the normal path. Change cache version if static icon/manifest behavior changes materially.

## 23. OLD ANDROID READINESS

- `browserslist` explicitly includes `chrome 87`.
- Production build uses webpack and a targeted compatibility loader for Next client error-boundary files.
- Dedicated Chrome 87 unit contract passes.
- Current clean and isolated production builds pass.
- Accepted 360/390/412 CSS evidence covers safe-area, bottom-nav clearance, wrapping and touch targets.

Status: **AUTOMATED PASS** for the accepted Vivo/Chrome 87 baseline. This is not a claim of a new physical-device run after `94db430`; repeat one login/Home/Time smoke on the oldest supported device after exact-candidate Testing deployment.

## 24. IPHONE READINESS

Accepted implementation supports iPhone safe-area insets, standalone PWA scope, bottom-nav and sticky-action clearance, native date/file controls, image HEIC/HEIF avatar input with server conversion, and six-digit OTP input/paste behavior. Claim/Leave uploads are size/MIME/content validated.

Owner evidence covers Profile, workplace switch and logout on Testing. It does not constitute a new full-device pass for Home, Time, Requests, Pay, attachments or approvals against `94db430`. Repeat the short release smoke on one iPhone after exact candidate is in Testing and again for the Production pilot.

## 25. RAILWAY PRODUCTION TOPOLOGY

Expected, not verified:

| Component | Expected contract | Actual Production status |
| --- | --- | --- |
| Web service | monolithic Next app serving POS and `/staff` | UNKNOWN / OWNER VERIFY |
| PostgreSQL | dedicated Production DB, private connection | UNKNOWN / OWNER VERIFY |
| Build | `npm run build` → Prisma generate + guarded Next webpack build | repository-defined |
| Start | `npm start` → Production env validator then `next start` | repository-defined |
| Health | `GET /api/health` | route exists; Production not called |
| Public domain | HTTPS canonical domain with `/staff` | UNKNOWN / OWNER VERIFY |
| App/DB region | Southeast Asia/Singapore recommended | UNKNOWN / OWNER VERIFY |
| Private storage | S3-compatible bucket plus optional persistent upload volume | UNKNOWN / OWNER VERIFY |
| Environment separation | distinct Production vars/DB/SMS/storage/domain | UNKNOWN / OWNER VERIFY |

No Railway Production service, variables or domain were opened or changed.

## 26. REGION / LATENCY

Known: accepted Testing app/database evidence identifies Southeast Asia/Singapore (`asia-southeast1-eqsg3a`), and the application’s principal user base is Malaysia. Current Testing health is fast and database-ready.

Unknown: Production web region, PostgreSQL region, private storage region and SMS123 egress latency.

Required: place Production web and PostgreSQL in the same Southeast Asia region where possible; keep private object storage nearby; measure `/api/health`, OTP request, Home and punch latency during pilot. Do not accept an app/DB cross-region topology without an explicit latency and failure-mode review.

## 27. HEALTH CHECK

`GET /api/health` performs a live `SELECT 1`, returns HTTP 200 with `ok=true` and `database=ready`, and exposes release identity: commit SHA, deployment ID, environment, source digest and package version. Database failure returns 503. Response is no-store.

Production success criteria:

- HTTP 200;
- `ok=true`, `database=ready`;
- `environment=production`;
- `commitSha` exactly equals the frozen release SHA;
- `deploymentId` equals the new Railway deployment;
- `sourceDigest` equals the recorded 64-hex release digest and is not null;
- repeated checks during the smoke window remain stable.

Current Testing health (safe read-only call) returned SHA `c75b5d3`, deployment `0924624b-...`, environment `testing`, DB ready and source digest null. Production was not called.

## 28. PRODUCTION SMOKE PLAN

Execute only after owner authorization, backup, migration success and health success:

1. `GET /api/health` and verify exact identity.
2. Open `/staff/login` without authentication; confirm correct Staff 3000 page.
3. Send one controlled OTP to the approved normal employee.
4. Verify Home.
5. Open Time.
6. Open Requests.
7. Open Pay without changing payroll.
8. Open Profile/About this phone.
9. Sign out; verify protected Time/Requests/Pay deny access.
10. Reuse or obtain one manager session only if required; open Requests → Approvals.
11. Confirm own data remains own-only and no action is submitted.
12. If an approved multi-employer pilot exists, switch A → B, verify identity/business/branch refresh, then B → A.

Stop at the first tenant, auth, money, migration, 5xx or widespread OTP anomaly.

## 29. OTP SMOKE POLICY

- Maximum: **one normal employee SMS**; one manager SMS only if a manager session cannot be safely reused.
- Phone numbers, device owner and time window must be approved before release.
- Success: one SMS received, one challenge verified within expiry, correct employee/workplace selected, no duplicate send and no secret/OTP in logs.
- Do not paste OTP into chat, reports or logs.
- Do not automate OTP loops.
- Respect resend cooldown. Do not resend merely because UI is slow; inspect request/health first.
- Stop on duplicate SMS, challenge rollback/invalidity, provider-wide rejection, unexpected tenant, or rate-limit anomaly.

## 30. FIRST EMPLOYEE PILOT

Recommended pilot group:

- one owner-controlled normal employee;
- one genuine normal employee;
- one manager/approver;
- optionally one multi-employer employee after the first three pass.

Pilot scope: login/session, Home, one normal attendance action only when operationally appropriate, read-only Time/Requests/Pay/Profile, one low-risk request if the business owner explicitly schedules it, manager visibility, logout and tenant switch. Do not onboard all staff or run broad payroll actions.

Success requires no tenant mismatch, no OTP duplication, no unexplained 5xx, correct attendance mutation, correct request/approval scope, own-only Pay, stable PWA update and successful logout/re-login.

## 31. OBSERVATION WINDOW

Recommended: 24 hours for the controlled pilot, then 2–3 business days before broad expansion. Include at least one real shift boundary and one manager review cycle.

Monitor login/OTP success and latency, session/logout/device authorization, clock actions, request submissions, approval counts/decisions, Payslip/Commission access, storage upload/read failures, cross-tenant complaints, 4xx/5xx rates and client errors. Keep the cohort fixed during the window. Expand only after owner review.

## 32. OBSERVABILITY

Available:

- Railway application/deployment logs;
- `/api/health` with DB and release identity;
- auth security events and redacted OTP provider failure logs;
- session/logout/device/workplace-switch audit entries;
- canonical approval, attendance, Leave, Claim and payroll audit logs;
- error-safe responses without secret payloads.

Not proven:

- centralized metrics/APM;
- automated 5xx/OTP/latency alerts;
- client-side error aggregation across installed PWAs;
- backup success/restore alerts;
- storage-capacity/object-store health dashboard.

Before release, assign a person to watch Railway and audit events, define a query/runbook for OTP and attendance incidents, and ensure logs preserve challenge/deployment IDs without phone, OTP, tokens or credentials.

Operational red flags requiring immediate stop/rollback: any cross-tenant data, wrong employee Payslip/Commission, session that cannot revoke, widespread OTP failure or duplicates, attendance mutations failing, manager approval bypass/self-review, migration error, persistent 5xx, broken Home/Time/Requests, or stale PWA tenant state.

## 33. ROLLBACK PLAN

Application rollback:

1. Stop pilot expansion.
2. Record failing deployment, release SHA, time and symptom.
3. Roll back Railway web to the previous known-good immutable deployment.
4. Recheck health identity and unauthenticated Staff route.
5. Require affected sessions to sign out/reopen where tenant/session state may be stale.
6. Ask PWA users to close/reopen; service worker does not cache navigations/APIs/chunks.

OTP: do not resend automatically during rollback; existing committed challenges may remain valid only for their bounded lifetime and exact release behavior. Prefer waiting for expiry before a new request if provider acceptance is uncertain.

Database: choose forward fix, reverse migration or snapshot restore based on the exact delta and data written after migration. Never roll back application across an incompatible schema without a compatibility decision.

## 34. DATABASE ROLLBACK

Not all Prisma migrations are reversible. Enum additions, backfills, constraints, triggers and externally written data are often forward-only.

| Risk | Safe rollback mode |
| --- | --- |
| additive nullable columns/indexes | application rollback while columns remain; later forward cleanup |
| renamed/divergent migration ledger | ledger reconciliation, not blind reverse SQL |
| enum additions | normally forward fix; reverse may be unsafe |
| `SET NOT NULL`/new constraints | reverse migration only after proving no incompatible writes; otherwise forward fix |
| data backfills | restore or purpose-built compensating migration; do not assume reversibility |
| attendance/payroll/payslip/commission writes after cutover | usually forward fix or coordinated snapshot restore with business data-loss decision |
| failed partial migration | Prisma status/ledger investigation plus backup restore or controlled resolve |

Production rollout may not proceed until each migration in the actual delta has an owner-approved rollback classification and the restore path is validated.

## 35. RELEASE RUNBOOK

A. Freeze exact branch/SHA/digest from the verified Production baseline.  
B. Remove unrelated runtime or explicitly approve full monolith contents.  
C. Deploy that exact SHA to Testing; verify health identity and repeat bounded owner smoke.  
D. Confirm Production domain, region, app/DB/storage topology and env contract.  
E. Perform owner-authorized read-only Production migration-ledger/schema compatibility review.  
F. Dry-run migration delta on a fresh Production backup restore and record timing/locks.  
G. Assign backup, migration, deployment, smoke and rollback owners.  
H. Announce release window and freeze release branch.  
I. Take/verify Production DB and storage backup.  
J. Apply only the reviewed migration delta.  
K. Deploy the exact frozen SHA.  
L. Verify `/api/health` SHA/digest/environment/DB.  
M. Execute one controlled employee OTP and short smoke.  
N. Execute manager and optional multi-employer smoke.  
O. Start small pilot, observe, then obtain owner approval before expansion.

## 36. DOWNTIME / MAINTENANCE

Zero downtime cannot be assumed. Many migrations are additive, but non-concurrent indexes, constraint validation, enum/trigger changes and data backfills can lock tables. The actual Production delta and table sizes are unknown.

Recommended classification now: **brief controlled maintenance/release window required**, with attendance/request/payroll operators informed. A full multi-hour business data freeze is probably unnecessary if the restore dry-run proves short locks, but do not apply Attendance or Payroll-sensitive schema while active punches/payroll finalization are occurring.

Temporary data-freeze recommendation: pause payroll finalization/publication and manager bulk decisions during migration; avoid the busiest clock-in/out boundary. Resume only after health and Staff smoke.

## 37. RELEASE OWNERSHIP

| Responsibility | Accountable | Executor | Evidence required |
| --- | --- | --- | --- |
| Release approval | Product/Business Owner | Owner | written go/no-go |
| Candidate construction | Engineering owner | Codex/developer under owner scope | branch/SHA/digest, clean diff |
| Railway deployment | Technical owner | authorized Railway operator | deployment ID/health identity |
| DB backup | Production DB owner | authorized operator | snapshot time + restore check |
| Migration ledger/delta | DB/engineering owner | authorized operator | read-only report + dry-run |
| Migration execution | DB owner | authorized operator | command/result/timing |
| OTP phone/device | Business owner | device owner | one bounded verification |
| Employee smoke | Business owner + employee | approved tester | checklist |
| Manager smoke | Manager/owner | approved manager | checklist |
| Observation | Technical + business owner | named on-call watcher | incident log |
| Rollback decision | Product owner + technical/DB owner | authorized operator | trigger and chosen plan |

Codex must not independently own irreversible Production approval, backup adequacy or rollback/data-loss decisions.

## 38. SECRET AUDIT

Tracked-source pattern audit checked private-key headers, credential-bearing PostgreSQL URLs, SMS123 assignments, common OpenAI/AWS/GitHub token formats and hardcoded environment targets.

Results:

- no tracked private key;
- no credible Production API key/token identified;
- PostgreSQL URL matches are `.env.example`, localhost disposable-test helpers and validator tests;
- `SMS123_API_KEY` match is an empty/example declaration;
- `sk-` matches are placeholder/UI text, not a credible key;
- secret-bearing variables are server-side and not `NEXT_PUBLIC_*`;
- audit sanitizer tests cover credentials, tokens, OTP and payroll-sensitive data.

Classification: **NO CREDIBLE TRACKED PRODUCTION SECRET EXPOSURE FOUND**. This does not replace a Railway secret inventory/rotation policy. If an owner identifies a real key reused from Testing or shared externally, stop release and rotate it before rollout.

## 39. ENVIRONMENT ISOLATION

Positive guards:

- explicit `APP_ENVIRONMENT` overrides Railway/Node inference;
- Production validator requires release identity and rejects localhost PostgreSQL;
- Production OTP mock/code is forbidden;
- private Claim storage has no Production filesystem fallback;
- Testing fixture writers require explicit Testing/service/database guards;
- hardcoded public Testing domain was not found in Staff runtime source.

Residual review:

- validator proves protocol/non-localhost but cannot know that `DATABASE_URL` is the correct Production project; verify host/project identity separately;
- Production/Testing SMS123 and storage credentials must be distinct;
- `APP_RELEASE_SOURCE_DIGEST` is currently null in Testing and must be mandatory for final Testing/Production;
- local UAT route is hostname guarded and must return 404 through the Production proxy;
- dual `OTP_PROVIDER`/compatibility alias should resolve to one explicit Production value;
- no Supabase project identifier was found as a canonical Staff dependency; PostgreSQL/Railway identity must be recorded from approved configuration, not guessed.

## 40. RELEASE BUILD REPRODUCIBILITY

Two production builds passed:

1. clean candidate worktree build: PASS, 145 static pages;
2. isolated `git archive 94db430` + `npm ci` + `npm run build`, without `.env.local`, fixture or shared `node_modules`: PASS, 145 static pages.

The isolated build initially could not download the Prisma Windows engine because the local Node CA chain did not trust the download certificate. Re-running with Node system CA enabled succeeded. Release CI/Railway must have normal trusted CA access or a preapproved system-CA setting; TLS verification must not be disabled.

The archive build proves the source does not require untracked fixtures or local secret artifacts. Runtime startup still requires the documented Production env contract.

## 41. DEPENDENCY / LOCKFILE

| Item | Result |
| --- | --- |
| Node engine | `>=22 <25` |
| Audited local Node | `v24.15.0` |
| npm | `11.12.1` |
| pnpm available locally | `11.19.0` |
| Next | `16.3.0` |
| Prisma Client | `6.19.3` |
| Build pipeline | Next 16 webpack, guarded build |
| Lockfiles | both `package-lock.json` and `pnpm-lock.yaml` tracked |
| `packageManager` field | absent |

`npm ci` is reproducible with `package-lock.json`, but tracking two lockfiles with no declared package manager is ambiguous for Railway auto-detection and future dependency changes. Before release, owner should freeze **npm + package-lock** (matching audited commands) or explicitly choose pnpm, then ensure the other lockfile cannot drift. Do not upgrade packages during readiness closure.

Non-blocking build advisories: Prisma `package.json#prisma` deprecation and Next middleware-to-proxy deprecation. Isolated no-env build also emitted a Next Edge warning trace involving `process.cwd`; build completed, but future Next upgrades should re-audit it.

## 42. TEST RESULTS

| Gate | Current result |
| --- | --- |
| Unit files invoked | 229 `tests/unit/*.test.ts` files |
| Unit tests | 1,407 passed; 0 failed/cancelled/skipped/todo |
| Repository integration files | 77 total |
| Selected relevant Staff PostgreSQL integration | 11 files; 30 passed; 0 failed/skipped/todo (closure evidence, runtime unchanged) |
| TypeScript | PASS |
| ESLint | PASS: 0 errors, 3 pre-existing warnings |
| `git diff --check` | PASS |
| Production build, clean worktree | PASS; 145 pages |
| Isolated archive + `npm ci` build | PASS; 145 pages |
| Fresh migrations | PASS; 212/212 |
| Current Testing `/api/health` | PASS, but SHA is `c75b5d3`, not candidate |

The previous closure report’s “306 unit files” count combined 229 unit and 77 integration files. This audit reports the current command inputs separately and does not use the old count as a correctness target.

ESLint warnings remain in an inventory QA script, WhatsApp inbox `<img>`, and employee bank read parameter; none is a Staff release blocker.

## 43. OWNER UAT EVIDENCE

Accepted real Railway Testing owner evidence carried forward exactly:

- Profile normal employee: PASS
- Profile manager: PASS
- Multi-employer A → B: PASS
- Multi-employer B → A: PASS
- No stale tenant data: PASS
- About this phone: PASS
- Sign out: PASS
- Pay after logout denied: PASS
- Requests after logout denied: PASS
- Time after logout denied: PASS

No owner UAT is claimed for other modules. Because accepted Testing SHA differs from the candidate, these passes remain valuable behavior evidence but must be repeated selectively on the exact final Testing candidate.

## 44. DEFERRED GAPS

| Gap | Release classification |
| --- | --- |
| `PAYMENT_STATUS_READ_MODEL_REQUIRED` | NON-BLOCKING; UI makes no paid claim |
| Claim Payroll settlement writer | NON-BLOCKING; `PAYROLL_LINKED` not presented as settled |
| Pay total deductions enrichment | NON-BLOCKING; no derived deductions |
| HTML Payslip Detail | NON-BLOCKING; protected PDF remains canonical |
| Commission item title enrichment | NON-BLOCKING; safe generic source labels |
| Commission display rate enrichment | NON-BLOCKING; no guessed rate |
| Profile login phone enrichment | NON-BLOCKING; omitted |
| Profile last signed in enrichment | NON-BLOCKING; omitted |
| Remote device management | NON-BLOCKING; current device semantics are honest |
| Profile About/Support | NON-BLOCKING |

No deferred feature was implemented or changed in this audit.

## 45. BLOCKERS

No confirmed code-level `BLOCKED` criterion was found: builds pass; no Production-capable mock OTP was found; no credible secret exposure, cross-tenant vulnerability, insecure Production cookie path, money claim, or known impossible rollback was reproduced.

However, rollout must not start while these **release gates remain unresolved**:

- exact candidate has not replaced the drifted Testing runtime;
- final monolith release package/branch has not been constructed and pushed;
- Production migration ledger/delta is unknown and migration IDs differ across lineages;
- verified Production backup/restore ownership is not assigned;
- Production env/SMS123/domain/region/storage values are unconfirmed;
- persistent avatar path and private evidence storage are unverified;
- single package-manager/lockfile policy is not frozen.

These are presently `REVIEW REQUIRED` rather than `BLOCKED` because a safe, explicit resolution path exists and no Production fact was falsely assumed. If owner-authorized verification finds a wrong DB, unreconcilable/destructive migration, no viable backup, unavailable SMS123 credentials, unsafe local-auth reachability, or cross-tenant behavior, the verdict immediately becomes **BLOCKED**.

## 46. OWNER CONFIRMATIONS REQUIRED

- Approve whether `94db430` whole-monolith source is acceptable or require a Staff-only controlled release branch.
- Approve pushing a frozen release branch and recording SHA/source digest.
- Authorize exact candidate deployment to Railway Testing and bounded repeat UAT.
- Confirm Production Railway web service, domain/DNS, region and PostgreSQL region.
- Authorize a later **read-only** Production migration ledger/schema compatibility audit.
- Assign DB backup, restore validation and migration operators.
- Confirm Production SMS123 account/template/credit/credential and approved test phones.
- Confirm Production `APP_ENVIRONMENT`, release identity, auth/session, MFA/payroll secrets without exposing values.
- Confirm private S3-compatible storage and employee-avatar persistent volume/backup.
- Choose canonical npm/package-lock policy.
- Approve release window, pilot cohort, observation owner and rollback decision makers.

## 47. MANUAL RELEASE CHECKLIST

### BEFORE DEPLOY

- [ ] Final branch is clean, pushed and owner-approved.
- [ ] SHA and source digest recorded; exact SHA passed Testing UAT.
- [ ] Staff 3100, fixtures, screenshots and unrelated work excluded/approved.
- [ ] Production env validator reviewed without printing secrets.
- [ ] Production domain, region, DB identity and storage confirmed.
- [ ] Production migration ledger read-only diff reviewed.
- [ ] Migration delta dry-run passed on restored backup.
- [ ] DB and storage backup taken; restore validated; owners assigned.
- [ ] SMS123 account/template/credit and one approved phone confirmed.
- [ ] Rollback deployment and stop criteria recorded.

### DEPLOY

- [ ] Announce release window; pause sensitive payroll/approval operations.
- [ ] Apply only reviewed migrations; record output/timing.
- [ ] Deploy exact SHA; do not rebuild from a dirty worktree.
- [ ] `/api/health` shows Production, exact SHA/digest/deployment and DB ready.

### AFTER DEPLOY

- [ ] Staff login page is canonical 3000.
- [ ] One normal employee OTP/login succeeds with one SMS.
- [ ] Home, Time, Requests, Pay and Profile open correctly.
- [ ] Sign out revokes session; protected routes deny access.
- [ ] One manager opens Requests → Approvals without scope leakage.
- [ ] Optional A → B → A switch has no stale tenant state.
- [ ] iPhone and oldest Android reopen PWA without stale runtime.

### PILOT

- [ ] Pilot cohort only; no broad onboarding.
- [ ] Observe at least one shift boundary and manager cycle.
- [ ] Check OTP, attendance, requests, approvals, Pay, storage and 5xx logs.
- [ ] Owner approves expansion after observation window.

### ROLLBACK TRIGGER

- [ ] Any cross-tenant/wrong-employee money data.
- [ ] Session cannot revoke or manager bypass/self-review.
- [ ] Migration failure or persistent 5xx.
- [ ] Widespread/duplicate OTP failure.
- [ ] Attendance mutations fail or PWA retains old tenant/runtime.

## 48. RECOMMENDED NEXT STEP

Do **not** deploy Production. The next authorized phase should be:

1. Decide the exact monolith release scope and construct a clean tracked release branch from the real Production baseline.
2. Freeze SHA plus source digest and standardize npm/package-lock.
3. Deploy that exact candidate to Railway Testing, not `c75b5d3`.
4. Verify health identity, run the short Staff smoke, and repeat owner Profile/multi-employer/logout plus one manager check.
5. Only after Testing equivalence is proven, request owner authorization for a read-only Production env/migration/topology review and backup/restore drill.
6. Reissue this readiness verdict. If all review items close without a blocker, the verdict may advance to `READY FOR CONTROLLED PRODUCTION ROLLOUT`—still without automatically deploying.

## 49. PRODUCTION STATUS

**AUDIT ONLY**  
**PRODUCTION NOT ACCESSED**  
**PRODUCTION NOT MODIFIED**  
**NO PRODUCTION DEPLOYMENT**  
**NO PRODUCTION DATABASE ACCESS**  
**NO PRODUCTION MIGRATION**  
**NO PRODUCTION OTP**

No Production database was opened or queried. No Production tables, environment variables, Railway services, DNS, storage, migrations, sessions or OTP providers were accessed or changed. Any unavailable Production fact is explicitly marked:

**REQUIRES OWNER-AUTHORIZED PRODUCTION READ-ONLY VERIFICATION**

The audit stops here and waits for owner review.
