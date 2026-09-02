# TETAMU RAILWAY TESTING — REGION / LATENCY / ATTENDANCE FAILURE AUDIT

Audit date: 2026-08-31 (Asia/Singapore)  
Canonical workspace: `C:\CodexTetamuP0`  
Runtime under audit: Railway **Testing**, Staff App **3000 only**  
Deployed candidate observed: `e79cba14da4bce2103d3a3c71262766ad0169374`

## 1. FINAL VERDICT

**REGION MISMATCH CONFIRMED · LATENCY ROOT CAUSE FOUND · ATTENDANCE DEFECT FOUND · REGION MOVE REQUIRES OWNER APPROVAL**

The currently running core applications are in Railway Singapore, but `Postgres-Canonical-Testing` is in Railway US West. The Staff application is connected to that US-West database through its Railway private hostname. A warm, trivial database round trip from the running Staff container is about **177 ms**. This makes query count, rather than any single slow SQL statement, the dominant cost.

The physical-iPhone Attendance failure is proven to be Prisma error **P2028**: the normal Attendance-today reader exceeded Prisma's default **5,000 ms interactive transaction timeout**. The failure occurred at the final `attendanceExpectedDay.findFirst`, after earlier serial queries had already consumed the transaction budget. It was not caused by invalid employee data, a stale session, a disabled branch, missing roster evidence, or SMS123.

The latest OTP requests took 8.31 s and 10.32 s end to end, but the measured SMS123 network portion was only about 0.64–1.24 s. Most OTP latency is app/database work before and after the provider call.

No region migration and no source-code fix were performed in this audit. Merely increasing the Attendance transaction timeout would reduce the immediate 500 but would preserve an unacceptably slow cross-region path; it is not sufficient to mark the system READY.

## 2. ACTUAL RAILWAY REGIONS

These values were read from the real Testing deployment metadata/runtime. They were not inferred from service names.

| Railway service | Current deployment ID | Actual region | Runtime/replica observation |
|---|---|---|---|
| `tetamu-staff-app` | `54c22ae7-7f94-491a-be34-2cb01bc0e61c` | `asia-southeast1-eqsg3a` (Singapore) | 1 replica; `RAILWAY_REPLICA_REGION` confirms region; sleeping disabled |
| `tetamu-pos-web` | `14e7eb1b-1768-483a-926c-541f9842b8a7` | `asia-southeast1-eqsg3a` (Singapore) | Core web runtime |
| `tetamu-pos-worker` | `7657dccd-0da1-4010-936d-8e6254d98678` | `asia-southeast1-eqsg3a` (Singapore) | Core worker runtime |
| `tetamu-db-backup` | `b2dae5fc-9457-45fe-8d5a-f688cf0903d3` | `us-west2` | Cron workload |
| `tetamu-db-restore-verify` | `7cd79dc7-7b4f-47de-8d3d-d64228f00034` | `us-west2` | Cron workload |
| `Postgres-Canonical-Testing` | `abe80892-29e3-4afe-a118-243b46444914` | `us-west2` | Canonical Testing database |

Non-Singapore services are therefore the canonical database and its backup/restore verification jobs. Production metadata was not inspected.

## 3. APP ↔ DB COLOCATION

The Staff container's sanitized `DATABASE_URL` host is `postgres-rhje.railway.internal`. This exactly matches the private domain of `Postgres-Canonical-Testing`; the application is not accidentally using the retired database.

However:

- Staff/web/worker: Singapore
- Canonical Testing PostgreSQL: US West
- Result: every ordinary SQL round trip crosses regions.

The connection string has no explicit `connection_limit` or `pool_timeout`, so Prisma defaults apply. This is a genuine placement mismatch, not a DNS naming issue.

## 4. DB LATENCY

Measurements were made with safe reads from inside the running `tetamu-staff-app` Testing container. Samples were deliberately small.

