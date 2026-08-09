# Attendance P2 — Attendance Resolution Workflow

## A. Objective

Attendance P2 resolves ambiguity before any future Payroll consumption:

`raw attendance → exception → resolution → final attendance result → monthly timesheet → approval → lock`.

This phase stores time and classification evidence only. It does not calculate pay, deductions, overtime rates, statutory amounts, or disciplinary penalties.

## B. Existing Attendance Audit

| Classification | Repository finding |
| --- | --- |
| CURRENTLY IMPLEMENTED | Immutable punch/GPS facts, branch timezone settings, duplicate/idempotency controls, employee OTP/device sessions, attendance sessions, employee explanation, manager session resolution, immutable versioned final session results, branch-scoped monthly Timesheet and immutable locked revisions. |
| PARTIAL | Existing resolution and Timesheet were session-centred; a day with no punch had no record. Existing Timesheet combined approval and lock. Leave was separate and not linked to an Attendance day result. |
| MISSING BEFORE P2 | Expected-attendance evidence, no-attendance/no-show distinction, late/early rules, daily P2 outcome, independent approval, correction frequency warning, and P2 readiness. |
| LEGACY | `AttendanceResolutionCase`, `AttendanceFinalResult` and session revision entries remain supported. No destructive backfill is performed. |
| RISK | There is no complete roster/scheduling domain. P2 therefore accepts only explicit, versioned expected-attendance evidence and never invents a schedule. |

## C. Raw Attendance Model

`AttendancePunch` remains the append-only fact source for server/device timestamps, coordinates, accuracy, geofence result and source. `EmployeeAttendance` and its punch links retain all split/multiple-punch facts. P2 corrections create request, resolution and final-result records; they do not update raw punches.

## D. Expected Attendance Source

`AttendanceExpectedDay` is the minimal schedule boundary. It records employee, branch, work date, kind, expected start/end, grace, timezone, policy snapshot, source and revision. Supported sources are roster, fixed schedule, branch pattern and manual evidence. A new version supersedes the old version; the old facts remain immutable.

This is intentionally not a roster module. Without a current `WORKDAY` record, no-show is unavailable (`NO_SHOW_NOT_AVAILABLE_WITHOUT_ROSTER`).

## E. Exception Domain

`AttendanceP2Exception` separates detected interpretation from raw facts. It holds an immutable evidence snapshot and source digest while allowing controlled status/revision transitions. Open, pending-employee and pending-manager states are Timesheet blockers. Resolved and closed history cannot be deleted.

## F. Exception Types

P2 adds `MISSING_CLOCK_IN`, `MISSING_CLOCK_OUT`, `LATE_ARRIVAL`, `EARLY_DEPARTURE`, `NO_ATTENDANCE_RECORDED`, `SUSPECTED_NO_SHOW` and `LEAVE_ATTENDANCE_CONFLICT`. Existing P1 GPS, wrong-branch, rapid/duplicate punch and missed-break handling remains unchanged.

## G. Resolution Workflow

The deterministic detector reads raw day facts, expected evidence, approved Leave context and policy values. An employee may propose a missing time and reason. An authorized manager records `AUTHORIZED`, `UNAUTHORIZED`, `CORRECTED`, `SCHEDULE_ERROR`, `NOT_SCHEDULED`, `APPROVED_LEAVE` or `EXCLUDED`, with reason, actor and timestamp. Resolutions are append-only and use optimistic revision checks inside serializable transactions.

## H. No-Attendance Rules

No punch plus no schedule produces the blocking `NO_ATTENDANCE_RECORDED` exception. It never creates Leave and never selects paid/unpaid treatment. Manager resolution is required.

## I. No-show Evidence Rule

Only current `WORKDAY` evidence with valid expected start/end can produce `SUSPECTED_NO_SHOW`. Missing schedule evidence cannot prove that an employee was expected to work.

## J. Missing Punch

A day with only one side of attendance produces `MISSING_CLOCK_IN` or `MISSING_CLOCK_OUT`. The request stores the employee’s proposed time separately. Approval produces a correction resolution and a new final result; it does not overwrite the recorded clock fact.

## K. Late / Early

Late compares actual first-in with expected start plus the evidence-snapshot grace period. Time within grace is not late. Early departure compares actual last-out with expected end. Neither rule runs without its required expected time, and neither classification is Leave or a pay deduction.

## L. Leave Integration

