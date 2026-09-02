# TETAMU — RAILWAY TESTING DATABASE REGION CUTOVER

US West → Singapore  
Canonical workspace: `C:\CodexTetamuP0`  
Canonical Staff App: **3000 only**  
Environment: **Railway Testing only**

Cutover window: 2026-08-31 (Asia/Singapore)

## 1. FINAL VERDICT

**REVIEW REQUIRED**

The infrastructure and data cutover is complete:

- all five direct Testing consumers now resolve to one new Singapore canonical database;
- the new database contains 212/212 canonical migrations;
- the approved five-Business allowlist reconciles exactly with zero unexplained FK orphans;
- the old US-West database remains intact and available for rollback;
- post-cutover DB latency is materially lower;
- controlled OTP requests were accepted for both UAT phones and their challenges are durable;
- complete disposable integration testing passed 188/188, and focused Staff testing passed 92/92.

Final physical-device acceptance is still required. The owner must enter the real OTP on both devices, establish fresh sessions, and verify authenticated Attendance Today plus the manager Home on the physical Android device. These steps were deliberately not bypassed, so this report does not call the release `CUTOVER COMPLETE` yet.

No application code or migration was changed as part of this region cutover. Deployment used clean canonical worktree commit `e79cba14da4bce2103d3a3c71262766ad0169374`, not the dirty main workspace.

## 2. BEFORE TOPOLOGY

Live Testing metadata was re-read before the cutover. The mismatch was confirmed rather than inferred from service names.

| Service | Deployment | Region | Database target |
|---|---|---|---|
| `tetamu-staff-app` (`5f4fb86d-85d6-4a30-a027-6c2d36425c93`) | `54c22ae7…` | Singapore | old US-West canonical DB |
| `tetamu-pos-web` (`e967b54d-dd06-4741-be99-e6e55e70af0e`) | `14e7eb1b…` | Singapore | old US-West canonical DB |
| `tetamu-pos-worker` (`2fc2631f-e219-4680-8553-62f7d4556417`) | `7657dccd…` | Singapore | old US-West canonical DB |
| `tetamu-db-backup` (`3b67ce26-af17-49d7-ab98-fcf453f412f1`) | `b2dae5fc…` | US West | old US-West canonical DB |
| `tetamu-db-restore-verify` (`00b396af-e407-4b9f-9d3d-33d5efbee024`) | `7cd79dc7…` | US West | old US-West canonical DB |
| `Postgres-Canonical-Testing` (`5b5acbed-12d8-4756-929a-676aeffd1100`) | `abe80892-29e3-4afe-a118-243b46444914` | US West | source canonical Testing DB |

All five old consumer URLs resolved to the same secret-safe database identity hash prefix: `BC85763747810805`.

Initial health evidence:

- `/api/health`: HTTP 200, 1.758 s
- `/staff/login`: HTTP 200, 0.206 s
- PostgreSQL: 18.6
- DB size: 36,763,327 bytes
- Businesses: 5
- memberships: 28
- migrations: 212

During the first freeze, a Railway region/scale operation automatically started one Staff deployment. This was detected before the reference switch. Source and target fingerprints still matched, no data drift was found, and a second strict freeze stopped all five consumers before final switching.

## 3. OLD US-WEST BACKUP

Backup directory:

`C:\Users\oscar\.codex\backups\tetamu-railway-testing-sg-cutover\20260830T182913Z`

| Artifact | Size | SHA-256 |
|---|---:|---|
| `us-west-canonical-cutover-full.custom` | 1,878,172 bytes | `6C814D31A3EB5516EA59E466BB86840EC553293283F554D28E43D49D6EDC2685` |
| `us-west-canonical-schema.sql` | 1,128,147 bytes | `691CF7E7A5BE2AA6C78D8AD07F57C316571767EFA2DD3A1B283389E8428C3020` |
| `us-west-prisma-migrations.csv` | 36,594 bytes | `B2C50C5A947BF6969106D59E25E9112A67F66424938B992C5FCEF7DB1BA7A6D` |
| `us-west-restore-list.txt` | — | `AF14C7D784BB614720C70C6B853AC3CEA90C38BAEFBFC355C6B5BBE88EAED804` |
| `us-west-table-estimates.csv` | — | `18040C5A93581DEFF3D9218A8D63EC67CE9E45D82088558106CDFFB7F1500291` |