| Check | Result |
|---|---|
| New Prisma connection acquisition | 1,157.51 ms; repeat observation 1,332.81 ms |
| `SELECT 1`, first/cold sample | 354.95 ms |
| `SELECT 1`, warm p50 | 177.48 ms |
| `SELECT 1`, p95 (10 samples) | 354.95 ms |
| Simple `EmployeeAccount` lookup, p50 / p95 | 177.81 / 354.61 ms |
| Simple active `EmployeeSession` lookup, p50 / p95 | 177.92 / 355.07 ms |
| Three Attendance prerequisite reads in `Promise.all`, warm | about 178–180 ms total |
| Same prerequisite group, cold sample | 1,431.98 ms |

Raw 10-sample `SELECT 1` timings in milliseconds:

`354.95, 177.94, 177.34, 177.27, 177.63, 177.34, 177.70, 177.48, 179.63, 177.45`

A controlled sequence of 30 trivial reads inside a default Prisma interactive transaction completed only 27 reads before reproducing P2028. At a roughly 177 ms warm RTT, 27 serial round trips consume about 4.8 seconds, which is consistent with the default 5-second transaction expiry.

Interpretation: PostgreSQL itself was responsive and simple SQL was not CPU-bound; network distance and serial round-trip count dominate.

## 5. HTTP LATENCY

### Small external sample

| Endpoint | Result |
|---|---|
| `/api/health` | 200; 5-sample p50 0.351 s, p95 1.651 s |
| `/staff/login` | 200; p50 0.208 s, p95 0.215 s |
| `/api/employee-auth/me` without cookie | 401; p50 0.165 s, p95 0.185 s |
| `/api/employee-auth/modules` without cookie | 401; p50 0.161 s, p95 0.164 s |
| `/api/employee-attendance/today` without cookie | 401; p50 0.163 s, p95 0.178 s |

One additional warm-path network decomposition on 2026-08-31:

| Endpoint | DNS | Connect | TLS | TTFB | Total | HTTP |
|---|---:|---:|---:|---:|---:|---:|
| `/api/health` | 27 ms | 74 ms | 131 ms | 1,589 ms | 1,589 ms | 200 |
| `/staff/login` | 8 ms | 45 ms | 100 ms | 155 ms | 199 ms | 200 |
| `/api/employee-auth/me` | 11 ms | 50 ms | 105 ms | 154 ms | 154 ms | 401 |
| `/api/employee-auth/modules` | 12 ms | 48 ms | 105 ms | 152 ms | 152 ms | 401 |
| `/api/employee-attendance/today` | 14 ms | 52 ms | 109 ms | 158 ms | 158 ms | 401 |

`/api/health` executes a database check, so its first/slow samples expose connection/database cost. The three 401 measurements terminate before authenticated, database-heavy work and are transport/routing baselines only; they must not be presented as authenticated API performance.

### Actual authenticated iPhone observations

| Endpoint | HTTP | Duration |
|---|---:|---:|
| `POST /api/employee-auth/request-otp` | 202 | 8,310 ms |
| `POST /api/employee-auth/request-otp` (earlier controlled request) | 202 | 10,323 ms |
| `POST /api/employee-auth/verify-otp` | 200 | 8,725 ms |
| `/api/employee-auth/modules` | 200 | 3,019 ms |
| `/api/employee-attendance/today` | 500 | 9,306 ms |

These authenticated results substantially exceed the desired warm-read target of under 1 second and Attendance target of under 1–1.5 seconds.

## 6. OTP LATENCY BREAKDOWN

No additional real SMS was sent for benchmarking. Breakdown uses the two latest accepted real requests, database audit timestamps, provider network-flow timestamps, and HTTP request logs.

| Stage | Latest iPhone request (8.31 s) | Earlier request (10.32 s) |
|---|---:|---:|
| Challenge created → provider flow start (DB/app pre-send) | about 6.412 s | about 7.794 s |
| SMS123 request/response | about 0.638 s | about 1.240 s |
| Provider response → accepted audit | about 0.712 s | about 0.633 s |
| Additional audit write | about 0.358 s | about 0.364 s |
| Remaining response work | about 0.190 s | about 0.293 s |
| Total | 8.310 s | 10.323 s |

