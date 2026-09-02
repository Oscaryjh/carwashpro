# TETAMU STAFF 3000 FINAL CLOSURE REPORT

Date: 2026-08-29  
Scope: **LOCAL / TESTING ONLY**  
Canonical workspace: `C:\CodexTetamuP0`  
Canonical runtime: Staff 3000

## 1. FINAL VERDICT

**REVIEW REQUIRED**

The canonical database, allowlist transfer, reconciliation, Staff 3000 runtime, authenticated employee workflows, manager approval workflows, security test suites, production build and runtime smoke all passed. Staff 3000 is the only active local Staff runtime and port 3100 is not listening.

The remaining review item is independent browser execution at exactly `412 × 915`. The available authenticated in-app browser completed the `390 × 844` mobile run, but its isolated viewport could not be switched to `412 × 915` after the browser security policy rejected the reload. The responsive contract for widths up to 430px is covered by passing unit tests, but this report does not convert that into a fabricated browser PASS. Real Android and real iPhone are also marked **NOT EXECUTED** as allowed by the task.

One non-blocking local fixture warning was observed after a successful Clock Out: P2 materialization returned `INVALID_STATE` because that UAT day intentionally had no published expected-attendance evidence. The canonical raw attendance session and Clock Out mutation were committed successfully (`HTTP 200`); no inferred off-day or fabricated expected schedule was created.

## 2. OWNER DECISION APPLIED

### Retain

- Explicit allowlist root: `Tetamu HR Acceptance Test`.
- Source Business ID: `d917554b-9cff-4fff-8d81-898397f05cda`.
- Required canonical parents/configuration/snapshots plus the approved Business, Branch, 6 memberships, roster, 2 Leave requests, 1 Claim, 1 Payroll run, 6 Payroll entries and 6 Payslip publications.

### Recreate

- Fresh local canonical fixtures for Employee, manager employee, Supervisor, Branch Manager, HR and Business Owner.
- HR/Payroll core acceptance, five-role, manager approval, Attendance correction, OT, Leave and Claim UAT records.
- Fresh auth/session/device state only in the new canonical local database.

### Archive

- Every non-allowlisted old Local business and its domain data.
- Historical non-public schemas.
- Historical Payroll, Payslip, statutory, Attendance, Leave, Claim, Roster and other records not required by the approved allowlist.
- The old database and full logical backup remain the historical archive.

### Disposable

- Old auth sessions, employee sessions, OTP challenges, login tokens, rate limits, idempotency records, locks, leases, temporary queues and old `_prisma_migrations` were not transferred.

### Orphan policy

- 801 public FK constraints were audited; 62 constraint groups contained historical orphan rows.
- Owner classification applied: **ARCHIVE_ONLY / EXCLUDE FROM NEW ACTIVE DB**.
- No missing parents were invented, no source orphans were repaired, and no source rows were deleted.
- Historical restore exceptions are documented in `artifacts/local-db-baseline/20260829/canonical-transfer/historical-restore-exceptions.json`.

## 3. OLD DATABASE

- Untouched source database: `car_wash_crm_pos`.
- Logical backup: `artifacts/local-db-baseline/20260829/car_wash_crm_pos_20260829.dump`.
- Backup size: 40,497,386 bytes.
- SHA-256: `CAD9E2D6C31512320DBD840B47B7005B29EFC663AD2D9B8A04F8A4982CDE56D9`.
- `pg_restore --list` catalog read: PASS.
- Historical restore exception: strict FK recreation fails on owner-approved archive-only orphan data; the original database and backup remain recoverable evidence and were not mutated.
- First recorded strict failures included 68 orphan `auth_sessions` rows and 68 orphan `employee_lindung24_participation_versions` rows; the broader audit identified 62 orphan FK groups.
- Evidence:
  - `artifacts/local-db-baseline/20260829/RESTORE_VERIFICATION_RESULT.md`
  - `artifacts/local-db-baseline/20260829/public-fk-orphan-audit.txt`
  - `artifacts/local-db-baseline/20260829/SHA256SUMS.txt`

## 4. NEW CANONICAL DATABASE

- Database: `tetamu_canonical_local_20260829`.
- Host: local PostgreSQL at `localhost:5432`.
- Empty database creation followed only the canonical `C:\CodexTetamuP0\prisma\migrations` lineage.
- Canonical migrations: **212 / 212 PASS**.
- `prisma validate`: PASS.
- `prisma generate`: PASS.
- `prisma migrate status`: **Database schema is up to date**.
- Old `_prisma_migrations`: not imported.
- 3100 migrations: not imported.
- New active DB FK orphan constraints after transfer: **0**.