Migration-tree digest:

`67b51b20f63df99da014681852a1933c5b873112f16d6e41756312eb5f7ed00d`

Restore verification:

- `pg_restore --list`: PASS
- isolated restore/read: PASS
- restored read fingerprint: database `cutover_restore_verify`, Businesses 5, memberships 28, migrations 212, Attendance 23, Leave requests 6, Claims 3, Payroll entries 32, Appointments 19
- source database was not modified.

## 4. NEW SINGAPORE DB

| Field | Result |
|---|---|
| Service | `Postgres-Canonical-Testing-SG` |
| Service ID | `49c45405-1634-4292-9df3-bc27fe9a62a1` |
| Deployment | `481b7818-d12a-49a5-98e9-0376eacf5375` |
| Actual region | `asia-southeast1-eqsg3a` (Singapore) |
| PostgreSQL | 18.6 |
| Volume | READY |
| Canonical migrations | 212/212 |
| Failed/incomplete migrations | 0 |
| Public tables | 236 |

Migration status: **Database schema is up to date**.

Additional schema verification:

- current Staff appearance fields (`staff_app_logo_url`, `staff_app_appearance`) present;
- canonical OTP schema present;
- legacy `provider_message_code` absent;
- 16 statutory tables present;
- PCB/MTD correctness columns present;
- effective-dated statutory participation structures present;
- `prisma generate`: PASS;
- `prisma validate`: PASS.

The temporary public TCP proxy used for transfer was removed after reconciliation. The database remains reachable through Railway private networking by its consumers.

## 5. DATA TRANSFER

Only the approved five retained Testing Businesses were transferred, preserving canonical IDs and their required dependency graph.

| Business | Canonical ID | Rows | Tables |
|---|---|---:|---:|
| Royal Salon | `611b0c19-ebf7-4548-8a48-a3b6a7af8a81` | 403 | 56 |
| Payroll UAT Business | `b87aaa12-b41d-44b5-908e-72d04e6a08a0` | 203 | 34 |
| HASiL Verification 2026 | `8ed2fb4f-d6c7-44dd-ac8e-23dd11a54796` | 138 | 23 |
| Oscar Salon Damai | `bd884722-c72f-4c29-96ed-c957a6590c0d` | 118 | 16 |
| Oscar Salon Lintas | `801b4fa7-4208-4a1d-b63e-c34e34ee5afb` | 496 | 52 |
| **Total** | — | **1,358** | — |

FK orphan audit: **0 unexplained orphans**.

Intentional exceptions:

- active employee sessions: not transferred;
- auth sessions: not transferred;
- OTP challenges: not transferred;
- rate-limit and Attendance idempotency state: not transferred;
- worker locks/leases, notification queues and temporary stock-count sessions: not transferred;
- five revoked historical EmployeeSession rows were retained only as historical evidence; all are revoked and unusable.

Three archive-only Businesses were not reintroduced.

## 6. RECONCILIATION

Source allowlist and Singapore target were compared after the second strict freeze.

| Domain | Exact result |
|---|---|
| Identity | 5 Businesses, 5 branches, 27 EmployeeAccounts, 28 memberships |
| Leave | 6 requests, 16 balances, 28 entitlements |
| Claims | 3 requests, 3 lines, 3 attachments, 6 events; submitted/approved amount RM38.20 |
| Attendance | 23 sessions, 36 punches, 3 exceptions, 53 expected days, 20 resolution cases, 19 finals |
| Timesheet | 5 revisions, 15 entries |
| Roster | 11 periods, 69 published assignments, 1 schedule version |
| Payroll | 8 runs, 32 entries; gross RM131,436.06; deductions RM8,706.55; net RM122,729.51 |
| Payslip | 1 publication, 2,458 bytes |
| Appointments | 19 |
| Migrations | 212 |