Attendance reads only an approved `LeaveRequestDay` and its immutable `payTreatmentSnapshot`. Approved Leave without attendance can produce `APPROVED_PAID_LEAVE` or `APPROVED_UNPAID_LEAVE`. Approved Leave plus a punch produces `LEAVE_ATTENDANCE_CONFLICT`. Attendance cannot change the selected Leave policy/type or its paid/unpaid treatment.

## M. Employee Self-Correction

Staff authentication restricts a request to the authenticated business and membership. The employee can submit suggested clock-in/out and a reason for their own missing-punch exception only. They cannot update facts, resolve the exception or approve the result.

## N. Correction Abuse Controls

Every request and review remains auditable. Three or more approved corrections in one month produces `REPEATED_CORRECTION_WARNING`. This is a configurable/extensible warning boundary, not an automatic penalty, fine or payroll deduction.

## O. Final Attendance Result

`AttendanceP2FinalResult` is one immutable employee/day version with outcome, expected/factual times, worked/break minutes, Leave reference, source digest and resolution digest. New evidence produces a superseding version. Raw, exception and final states therefore remain distinct.

## P. Monthly Timesheet

Monthly readiness batches legacy session results with P2 open exceptions and the latest P2 daily results. Branch readiness is tied to a digest of current evidence and becomes stale when evidence changes. A locked revision snapshots both legacy entries and P2 day results.

## Q. Approval / Lock

Status flow is `DRAFT → APPROVED → LOCKED`. Approval requires whole-business scope, all branches ready and zero blockers, and stores approver, reason, timestamp, revision and source digest. Lock is a separate action and refuses an unapproved or stale approval. Neither action generates Payroll.

## R. Reopen

An approved or locked Timesheet may be reopened only by whole-business Attendance authority with a reason. Reopen returns the live month to draft, clears current approval evidence and branch readiness, and writes audit history. Prior locked revisions and snapshots remain immutable.

## S. Policy / Historical Safety

Expected day, grace, timezone, Leave treatment, source digest and final result are snapshotted. Locked Timesheet day rows reference an exact final-result version and do not recompute from mutable live policy. Existing locked legacy revisions are not rewritten.

## T. Permissions

Manager reads require `VIEW_ATTENDANCE_EMPLOYEES`; writes require `MODIFY_ATTENDANCE_EMPLOYEES`. Whole-company approve/lock/reopen also requires full active-branch scope. Staff endpoints use employee session/device authentication and self scope. A linked staff user cannot approve their own membership’s exception.

## U. Tenant / Branch / Group Isolation

All queries bind trusted business ID and authorized branch IDs. Database membership, expected evidence, exception, resolution, final-result and snapshot foreign keys/checks preserve business scope; branch/business composite keys prevent cross-tenant references. Group access is resolved to business and branch capabilities before service calls.

## V. Timezone / Overnight

Expected evidence carries an IANA timezone snapshot, and work date is an explicit date rather than server-local “today.” Expected start/end may cross midnight; next-day clock-out is compared with the same work-date evidence and is not classified as missing merely because the UTC date changed. Overnight evidence receives a review warning. Full shift/roster generation remains deferred.

## W. Audit / Concurrency

Expected versions, employee requests, manager resolutions, approvals, locks and reopens write audit entries. Detection uses a stable SHA-256 key over tenant, employee, date, type and source digest. Resolution uses expected revision plus serializable transactions. Database triggers prevent hard delete and mutation of historical evidence.

## X. Tests

Unit coverage includes no schedule/no punch, scheduled no punch, no automatic unpaid Leave, missing punch, grace, late, early, Leave conflict, rest day/holiday/not scheduled, correction warning, overnight and detector idempotency. Integration coverage verifies approval is distinct from lock, blocker/readiness rules, immutable revisions and Payroll preservation. Completion also runs TypeScript, lint, production build, local migration rebuild, canonical guard and `git diff --check`.

## Y. Deferred to Payroll P5

Payroll P5 may consume only an approved and locked Timesheet revision. Pay effects, overtime qualification/rates, rest-day/public-holiday rates, absence deductions and daily/hourly payroll policy are explicitly deferred. Attendance P2 exports classifications and minutes, never money.

## Z. Completion Gate

Attendance P2 is ready only if the full raw → exception → resolution → final result → Timesheet → approval → lock chain, access controls, immutability, local migration rebuild and all validation commands pass. Otherwise it is reported as partially ready. Payment P3A remains stopped with `PUBLIC_BANK_SPEC_NOT_READY`, and this phase does not enter Payroll P5.
