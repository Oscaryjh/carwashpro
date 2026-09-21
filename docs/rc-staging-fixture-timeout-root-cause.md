# RC Staging Fixture Submit Timeout — Root Cause

## Classification

Selected minimal option: **C — fixture orchestration only**.

The observed `P2028` is caused by running the guarded fixture process from the operator workstation through Railway's public TCP proxy while the product service keeps Prisma's default five-second interactive-transaction budget. It is not caused by a lock, a slow single SQL statement, fixture row volume, external I/O inside the transaction, or a Payroll readiness blocker.

## Exact failing path

- Fixture call site: `scripts/lib/rc-staging-hr-core-data.ts:472`.
- Product transaction: `submitPayrollRunForReview` in `src/lib/payroll/service.ts:1009-1100`.
- The transaction starts at the `database.$transaction` call, loads the draft, checks the locked Timesheet, computes readiness, validates each manual PCB source, then atomically updates the run and writes its audit event.
- The frozen fixture worker created its `PrismaClient` without a fixture-specific transaction policy, so the effective interactive-transaction timeout was 5,000 ms.

## Reproduction and measurements

The disposable integration test `tests/integration/payroll-submit-transaction-timeout.test.ts` adds a controlled 350 ms delay before each ORM operation. The unmodified five-second client consistently raises Prisma `P2028`. After rollback the run remains `DRAFT`; submit audit, Payslip publication, payment instruction and COMPLETE marker counts remain zero. A normal retry creates one run, one entry and one submit audit, and a second retry creates no duplicate artifact.

A pinned-identity, read-only diagnostic ran against the existing RC Staging database. It executed the real submit read path, changed the transaction to `READ ONLY`, blocked at the first write method, and emitted only aggregate timing data:

| Stage | ORM/SQL queries | Wall time | Prisma query time |
|---|---:|---:|---:|
| Locked Timesheet invariant | 5 | 436 ms | 422 ms |
| Payroll period readiness | 135 | 7,440 ms | 7,172 ms |
| Final manual PCB checks | 102 | 4,568 ms | 4,369 ms |
| Full real submit read path | 249 | 11,144 ms | 10,692 ms |

The draft contains six synthetic entries. PostgreSQL activity sampling observed no lock wait. Samples were predominantly `idle in transaction / ClientRead`; the maximum observed active query age was 138 ms. This rules out a multi-second SQL statement and lock contention. The difference from local execution is the public-proxy round trip repeated across a highly chatty read path. No network request, password hash, file I/O or external computation occurs inside `submitPayrollRunForReview`; synchronous assembly and hashing are a small remainder of wall time.

## Product reliability assessment

The same product path completes within Prisma's default five-second budget against the local disposable PostgreSQL used by integration tests, so the current evidence does not prove an in-platform Production failure. RC Staging application services will use Railway's private database network rather than the operator-to-public-proxy path that caused this incident.

The 249-query profile for six entries is nevertheless a scalability warning: readiness and the final PCB loop both resolve manual PCB inputs per employee. A larger real payroll may exceed five seconds even on a private network. That should be handled as a separate measured product performance item, because batching or changing the atomic readiness boundary would be broader than this authorized fixture recovery and would require dedicated concurrency tests. It is not evidence for changing the product transaction or globally raising Prisma timeouts in this bounded fix.

## Why A and B were rejected

- **A** would require moving or batching readiness/manual-PCB validation across the product transaction's atomic boundary. Doing that safely requires a new optimistic-concurrency invariant across Timesheet, Payroll entry, statutory, tax and correction inputs. No such product semantic change is authorized here.
- **B** would raise the timeout on every product submit call even though the failure was reproduced only through the fixture's public-proxy transport. That expands runtime risk and does not address the evidence boundary.
- **C** confines a finite budget to the guarded, one-shot fixture `PrismaClient`. The product client and `submitPayrollRunForReview` stay unchanged; no retry is added. A 30-second fixture budget is bounded and covers the measured 11.1-second path with headroom below the fixture process's existing outer deadline.
