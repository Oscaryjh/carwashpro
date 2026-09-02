# TETAMU — Real Device OT UAT Flow Audit

Audit date: 27 Aug 2026 (Asia/Singapore)  
Scope: current code plus read-only Railway Testing inspection  
Mutation boundary: no roster, attendance, OT, approval, deployment, or production mutation

## 1. Executive Summary

The canonical OT flow is attendance-derived. There is no employee OT request and no OT submit action:

```text
Published Roster / Expected Day
→ actual Attendance and final result
→ derived Potential OT candidate
→ authorised Manager / HR decision
→ approved OT minutes
→ locked Monthly Timesheet snapshot
→ Payroll
```

The existing Testing employee `TWILIO-OTP-QA` is suitable for generating a candidate: the employee is active, attendance-enabled, linked to the Staff App, assigned to `Royal Salon / salon online`, and has published WORKDAY expected days on 27 and 28 Aug 2026 from 09:00 to 18:00 MYT.

The desired all-mobile path is **BLOCKED**. The Manager Staff App approvals implementation supports only Leave and Claims. It does not list or decide OT. Current OT approval is available on Desktop at the Monthly Timesheet overtime review section. A hybrid Employee iPhone → Desktop Manager/HR → Employee iPhone path is executable without changing the workflow.

## 2. Canonical OT Source

Potential OT is derived by `deriveOvertimeCandidate` and listed by `listAttendanceOvertimeCandidates` in `src/lib/attendance/overtime-service.ts` from the latest `AttendanceP2FinalResult` for a membership and work date.

The input chain is:

1. Roster publication materialises an `AttendanceExpectedDay`.
2. Employee clock-in/out produces Attendance evidence.
3. Attendance processing produces the latest P2 final result, including total worked minutes and expected-day references.
4. The OT service compares actual worked time with the Expected Day window and derives a candidate.
5. A persisted review is created only when an authorised reviewer makes the first decision.

Important: `Potential OT` is a derived candidate, not a separate employee request and not a schema status.

Primary files:

- `src/lib/attendance/overtime-service.ts`
- `src/lib/attendance/timesheet-service.ts`
- `src/lib/attendance/employee-timesheet.ts`
- `prisma/schema.prisma`
- `prisma/migrations/20260818220000_attendance_overtime_approval/migration.sql`

## 3. OT Record Model

Canonical persisted models:

- `AttendanceOvertimeReview`: one review per business, employee membership, and work date; stores potential minutes, approved minutes, context, decision status, revision, reviewer and reason.
- `AttendanceOvertimeReviewEvent`: immutable review event history and before/after evidence.
- `AttendanceTimesheetP2DaySnapshot`: frozen day-level potential/approved OT, context, approval status, review reference and revision.
- `AttendanceTimesheetP2SegmentSnapshot`: frozen segment-level worked, potential OT and approved OT minutes.
- `PayrollAttendanceInputSnapshot`: payroll-side attendance evidence copied from the locked Timesheet.
- `PayrollEntry`: receives approved overtime minutes and calculated overtime pay.

Relevant enums:

- `AttendanceOvertimeApprovalStatus`
- `AttendanceOvertimeContext`
- `AttendanceOvertimeEventType`

## 4. Status Flow

The real `AttendanceOvertimeApprovalStatus` values are:

```text
PENDING_REVIEW
APPROVED
REJECTED
ADJUSTED
NOT_APPLICABLE
```

The real event values are:

```text
OT_REVIEW_CREATED
OT_APPROVED
OT_REJECTED
OT_ADJUSTED
OT_REOPENED
```

`POTENTIAL` and `FROZEN` are not enum statuses. Potential is a derived amount. Frozen behavior is represented by the locked Timesheet snapshot containing the final approval status and minutes.

Before a review row exists, a positive non-blocked candidate is presented with effective status `PENDING_REVIEW`. A stale review is also treated as needing review rather than silently reused.

