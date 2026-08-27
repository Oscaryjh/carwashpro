# TETAMU — August 2026 Payroll UAT Feasibility Audit

Audit date: 26 Aug 2026 (Asia/Singapore)  
Environment: Railway `testing`  
Employee: `UAT-PAYROLL-001` — Real Device Payroll UAT Staff  
Scope: read-only feasibility audit. No roster, attendance, timesheet, payroll run, payslip, payment, statutory submission, or Production mutation was performed.

## Final classification

**OPTION B — AUGUST FIXTURE READY AFTER SIMPLE TEST DATA PREPARATION**

August is not blocked by a period-close rule. The current implementation permits an August monthly Timesheet to be created, made branch-ready, approved, and locked before 31 Aug. The employee is employment- and compensation-eligible for August, but a representative attendance-backed fixture still requires explicit roster/expected-day evidence, attendance results, and a locked monthly Timesheet.

This classification is about the three options supplied for this audit. It does **not** mean an isolated employee-only Payroll Run exists: Payroll Run generation is business-wide and includes every membership eligible for the business/month.

## Testing boundary

Railway project status confirmed the active environment as `testing`, including the Testing web service and Testing database service. The Testing MFA flag is unset. No Production command, deployment, database mutation, or business action was executed.

The employee facts used in this audit are the confirmed fixture facts supplied for this task:

- employment active from 1 Jul 2026;
- monthly MYR 3,000 compensation active from 1 Aug 2026;
- Royal Salon / salon online;
- no August source data was created in this audit.

The Testing database has no public database URL and the private SSH query route was unavailable from this local audit session. Accordingly, the audit does not invent a live count for existing August roster, attendance, Timesheet, or Payroll rows. The feasibility result is based on the confirmed fixture baseline plus the canonical write/readiness implementation.

## Canonical August payroll period

`parsePayrollMonth("2026-08")` resolves the period to:

- start: `2026-08-01` inclusive;
- end: `2026-09-01` exclusive.

The Attendance monthly Timesheet uses the same August period start. There is one Timesheet per Business and month, and one Payroll Run per Business and start/end period.

Evidence:

- `src/lib/payroll/period.ts`
- `src/lib/attendance/timesheet-service.ts`
- `prisma/schema.prisma` — `AttendanceMonthlyTimesheet`, `PayrollRun`

## Current-month Timesheet and lock behavior

| Question | Result | Evidence-based behavior |
|---|---|---|
| Can an August Timesheet exist on 26 Aug? | YES | Creation is keyed by business and `2026-08-01`; no current-date check exists. |
| Can it be materialized? | YES | Branch readiness materializes existing current Expected Days and approved Leave Days within the month. |
| Can it be approved before month-end? | YES | Approval checks DRAFT status, branch readiness, blockers, concurrency, and source digest; it has no `now >= periodEnd` gate. |
| Can it be locked before month-end? | YES | Lock requires an APPROVED, blocker-free, current-source Timesheet; it has no period-end check. |
| Is early lock semantically safe with incomplete future schedule? | NO | The code allows it, but absent future schedule evidence is omitted rather than proven complete. A representative fixture should explicitly complete the schedule evidence before lock. |

Evidence:

- `src/lib/attendance/timesheet-service.ts` — `markAttendanceTimesheetBranchReady`, `approveMonthlyAttendanceTimesheet`, `lockMonthlyAttendanceTimesheet`
- `tests/integration/attendance-monthly-timesheet.test.ts` — August approval/lock path

## Future-day treatment: 27–31 Aug

There is no generic `FUTURE` Attendance outcome in the monthly Timesheet coverage logic.

For a date with **no published Roster and no `AttendanceExpectedDay`**:

- it is not automatically labelled `NOT_SCHEDULED`;
- it is not automatically labelled `UNKNOWN`;
- it is not automatically materialized as `MISSING_EXPECTED_DAY`;
- it is absent from expected-day coverage and therefore does not itself block branch readiness or Timesheet lock.

`MISSING_EXPECTED_DAY` is created by roster reconciliation only when a published roster assignment exists but its Expected Day projection is missing.

If an Expected Day exists, the outcome changes:

