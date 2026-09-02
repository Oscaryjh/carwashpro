# TETAMU — Manager Staff App OT Approval Surface

Date: 27 Aug 2026  
Environment: Testing only  
Production touched: No

## 1. Executive Summary

The Manager Staff App now exposes Attendance-derived overtime review without introducing an employee OT request workflow. Authorized managers can review, approve, adjust, or reject a canonical overtime candidate from the Staff App. All decisions continue through the existing Attendance overtime service and remain subject to tenant, branch, self-approval, locked-timesheet, stale-source, and optimistic-revision guards.

Automated verification passed across the new Staff surface, the existing mobile approval surface, canonical Timesheet/Payroll boundaries, the full unit suite, the disposable integration suite, TypeScript, ESLint, and production build. Human iPhone and Android retesting remains required because no Testing OT fixture was created for this engineering task.

## 2. Existing Gap

Before this change, the canonical OT decision service and Desktop review capability existed, but a Manager using the Staff App had no dedicated OT queue or mobile decision surface. Employees could view frozen overtime information in `My overtime`, while managers had to leave the Staff App to make a decision.

## 3. Canonical OT Architecture

The implementation reuses:

- `deriveOvertimeCandidate` in `src/lib/attendance/overtime-service.ts`
- `listAttendanceOvertimeCandidates` in `src/lib/attendance/overtime-service.ts`
- `decideAttendanceOvertime` in `src/lib/attendance/overtime-service.ts`
- `AttendanceOvertimeReview` in `prisma/schema.prisma`
- `AttendanceOvertimeReviewEvent` in `prisma/schema.prisma`

No second OT table, employee OT request model, or Staff-specific approval state was added.

## 4. Staff Route

- Queue: `/staff/requests/overtime`
- Detail: `/staff/requests/overtime/[finalResultId]`
- Manager entry point: `/staff/requests`
- Employee read-only route: `/staff/timesheet`

The Overtime card is returned only when the current Staff actor resolves to the required manager capability.

## 5. Queue

The queue is implemented by `getStaffOvertimeQueue` in `src/lib/staff-pwa/overtime-approvals.ts` and rendered by `src/app/staff/requests/overtime/page.tsx`.

It shows the employee, local work date, scheduled span, actual span, potential OT, context, and current review status. Pending items appear before recently decided items. Results are constrained to the authenticated business and authorized branches, and the actor's own employee result is omitted.

## 6. Detail

The detail route renders the immutable Attendance facts needed for a decision:

- employee and branch
- scheduled and actual start/end
- worked and break minutes
- derived potential OT
- source context and review status
- Timesheet state
- expected review revision

Locked or conflicted records show a blocking explanation instead of pretending the action succeeded.

## 7. Approve

`decideMobileOvertimeAction` submits `APPROVE` to `decideStaffOvertime`, which delegates to `decideAttendanceOvertime`. Approval accepts the full currently derived OT candidate. No client-provided total can replace the canonical candidate.

## 8. Adjust

Adjustment requires approved minutes and a reason. The same canonical decision service validates the value and appends the review event. The action includes the expected revision to reject concurrent edits.

## 9. Reject

Rejection requires a reason and delegates to the canonical decision service. It creates an append-only review event and does not delete the Attendance-derived candidate.

## 10. Permissions

Every request is reauthenticated with `requireEmployeeSelfServiceAuthContext`. Manager access resolves through `resolveStaffOvertimeAccess` and requires:

- active linked Staff identity
- enabled HR module
- Business Owner authority, or Staff capability `MODIFY_ATTENDANCE_EMPLOYEES`
- the existing permission mapping from `ATTENDANCE_EMPLOYEE_MANAGE`

The browser UI is not treated as authorization.

## 11. Self Approval

Self-review is excluded from the queue and rejected again by the canonical service with `SELF_APPROVAL_NOT_ALLOWED`. Result: deny.

## 12. Branch Scope

Branch-scoped managers receive only active assignments within their authorized branches. A direct URL outside scope fails closed through `OUTSIDE_BRANCH_SCOPE`. Result: pass.

## 13. Business Scope

All lookups include the authenticated Business ID. Cross-business final results and review records are not returned. Result: pass.

## 14. Lock Protection

An Attendance month whose Timesheet is locked cannot receive a new OT decision. The canonical service returns `TIMESHEET_LOCKED`; the Staff surface converts it to a safe user-facing message. Result: deny.

## 15. Concurrency

Each decision submits `expectedRevision`. If another reviewer has already written a decision, `CONCURRENT_CHANGE` is returned and the user is asked to reload. A changed source digest is treated as stale instead of silently approving old Attendance facts. Result: deny stale/concurrent writes.

## 16. Employee Visibility

Employees continue to use `/staff/timesheet` and see read-only overtime state. No `Submit OT`, employee approval, or editable OT total was introduced. Result: pass.

## 17. Timesheet Boundary

Pending or stale overtime remains part of canonical monthly readiness. Locked Timesheets are immutable, and later correction must follow the existing reopen/revision workflow. The Staff surface does not bypass Timesheet readiness.

## 18. Payroll Boundary

Payroll continues to consume only reviewed/frozen overtime facts. `src/lib/payroll/attendance-integration.ts` uses the canonical review approval and revision boundary; the Staff route does not write Payroll values. Result: pass.

## 19. Mobile UX

The queue and detail use compact cards, wrapped facts, single-column narrow layouts, no horizontal overflow, minimum 44px touch targets, and bottom spacing that includes `env(safe-area-inset-bottom)`. Source-contract checks cover 375px, 390px, and 430px rules. Loading, empty, error, unauthorized, locked, and concurrent states are represented.

Human device verification is still required for real Safari/Chrome keyboard, viewport, and safe-area behavior.

## 20. Tests

New test: `tests/unit/staff-manager-overtime-approval.test.ts`

Covered contracts:

- capability-only navigation
- tenant/branch/self scope
- approve/adjust/reject canonical delegation
- lock/concurrency/stale guards
- employee read-only boundary
- Payroll approved-only boundary
- mobile widths and state surfaces

Targeted Staff/canonical suite: 16/16 passed.

## 21. Regression

- Main unit suite: 1165/1165 passed
- Disposable integration suite: 185/185 passed
- Staff Attendance API integration: 1/1 passed
- TypeScript: passed
- ESLint: 0 errors; 3 unrelated existing warnings
- `git diff --check`: passed
- Next production build: passed; both OT routes appear in the route manifest

## 22. Testing Deployment

Target service: `tetamu-staff-app`  
Environment: `testing`  
Deployment ID: `fda96e5b-8e86-4261-a10f-11a6ca84e56f`  
URL: `https://tetamu-staff-app-testing.up.railway.app`

Deployment status: `SUCCESS`  
Post-deploy health: `/api/health` returned HTTP 200.  
Post-deploy route precheck: both the queue and dynamic detail paths returned the deployed Next route surface; authentication and manager capability continue to be enforced server-side before data is read.

## 23. Human Real Device UAT

Required retest:

1. Employee iPhone clocks in on a published expected day.
2. Employee iPhone clocks out after scheduled end.
3. Manager Android opens Requests → Overtime review.
4. Manager confirms the facts and approves.
5. Employee iPhone opens My overtime and confirms the reviewed result.
6. Repeat with Adjust and Reject on separate legitimate candidates when available.

No fake OT candidate was created by this task.

## 24. Final Verdict

Engineering verdict: automated implementation and regression checks pass.  
Release verdict: **HUMAN REAL DEVICE RETEST REQUIRED**.

The remaining evidence is a real Testing manager/employee device transaction across Attendance → OT review → employee visibility. Production remains untouched.