Conclusion: **SMS123 is not the dominant delay**. DB/app work accounts for roughly 7.5–8.8 seconds in these requests. The current OTP implementation already commits the challenge/hash durably before calling SMS123 and performs provider work outside the interactive transaction; this audit found no return to the earlier “SMS sent but challenge rolled back” atomicity defect.

`deliveryAcceptedAt` is set from a timestamp captured before the transaction, so it is not a valid provider-duration timer. The network-flow and audit-event timestamps above were used instead.

## 7. IPHONE ATTENDANCE FAILURE

| Field | Evidence |
|---|---|
| Timestamp | `2026-08-30T17:53:32.676Z` (about `2026-08-31 01:53:32` Asia/Singapore) |
| Route | `/api/employee-attendance/today` |
| HTTP | 500 |
| Duration | 9,306 ms |
| Prisma code | `P2028` |
| Backend error | `Transaction already closed: timeout 5000 ms, however 5177 ms passed since transaction start` |
| Failing operation | `prisma.attendanceExpectedDay.findFirst()` |

The frontend's “Unable to process the attendance request” is therefore the generic rendering of an authenticated backend `INTERNAL_ERROR`.

The reader path performs:

1. stale Attendance reconciliation in a separate transaction;
2. another default interactive transaction;
3. active Attendance lookup;
4. principal/session/business/branch/setting/assignment checks;
5. completed Attendance reads;
6. available-branch read;
7. effective-roster/expected-day resolution;
8. final expected-day lookup.

The failing `findFirst` is not proven to be an intrinsically slow query. It is the operation that arrived after the transaction budget had already been consumed by prior cross-region serial calls.

Fixture and authorization checks for `+601112212259` showed:

- active `Real Device UAT Employee` account and active membership;
- Attendance enabled;
- active `Royal Salon / salon online` workplace and branch setting;
- active primary branch assignment with `canClockIn = true`;
- active, non-revoked employee device/session with view/punch capability;
- valid recent completed Attendance data;
- 31 Aug current WORKDAY expected-day sourced from roster;
- published 31 Aug roster period, publication revision 1;
- effective `Real Device UAT Shift` schedule version.

There was no stale-session, device, branch, membership, Attendance-disabled, or missing-roster-evidence reason for the 500.

## 8. COLD START / POOL FINDINGS

- Staff has one replica and application sleeping is disabled. The evidence does not support an application sleep/wake cold start as the primary problem.
- A newly opened Prisma connection took about 1.16–1.33 seconds; cold/fan-out samples were much slower than steady-state single-query samples.
- Runtime: Node `v22.23.2`; `availableParallelism()` reported 8.
- PostgreSQL `max_connections = 100`; observed current connections 21, active connections 1.
- No P2024 pool acquisition failures were found in the inspected 48-hour application logs.
- No “too many clients” / remaining connection-slot errors were found in database logs.
- No relevant DNS failure was found in the inspected 24-hour window.
- Some old network cleanup records (`NO_SOCKET`, `TCP_ABORT_ON_DATA`, `TCP_INVALID_SYN`) appeared around deployment/closed-pool lifecycle, but they do not prove current saturation.
- The main Attendance read uses a long, DB-chatty interactive transaction for a normal request and has no explicit transaction timeout. With the current geography, the default 5 seconds is predictably unsafe.

Conclusion: cold connection setup amplifies first-request latency, but the persistent 177 ms warm RTT and serial query count are sufficient to explain both slow requests and P2028.

## 9. REGION CONCLUSION

**REGION MISMATCH CONFIRMED.**

The primary runtime topology is Singapore application → US-West database. The measured warm database RTT is about 177 ms, compared with a practical expectation of low-millisecond private-network database calls when colocated. This mismatch is the principal systemic latency cause.

Backup/restore cron placement in US West is currently colocated with the database, but if the canonical database moves, those jobs and their private references must be reviewed as part of the same controlled cutover.