## 5. OT Generation Rules

Source: `deriveOvertimeCandidate` in `src/lib/attendance/overtime-service.ts`.

### Normal workday

Potential OT is the smaller of:

- total worked minutes; and
- minutes worked before expected start plus minutes worked after expected end.

For a normal 09:00–18:00 shift, clocking 09:00–19:00 with the existing 60-minute unpaid break yields approximately 60 potential OT minutes.

### Rest day, public holiday, or not scheduled

All final worked minutes are potential OT, subject to review.

### Other existing rules

- Whole minutes are used (`Math.floor`).
- The OT service has no separate minimum OT threshold.
- It has no separate rounding interval.
- Expected-day grace minutes are not applied by this OT derivation function.
- Break treatment is already reflected in the final attendance result's total worked minutes and frozen segments.
- A full-day leave/attendance conflict blocks the decision.
- Approved minutes cannot exceed potential minutes.
- A reason is required when the approved result differs from the full candidate, including adjustment or rejection.
- A locked Timesheet blocks later OT mutation until the controlled reopen workflow creates a new revision.

Candidate generation is automatic after the latest final attendance result exists; it is not a manually submitted request.

## 6. Testing Employee Suitability

Read-only Railway Testing inspection on 27 Aug 2026 confirmed:

### Employee

- Name: Twilio OTP QA Staff
- Employee ID: `TWILIO-OTP-QA`
- Phone: `+601112212259`
- Business: Royal Salon
- Branch: salon online
- Membership: ACTIVE
- Attendance enabled: YES
- Staff App user linked: YES
- Primary branch assignment: ACTIVE; clock-in allowed

### Published roster / expected days

- 27 Aug 2026: WORKDAY, 09:00–18:00 MYT
- 28 Aug 2026: WORKDAY, 09:00–18:00 MYT
- 29–30 Aug 2026: REST_DAY
- Roster week 24 Aug 2026: PUBLISHED, publication revision 1

The best immediate UAT date is 27 Aug 2026. At audit time, this employee had no Attendance row, P2 final result, or OT review for 27 Aug; the test remains clean.

### Manager

- Name: Real Device UAT Manager
- Employee ID: `EMP-005`
- Phone: `+601151300932`
- Business / branch: Royal Salon / salon online
- User: active and login-enabled
- Permissions include `ATTENDANCE_EMPLOYEE_READ` and `ATTENDANCE_EMPLOYEE_MANAGE`

The Employee and Manager are in the same business and branch. The fixture is suitable for branch-scoped OT review, but the Manager must currently use the Desktop approval surface.

No other employee is preferable: the current target already has today's published WORKDAY, active membership, attendance access, and Staff App linkage.

## 7. Manager Staff App Entry

Current Staff App Manager support:

| Capability | Result | Current entry |
|---|---:|---|
| See Potential OT in manager approval inbox | NO | None |
| Approve OT | NO | None |
| Adjust OT | NO | None |
| Reject OT | NO | None |

Evidence:

- `src/lib/staff-pwa/team-approvals.ts` defines only `LEAVE | CLAIMS` mobile approval domains.
- `src/app/staff/approvals/page.tsx` and `src/app/staff/approvals/[domain]/[requestId]/page.tsx` therefore do not provide an OT route.

The Staff App Requests copy is correct: there is no separate OT request. However, the Manager Android Staff App cannot complete the review step in the current implementation.

## 8. Desktop OT Entry

Desktop supports review, approve, adjust and reject.

Primary route:

```text
/team/attendance/timesheets?month=2026-08#overtime-review
```

Section:

```text
Overtime review
Classify potential OT before locking
```

Available operations while the Timesheet is not locked:

- Approve full OT
- Adjust approved minutes with reason
- Reject with reason

The unified Desktop approvals page also projects pending OT:

```text
/team/approvals
→ Review potential OT
→ /team/attendance/timesheets?month=YYYY-MM#overtime-review
```

