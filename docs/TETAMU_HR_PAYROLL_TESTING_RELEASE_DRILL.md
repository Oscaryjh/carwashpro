# TETAMU HR & Payroll Testing Release Drill

## 1. Executive Summary

Testing Release Drill completed across backup, archive validation, disposable restore, data/constraint reconciliation, migration verification, RC deployment, health, route smoke, statutory regression, observability audit, controlled rollback and RC roll-forward.

Final classification: **CONDITIONAL PRODUCTION RELEASE CANDIDATE**. All core technical restore/deploy/rollback gates passed. Production go-live remains blocked by missing scheduled backups, incomplete alerting, missing Railway healthcheck gating/source drift control, PARTIAL upgrade-migration evidence, and deferred PCB.

Production was not touched. No payment, bank export, mark-paid or statutory submission occurred.

## 2. Release Candidate Baseline

- Main branch: `codex/testing-release-2026-08-24`
- Main commit: `4070f2fdeca66870004065efdad3b0d69d5274c6`
- Source digest: `ee03598733b2ce6d85aed20559e4c2b000a9b67591dc10216fd9bd4b4768185d`
- Main remote branch verified at the same commit.
- Freeze working tree: clean.
- Standalone Staff branch/commit: `codex/staff-ui-testing-integration` / `0f8fcbf3d5314db8a673a8442ab9f5a92dea0965`.
- Migration head: `20260826173000_non_production_statutory_fixture_evidence_facility`.
- 52 main RC files: `RC_REQUIRED = 52`, `UNRELATED = 0`, `UNKNOWN = 0`.

## 3. Payroll READY EXCEPT PCB Baseline

Frozen certification remained unchanged:

| Scheme | Result |
| --- | --- |
| EPF | PASS |
| SOCSO | PASS |
| EIS | PASS |
| LINDUNG 24 | PASS |
| PCB | DEFERRED |

RM3,000 result remains RM350.65 employee deductions excluding PCB, RM2,649.35 net excluding PCB, and RM447.55 employer statutory cost. PCB remains `Pending configuration` and is excluded from net; it is not rendered as RM0.

## 4. Testing Boundary

Confirmed Railway project `Tetamu-POS`, environment `testing`, Desktop `https://tetamu-pos-web-testing.up.railway.app`, Staff `https://tetamu-staff-app-testing.up.railway.app`. All deployment and DB operations were explicitly scoped to Testing.

## 5. Backup

Testing PostgreSQL custom archive was created outside the repository at:

`C:\Users\oscar\AppData\Local\Temp\tetamu-release-drill-20260827T001054Z\tetamu-testing.pgdump`

Timestamp `2026-08-27T00:11:24Z`; `pg_dump` 18.6 against PostgreSQL 18.4; size 3,194,999 bytes; SHA-256 `0dd9d46bf8e0b7018a7668b79e8b75ea7870a4679af9fe5be31dfc7d71e14b3d`.

## 6. Backup Validation

File exists, non-empty, hash recorded, custom archive readable and catalog readable. `pg_restore --list` returned 3,075 catalog entries. Result: PASS.

## 7. Disposable Restore

Backup restored to an isolated PostgreSQL 18 disposable cluster in 3.8 seconds with zero fatal restore errors. It never targeted the active Testing DB. Disposable data directory cleanup completed after PostgreSQL stopped; backup artifact was retained.

## 8. Restore Data Integrity

Source/restored counts matched for Businesses 7, Branches 7, Employee Accounts 47, Memberships 46, Roster Periods 10, Roster Assignments 33, Attendance 25, Attendance Corrections 0, Leave 5, Claims 2, Commission 0, Timesheets 4, Timesheet Revisions 4, Payroll Runs 8, Payroll Entries 54, Payroll Components 1, statutory snapshots 5, Payslip publications 1 and Audit Logs 1,043.

## 9. Payroll Restore

Known Payroll Run `2972941a-8067-4076-bf3b-24ddf08b308a`, Payroll Entry `09a34a1a-fc19-40f6-bede-7ce2956b84eb` and Payslip Publication `34993730-8dfb-4754-a32a-9594123f11a3` were present after restore with intact relationships. The historical published payslip was not modified.

## 10. Constraint / Trigger Restore

Restored schema retained 795 foreign keys, 52 unique constraints, 391 check constraints, 269 user triggers, 24 guard functions and 2 synthetic evidence contracts. Tenant and immutable/append-only protections were not lost. Result: PASS.

## 11. Migration Status

Testing reported 209 migrations, schema up to date, no failed or pending migration. Current head: `20260826173000_non_production_statutory_fixture_evidence_facility`.

## 12. Fresh Migration Drill

An empty disposable DB migrated through all 209 migrations to current head in 5.26 seconds. Result: PASS.

## 13. Upgrade Migration Drill

Result: PARTIAL. No reproducible previous-release schema or previous-release DB snapshot was retained to prove an exact previous-release-to-RC path. This was not reported as PASS.