| Expected-day evidence | No punches | Timesheet effect |
|---|---|---|
| `WORKDAY` | `SUSPECTED_NO_SHOW` | Blocking until resolved |
| `NOT_SCHEDULED` | `NOT_SCHEDULED` | Non-blocking |
| `REST_DAY` | `REST_DAY` | Non-blocking |
| `PUBLIC_HOLIDAY` | `PUBLIC_HOLIDAY` | Non-blocking unless another review condition applies |
| No Expected Day, but explicitly materialized | `NO_ATTENDANCE_RECORDED` / no expected evidence | Blocking |
| No Expected Day and not materialized | No row/outcome | Not counted; does not block |

Therefore, **future days do not automatically block readiness or lock**. A future `WORKDAY` that is materialized before punches exist does block as suspected no-show. For a sound UAT fixture, 27–31 Aug must be represented truthfully as planned workdays, rest days, or not scheduled; they should not be silently omitted merely to make the Timesheet pass.

Evidence:

- `src/lib/attendance/p2-detection.ts`
- `src/lib/attendance/p2-service.ts`
- `src/lib/roster/service.ts`

## Minimum representative attendance fixture

For a simple monthly-salary fixture with no OT, leave, claims, commission, or public-holiday complexity, prepare only canonical source evidence:

1. A published August roster/schedule for `UAT-PAYROLL-001` at `salon online`.
2. `AttendanceExpectedDay` projections for the intended August schedule.
3. Truthful `REST_DAY` / `NOT_SCHEDULED` evidence for non-working dates, including future dates if the Timesheet is to be locked early.
4. Clock-in/out sessions for every elapsed scheduled `WORKDAY` that is meant to be worked.
5. Attendance P2 final results for those sessions.
6. Resolution of any suspected no-show, missing punch, location, or other Attendance blocker.
7. Branch Ready for every branch participating in the Royal Salon monthly Timesheet.
8. Timesheet approval followed by an immutable locked revision.

Hard-gate nuance: monthly payroll has a legacy-compatibility path when the locked Timesheet contains no employee P2 day snapshots. That path produces a REVIEW warning rather than a blocking issue. It can technically preserve base monthly pay, but it is not suitable as the evidence-backed Real Device UAT fixture requested here.

Evidence:

- `src/lib/payroll/timesheet-bridge.ts`
- `src/lib/payroll/attendance-integration.ts`
- `src/lib/payroll/readiness.ts`

## Compensation and expected basic pay

The employee joined before August and the monthly compensation is effective exactly on 1 Aug. The canonical proration guard only rejects a monthly employee who joins after the period start or terminates before the final period day. This fixture passes that guard.

For monthly pay, Payroll starts `basicPay` from the resolved monthly `baseRate`. Attendance minutes do not directly prorate the monthly base. Unpaid absence, approved unpaid leave, OT, holiday pay, and other canonical component lines can change totals.

With the requested simple fixture and no unpaid-absence or other variable lines:

- expected canonical basic pay: **RM 3,000.00**;
- this is the expected basic component, not a guarantee of final net pay if statutory or other deductions are later enabled.

Evidence:

- `src/lib/payroll/calculation.ts` — `assertSupportedPayrollProration`
- `src/lib/payroll/service.ts` — resolved monthly base rate and Payroll Entry `basicPay`

## Statutory readiness and blocker boundaries

Statutory calculation is profile-driven:

- EPF, SOCSO, and EIS are only required when enabled on the frozen employee profile.
- LINDUNG 24 is required only when the employee/profile/participation conditions make it applicable.
- PCB is required when a tax profile revision or TIN makes PCB applicable.
- An applicable scheme with an incomplete profile, missing verified rule, missing classification, incomplete PCB/YTD ledger, or unresolved LINDUNG 24 participation creates a BLOCKED statutory snapshot and prevents Payroll from proceeding.
- A scheme that remains disabled/unconfigured produces no statutory calculation. A fully unconfigured statutory profile is a readiness REVIEW warning and the entry can end as `NOT_CONFIGURED`; that warning alone is not a Finalize blocker.

For the confirmed basic-only fixture, no enabled statutory/tax configuration was supplied. Therefore the canonical baseline is:

- **Payroll calculation/finalization blocker: NO**, provided the employee's schemes remain disabled/unconfigured in Testing.
- **Payment blocker: NO** for missing/unverified bank details; that state is REVIEW-only for Payroll Finalize, but blocks or affects the separate payment instruction workflow.
- **Statutory submission/export readiness: NO**; a `NOT_CONFIGURED` employee does not provide official EPF/SOCSO/EIS/PCB/LINDUNG 24 submission data.