Relevant files:

- `src/app/(business)/team/attendance/timesheets/page.tsx`
- `src/app/(business)/team/attendance/timesheets/actions.ts`
- `src/lib/approvals/service.ts`

## 9. Employee Visibility

Employee Staff App visibility is read-only and is not an OT submission workflow.

Route:

```text
/staff/timesheet
```

Section:

```text
My overtime
```

The employee can see:

- Potential OT minutes
- Approved OT minutes
- effective approval status
- OT context and date
- pending-review message before decision
- the final frozen classification after Timesheet Lock

The status can therefore show `PENDING_REVIEW`, `APPROVED`, `ADJUSTED`, or `REJECTED` when a corresponding candidate/review exists. There is no employee action to create or decide OT.

## 10. Permissions

Approval security is enforced server-side by `decideAttendanceOvertime` in `src/lib/attendance/overtime-service.ts` and the Desktop action context.

- Business scope: candidate and reviewer context must match the business.
- Branch scope: reviewer must have access to the candidate's branch.
- Permission scope: Desktop write context requires capability `MODIFY_ATTENDANCE_EMPLOYEES`, mapped to permission `ATTENDANCE_EMPLOYEE_MANAGE` in `src/lib/business-groups/capabilities.ts`.
- Self approval: denied if the candidate employee's linked Staff user is the acting reviewer.
- Locked period: denied with `TIMESHEET_LOCKED`.
- Concurrency: revision mismatch is denied with `CONCURRENT_CHANGE`.

For the existing Testing pair:

- Self approval: DENY
- Employee → Manager business scope: PASS
- Employee → Manager branch scope: PASS
- Manager permission: PASS

## 11. Payroll Boundary

Payroll consumes only approved OT minutes from the frozen locked Timesheet.

Flow:

```text
AttendanceTimesheetP2DaySnapshot / SegmentSnapshot
→ PayrollAttendanceInputSnapshot
→ approvedOvertimeMinutes
→ PayrollEntry.overtimeMinutes / overtimePay
```

Evidence:

- `src/lib/payroll/timesheet-bridge.ts` requires a matching `LOCKED` Monthly Timesheet and reads the frozen day/segment OT fields.
- `src/lib/payroll/attendance-integration.ts` aggregates approved OT minutes and verifies that approved minutes do not exceed potential minutes.
- `src/lib/payroll/service.ts` writes approved attendance OT to the Payroll Entry.

Consequences:

- Potential / pending OT does not enter Payroll.
- Rejected OT contributes zero approved minutes.
- Pending or stale review blocks Timesheet readiness/lock rather than silently becoming Payroll OT.

## 12. Freeze Behavior

Before lock, Monthly Timesheet readiness treats pending, stale, or blocked OT as blockers.

At lock, `src/lib/attendance/timesheet-service.ts` writes immutable revision, day, and segment snapshots containing:

- potential OT minutes
- approved OT minutes
- OT context
- approval status
- review reference and revision

Payroll verifies the current locked revision, source digest and lock timestamp before bridging the snapshot. A later live OT change cannot silently mutate historical Payroll input. Any change requires the controlled Timesheet reopen/revision workflow.

Freeze verdict: PASS.

## 13. Minimum Real Device Path

### Fully mobile target requested by UAT

```text
Employee iPhone
→ Staff App /staff/roster: confirm 09:00–18:00 roster
→ Staff App Home Today card: clock in
→ clock out after scheduled end

System
→ final attendance result
→ Potential OT candidate

Manager Android Staff App
→ no OT approval route
```

This path is blocked at the Manager Staff App step.

### Shortest currently executable hybrid path