## 14. Migration Recovery

Recovery plan is documented in the Runbook: stop writes, stop/rollback app, inspect schema/migration history, restore pre-deploy backup only if required, deploy a compatible known-good app, then health/smoke. Prisma automatic down migration is not claimed.

## 15. Testing Deployment

Initial RC deployments succeeded. A release-identity variable correction triggered a Railway connected-source deployment `2777de22-893d-4211-b734-231d37b3d861` that pulled stale GitHub source (Next 15.3.8, 51 migrations, missing `/api/health`). No pending DB migration was applied. The stale deployment was immediately replaced with the frozen CLI source.

Final Testing deployments after rollback drill:

- Desktop `4667d600-511a-4375-a1fc-deedbab3e071` — SUCCESS.
- Standalone Staff `c8c8b357-c1ed-4ddc-a8d5-5071b0b0991b` — SUCCESS.
- Worker `bcec9c85-782b-4728-bb7d-e26cb29af399` — SUCCESS and unchanged because RC did not modify worker code.

## 16. Build

Dependency installation, Prisma generation, 209-migration predeploy, Next 16.3.0 build/start and environment contract validation succeeded. Local verification also passed TypeScript, build, tests and lint. No ignored build or migration failure was accepted.

## 17. Health

Final Desktop `/api/health` returned HTTP 200, DB `ready`, environment `testing`, deployment `4667d600-…`, commit `4070f2f…`, source digest `ee0359…`, version `0.1.0`. Staff login returned HTTP 200.

## 18. Desktop Smoke

Desktop Login returned 200. Dashboard, People, Roster, Attendance, Leave, Claims, Commission, Timesheet, Payroll and known Payroll Run detail returned the expected unauthenticated 307 to login, with no 500 or authorization regression. Existing immutable artifact reads were also verified directly against Testing DB.

## 19. Staff Smoke

Standalone Staff Login, Home, Roster, Timesheet, Requests, Pay, Payslips and Profile returned 200. The individual payslip endpoint failed closed with 404 without a valid employee session, as coded. Existing published-payslip metadata remained present. Real-device authentication was previously passed and was not repeated to avoid SMS. Result: PASS within read-only/no-SMS scope.

## 20. Payroll Calculation Regression

Full baseline had already passed 1,144/1,144 unit and 186/186 disposable/relevant integration tests. After final RC roll-forward, 43/43 targeted statutory, employee-profile, synthetic-evidence, P4D and PCB-deferred tests passed. RM3,000 certified figures did not drift.

## 21. Statutory Boundary Regression

Frozen verified tests covered EPF/SOCSO/EIS wage-band boundaries and ceilings plus LINDUNG 24 opt-out, opt-in, foreign mandatory and selected-employer behavior. Official evidence packs and retained P2C dataset/calculator verification passed.

## 22. PCB Deferred Regression

Tests confirmed calculated zero is distinct from not configured. PCB remains application/configuration pending and excluded from net. No `PCB RM0.00` regression was found.

## 23. Synthetic Statutory Safety

Testing synthetic evidence remains non-production only. Production write, official statutory export and official statutory submission fail closed with stable code `SYNTHETIC_STATUTORY_EVIDENCE_NOT_EXPORTABLE`. Targeted regression passed.

## 24. Monitoring

| Signal | Logging | Monitoring | Alert |
| --- | --- | --- | --- |
| HTTP 5xx | Railway/app logs | Railway logs/deployment | No configured project alert |
| DB connection error | App/Prisma logs | `/api/health` + Railway logs | No configured alert |
| Deployment failure | Railway deployment logs | Railway deployment status | No configured alert |
| Health endpoint | HTTP response | `/api/health` | No provider healthcheck/alert gate |
| Worker failure | Worker logs | Railway service/deployment | No configured alert |
| SMS123 failure | Safe provider failure logs | Worker/app logs | No configured alert |
| Payroll Finalize audit | Audit records | DB/report inspection | No configured alert |
| Statutory export deny | Stable error/audit path | Logs/tests | No configured alert |
| Statutory submission deny | Stable error/audit path | Logs/tests | No configured alert |

Monitoring result: PARTIAL. Runtime logs and health/deployment status exist; proactive alerting does not.

## 25. Logging Safety

Deployed OTP/provider logging records challenge/provider and safe error classifications, not OTP plaintext or API key. No password, session/JWT secret, full bank account, private-storage credential or raw statutory identity was found in runtime logging paths reviewed. A local QA TOTP script can print a generated test code and must remain operator-controlled; it is not a deployed runtime path. Result: PASS for deployed runtime.

## 26. Error Traceability

- Unauthorized read: `/api/employee-auth/me` returned 401 with stable code `UNAUTHENTICATED` and no mutation.
- Validation failure: invalid `/api/ai/analyze` payload returned 400 with stable code `AI_REQUEST_INVALID` and explicit no-data-changed message.
- Synthetic statutory export: automated regression returned stable deny code `SYNTHETIC_STATUTORY_EVIDENCE_NOT_EXPORTABLE`.

