# TETAMU Staff 3000 — Approval Center V2 Reconciliation Manifest

Date: 2026-09-01  
Canonical workspace: `C:\CodexTetamuP0`  
Canonical branch: `codex/testing-release-2026-08-24`  
Accepted controlled worktree: `C:\CodexTetamuP0-staff-testing-deploy-20260830`

## Accepted source commits

| Commit | Classification | Purpose |
|---|---|---|
| `d67b24b585be88ed29971d8b0792131f369dd33e` | REQUIRED_V2 | Accepted Approval Center V2: Pending/My History, personal history projection, read-only history detail, rejection sheet, OT decision UX and focused tests. |
| `92e674b` | DEPENDENCY | Membership-level OT self-review exclusion at list, detail and write boundaries. Required to avoid the prior same-display-name/user-identity leakage. |
| `c9c4359` | DEPENDENCY / FOLLOW-UP FIX | Preserves newest immutable Attendance final-result version when projecting OT candidates; prevents stale evidence from regaining precedence. |
| `1a16052` | UNRELATED | Deployment report only; no runtime source required for canonical behavior. |
| `5bbbfc5` and later Home/Time/Schedule/History/Timesheet commits | UNRELATED | Later Staff V2 page work. Must not be bulk-imported in this task. |

## File reconciliation

| File / area | Classification | Reconciliation decision |
|---|---|---|
| `src/app/staff/approvals/page.tsx` | REQUIRED_V2 / CONFLICT | Manually reconcile accepted Pending/My History implementation onto current canonical source. |
| `src/lib/staff-pwa/approval-history.ts` | REQUIRED_V2 | Add exact accepted canonical read projection; no duplicate table/model. |
| `src/app/staff/approvals/history/[domain]/[sourceId]/page.tsx` | REQUIRED_V2 | Add accepted authenticated, scoped, read-only detail route. |
| `src/app/staff/approvals/[domain]/[requestId]/page.tsx` | ALREADY_CANONICAL | Current canonical hash matches controlled source; preserve. |
| `src/components/staff-pwa/mobile-approval-form.tsx` | REQUIRED_V2 / CONFLICT | Reconcile accepted required-reason rejection bottom sheet and direct approve action. |
| `src/app/staff/requests/overtime/[finalResultId]/page.tsx` | REQUIRED_V2 / CONFLICT | Reconcile accepted hr/min adjustment UX and decision-only facts. |
| `src/app/staff/requests/overtime/actions.ts` | REQUIRED_V2 / CONFLICT | Convert hr/min form values back to canonical minutes without changing service semantics. |
| `src/app/staff/requests/attendance-corrections/page.tsx` + `src/lib/attendance/management-service.ts` | CONFLICT | Real mobile verification found the accepted Attendance reject path still described and accepted an optional note. Reconcile the explicit V2 contract by requiring a 3–500 character rejection reason in both HTML and the canonical service schema. |
| `src/app/staff/requests/page.tsx` | REQUIRED_V2 / STALE COPY | Only narrow manager-entry copy: `Approvals`, `N waiting for you`, `All clear`; do not implement Requests Hub V2 layout. |
| `src/app/staff/staff-consolidation.css` | REQUIRED_V2 / CONFLICT | Apply only the 51-line Approval V2 delta from `d67b24b`; do not replace later/current Staff CSS wholesale. |
| `src/lib/staff-pwa/overtime-approvals.ts` | DEPENDENCY / CONFLICT | Reconcile membership-level actor identity and excluded membership filtering from `92e674b`. |
| `src/lib/attendance/overtime-service.ts` | DEPENDENCY / CONFLICT | Reconcile query-level and write-level `excludedMembershipId` / `actorMembershipId` guards from `92e674b`. |
| `tests/unit/staff-approval-center-v2.test.ts` | REQUIRED_V2 / STALE | Add accepted coverage; update only stale zero-pending copy to `All clear`. |
| `tests/unit/staff-attendance-approval-consistency.test.ts` | DEPENDENCY | Update accepted Approval V2 count selector assertion. |
| `tests/unit/staff-mobile-team-approvals.test.ts` | DEPENDENCY | Preserve capability, order, bottom-sheet and mobile assertions. |
| `tests/unit/staff-pwa.test.ts` | DEPENDENCY / CONFLICT | Update only manager-entry wording assertions; preserve newer navigation/Home/Time coverage. |
| `tests/unit/staff-manager-overtime-approval.test.ts` | DEPENDENCY | Reconcile membership-level self-review tests from `92e674b`. |
| `tests/integration/attendance-phase1c-services.test.ts` | DEPENDENCY / CONFLICT | Reconcile only self-review guard coverage from `92e674b`; do not overwrite unrelated current integration changes. |
| Prisma schema / migrations | ALREADY_CANONICAL | Required immutable actor evidence models and fields already exist. No schema or migration change. |
| Leave / Claims / Attendance canonical services | ALREADY_CANONICAL | Reused by the accepted projection; no workflow rewrite. |
| Home / Time / Schedule / Attendance History / Timesheet V2 | UNRELATED | Regression-test only. No source import or visual change. |

## Conflict policy

1. No bulk worktree copy.
2. No cherry-pick of `d67b24b` because its parent chain contains unrelated Testing and fixture commits and the canonical worktree contains newer uncommitted Staff work.
3. Use exact-file reconciliation for new V2 files and narrow manual hunks for conflicted files.
4. Preserve current canonical Home/Time/Schedule/Attendance History/Timesheet work.
5. Preserve server-side capability, business, branch and self-review authorization; UI visibility is not an authorization boundary.
6. Do not add an approval/history data model.

## Gate

Reconciliation may proceed because the accepted source and its required security dependency have been identified, and the existing canonical schema already supports the read projection.

Environment: **LOCAL / RAILWAY TESTING ONLY**  
Production: **NOT ACCESSED / NOT MODIFIED**
