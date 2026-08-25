# Tetamu POS — 2026-08-22 Development Handoff

> Purpose: Current-state handoff for another ChatGPT/Codex session.
>
> This document records what was actually changed in the Tetamu workspace on 22 Aug 2026. It distinguishes completed code, verified behavior, existing dependencies, and remaining blockers. It is not a production release note.

## 1. Snapshot and source of truth

- Workspace: `C:\CodexTetamuP0`
- Branch: `verification/pcb-2026-vc1`
- Base commit: `2981454`
- Date/time zone: 22 Aug 2026, Asia/Singapore
- Git state: dirty working tree; today's changes have not been committed, pushed, or deployed.
- There were no Git commits dated 22 Aug 2026. The scope below was reconstructed from current diffs, file modification times, implementation code, tests, and browser validation.
- Approximate full dirty-tree size at handoff: 101 tracked files changed, plus untracked files. Some dirty-tree changes pre-date today and are excluded from the “developed today” list below.

## 2. Executive summary

Today's work concentrated on seven product areas:

1. Roster month publishing and locked-Timesheet recovery UX.
2. Claims main-page and category-policy simplification.
3. Leave administration, request inbox, employee balance management, and policy/type UI.
4. Employee 360 Profile information architecture.
5. Staff App Mobile Team Approvals V1.
6. Desktop People & HR Action Center.
7. Small Employee Profile payroll/bank/read-model presentation refinements.

The key architecture decision was preserved throughout:

```text
Action Center / Staff App
        ↓ read and route
Canonical Leave / Claims / Attendance / Timesheet services
        ↓ validate and mutate
Existing domain records, revisions, audit trails and permissions
```

No new universal approval engine was introduced. No Leave, Claims, Attendance, Timesheet, Payroll, PCB, or statutory calculation core was rewritten today.

## 3. Roster — publish a whole month

### What was added

- A monthly publish action lets HR publish one calendar month from the Month view.
- The monthly operation translates the selected month into the required weekly roster evidence versions.
- Already-published weeks are skipped safely.
- Missing employee schedules are surfaced before publication.
- A month can report partial success when some weeks publish and another week is blocked.
- A locked monthly Timesheet now returns a human-readable recovery path instead of a raw workflow error.
- The error directs HR to Attendance → Monthly Timesheets to reopen the controlled revision, then return to publish the remaining weeks.

### Canonical boundary

- Roster still publishes versioned weekly evidence.
- Attendance remains the consumer of published roster evidence.
- Roster does not unlock or rewrite a Timesheet directly.
- Payroll is not recalculated by roster publication.

### Main code

- `src/app/(business)/team/roster/actions.ts`
  - `publishRosterMonthAction`
  - month validation and weekly boundary calculation
- `src/app/(business)/team/roster/page.tsx`
- `src/app/(business)/team/roster/roster.module.css`
- `src/lib/roster/service.ts`

### Test evidence

- `tests/unit/roster-shift-scheduling-phase1.test.ts`
- Verified behaviors include deterministic weekly evidence, blank-day semantics, overnight shift support, Month/Week/Staff views, and monthly publishing through weekly versions.

## 4. Attendance Monthly Timesheets — clearer controlled revision UX

### What changed

- Locked Timesheet messages were rewritten into HR-readable language.
- The UI now explains that reopening creates a controlled new revision and leaves the prior locked revision unchanged.
- Roster publication errors link to the correct month in Monthly Timesheets.
- Timesheet finalization remains a distinct task from ordinary approvals.

### Canonical boundary

- A finalized/locked Timesheet is not edited in place.
- `Reopen` creates a new revision.
- Old revisions remain available for audit.
- Locking Attendance does not automatically run Payroll.

### Main code

- `src/app/(business)/team/attendance/timesheets/page.tsx`
- Existing mutation remains `lockTimesheetAction` in `src/app/(business)/team/attendance/timesheets/actions.ts`.
- Existing service remains `lockMonthlyAttendanceTimesheet` in `src/lib/attendance/timesheet-service.ts`.

### Test evidence

- `tests/unit/attendance-monthly-timesheet.test.ts`

## 5. Claims — compact operational UX

### What changed

- Claims main page was reorganized into a more compact operational view.
- Technical policy wording was reduced on the daily HR screen.
- Category policy editing was separated into a dedicated form.
- Creating a category is intentionally simple.
- Updating an existing category retains the existing audit-reason requirement.
- Claim line decisions continue to support approved, partially approved, and rejected outcomes.
- Duplicate detection remains a warning fingerprint rather than silent mutation.
- Reimbursement treatment remains separate from gross wage and one-off earnings.

### Canonical boundary