## 5. ALLOWLIST TRANSFER

- Transfer implementation: `scripts/transfer-staff-3000-allowlist.mjs`.
- Root selection was limited to the approved Business ID.
- Transferred: 41 canonical tables, 208 rows.
- Required dependencies included identities, branch assignments, module entitlements, role profiles, Leave/Claim policy versions, Attendance/Payroll snapshots, statutory classifications and Payslip publications.
- Archive exclusions were not copied merely because they shared a domain table.
- Session, OTP, token, rate-limit, lock and temporary runtime state were excluded.
- Transfer evidence:
  - `artifacts/local-db-baseline/20260829/canonical-transfer/allowlist-transfer-plan.json`
  - `artifacts/local-db-baseline/20260829/canonical-transfer/allowlist-transfer-result.json`
  - `artifacts/local-db-baseline/20260829/canonical-transfer/allowlist-reconciliation-result.json`

## 6. RECONCILIATION

Final source/target reconciliation: **PASS, exact match**.

| Item | Source | Canonical target |
|---|---:|---:|
| Businesses | 1 | 1 |
| Branches | 1 | 1 |
| Memberships | 6 | 6 |
| Roster periods | 1 | 1 |
| Roster assignments | 6 | 6 |
| Leave requests | 2 | 2 |
| Claims | 1 | 1 |
| Claim submitted | RM 120.00 | RM 120.00 |
| Claim approved | RM 120.00 | RM 120.00 |
| Payroll runs | 1 | 1 |
| Payroll entries | 6 | 6 |
| Payroll gross | RM 18,264.90 | RM 18,264.90 |
| Payroll deductions | RM 115.38 | RM 115.38 |
| Payroll net | RM 18,269.52 | RM 18,269.52 |
| Payslip publications | 6 | 6 |
| Payslip bytes | 13,748 | 13,748 |

The historical net total exceeding gross is retained source evidence, not recalculated or silently corrected during transfer. All allowlisted counts and amounts match exactly. Owner-approved archive exclusions are expected exclusions, not reconciliation failures.

## 7. FOUR CONTRACT REGRESSIONS

1. **Payroll truthfully distinguishes locked calculations from payment completion** — PASS. The contract keeps calculation locking separate from payment completion.
2. **Sensitive deployed entry points use dedicated capabilities and immutable statutory artifacts** — PASS. Capability and immutable artifact boundaries remain explicit.
3. **Shift-based roster uses default schedules plus weekly exceptions** — PASS. Current default/exception semantics are preserved.
4. **Roster keeps Draft, published history, Staff visibility and Attendance boundaries explicit** — PASS. Stale wording was aligned to the approved `No schedule yet` terminology without weakening functional semantics.

Final unit test: **1322 / 1322 PASS, 0 FAIL**.

Additional regression results:

- Disposable protected integration: **199 / 199 PASS**.
- Isolated Attendance route flow: **1 / 1 PASS**.
- Staff/security focused suite: **91 / 91 PASS**.
- TypeScript `tsc --noEmit`: PASS.
- ESLint: 0 errors; 3 pre-existing warnings.
- Production build: PASS, including all canonical `/staff` routes.

## 8. DATABASE CUTOVER

- Local `DATABASE_URL` resolves to `tetamu_canonical_local_20260829`; credentials are intentionally omitted from this report.
- Embedded local PostgreSQL default database name was changed to `tetamu_canonical_local_20260829` while retaining an environment override.
- Staff 3000 dev runtime: available on port 3000.
- Production bundle smoke on port 3000:
  - `/staff/login`: HTTP 200 and rendered the Staff sign-in UI.
  - `/staff/manifest.webmanifest`: HTTP 200.
  - six Staff quick-access icon assets: HTTP 200.
  - employee auth configuration error page: not rendered in the valid smoke configuration.
- Port 3100: **not listening**.

## 9. EMPLOYEE AUTHENTICATED UAT

Authenticated against Staff 3000 only.

### PASS

