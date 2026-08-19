# Payroll P6B — Cross-Midnight Work Segmentation

## Status

`ENGINEERING READY` for Local / Testing. Production was not accessed or validated. P6C monetary calculation is intentionally deferred.

## Gap audit and closure

Before P6B, Attendance could preserve resolved clock events and Payroll could freeze attendance inputs, but an overnight session was still effectively treated as one record. It did not provide immutable, local-calendar-day facts for public-holiday, Rest Day, approved OT, leave-conflict, or reconciliation decisions.

P6B closes that gap with this canonical path:

```text
Resolved Attendance
  -> branch-timezone local date segmentation
  -> immutable locked Timesheet revision and segment digest
  -> Payroll attendance input snapshot
  -> six mutually exclusive minute summaries plus readable drill-down
```

## Canonical rules

- **Timezone:** the frozen branch timezone is authoritative. Invalid or missing timezone data blocks locking; UTC dates are never silently substituted.
- **Local midnight:** each resolved work interval is split at every local midnight, including DST/offset-aware boundaries supported by the timezone library.
- **Multi-day sessions:** segmentation supports up to eight local dates and conserves the exact source duration.
- **Breaks:** only resolved break intervals are used. Break minutes crossing midnight are split by the same local-day boundary. Paid breaks remain worked time; unpaid breaks reduce worked time. Missing or ambiguous break evidence blocks locking rather than being inferred.
- **Day context:** every segment is independently classified as Normal Day, Rest Day, or Public Holiday. Public Holiday is the primary bucket when Public Holiday and Rest Day overlap; the Rest Day overlap flag remains preserved for audit.
- **Leave conflicts:** any approved leave fraction combined with resolved worked minutes blocks the locked revision. Half-day conflicts are not guessed or auto-netted.
- **Approved OT:** P6A approval remains the sole OT truth. Approved minutes are allocated deterministically from the earliest eligible segment and can never exceed worked or potential OT minutes.
- **Conservation:** gross, break, worked, potential OT, approved OT, and regular minutes reconcile exactly. No minute can be counted in two primary payroll buckets.
- **Immutability:** the final segment digest is written once with the locked Timesheet revision. Reopen creates a new revision; historical locked segments remain unchanged.
- **Idempotency:** identical canonical inputs create the same stable segment facts and digest.
- **Legacy records:** Payroll refuses to silently reinterpret legacy locked inputs that have no P6B segment facts. The record must be reopened/rebuilt through the canonical workflow.

## Storage and frozen Payroll facts

`AttendanceTimesheetP2SegmentSnapshot` stores immutable per-local-date facts, including local date, UTC boundaries, timezone, day context, overlap indicators, duration, break, worked, potential OT, approved OT, regular minutes, leave-conflict evidence, source references, and stable digest.

`PayrollAttendanceInputSnapshot` freezes:

1. Normal Day Regular Minutes
2. Normal Day Approved OT Minutes
3. Rest Day Regular Minutes
4. Rest Day Approved OT Minutes
5. Public Holiday Regular Minutes
6. Public Holiday Approved OT Minutes

The six values are operational time facts only. P6B does not calculate rate multipliers, wages, RM amounts, statutory contributions, or net pay.

## UI behavior

- **Manager Timesheets:** overnight sessions show their local-date split, context, break, regular, and approved OT minutes before approval.
- **Staff App:** overnight shifts use a small `Overnight shift · DD/MM–DD/MM` label without exposing UTC timestamps or technical IDs.
- **Payroll:** the attendance snapshot shows the six readable totals and a per-date drill-down. UUIDs, raw enums, and UTC-only timestamps are not shown to ordinary users.

## Security, scope, and performance

- Existing business, branch, and payroll permissions remain authoritative; P6B introduces no scope bypass.
- Segment facts are batched when loading Timesheets and Payroll inputs to avoid per-row query expansion.
- Locks, Payroll snapshots, and reopen operations preserve existing audit and immutable-revision controls.

## Acceptance cases 74–96

| Case | Acceptance | Evidence | Result |
|---|---|---|---|
| 74 | Normal -> Normal overnight | segmentation unit test | PASS |
| 75 | Normal -> Public Holiday | segmentation unit + integration test | PASS |
| 76 | Public Holiday -> Normal | segmentation unit test | PASS |
| 77 | Normal -> Rest Day | segmentation unit test | PASS |
| 78 | Rest Day -> Normal | segmentation unit test | PASS |
| 79 | Rest Day -> Public Holiday overlap | segmentation and Payroll summary unit tests | PASS |
| 80 | Unpaid break crosses midnight | segmentation unit + integration test | PASS |
| 81 | Paid break remains worked time | segmentation unit test | PASS |
| 82 | Approved OT partially overlaps eligible work | segmentation unit test | PASS |
| 83 | Approved OT uses deterministic earliest allocation | segmentation unit test | PASS |
| 84 | Unresolved P6A decision blocks lock | P6A lock precondition regression | PASS |
| 85 | Full-day leave and worked time conflict | segmentation unit test | PASS |
| 86 | Half-day leave and worked time conflict | segmentation unit test | PASS |
| 87 | Invalid timezone fails closed | segmentation unit test | PASS |
| 88 | Multi-day session split | segmentation unit test | PASS |
| 89 | Exact duration conservation | segmentation invariants | PASS |
| 90 | Locked Timesheet persists immutable segment facts | P6B integration test | PASS |
| 91 | Payroll freezes exact six-bucket summary | P6B integration test | PASS |
| 92 | Reopen creates a new revision and preserves history | Attendance/P6A integration regression | PASS |
| 93 | Digest/reconciliation mismatch is rejected | Payroll snapshot unit test | PASS |
| 94 | Finalized Payroll remains immutable | existing Payroll integration regression | PASS |
| 95 | Tenant/branch/RBAC boundaries remain enforced | Attendance and P6A integration regressions | PASS |
| 96 | Branch timezone and Public Holiday fixture classification | P6B integration fixture | PASS |

## Final matrix

| Area | Status |
|---|---|
| Timezone handling | READY |
| Midnight split | READY |
| Multi-day split | READY |
| Day context and PH/Rest overlap | READY |
| Break segmentation | READY |
| P6A approved OT allocation | READY |
| Leave conflict fail-closed | READY |
| Immutable Timesheet segments | READY |
| Payroll six-bucket snapshot | READY |
| Reconciliation and idempotency | READY |
| Legacy compatibility guard | READY |
| RBAC / tenant / branch scope | READY |
| Manager / Staff / Payroll UX | READY |
| P6C monetary calculation | DEFERRED — NOT STARTED |

No fake historical backfill is performed. Existing legacy locked records must be reopened and rebuilt when P6B facts are required.