- Claims approval confirms reimbursement eligibility.
- It does not mark a Claim paid.
- It does not directly add an earning to Payroll.
- Payroll/statutory treatment remains a separate downstream concern.

### Main code

- `src/app/(business)/team/claims/page.tsx`
- `src/app/(business)/team/claims/claims.module.css`
- `src/app/(business)/team/claims/actions.ts`
- `src/app/(business)/team/claims/claim-category-policy-form.tsx`
- `src/lib/claim/policy.ts`
- `src/lib/claim/service.ts`

### Test evidence

- `tests/unit/claims-reimbursements-foundation.test.ts`

## 6. Leave — administration, balance and request inbox UX

### What changed

- Leave administration now uses progressive disclosure and plain HR language.
- Daily work, policy work, and restricted maintenance operations are separated.
- Employee balance management opens in a modal/bottom-sheet card instead of navigating away.
- The modal is scrollable on desktop and becomes a mobile bottom sheet.
- HR can add or deduct an employee balance through the existing audited ledger path.
- The visible free-text reason field for balance adjustment was removed from the simplified modal; ledger/audit behavior remains in the service layer.
- Leave type creation is available from the management UI.
- Policy editing is available in a dedicated editor, including effective dates and statutory-minimum mapping.
- Leave request inbox is separated into three clear layers:
  - Pending approval
  - Approved
  - Closed / cancelled approved leave
- Request rows were compacted so a large number of requests remains scannable.
- Employee Profile Leave now links to the selected employee's managed balance card without losing employee context.
- Leave balance display uses ledger projections for entitlement, carry-forward, adjustments, usage, and remaining balance.

### Important behavior retained

- Rejection still requires a reason.
- Employee balance changes remain ledger-backed and audited.
- Generated entitlement and manual adjustments cannot double-credit the same source.
- Leave policy must have an effective version. If none exists, the service still blocks with `LEAVE_POLICY_NOT_READY`.
- Company starter policies do not pretend to be Malaysian statutory legal advice.

### Main code

- `src/app/(business)/team/leave/page.tsx`
- `src/app/(business)/team/leave/leave.module.css`
- `src/app/(business)/team/leave/actions.ts`
- `src/app/(business)/team/leave/leave-type-create-form.tsx`
- `src/app/(business)/team/leave/leave-policy-editor.tsx`
- `src/components/employee-leave-balance-modal.tsx`
- `src/components/employee-leave-balance-modal.module.css`
- `src/components/employee-profile-leave.tsx`
- `src/lib/leave/ledger-projection.ts`
- `src/lib/leave/service.ts`
- `src/lib/team/employee-profile-leave-read.ts`

### Test evidence

- `tests/unit/leave-management-modal-ux.test.ts`
- `tests/unit/leave-request-inbox-ux.test.ts`
- `tests/unit/leave-admin-simplification.test.ts`
- `tests/unit/leave-management.test.ts`
- `tests/unit/people-hr-entitlement-ux.test.ts`

## 7. Employee 360 Profile — purpose-led information architecture

### What changed

The employee workspace was consolidated into five purpose-led areas instead of many overlapping profile tabs:

1. Profile
2. Time
3. Leave & Claims
4. Pay
5. Access

Legacy deep links continue to resolve to the correct new area, so existing bookmarks do not need to be broken.

### Profile and navigation improvements

- Common identity and employment information is presented once instead of repeated across Overview, Personal, and Employment.
- Existing uploaded employee avatars are reused, with initials as fallback.
- Role and level editing remains inside the employee edit modal rather than duplicated on the People list.
- Employee-area navigation supports horizontal scrolling on narrow screens.
- Profile readers remain separated by capability and sensitivity.
- Leave balance management opens in context for the current employee.
- Payroll/bank and statutory reads remain capability-controlled.
- The Employee 360 composition does not create a second data source; it composes existing canonical readers.

### Main code

- `src/app/(business)/team/people/[personId]/page.tsx`
- `src/components/employee-profile-360.tsx`
- `src/components/employee-profile-section-nav.tsx`
- `src/components/employee-profile-shell.tsx`
- `src/components/employee-profile-shell.module.css`
- `src/components/employee-profile-phase2a.tsx`
- `src/components/employee-profile-payroll.tsx`
- `src/components/employee-profile-leave.tsx`
- `src/lib/team/employee-profile-tabs.ts`
- `src/lib/team/employee-profile-read.ts`
- `src/lib/team/employee-profile-bank-read.ts`
- `src/lib/team/employee-profile-statutory-read.ts`

### Security boundary retained

- Bank data remains subject to `VIEW_BANK_ACCOUNT` and whole-business access checks.
- Employee Profile does not expose sensitive plaintext by default.
- Core People data, Payroll data, and Statutory data use separate read paths.