Per-Business monetary evidence also matched:

- Payroll UAT: gross/net RM3,000.00
- HASiL: gross/net RM49,500.00
- Damai: gross/net RM5,100.00
- Lintas: gross RM73,836.06, net RM65,129.51
- Royal Salon Claims: RM38.20 submitted/approved

Final pre-switch source and target fingerprint matched exactly:

`5,28,23,36,6,3,32,131436.06,122729.51,19`

Post-runtime target check:

- Businesses: 5
- memberships: 28
- Attendance sessions: 23
- migrations: 212
- controlled post-cutover OTP challenges: 2
- active EmployeeSession rows: 0 (fresh login required)

## 7. SERVICES SWITCHED

The following Testing consumers were switched together, with deploys initially suppressed until every reference was updated:

1. `tetamu-staff-app`
2. `tetamu-pos-web`
3. `tetamu-pos-worker`
4. `tetamu-db-backup`
5. `tetamu-db-restore-verify`

All five references resolve to the same secret-safe new database identity:

- host: `postgres-zvge.railway.internal`
- database: `railway`
- port: 5432
- identity hash prefix: `31788429644CFEA0`

No credentials are included in this report. There was no dual-write interval.

## 8. AFTER TOPOLOGY

| Service | Final deployment | Region | Runtime | DB target |
|---|---|---|---|---|
| `tetamu-staff-app` | `51d57f6a-7099-48cc-b75b-7477a0e2ac1e` | Singapore | SUCCESS / RUNNING | new SG canonical DB |
| `tetamu-pos-web` | `4b1bd782-94b2-486f-a4b6-05bbd1c4c7bd` | Singapore | SUCCESS / RUNNING | new SG canonical DB |
| `tetamu-pos-worker` | `87636281-82fd-4609-afa2-961331b29365` | Singapore | SUCCESS / RUNNING | new SG canonical DB |
| `tetamu-db-backup` | `ae38ac58-df8e-40ba-834a-ccd28c152f7a` | Singapore | SUCCESS / one-shot idle | new SG canonical DB |
| `tetamu-db-restore-verify` | `2f880f42-120d-4ad3-9886-bec2e8a34464` | Singapore | SUCCESS / one-shot idle | new SG canonical DB |
| `Postgres-Canonical-Testing-SG` | `481b7818-d12a-49a5-98e9-0376eacf5375` | Singapore | SUCCESS / RUNNING | canonical target |

One initial Web redeploy from its stale GitHub snapshot failed because its build omitted `prisma generate` (`Can't resolve '.prisma/client/index-browser'`). It was not accepted. A clean canonical upload deployment then succeeded as `4b1bd782-94b2-486f-a4b6-05bbd1c4c7bd`.

Staff runtime checks:

- `/api/health`: 200
- `/staff/login`: 200
- `/staff`: 200
- `/staff/timesheet`: 200
- `/staff/manifest.webmanifest`: 200
- Staff port: 3000
- 3100 redirects/links/dependency: none found; automated PWA route contract passed.

## 9. DB LATENCY BEFORE / AFTER

Measurements were taken from the running Singapore Staff container against the new private Singapore DB.

| Metric | Before (US West) | After (Singapore) | Result |
|---|---:|---:|---|
| New Prisma connection | 1.16–1.33 s | 200.963 ms | about 5.8–6.6× faster |
| `SELECT 1` cold | not separately recorded | 10.992 ms | post-cutover evidence |
| `SELECT 1` warm p50 | ~177 ms | 3.890 ms | about 45.5× faster |
| `SELECT 1` warm p95 | not separately recorded | 7.272 ms | post-cutover evidence |
| EmployeeAccount lookup | not separately recorded | 7.758 ms | PASS |
| EmployeeSession lookup | not separately recorded | 6.121 ms | PASS |
| Attendance prerequisite reads | affected by cross-region path | 9.510 ms | PASS |

Warm sample size: 10. Warm min: 3.110 ms; max/p95: 7.272 ms.

## 10. HTTP LATENCY BEFORE / AFTER