If any scheme has already been enabled in the live Testing employee profile, its profile and active verified rule become a real Finalize gate. The Draft must be regenerated after any statutory profile/rule change.

The Sabah/work-pay setting is separate from the statutory contribution rule packs. With no OT, rest-day work, or public-holiday work, it does not add a statutory deduction blocker to this basic-pay fixture.

Evidence:

- `src/lib/payroll/statutory-p2.ts` — `materializeStatutoryP2`, `schemeRequired`
- `src/lib/payroll/readiness.ts`
- `src/lib/payroll/service.ts` — submit/finalize readiness checks

## Finalize gates

| Gate | Current audit status | Requirement |
|---|---|---|
| Employment | READY | Active and joined before 1 Aug. |
| Compensation | READY | Active monthly MYR 3,000 version effective 1 Aug. |
| Roster | MISSING_FIXTURE | Publish a truthful August schedule for representative Attendance evidence. |
| Expected Days | MISSING_FIXTURE | Project scheduled work/rest/not-scheduled days from the published roster. |
| Attendance | MISSING_FIXTURE | Record elapsed scheduled work and resolve any blockers. |
| Monthly Timesheet | MISSING_FIXTURE | Materialize branch coverage and obtain Branch Ready. |
| Timesheet Approval | MISSING_FIXTURE | Approve the blocker-free current source digest. |
| Timesheet Lock | MISSING_FIXTURE | Lock the approved immutable revision; **not blocked by date**. |
| Payroll Draft | MISSING_FIXTURE | Generate only after the locked Timesheet exists. |
| Payroll readiness | MISSING_FIXTURE | Requires current locked Timesheet, compensation, reconciled components, and no blocking statutory snapshot. |
| Statutory readiness | READY for unconfigured basic-only fixture | Becomes BLOCKED_BY_POLICY if an applicable scheme lacks profile, verified rule, classification, PCB/YTD, or LINDUNG 24 evidence. |
| Submit for review | MISSING_FIXTURE | Non-empty run, current Timesheet, no blocking readiness issue, no statutory `REVIEW_REQUIRED` entry, no pending holiday decision. |
| Finalize permission/separation | BLOCKED_BY_POLICY until performed by authorized actor | Run must be in REVIEW. Submitter cannot finalize the same run unless an allowed owner override and reason are used. |
| MFA / second verification | READY in current Testing configuration | `TETAMU_MFA_ENABLED` is unset; non-test runtime disables interactive MFA and uses the temporary high-risk authorization path. Capability and exact-action authorization are still required. |
| Payslip publish | MISSING_FIXTURE | Only a FINALIZED Payroll Run can publish employee payslips. |

Evidence:

- `src/lib/payroll/readiness.ts` — `assertPayrollReadinessCanProceed`
- `src/lib/payroll/service.ts` — `submitPayrollRunForReview`, `finalizePayrollRun`
- `src/lib/payroll/high-risk-mfa.ts`
- `src/lib/auth/mfa-feature.ts`
- `src/lib/payroll/payslip-publication.ts`

## Business-wide isolation constraint

`generatePayrollRun` queries all Royal Salon memberships whose join/termination dates overlap August. It does not accept an employee filter. The database also enforces a unique Payroll Run per Business and period.

Consequences:

- an August Royal Salon Payroll Run cannot be a run only for `UAT-PAYROLL-001`;
- generating it will create/update entries for every date-eligible Royal Salon membership;
- the Royal Salon monthly Timesheet likewise aggregates the Business/allowed branches, not only this employee;
- this audit cannot promise strict isolation from other Royal Salon UAT records.

This is not a date blocker, so the supplied classification remains Option B. Before creating the fixture, the tester must confirm that using the shared Royal Salon August business-wide run is acceptable. No employee, business, branch, run, or source data was changed in this audit.

## Exact next step

Do not create Payroll yet. First prepare and review a truthful August roster/expected-day and Attendance fixture for `UAT-PAYROLL-001`, including explicit treatment of 27–31 Aug, and confirm that a shared Royal Salon business-wide August Timesheet/Payroll Run will not conflict with other UAT work. Then resolve Attendance blockers, make all participating branches Ready, approve and lock the August Timesheet through the canonical workflow. Re-run Payroll readiness before generating the Draft.

## Verdict

August 2026 is technically eligible now and is not blocked until period close. It is not ready for Payroll generation today because the evidence-backed Attendance/Timesheet fixture is missing, and the canonical Payroll Run is business-wide rather than employee-isolated.

