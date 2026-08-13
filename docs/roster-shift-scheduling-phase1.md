# Tetamu Roster / Shift Scheduling Phase 1

## A. Objective

Phase 1 provides branch-scoped weekly and monthly roster planning, immutable publication revisions, Staff self-service schedule visibility, and a controlled bridge into the existing `AttendanceExpectedDay` evidence model. It is planning evidence only; it does not calculate Attendance, Timesheet or Payroll.

## B. Existing Audit

Before this phase, `/team?section=schedule` represented appointment-booking availability for legacy `User` records. It was not an employee roster. Attendance P2 already provided versioned `AttendanceExpectedDay`, safe `NO_ATTENDANCE_RECORDED` behaviour, suspected No-show only for explicit `WORKDAY`, Leave linkage, monthly Timesheet locking and Payroll P5 consumption of locked Timesheets. Those boundaries remain canonical.

## C. Roster Domain

`RosterPeriod` is one business/branch/Monday week. Mutable `RosterAssignment` rows form the current Draft. `RosterPublication` and `RosterPublishedAssignment` form immutable, versioned history. The Phase 1 single-interval expected-day architecture deliberately blocks a second employee assignment on the same date.

## D. Module / Capability Boundary

Roster belongs to the existing HR entitlement; no commercial ROSTER module was added. Manager capabilities are `VIEW_ROSTER`, `CREATE_ROSTER`, `EDIT_ROSTER`, `PUBLISH_ROSTER`, `AMEND_PUBLISHED_ROSTER`, and `MANAGE_RETROSPECTIVE_ROSTER`. Staff permissions map to the same HR boundary. HR-only businesses do not need POS or Payroll.

## E. Roster Period

Periods are branch-specific and always start on Monday. A unique business/branch/week constraint prevents duplicate periods. `draftRevision` provides optimistic edit concurrency and `publicationRevision` identifies the latest public view.

## F. Shift Assignment

Phase 1 supports `WORK_SHIFT`, `REST_DAY`, and `NOT_SCHEDULED`. Work shifts require start/end, accept an unpaid planning break, and are limited to a conservative maximum of 24 hours. Scheduled duration is not paid duration or overtime.

## G. Branch / Timezone

Every write verifies the trusted business and allowed branch scope, active employee branch assignment and employment dates. Publication snapshots the branch Attendance timezone, falling back to the business timezone; no Roster domain timezone is hard-coded.

## H. Rest / Off / Unspecified

Explicit Rest publishes `REST_DAY`; explicit Off/Not Scheduled publishes `NOT_SCHEDULED`. A blank cell publishes no evidence and never becomes Rest, Off or Workday. No roster plus no punch therefore remains `NO_ATTENDANCE_RECORDED`.

## I. Draft

Draft writes only `RosterAssignment`. They never write or materialize Attendance, never appear in Staff App, and never alter the last published revision.

## J. Publish

Publish runs in a retryable Serializable transaction. It freezes the complete branch-week snapshot, versions current Roster-owned expected evidence, writes the immutable publication and AuditLog, and moves the period to Published atomically.

## K. Published Revision

Every publication has a monotonic revision, operation key and SHA-256 source digest. Database triggers reject update/delete of publications and snapshots. Editing after publication returns the period to Draft while Staff continues reading the previous publication until the next Publish.

## L. AttendanceExpectedDay Integration

Only current latest published snapshots with `APPLIED` disposition create the existing `AttendanceExpectedDay`: Work Shift → `WORKDAY`, Rest → `REST_DAY`, Not Scheduled → `NOT_SCHEDULED`. Evidence references contain publication and snapshot identity. Removed future assignments supersede only the precise prior Roster-owned evidence; non-Roster evidence is not blindly overwritten.

## M. No-show Safety

Roster does not create Attendance exceptions or final outcomes. Attendance P2 continues to derive suspected No-show only from current explicit `WORKDAY`; an absent roster remains no-evidence and cannot become No-show.

## N. Retrospective Safety

Past or already-started dates require the dedicated retrospective capability and a reason. Their published snapshots use `RETROSPECTIVE_REVIEW_REQUIRED`, do not write automatic expected evidence, and are audited. This records schedule history without manufacturing a disciplinary Attendance outcome.

## O. Leave Interaction

Approved full-day Leave blocks publication of an overlapping Work Shift. Leave type and paid/unpaid snapshots remain owned by Leave. Half-day semantics are not guessed. Pending Leave remains a review concern and is not converted by Roster.

## P. Public Holiday

Roster does not own a holiday calendar. If authoritative current `PUBLIC_HOLIDAY` evidence exists and a Work Shift is published, the new `WORKDAY` evidence preserves the prior holiday identity/source/revision inside `publicHolidayContext`. Both facts remain available without any rate calculation.

## Q. Copy Week

Copy Week reads the prior latest published snapshot and creates new Draft rows with new identities and shifted dates/times. It requires an empty target, rechecks employee/branch eligibility and approved Leave, and does not affect Staff or Attendance until Publish.

## R. Bulk Assignment

Manager UI can apply one explicit assignment to multiple selected employees for one date. The service validates every row and commits all rows plus one draft revision atomically. It performs no automatic scheduling.

## S. Conflict Detection

Database and service constraints prevent duplicate employee/day assignments, cross-tenant references, out-of-week rows and invalid shift shapes. Service overlap checks compare absolute start/end instants across branches and adjacent dates, so an overnight shift also blocks a conflicting next-day shift. Since Attendance P2 currently holds one expected interval per employee/day, `MULTIPLE_SHIFT_SAME_DAY` is intentionally blocked rather than ambiguously merged. Overnight shifts are supported.

## T. Employee Staff App

`/staff/roster` displays Today and weekly own-data schedule using only each period's latest publication. It shows branch, start/end, break, Rest or Not Scheduled. Missing rows say “No published schedule available” and explicitly avoid inferring Off Day. The Staff home card links to the same source.

## U. Permissions / Tenant

Manager queries use existing Attendance branch scope plus HR entitlement and Roster capabilities. Staff queries bind trusted Employee session `businessId + membershipId`. Composite business foreign keys and scope triggers reject cross-business branch, employee, period, publication and snapshot references.

## V. Idempotency / Concurrency

`businessId + operationKey` makes Publish idempotent. Draft revision checks prevent lost updates. Serializable retry handles database write conflicts. Concurrent Publish can produce only one canonical revision/operation result.

## W. Reconciliation

The reconciliation reader compares latest `APPLIED` snapshots against current expected-day source, membership, branch, date, kind, time, timezone and evidence reference. It reports missing, mismatched and stale Roster evidence. Past disciplinary evidence is never auto-repaired.

## X. Tests / Browser / Regression

Targeted unit and Local transaction-rollback integration tests cover Draft isolation, work/rest/blank semantics, overnight validation, immutable publication revision, ExpectedDay versioning, holiday context, approved Leave conflict, Copy Week, idempotency, own-data reads, tenant/branch scope, retrospective safety and locked Timesheet protection. Full gates include Unit, Integration, TypeScript, lint, Prisma validate/generate, migration status, fresh rebuild, production-mode Local build, browser console and 390px checks.

## Y. Deferred Phase 2

Deferred: shift swap/trade, availability, open shifts, recurring templates, minimum staffing, auto/AI scheduling, reminders/WhatsApp notifications and employee acceptance. Multiple same-day shifts remain explicitly blocked until expected-attendance semantics support multiple intervals safely.

## Z. Final Status

Phase 1 is ready only when all repository, migration, browser and regression gates pass. Production is outside scope and is neither accessed nor validated.
