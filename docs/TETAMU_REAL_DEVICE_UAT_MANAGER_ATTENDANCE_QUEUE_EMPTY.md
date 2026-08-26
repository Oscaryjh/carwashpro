# TETAMU Real Device UAT — Manager Attendance Queue Empty

Date: 26 Aug 2026  
Environment: Testing only  
Affected route: `/staff/requests/attendance-corrections`

## Incident summary

The Android Manager session showed `0 waiting` even though attendance correction
`1103e43b-335b-4b45-95ca-b2026eb1fa05` was pending for an employee within the
same business and authorized branch.

## Final verdict

**FIXED — HUMAN ANDROID RETEST REQUIRED**

The server-side queue mismatch has been fixed and verified with automated tests
and a read-only Testing data precheck. A human must still reload the Testing
Staff App on Android and confirm that the item is visible. No approval or
rejection was performed during this investigation.

## Root cause

The pending correction was stored as a legacy `AttendanceException` with status
`PENDING` and type `FORGOT_CLOCK_OUT`. It had not yet been materialized as an
`AttendanceResolutionCase`.

The Staff App Manager queue queried only `AttendanceResolutionCase` records with
the newer review status. Therefore the server returned an empty queue. The
frontend did not receive and then discard the item.

## Read-only Testing evidence

| Check | Result |
| --- | --- |
| Pending correction ID | `1103e43b-335b-4b45-95ca-b2026eb1fa05` |
| Legacy exception status | `PENDING` |
| Exception type | `FORGOT_CLOCK_OUT` |
| Canonical resolution-case count before fix | `0` |
| Pending-exception projection count | `1` |
| Manager self-pending count | `0` |
| Employee business | `611b0c19-ebf7-4548-8a48-a3b6a7af8a81` |
| Employee branch | `41575966-238f-46ab-a114-22bbee4949c5` |
| Manager business | `611b0c19-ebf7-4548-8a48-a3b6a7af8a81` |
| Manager branch/scope | `41575966-238f-46ab-a114-22bbee4949c5` |
| Manager active session | `1164b559-aac0-4c3d-b175-b121db2a7574` |
| Manager membership | `3ed1909b-f624-49cb-9457-efecec9e776a` |
| Required attendance capability | Present |

## Minimal fix

1. Keep the canonical `AttendanceResolutionCase` queue unchanged.
2. Add a scoped projection for pending legacy `AttendanceException` records that
   do not already have a materialized resolution case.
3. Combine both sources into one Manager queue and one total waiting count.
4. Apply business scope, authorized branch scope and direct self-exclusion in the
   database query.
5. Route decisions for projected legacy items through the existing canonical
   `reviewAttendanceException` service; no parallel mutation path was created.

Files changed:

- `src/lib/attendance/resolution-read-service.ts`
- `src/lib/staff-pwa/team-approvals.ts`
- `src/app/staff/requests/attendance-corrections/page.tsx`
- `src/app/staff/requests/attendance-corrections/actions.ts`
- `tests/unit/staff-attendance-pending-exception-scope.test.ts`

Functional source commit:

`fd4157b fix(staff): include pending attendance exceptions`

## Scope and security verification

| Control | Result |
| --- | --- |
| Manager self-exclusion | PASS |
| Branch scope | PASS |
| Business scope | PASS |
| Legacy/new status mapping | PASS |
| Duplicate suppression | PASS |
| Frontend item filtering | Not involved |
| Cache/freshness root cause | Ruled out |
| Production touched | NO |
| Attendance data mutated | NO |
| Approval/rejection executed | NO |

## Automated verification

- TypeScript: PASS
- Targeted attendance queue tests: 13/13 PASS
- Full Staff App unit suite: 1169/1169 PASS
- ESLint: 0 errors (7 pre-existing warnings)
- Next.js production build with webpack: PASS
- `git diff --check`: PASS

The first local build attempt encountered a Windows Prisma DLL file lock. This
was an environmental lock from a running local process; the application compile,
type-check and static generation subsequently completed successfully.

## Human Android retest

Required steps after the Testing deployment succeeds:

1. Close or reload the Testing Staff App on the Manager Android device.
2. Sign in as **Real Device UAT Manager**.
3. Open **Requests → Attendance corrections**.
4. Confirm the page shows `1 waiting` and correction
   `1103e43b-335b-4b45-95ca-b2026eb1fa05`.
5. Stop without approving, rejecting, returning, clocking out or changing any
   attendance data during this queue-visibility retest.

Android visibility is not marked PASS until a human completes these steps.