| Endpoint | Before | After | Status |
|---|---:|---:|---|
| `/api/health` | 1.758 s | 0.556 s | 200 |
| `/staff/login` | 0.206 s | 0.328 s | 200 |
| `/staff` | not separately recorded | 0.369 s | 200 |
| `/staff/timesheet` | not separately recorded | 0.192 s | 200 |
| `/staff/manifest.webmanifest` | not separately recorded | 0.159 s | 200 |
| OTP request — iPhone | prior failure/timeout history | 1.165 s | 202 |
| OTP request — Android | prior failure/timeout history | 1.023 s | 202 |
| authenticated `/api/employee-auth/modules` | not completed | pending owner real-OTP login | REVIEW REQUIRED |
| authenticated `/api/employee-attendance/today` | previous physical 500/P2028 | pending owner real-OTP login | REVIEW REQUIRED |

Railway Staff logs for the final two-hour validation window contained no matching application error, P2028, transaction timeout, or HTTP request over 1 second in the queried error/slow filters after the controlled OTP requests.

## 11. OTP BREAKDOWN

Exactly one controlled real OTP request was sent per UAT phone:

| Phone | HTTP | Provider | Durable challenge | Delivery accepted | Total |
|---|---:|---|---|---|---:|
| `01112212259` | 202 | SMS123 | yes | yes | 1.165 s |
| `0128793848` | 202 | SMS123 | yes | yes | 1.023 s |

No OTP value was read or logged.

- DB pre-send: **not separately instrumented in the deployed request trace**
- SMS123 phase: **not separately instrumented in the deployed request trace**
- DB post-send: **not separately instrumented in the deployed request trace**
- Total: 1.165 s / 1.023 s

Atomicity was verified by code and tests rather than inferred from total latency: the challenge is durably committed before the external provider call; provider success/failure is recorded afterward. Tests cover SMS accepted plus follow-up DB failure, SMS failure, cooldown, duplicate request suppression, challenge verifiability and no duplicate send.

Current target challenges show `sms123`, provider reference present, delivery accepted, not invalidated, not verified, and 300-second expiry. No second SMS was sent.

## 12. ATTENDANCE RESULT

| Check | Result |
|---|---|
| Authenticated HTTP result | **not yet executed with a fresh physical OTP session** |
| Authenticated duration | pending |
| P2028 after cutover | none observed in queried Railway logs |
| Attendance prerequisite DB read | 9.510 ms |
| Route-level disposable integration | PASS |
| Remaining root cause? | no current evidence of a DB-region timeout; physical authenticated confirmation still required |

The previous physical `/api/employee-attendance/today` HTTP 500/P2028 cannot be called resolved until the owner performs the fresh real-OTP login and the endpoint returns 200 on the iPhone. No timeout was increased as a substitute for this validation.

## 13. TIMESHEET 30 AUG

Canonical Testing evidence:

- Attendance History: `COMPLETED`
- legacy final: one `INCLUDED` revision
- active P2 exceptions: `LATE_ARRIVAL OPEN` and `EARLY_DEPARTURE OPEN`
- P2 final for date: none
- Staff Timesheet projection: exactly one 30 Aug card
- projected status: `WAITING_FOR_MANAGER`
- actionable missing-time exception: none
- `Send the missing time`: not shown
- duplicate card: none

Focused Timesheet projection and deduplication tests passed.

## 14. ANDROID HOME

Automated regression evidence passed for:

- manager `Needs My Approval` priority before Schedule/Quick Access when pending > 0;
- no manager entry for normal employees;
- empty Upcoming Schedule omitted;
- bottom navigation safe-area/content clearance;
- final content scrollability;
- Quick Access limited to Appointments, Schedule and Leave where enabled;
- canonical Staff port 3000 and no 3100 route dependency.

Responsive public-shell browser checks:

- 390 × 844: effective inner width and scroll width both 391 px; no horizontal overflow; `/staff` redirected canonically to `/staff/login`; no 3100 link.
- 412 × 915: inner width and scroll width both 412 px; no horizontal overflow; no 3100 link.
- one noncritical login-header brand link measured 42 px high at 412 px; it is outside the authenticated Android Home bottom-navigation regression and should be treated as a future polish item, not hidden evidence.