Railway supplies edge request IDs, but these two application JSON error paths do not expose a first-class application trace ID. Error traceability is therefore functional but observability correlation is PARTIAL.

## 27. Health Quality

`/api/health` checks application liveness and DB reachability and returns environment, deployment ID, commit SHA, source digest and version with no-store caching. Quality: PASS. Railway service healthcheck gating is nevertheless not configured.

## 28. Backup Policy

Railway project compliance reported `schedules: []` for `Postgres-Singapore` and the legacy `Postgres` service. The manual drill is not a backup policy. Frequency, retention, restore owner and automatic restore procedure are therefore not established. Result: FAIL — Production go-live blocker.

## 29. Alerting

Railway `notificationRules` returned an empty array. Logs and deployment status are available but deployment/service/health/DB/5xx/worker/OTP provider alerts are not configured. Result: PARTIAL — Production go-live blocker.

## 30. Rollback Compatibility

The selected previous Desktop known-good deployment already contained the current additive synthetic statutory migration and `/api/health`; startup against the current DB reported 209 migrations and none pending. Standalone Staff previous known-good reported no pending migrations. Application rollback was therefore schema-compatible; DB rollback was not needed.

## 31. Rollback

Controlled application-only rollback succeeded:

- Desktop RC `5ece7375-…` → target `8995f633-…` → rollback deployment `9d426bbe-…` SUCCESS.
- Staff RC `7ef14447-…` → target `50b876fd-…` → rollback deployment `747b36a0-…` SUCCESS.

Both became healthy within the observed polling window of under one minute. DB was not rolled back.

## 32. Post-Rollback Health

Desktop health returned 200 and DB ready. Staff login returned 200. Desktop startup found 209 migrations with none pending; no schema mismatch was observed.

## 33. Post-Rollback Smoke

Desktop login/protected People, Attendance and Payroll boundaries and Staff login/Requests/Pay/Payslip routes had no 500. Authentication remained fail closed.

## 34. Payroll Data Integrity

After rollback, known Payroll Run remained `FINALIZED`; known Payroll Entry still referenced that run; known Payslip Publication still referenced that run; four Timesheet revisions and five statutory snapshots remained. No data loss or mutation occurred.

## 35. RC Re-deploy

Roll-forward used the retained RC images and succeeded:

- Desktop final `4667d600-511a-4375-a1fc-deedbab3e071`.
- Staff final `c8c8b357-c1ed-4ddc-a8d5-5071b0b0991b`.

Testing now rests on the Release Candidate, not the known-good rollback image.

## 36. Final Health

Desktop health 200, DB ready, environment testing, frozen commit/source digest match. Staff login 200. Result: PASS.

## 37. Final Smoke

| Flow | Result |
| --- | --- |
| Desktop login | PASS |
| People | PASS — protected 307, no 500 |
| Roster | PASS — protected 307, no 500 |
| Attendance | PASS — protected 307, no 500 |
| Leave | PASS — protected 307, no 500 |
| Claims | PASS — protected 307, no 500 |
| Commission | PASS — protected 307, no 500 |
| Timesheet | PASS — protected 307, no 500 |
| Payroll | PASS — protected 307, no 500 |
| Payslip | PASS — immutable DB artifact + protected route |
| Staff login | PASS |
| Staff Home | PASS |
| Staff Time/Roster | PASS |
| Staff Requests | PASS |
| Staff Pay | PASS |
| Published Payslip read | PASS — metadata present; endpoint fail closed without session |
| EPF calculation regression | PASS |
| SOCSO calculation regression | PASS |
| EIS calculation regression | PASS |
| LINDUNG24 regression | PASS |
| PCB deferred presentation | PASS |

## 38. Runbook

Operational pre-deploy, backup, migration, deployment, health, smoke, statutory regression, rollback, DB restore, verification and escalation steps are documented in `docs/TETAMU_HR_PAYROLL_RELEASE_RUNBOOK.md`.

## 39. Remaining Production Blockers

1. No scheduled database backups or documented retention/restore owner.
2. No Railway notification rules or equivalent proactive service/DB/5xx/worker/OTP alerts.
3. No Railway healthcheck gate on Desktop; connected-source drift can receive traffic. Align connected GitHub source with RC branch/commit and require `/api/health` before traffic shift.
4. Upgrade migration drill remains PARTIAL without a retained previous-release schema/snapshot.
5. PCB remains DEFERRED and outside current certification.

## 40. Final Verdict

```text
TETAMU HR & Payroll
→ CONDITIONAL PRODUCTION RELEASE CANDIDATE

Payroll Calculation
→ READY EXCEPT PCB

PCB
→ DEFERRED / application and configuration pending

PRODUCTION RELEASE CANDIDATE ≠ PRODUCTION READY
```