### Test evidence

- `tests/unit/employee-profile-360-ia.test.ts`
- `tests/unit/employee-profile-shell.test.ts`
- `tests/unit/employee-profile-phase2a.test.ts`
- `tests/unit/employee-profile-phase2d.test.ts`
- `tests/unit/employee-bank-profile-p1.test.ts`

## 8. Employee Profile payroll presentation refinements

### What changed today

- Employee Profile payroll cards and dialogs were aligned with the new Employee 360 layout.
- Recurring-pay creation no longer asks HR to invent a technical stable code; the system creates a deterministic internal code.
- Payroll, bank, and statutory profile readers remain separate.
- Existing month-effective and revision behavior is preserved.

### Not changed today

- Payroll calculation engine was not rewritten.
- Payroll draft/finalization behavior was not redesigned.
- PCB formula/rule-pack development was not continued today.
- EPF/SOCSO/EIS/LINDUNG 24 calculation engines were not changed today.

### Main code and tests

- `src/components/employee-profile-payroll.tsx`
- `src/components/employee-profile-payroll-dialog.tsx`
- `tests/unit/payroll-p4a-recurring-pay.test.ts`
- `tests/unit/employee-bank-profile-p1.test.ts`

## 9. Staff App — Mobile Team Approvals V1

### What was added

- New Staff App route: `/staff/approvals`
- Mobile inbox limited intentionally to Leave and Claims.
- Compact All / Leave / Claims filters.
- Oldest-first ordering for actionable items.
- Dedicated request detail pages.
- Approve/reject actions reuse the canonical Leave and Claims mutation paths.
- Protected scoped download routes were added for:
  - Leave supporting documents
  - Claim attachments
- Loading state, empty state, safe errors, and 44px touch targets were added.

### Authorization and safety

- Access is capability-based, not role-name based.
- Tenant and authorized-branch scope are checked before data is returned.
- Self-approval is blocked.
- Existing stale/revision guards remain authoritative.
- Claim approval does not mark a reimbursement paid or inject it directly into Payroll.
- Raw server errors are not shown to the mobile user.

### Main code

- `src/app/staff/approvals/page.tsx`
- `src/app/staff/approvals/[domain]/[requestId]/page.tsx`
- `src/app/staff/approvals/actions.ts`
- `src/app/staff/approvals/loading.tsx`
- `src/app/api/staff-approvals/leave-documents/[documentId]/route.ts`
- `src/app/api/staff-approvals/claim-attachments/[attachmentId]/route.ts`
- `src/components/staff-pwa/mobile-approval-form.tsx`
- `src/components/staff-pwa/staff-home-overview.tsx`
- `src/lib/staff-pwa/team-approvals.ts`
- `src/app/staff/staff.css`

### Test evidence

- `tests/unit/staff-mobile-team-approvals.test.ts`
- Verified: capability access, Leave/Claims scope, tenant and branch isolation, self-approval guard, canonical stale guards, protected documents, loading/mobile UI, and safe error messages.

## 10. Desktop People & HR — Action Center

### What changed

The previous Desktop `Approvals` page is now `Action Center`.

It separates:

- `APPROVAL`: a manager must make a decision.
- `TASK`: a user must complete a canonical next step, such as finalizing an already-approved Timesheet.

### Current Action Center scope

- Attendance
- Leave
- Claims

Commission and Payroll adapters still exist in the older unified reader, but they are intentionally not surfaced in Action Center V1.

### Current mapping

| Domain item | Action Center kind |
|---|---|
| Attendance exception / OT / Resolution | Approval |
| Pre-final Timesheet decision | Approval |
| Approved Timesheet waiting to be locked | Task |
| Leave request | Approval |
| Claim request | Approval |

### UI delivered

- `Action Center` workspace/navigation label.
- All / Approvals / Tasks tabs.
- Module, authorized branch, and submitted-date filters.
- Compact rows with employee, branch, amount/summary, status, submitted/ready time, and waiting time.
- Exact empty state: `You're all caught up`.
- Clear canonical links such as Review leave, Review claim, Review attendance, and Finalize timesheet.
- Mobile layout uses full-width actions and avoids horizontal overflow.
- The misleading global Workflow Settings link was removed from the header; the existing settings route remains because it is Leave/Claims-specific rather than a universal workflow engine.

### Architecture and concurrency

- Action Center is a read model only.
- It does not execute domain mutations directly.
- Leave continues to validate status and revision.
- Claims continues to validate `SUBMITTED` status and revision.
- Timesheet finalization revalidates branch readiness, status, evidence digest, stale approval, and concurrent changes.
- Queries remain tenant-, branch-, capability-, and self-approval scoped.

### Main code

