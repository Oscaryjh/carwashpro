# TETAMU HR & Payroll Release Candidate Manifest

## Release identity

| 字段 | 值 |
| --- | --- |
| Project | Tetamu-POS |
| Environment | testing |
| Main branch | `codex/testing-release-2026-08-24` |
| Main commit | `4070f2fdeca66870004065efdad3b0d69d5274c6` |
| Main remote verification | remote branch points to the same commit |
| Main working tree at freeze | clean |
| Main RC source digest | `ee03598733b2ce6d85aed20559e4c2b000a9b67591dc10216fd9bd4b4768185d` |
| Standalone Staff branch | `codex/staff-ui-testing-integration` |
| Standalone Staff commit | `0f8fcbf3d5314db8a673a8442ab9f5a92dea0965` |
| Standalone Staff working tree | clean |
| Migration count | 209 |
| Migration head | `20260826173000_non_production_statutory_fixture_evidence_facility` |

## Scope classification

Frozen main commit contains 52 changed paths. All 52 were reviewed as `RC_REQUIRED`; `UNRELATED = 0`, `UNKNOWN = 0`. They comprise release/UAT evidence, one additive migration, Prisma schema changes, non-production fixture scripts, Payroll/Statutory implementation, retained official certification artifacts, and relevant unit/integration tests.

## Final Testing deployments

| Service | Final deployment | Result | Source |
| --- | --- | --- | --- |
| `tetamu-pos-web` | `4667d600-511a-4375-a1fc-deedbab3e071` | SUCCESS | RC image from commit `4070f2f…` |
| `tetamu-staff-app` | `c8c8b357-c1ed-4ddc-a8d5-5071b0b0991b` | SUCCESS | standalone Staff RC `0f8fcbf…` |
| `tetamu-pos-worker` | `bcec9c85-782b-4728-bb7d-e26cb29af399` | SUCCESS / unchanged | Worker code not changed by RC |

Final Desktop health reports DB ready, environment `testing`, deployment ID `4667d600-…`, commit `4070f2f…`, and the frozen source digest.

## Backup artifact

| 字段 | 值 |
| --- | --- |
| Environment | Railway Testing PostgreSQL (`Postgres-Singapore`) |
| Backup timestamp | `2026-08-27T00:11:24Z` |
| Tool | `pg_dump (PostgreSQL) 18.6` |
| Server | PostgreSQL 18.4 |
| Format | custom archive |
| Path | `C:\Users\oscar\AppData\Local\Temp\tetamu-release-drill-20260827T001054Z\tetamu-testing.pgdump` |
| Size | 3,194,999 bytes |
| SHA-256 | `0dd9d46bf8e0b7018a7668b79e8b75ea7870a4679af9fe5be31dfc7d71e14b3d` |
| Catalog entries | 3,075 |
| Archive validation | PASS |
| Committed to Git | NO |

## Restore and reconciliation

Disposable restore completed with 0 fatal errors. Source and restored counts matched:

| Domain | Testing | Restored | Match |
| --- | ---: | ---: | --- |
| Businesses | 7 | 7 | YES |
| Branches | 7 | 7 | YES |
| Employee Accounts | 47 | 47 | YES |
| Memberships | 46 | 46 | YES |
| Roster Periods | 10 | 10 | YES |
| Roster Assignments | 33 | 33 | YES |
| Attendance | 25 | 25 | YES |
| Attendance Corrections | 0 | 0 | YES |
| Leave | 5 | 5 | YES |
| Claims | 2 | 2 | YES |
| Commission | 0 | 0 | YES |
| Timesheets | 4 | 4 | YES |
| Timesheet Revisions | 4 | 4 | YES |
| Payroll Runs | 8 | 8 | YES |
| Payroll Entries | 54 | 54 | YES |
| Payroll Components | 1 | 1 | YES |
| Statutory Snapshots | 5 | 5 | YES |
| Payslip Publications | 1 | 1 | YES |
| Audit Logs | 1,043 | 1,043 | YES |

Known artifacts restored and related correctly:

- Payroll Run `2972941a-8067-4076-bf3b-24ddf08b308a`;
- Payroll Entry `09a34a1a-fc19-40f6-bede-7ce2956b84eb`;
- Payslip Publication `34993730-8dfb-4754-a32a-9594123f11a3`.

Constraints/guards restored: 795 foreign keys, 52 unique constraints, 391 check constraints, 269 user triggers, 24 guard functions and 2 synthetic evidence contracts. Disposable restore data directory cleanup: PASS. Backup retained: YES.

## Migration drill

| Gate | Result |
| --- | --- |
| Testing migration status | PASS — schema up to date, 209 migrations |
| Fresh empty DB to current head | PASS — 209 migrations, 5.26 s |
| Previous release to RC upgrade | PARTIAL — reproducible previous-release schema/snapshot unavailable |
| Recovery plan | PASS — documented; no false automatic down-migration claim |

## Test baseline

| Gate | Result |
| --- | --- |
| Full unit | 1,144 / 1,144 PASS |
| Disposable/relevant integration | 186 / 186 PASS |
| Post-deploy targeted statutory/unit | 43 / 43 PASS |
| Official evidence packs | PASS |
| P2C retained dataset/calculator | PASS |
| TypeScript | PASS |
| ESLint | PASS (0 errors; 3 unrelated existing warnings) |
| `git diff --check` | PASS |
| Build | PASS |

## Payroll calculation certification

```text
Payroll Calculation: READY EXCEPT PCB

EPF: PASS
SOCSO: PASS
EIS: PASS
LINDUNG 24: PASS

PCB: DEFERRED
Application/configuration pending
Not included in net pay
```

RM3,000 frozen result:

```text
EPF employee/employer: RM330.00 / RM390.00
SOCSO employee/employer: RM14.75 / RM51.65
EIS employee/employer: RM5.90 / RM5.90
LINDUNG24 baseline: RM0.00 (valid local voluntary opt-out)
Employee deductions excluding PCB: RM350.65
Net excluding PCB: RM2649.35
Employer statutory cost: RM447.55
```

## Rollback drill

| Stage | Desktop | Staff | Result |
| --- | --- | --- | --- |
| RC before rollback | `5ece7375-65ce-4692-92d3-90972767565c` | `7ef14447-9e3e-441d-9bd6-d95eb4a3aed7` | Healthy |
| Known-good target | `8995f633-9cfa-4fa8-a934-59dcede97c1d` | `50b876fd-98cb-46f5-ab6e-826b122bd7b6` | Compatible |
| Rollback deployment | `9d426bbe-59c8-4f7f-8249-df58e9c2f00b` | `747b36a0-4606-49e0-8d8d-707e68627b98` | SUCCESS |
| RC roll-forward | `4667d600-511a-4375-a1fc-deedbab3e071` | `c8c8b357-c1ed-4ddc-a8d5-5071b0b0991b` | SUCCESS |

Rollback did not modify the DB. Post-rollback health, protected-route behavior, Finalized Payroll, Published Payslip, Timesheet revisions and statutory snapshots all remained intact.

## Final smoke

Desktop login returned 200; protected Desktop routes returned the expected 307 login boundary with no 500. Standalone Staff Login, Home, Roster, Timesheet, Requests, Pay, Payslips and Profile returned 200. The individual payslip download route returned fail-closed 404 without an employee session, as designed. Real-device OTP authentication was previously passed and was not repeated to avoid SMS.

## Remaining Production go-live blockers

1. Railway Testing/Project has no scheduled database backup policy (`schedules: []`).
2. Railway project has no notification rules; alerting is incomplete.
3. `tetamu-pos-web` has no provider healthcheck gate configured. A variable-triggered deployment briefly pulled stale connected GitHub source (Next 15.3.8, 51 migrations, no `/api/health`) before the RC CLI source was restored. Connected source, branch protection and healthcheck gating must be corrected before Production.
4. Upgrade migration drill remains PARTIAL until a reproducible previous-release schema/snapshot is retained.
5. PCB remains DEFERRED and is not part of the certification.

## Verdict

```text
CONDITIONAL PRODUCTION RELEASE CANDIDATE

PRODUCTION RELEASE CANDIDATE ≠ PRODUCTION READY
```