## 10. ROOT CAUSE

### Attendance

Primary root cause: cross-region app↔DB RTT multiplied by many sequential operations inside a default 5-second Prisma interactive transaction, ending in P2028 and HTTP 500.

Contributing design issue: the read path can invoke effective-roster resolution inside the transaction. Even when the expected-day row already exists and returns early, the overall path remains round-trip heavy.

Not root causes: invalid fixture, stale login after database cutover, branch mismatch, disabled Attendance, missing expected-day evidence, SMS123, or connection-pool exhaustion.

### OTP

Primary root cause: DB-chatty pre-send/post-send stages crossing Singapore↔US West. SMS123 is a minority of the 8–10 second request.

### Health/cold behavior

Primary root cause: initial Prisma connection plus cross-region database request. Staff application sleeping is disabled.

## 11. FIX IMPLEMENTED

**None — deliberate audit decision.**

- No source file was changed.
- No Railway region was changed.
- No database was migrated.
- No environment variable was changed.
- No new migration was created.

A 15-second timeout remains reasonable as bounded cold-start tolerance where already used, but applying it to Attendance alone would only turn a 9-second 500 into a very slow success. It is a possible emergency stop-gap only after separate approval and testing, not the canonical performance fix and not grounds for READY.

## 12. RECOMMENDED NEXT ACTION

Recommended canonical direction: colocate the core Testing database with the Singapore applications, then remeasure before deciding how much query-path refactoring is still needed.

Safe, separately approved Testing-only plan:

1. Freeze Testing writes for a defined cutover window.
2. Take and verify a backup of `Postgres-Canonical-Testing`; record counts/checksums and rollback coordinates.
3. Create a new Singapore PostgreSQL service. Do not move/delete the US-West volume in place.
4. Apply and verify the complete canonical migration history (currently 212 migrations in the rebuilt Testing baseline).
5. Restore only the approved Testing data allowlist and reconcile business, membership, auth, roster, Attendance, Leave, Claims, payroll and approval counts.
6. Update Testing service references/`DATABASE_URL` together for Staff, web, worker, backup and restore-verify jobs; avoid mixed old/new writers.
7. Redeploy controlled Testing services and run DB health, Staff login, real OTP, module authorization, Attendance-today, clock-in/out and manager approval smoke checks.
8. Keep the former US-West database read-only for a time-bounded rollback window; do not delete it immediately.
9. Rerun the exact DB/HTTP timing suite and physical-iPhone flow. Acceptance target: warm authenticated reads under 1 second where practical and Attendance-today under 1–1.5 seconds.
10. After colocation, profile the remaining Attendance query sequence. Safely parallelize independent reads and move pure read composition out of long interactive transactions where canonical consistency permits.

Do not move the region until the owner explicitly authorizes this separate cutover.

## 13. TEST RESULTS

Focused tests were run against the clean deployed-candidate worktree `C:\CodexTetamuP0-staff-testing-deploy-20260830`:

| Test | Result |
|---|---|
| `npx tsx --test tests/unit/staff-employee-otp-transaction-timeout.test.ts` | PASS — 1/1 |
| `node scripts/with-embedded-postgres.mjs npx tsx --test --test-concurrency=1 tests/integration/attendance-phase1c-route-flow.test.ts` | PASS — 1/1 |

The integration run emitted two expected diagnostic warnings that completed-punch P2 materialization returned `INVALID_STATE`, but the full isolated Attendance route-flow assertion passed. This audit did not change code, so TypeScript/ESLint/build were not rerun as change validation.

Runtime checks also confirmed:

- current account/session/workplace capability state is valid;
- canonical 31 Aug roster expected-day is present and current;
- default 5-second interactive-transaction expiry is reproducible from the Staff container;
- no real SMS was generated by the benchmark.

## 14. PRODUCTION STATUS

**TESTING ONLY**  
**PRODUCTION NOT ACCESSED**  
**PRODUCTION NOT MODIFIED**