- Login and local/test mock OTP through the actual login UI.
- Full mobile number confirmation before OTP entry.
- Current workplace and canonical membership context.
- Home.
- Clock In.
- Break Start.
- Break End.
- Clock Out.
- Attendance History surface.
- Missing Punch / Attendance correction submission surface.
- Roster.
- Timesheet and employee OT read-only boundary.
- Leave, Leave evidence surface and request flow.
- Claims and receipt/attachment surface.
- Commission.
- Pay and Payslip.
- Profile/device surface.
- Appointments.
- Logout.
- Pages audited without current console errors: `/staff`, `/staff/history`, `/staff/requests`, `/staff/pay`, `/staff/profile`, `/staff/roster`, `/staff/timesheet`, `/staff/leave`, `/staff/claims`, `/staff/commission`, `/staff/payslips`, `/staff/appointments`.
- Employee access to `/staff/approvals` correctly redirects/denies manager-only access.

### Fixture facts

- Normal employee persona: CORE-B membership.
- Real UI OTP login bound the browser's actual UAT device identifier; a shortcut session with a mismatched device correctly received a 403 attendance mutation before the proper login.
- Attendance mutations after proper login: Clock In, Break Start, Break End and Clock Out all returned success.

## 10. MANAGER AUTHENTICATED UAT

Manager access was provided by explicit capabilities and branch scope, not role name alone.

### PASS

- `/staff/approvals` loaded with one authorized branch.
- Filters: All, Leave, Claims, Attendance and OT were present.
- Leave approval: PASS.
- Claim approval: PASS; payment remained a separate step.
- Attendance correction approval: PASS through the canonical Attendance manager workflow.
- September 2026 OT queue: 3 waiting.
- OT approve in full: PASS.
- OT adjust to 60 minutes with reason: PASS.
- OT reject with reason: PASS.
- Final OT queue: 0 waiting; outcomes show Approved, Adjusted and Rejected.

The Approval Center's current-month summary showed zero OT while the September queue correctly showed three items; this is expected month scoping, not missing data.

## 11. SECURITY UAT

### PASS — automated protected integration and Staff/security suites

- Business A cannot read or mutate Business B Attendance, Roster, Timesheet, Leave, Claims, Commission, Payslip, Appointments or Approvals.
- Branch scope is server-derived and enforced.
- Self-review prevention is enforced.
- Missing capability is denied.
- Unauthorized branch is denied.
- Stale approval state/concurrent revision is rejected.
- Locked Timesheet OT guard is enforced.
- Payslip privacy is tenant/membership scoped.
- Leave document privacy is protected by scoped routes.
- Claim attachment privacy is protected by scoped routes.
- Appointment privacy is tenant and employee scoped.
- Client-supplied `businessId`, `membershipId` or `branchId` cannot override the authenticated session scope.
- Employee attendance device authorization is rechecked server-side.
- Manager permissions are capability-based; role name alone is insufficient.

## 12. MOBILE UAT

### 390 × 844 authenticated browser

- PASS for employee Home, Time/History, Leave request, Claims, Profile and manager Approval Center.
- No horizontal overflow in the executed authenticated Staff views.
- Bottom navigation, mobile cards, safe-area layout, compact filters and 44px action targets are present.
- Leave/Claims forms, date inputs, file inputs, loading/error/empty states and long identifier wrapping are covered by the passing Staff mobile unit suite.
- Current browser error log for the audited views: empty.

### 412 × 915 authenticated browser

- **NOT EXECUTED AS AN INDEPENDENT VIEWPORT**.
- Reason: the available authenticated in-app browser remained constrained to the 390-class viewport and its security policy rejected the reload required after applying a 412 override.
- Responsive CSS/unit contract up to 430px: PASS, but not reported as a substitute for the missing browser run.

### Physical devices

- Real Android: **NOT EXECUTED**.
- Real iPhone: **NOT EXECUTED**.

No physical-device PASS is claimed.

## 13. 3100 STATUS

`C:\CodexTetamuP0-staff-ui` remains **REFERENCE ONLY / READY TO RETIRE**.

- Directory not deleted.
- No runtime ownership.
- Port 3100 not listening.
- No migration ownership.
- No `STAFF_APP_ORIGIN` dependency introduced.
- No new development performed there.
- Canonical Staff routes, navigation, APIs, build and local runtime are owned by `C:\CodexTetamuP0` on port 3000.

## 14. PRODUCTION STATUS

**LOCAL / TESTING ONLY**  
**PRODUCTION NOT ACCESSED**  
**PRODUCTION NOT MODIFIED**

The production build and runtime smoke used only the local canonical database and explicit local placeholder configuration. No Production database, Railway environment, deployed service, Production secret or Production customer data was accessed or changed.