- `src/app/(business)/team/approvals/page.tsx`
- `src/app/(business)/team/approvals/approvals.module.css`
- `src/lib/approvals/types.ts`
- `src/lib/approvals/service.ts`
- `src/app/(business)/team/layout.tsx`
- `src/components/app-shell.tsx`

### Test evidence

- `tests/unit/unified-approval-center.test.ts`
- Additional canonical integration suites were run for Leave, Claims, Attendance resolution, Timesheet, and configurable two-level HR approvals.

## 11. People workspace navigation refinements

### What changed

- Team Activity now sits after Payroll in the People & HR navigation.
- The duplicate Staff Activity entry was removed from Business Settings.
- People directory reuses employee avatars.
- Role and Level controls remain inside the edit workflow rather than always occupying list-row space.

### Main code

- `src/app/(business)/team/page.tsx`
- `src/app/(business)/team/layout.tsx`
- `src/components/app-shell.tsx`
- `src/app/(business)/business/settings/page.tsx`

## 12. Validation completed today

### Consolidated unit regression

Command scope covered Roster, Timesheets, Claims, Leave, Employee Profile, bank access, recurring pay, Staff Mobile Approvals, and Desktop Action Center.

```text
Tests: 83
Passed: 83
Failed: 0
```

### Additional Action Center verification completed in the same work session

- Unified Action Center integration: 2/2 passed.
- Configurable two-level HR approval tests: 3/3 passed.
- Canonical Leave, Claims, and Attendance integration tests: 13/13 passed.
- Targeted ESLint: passed.
- `git diff --check`: passed.

The counts above overlap in scope and should not be added together as a unique-test total.

### Browser validation

Desktop Action Center was checked in the real local browser at:

- 390/391px: no horizontal overflow.
- 768px: no horizontal overflow.
- 1441px: desktop layout remained aligned.

The Approvals tab correctly hid Tasks and showed the intended empty state when no decision was pending.

## 13. Known blockers and remaining gaps

### Repository-wide TypeScript gate

`npx tsc --noEmit --pretty false` is not fully green because of existing PCB VC1 disposable test typing errors in:

- `tests/integration/payroll-pcb-vc1-disposable-e2e.test.ts`
- nullable `profileVersion` usage
- literal-type inference errors around the disposable fixture

These were not introduced by the Action Center work and were not changed today.

### Product-scope gaps intentionally retained

- Staff Mobile Team Approvals V1 supports Leave and Claims only.
- Desktop Action Center V1 supports Attendance, Leave, and Claims only.
- Workflow Settings is not a global workflow builder.
- Roster month publication cannot bypass a locked Timesheet; HR must reopen through the canonical Timesheet workflow.
- Leave balance adjustments still require a valid effective Leave policy version.
- PCB verification/freeze, LINDUNG 24, and statutory-rule governance were not today's implementation scope.

### Delivery state

- No Git commit created.
- No Git push performed.
- No Testing deployment performed.
- No Production access or deployment performed.

## 14. Important instructions for the next ChatGPT/Codex session

1. Treat this dirty working tree as user-owned work. Do not reset, checkout, or discard unrelated changes.
2. Do not rebuild Leave, Claims, Attendance, Timesheet, Payroll, PCB, or statutory cores from scratch.
3. Preserve canonical service mutations and use Action Center/Staff App only as readers and routers.
4. Before changing Next.js code, read the relevant local Next.js 16.3 documentation in `node_modules/next/dist/docs/`.
5. Keep tenant, authorized-branch, capability, self-approval, revision, stale-state, and concurrency guards intact.
6. Run focused tests for the affected module before attempting the repository-wide TypeScript gate.
7. Do not mark the whole repository ready until the PCB VC1 TypeScript errors are resolved and the full gate passes.

## 15. Copy-ready handoff prompt

```text
Continue Tetamu POS from the current workspace at C:\CodexTetamuP0.

Read docs/TETAMU-DEVELOPMENT-HANDOFF-2026-08-22.md first.

Important:
- The working tree is dirty and the changes are user-owned.
- Do not reset or discard unrelated work.
- Do not rebuild existing Leave, Claims, Attendance, Timesheet, Payroll, PCB, or statutory engines.
- Reuse canonical domain services and preserve tenant/branch/capability/revision/concurrency guards.
- Today's completed work includes Roster month publishing, Leave and Claims UX, Employee 360 IA, Staff Mobile Team Approvals V1, and Desktop Action Center.
- The consolidated focused regression is 83/83 PASS.
- The repository-wide TypeScript gate is still blocked by existing PCB VC1 disposable E2E typing errors.
- No commit, push, Testing deployment, or Production deployment has been performed.

Before implementing anything, audit the current code and confirm whether the requested change overlaps the completed work documented above.
```