```text
Employee iPhone
→ /staff/roster: confirm roster
→ /staff Home Today card: Clock In at 09:00
→ /staff Home Today card: Clock Out at 19:00

System
→ attendance final result
→ approximately 60 minutes Potential OT

Authorised Manager / HR on Desktop
→ /team/approvals
→ Review potential OT
→ /team/attendance/timesheets?month=2026-08#overtime-review
→ Approve full OT or Adjust / Reject with reason

Employee iPhone
→ /staff/timesheet
→ My overtime
→ confirm approved/adjusted/rejected state and approved minutes

Desktop HR
→ same Monthly Timesheet overtime review section
→ read-only verify approved OT input
→ resolve every remaining OT item before later Timesheet Lock
```

If attendance produces an exception instead of a final result, the existing attendance-resolution workflow must finish first; the OT candidate derives only from the latest final result.

## 14. Required Test Data

Minimum safe UAT fixture, using existing Testing data:

| Field | Value |
|---|---|
| Employee | Twilio OTP QA Staff (`TWILIO-OTP-QA`) |
| Employee device | iPhone |
| Manager | Real Device UAT Manager (`EMP-005`) |
| Manager device | Android, but Desktop browser is required for current OT decision |
| Business | Royal Salon |
| Branch | salon online |
| Roster date | 27 Aug 2026 (or 28 Aug 2026) |
| Shift | Real Device UAT Shift |
| Shift start | 09:00 MYT |
| Shift end | 18:00 MYT |
| Planned clock-in | 09:00 MYT |
| Planned clock-out | 19:00 MYT |
| Existing unpaid break | 60 minutes |
| Expected potential OT | approximately 60 minutes |

There is no minimum OT threshold or rounding interval in the canonical OT derivation service. A full 60-minute overrun is nevertheless recommended because it is easy to verify and avoids ambiguity from device/network timestamps.

## 15. Blockers

### Blocking the requested all-mobile Real Device path

1. No Manager Staff App OT approval surface.
2. The Manager mobile approval domains currently include only Leave and Claims.

### Not blockers

- Suitable employee: available.
- Suitable published roster: available for 27 and 28 Aug 2026.
- Candidate generation: implemented.
- Employee visibility: implemented at `/staff/timesheet`.
- Desktop approve / adjust / reject: implemented.
- Business, branch, and permission scope for the existing Manager: ready.
- Payroll approved-only boundary: implemented.
- Timesheet freeze: implemented.

## 16. Final Verdict

```text
BLOCKED
```

Reason: the requested Employee iPhone + Manager Android Staff App OT approval path cannot be completed because the Manager Staff App has no OT approval route. The current canonical workflow is otherwise ready for a hybrid real-device UAT using the Employee iPhone and an authorised Desktop Manager/HR.

No data was created or changed. Production was not touched.

## Evidence Index

- `prisma/schema.prisma`
- `prisma/migrations/20260818220000_attendance_overtime_approval/migration.sql`
- `src/lib/attendance/overtime-service.ts`
- `src/lib/attendance/timesheet-service.ts`
- `src/lib/attendance/employee-timesheet.ts`
- `src/app/staff/timesheet/page.tsx`
- `src/lib/staff-pwa/team-approvals.ts`
- `src/app/staff/approvals/page.tsx`
- `src/app/staff/approvals/[domain]/[requestId]/page.tsx`
- `src/app/(business)/team/attendance/timesheets/page.tsx`
- `src/app/(business)/team/attendance/timesheets/actions.ts`
- `src/lib/approvals/service.ts`
- `src/lib/business-groups/capabilities.ts`
- `src/lib/payroll/timesheet-bridge.ts`
- `src/lib/payroll/attendance-integration.ts`
- `src/lib/payroll/service.ts`
- `tests/integration/payroll-p6a-overtime-approval.test.ts`
- `tests/integration/attendance-monthly-timesheet.test.ts`
- `tests/unit/attendance-payroll-timesheet-bridge.test.ts`
- `docs/TETAMU_HR_PAYROLL_REAL_DEVICE_UAT_FIXTURE_PREPARATION.md`
