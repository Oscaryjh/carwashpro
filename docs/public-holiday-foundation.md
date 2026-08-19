# Public Holiday Foundation

## Purpose

Public Holidays are calendar and legal-context facts. They overlay the existing Roster, Leave, Attendance and Timesheet domains without becoming a second scheduling engine and without calculating payroll amounts.

```text
Public Holiday
!= Work Shift
!= Rest Day
!= Leave
!= Not Scheduled
```

An employee may still be rostered to work on a Public Holiday. The holiday label therefore never replaces the published shift or Attendance fact.

## Canonical model

`HolidayOccurrence` stores an immutable, auditable occurrence with:

- date and display name;
- `PUBLIC_HOLIDAY`, `COMPANY_HOLIDAY` or `SPECIAL_CLOSURE` type;
- `OFFICIAL` or `CUSTOM` source;
- `NATIONAL`, `STATE`, `BUSINESS` or `BRANCH` applicability;
- country, state/territory and optional branch jurisdiction;
- statutory marker and official source URL;
- active, superseded or cancelled status;
- revision chain, actor, timestamp and reason.

Official records require a source URL and cannot be deleted or cancelled. Corrections create a new revision and supersede the prior record. Custom records may be cancelled with a reason; prior audit evidence remains.

Legacy `PayrollHoliday` records remain readable during migration, but new management uses `HolidayOccurrence`.

## Applicability

Resolution is performed for an authorised Business and an active Branch:

- National: same country.
- State / territory: same country and state code.
- Business: every branch in the Business.
- Branch: exact branch only.

The resolver never infers jurisdiction from a branch name. Each branch stores canonical country and state/territory codes. The existing Attendance/Business timezone remains the time source; holiday configuration does not create a second timezone.

## Domain handoff

- Roster Month, Week, Staff, Coverage and Day views receive the same resolved holiday collection.
- A rostered shift remains visible on a holiday; the PH label is an overlay.
- Roster publication snapshots `publicHolidayContext` into `AttendanceExpectedDay.policySnapshot` with `payrollEffect: "NONE"`.
- Staff App displays the holiday beside the scheduled shift, Leave or safe “no work shift scheduled” state.
- Timesheet lock copies the expected-day holiday context into immutable revision/day snapshots. Worked minutes and holiday context are preserved as separate facts.
- No pay rate, allowance, multiplier, statutory entitlement or payroll amount is calculated by this foundation.

## Historical safety

Correcting a future/current holiday creates a new version. Previously locked Timesheet revisions keep their prior holiday-context snapshots. A later calendar correction therefore does not silently rewrite historical payroll input evidence.

## RBAC and tenant isolation

- Viewing uses the existing `VIEW_ROSTER` capability and authorised Attendance branch scope.
- Managing jurisdiction and occurrences uses `MANAGE_SHIFT_TEMPLATES` and the same authorised branch scope.
- Every query is scoped by `businessId`; branch-scoped writes require an allowed branch ID.
- Mutations write audit records and never mutate Roster, Attendance, Timesheet or Payroll amounts directly.

## Explicitly deferred

Cross-midnight shifts are supported by Roster and Attendance, but splitting one worked session at midnight into separate holiday/non-holiday hour segments is not represented as a canonical fact in this phase. Until a dedicated segmentation model exists, the system preserves the expected-day holiday context and worked minutes without claiming precise cross-date PH hours.

Also deferred:

- official government calendar API ingestion and automatic gazette updates;
- holiday substitution rules and observed-day automation;
- Public Holiday pay-rate calculation, payroll money and statutory interpretation;
- Production configuration, data migration and validation.

## Environment

This implementation and its validation are LOCAL / TESTING ONLY. Production is not accessed or validated.