Authenticated manager Home on a physical Android device remains pending fresh OTP login. The report therefore does not overstate physical 390/412 manager acceptance.

## 15. TWO-PHONE READINESS

### iPhone — `01112212259`

- canonical phone: `+601112212259`
- persona: Real Device UAT Employee
- Royal Salon / salon online
- membership: ACTIVE
- Attendance: enabled
- branch assignment: active, primary, `canClockIn = true`
- normal Staff permissions
- Approval Center: not available
- OTP request: accepted; physical verify/login pending

### Android — `0128793848`

- persona: Real Device UAT Manager
- Royal Salon / salon online
- membership: ACTIVE
- Attendance: enabled
- branch assignment: active, primary, `canClockIn = true`
- capabilities: Leave approval, Claim review, Attendance read/manage, Roster view
- Attendance manage maps to the canonical employee Attendance-management capability used by the approval surface
- `ALL_BRANCHES`: absent
- self-review: blocked by canonical guards and tests
- OTP request: accepted; physical verify/login pending

Fresh login required after cutover: **YES**.

## 16. ROLLBACK

If physical UAT exposes a critical issue:

1. stop writes to the Singapore Testing database;
2. restore all five Testing consumer references to `Postgres-Canonical-Testing` in US West;
3. redeploy/restart Staff, Web, Worker, Backup and Restore Verify together;
4. verify `/api/health` and `/staff/login`;
5. retain the Singapore database for diagnosis;
6. do not dual-write.

The old US-West database was not renamed, deleted, mutated in place or detached from its volume.

Temporary cutover access cleanup:

- Singapore DB public TCP proxy: removed and verified absent;
- temporary Railway SSH key `codex-railway-sg-cutover-20260831`: removed;
- temporary local private/public key files: removed and verified absent.

## 17. OLD US-WEST DB STATUS

**ARCHIVE / ROLLBACK AVAILABLE**

Service: `Postgres-Canonical-Testing`  
Service ID: `5b5acbed-12d8-4756-929a-676aeffd1100`  
Deployment: `abe80892-29e3-4afe-a118-243b46444914`  
Region: US West  
Status: retained intact; do not delete before owner physical UAT closure.

## 18. 3100 STATUS

**REFERENCE ONLY / READY TO RETIRE**

The deployed canonical Staff App listens on port 3000. Public routes, manifest contract and focused PWA tests found no 3100 redirect or runtime dependency.

## 19. TESTS

### Focused Staff suite

- 92 passed
- 0 failed

Coverage includes SMS123 durable challenge lifecycle, OTP timeout tolerance, no duplicate send, Attendance employee auth, Timesheet projection/deduplication, correction CTA, branch/tenant/self-review guards, approval consistency, Android Home manager priority, bottom-nav safe area and PWA port/routing contract.

### Full disposable integration suite

- shared integration tests: 187 passed, 0 failed
- isolated Attendance route flow: 1 passed, 0 failed
- total: **188 passed, 0 failed**
- all 212 migrations were applied from zero to the disposable database before testing
- the disposable database was dropped after completion

Expected Prisma errors shown during the suite were assertions of database protections (immutability, tenant scope, idempotency and concurrency), not test failures.

## 20. PRODUCTION STATUS

**TESTING ONLY**  
**PRODUCTION NOT ACCESSED**  
**PRODUCTION NOT MODIFIED**

No Production service, variable, deployment or database was inspected or changed.

## Owner closure actions

1. On iPhone, request/enter the real OTP for `01112212259` and verify `/api/employee-attendance/today` returns 200 in practical warm time.
2. Confirm iPhone can reach the intended Attendance and Timesheet 30 Aug states.
3. On Android, request/enter the real OTP for `0128793848`.
4. Confirm manager Home ordering, no bottom-nav overlap, correct approval count, branch-limited access and self-review denial.
5. Only after both physical flows pass, change the final verdict from `REVIEW REQUIRED` to `CUTOVER COMPLETE`.
