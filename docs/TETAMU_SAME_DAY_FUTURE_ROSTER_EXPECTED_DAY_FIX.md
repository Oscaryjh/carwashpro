# TETAMU Same-Day Future Roster / Expected Day Classification Fix

## 1. Executive Summary

Testing 的 canonical Roster 发布逻辑已修复：同一天是否属于 retrospective 不再按日期整体判断，而是按 `membershipId + workDate` 的具体 assignment，并以分店时区下的实际 shift start instant 判断。修复已部署到 Railway Testing；`UAT-PAYROLL-001` 的新 revision 3 已通过 canonical Roster workflow 发布为 27 Aug 2026 16:50–17:20 MYT、break 0，Expected Day 已自然生成为 `CURRENT / WORKDAY / ROSTER`。Production 未触碰，Attendance、OT、Timesheet 与 Payroll 逻辑均未修改。

## 2. UAT Failure Evidence

- Employee: Real Device Payroll UAT Staff (`UAT-PAYROLL-001`, `+60128793848`)
- Business / Branch: Royal Salon / salon online
- Roster period: `d27b4a99-c996-4259-8938-4a5689b79a90`
- Existing publication revision 2: `454ceb54-787e-48f6-aeb4-53bf387a00b2`
- Existing target snapshot: `5c827344-b7ba-483f-9096-6c51c3b46bfa`
- Failure: a same-day shift whose own start time was still in the future was emitted as retrospective and did not materialise a current Expected Day.

## 3. Root Cause

`src/lib/roster/service.ts` previously collected historical state in a date-only `Set<string>`. When any employee assignment on a date had already started, the entire date was marked historical, so another employee's same-day future assignment inherited retrospective treatment. The defect was therefore canonical roster evidence classification scope, not OT, Attendance, Payroll, Leave, or timezone conversion.

Root cause classification: **cross-employee date-scope contamination caused by date-only retrospective keys**.

## 4. Timezone Handling

- Authoritative timezone: branch attendance timezone, falling back to business timezone.
- Testing branch: `Asia/Kuala_Lumpur`.
- Shift instants continue to be constructed with canonical `parseBranchLocalDateTime`.
- Classification compares absolute `Date` instants after the branch-local shift has been resolved; UTC and MYT representations therefore describe the same boundary.

## 5. Retrospective Classification Rule

The helper in `src/lib/roster/retrospective-classification.ts` applies:

1. Work date before branch-local today → retrospective.
2. Work date after branch-local today → future.
3. Same-day `WORK_SHIFT` with start time → retrospective only when `now >= startAt`.
4. Same-day non-work assignment or invalid missing shift start → protected as retrospective.
5. Classification key → `${membershipId}:${workDate}`.

Exact start boundary is intentionally retrospective.

## 6. Same-Day Future Behavior

When `now < shiftStart`, the assignment is `APPLIED`, not retrospective. Publication materialises or supersedes Expected Day evidence through the existing service; no direct Expected Day write was introduced.

## 7. Same-Day Past Behavior

When `now > shiftStart`, the assignment remains protected as retrospective. Changes continue through the existing retrospective review and timesheet safeguards.

## 8. Exact Boundary

At `now === shiftStart`, the assignment is retrospective (`now >= shiftStart`). This prevents an assignment from being rewritten at the instant it becomes operational attendance evidence.

## 9. Expected Day Materialisation

Post-deploy verification for publication revision 3:

- Published assignment: `ce4d426d-3b11-45bb-9a59-73b1598c433a`
- Evidence disposition: `APPLIED`
- Expected Day: `0e4c8353-fc3d-4c75-be05-68f3d9e3a72b`
- Kind: `WORKDAY`
- Source: `ROSTER`
- Status: `CURRENT`
- Revision: 1
- Expected start/end: 27 Aug 2026 16:50–17:20 MYT

## 10. Existing Revision Preservation

Publication revision 2 remains preserved and was not rewritten. The canonical amendment produced revision 3 (`ebce5625-415c-4a08-8ebd-ce8afefe902b`). No historical publication, snapshot, or Expected Day row was patched directly.

## 11. Tests

- New unit boundary coverage: 5/5 passed.
- Targeted Roster integration coverage: 5/5 passed.
- Same-day future, started, exact boundary, tomorrow, yesterday, midnight/MYT/UTC equivalence, and employee-scoped keys are covered.
- Integration proves a started shift for employee A does not make employee B's future shift retrospective.

## 12. Regression

- Relevant Roster / Attendance / OT / mobile OT unit tests: 39/39 passed.
- Relevant Roster / Attendance / P2 / Timesheet / OT integration tests: 17/17 passed.
- Full unit suite: 1213/1213 passed.
- TypeScript: PASS.
- ESLint: PASS with 0 errors and 3 pre-existing unrelated warnings.
- `git diff --check`: PASS.
- Production build: PASS (Next.js 16.3, 142/142 static pages generated).
- Attendance, OT formula, Leave, Claims, Timesheet lock, Payroll, PCB, and statutory code were not changed.

## 13. Testing Deployment

- Service: `tetamu-pos-web`
- Environment: `testing`
- Deployment: `19f21a8c-c89c-4f35-953e-74adca6dbda2`
- Result: SUCCESS
- Health: `ok=true`, database `ready`
- Testing URL: `https://tetamu-pos-web-testing.up.railway.app`
- Production touched: NO

The deployment was built from an isolated worktree containing the current release plus only the roster classification fix and its tests, so unrelated dirty-worktree changes were not deployed.

## 14. Post-Deploy Fixture Preparation

Before mutation, Testing was checked for the target employee/date. No approved Leave, Attendance session, Attendance final result, P2 final result, OT review, locked Timesheet entry, or Payroll attendance snapshot conflict existed. At 16:23:12 MYT-equivalent evaluation time, publication revision 2's 16:30 start was still future.

Canonical preparation result:

- Employee: `UAT-PAYROLL-001`
- New publication revision: 3
- Shift: 27 Aug 2026, 16:50–17:20 MYT
- Break: 0 minutes
- Reason: `REAL_DEVICE_OT_UAT_TESTING_ONLY`
- Expected Day: `CURRENT WORKDAY`
- Direct Attendance/OT/Expected Day/Timesheet/Payroll writes: NONE

## 15. Human OT UAT Next Step

The employee must use the real Staff App and perform the remaining actions as a human:

1. Clock In at approximately 16:50 MYT.
2. Clock Out after approximately 17:20 MYT, late enough to create the intended potential OT evidence under the existing policy.
3. Manager `EMP-005` (`+601151300932`) reviews the result at `/staff/requests/overtime`.
4. Employee checks `/staff/timesheet`.

No Clock In, Clock Out, Potential OT, OT review, approval, Timesheet lock, or Payroll action was automated in this task.

## 16. Final Verdict

**READY FOR HUMAN OT TEST**

The canonical defect is fixed, Testing is deployed, revision 2 is preserved, revision 3 is a future applied assignment, and its Expected Day is a current roster workday. Real-device OT UAT is not yet passed because the required human clock actions have not occurred.
