# TETAMU STAFF 3000 — APPROVAL CENTER V2 CANONICALIZATION REPORT

Date: 2026-09-01  
Canonical workspace: `C:\CodexTetamuP0`  
Canonical Staff App: **3000 ONLY**  
Environment: **LOCAL / RAILWAY TESTING ONLY**

## 1. FINAL VERDICT

**CANONICALIZED**

The accepted Approval Center V2 now exists in `C:\CodexTetamuP0` itself. Pending, My History, personally owned decision history, read-only history detail, Leave/Claims/Attendance/OT projection, capability/business/branch/self-review scope, required rejection reasons and OT adjustment reasons are present and verified.

No Requests Hub, Leave, Claims, Attendance archive, Pay or Profile follow-on phase was started by this task.

## 2. SOURCE OF ACCEPTED V2

Exact accepted source worktree:

`C:\CodexTetamuP0-staff-testing-deploy-20260830`

Exact commits:

- `d67b24b585be88ed29971d8b0792131f369dd33e` — accepted Approval Center V2 implementation and focused coverage.
- `92e674b488f9bcdfa2e27d9b64ea0501290180bd` — membership-level OT self-review exclusion.
- `c9c4359f652f4f1ff29743c715d66e964197c80e` — newest immutable Attendance final-result precedence for OT projection.
- `2ebf7643eddd83fa2a8cfddf960c52ef70bde85b` — clean Testing release commit containing the final narrow canonicalization fixes.

## 3. CANONICAL BEFORE STATE

Before reconciliation, canonical Staff 3000 had a Pending-only `/staff/approvals`, no `My History`, no approval-history projection/helper, no history detail route, no canonical V2 test, and stale manager entry wording.

The canonical worktree also contained substantial pre-existing unrelated changes. Therefore a bulk copy or broad cherry-pick was unsafe.

## 4. RECONCILIATION MANIFEST

The source/diff classification was recorded before product changes in:

`TETAMU_STAFF_APPROVAL_CENTER_V2_RECONCILIATION_MANIFEST.md`

Every Approval-scope item was classified as `REQUIRED_V2`, `DEPENDENCY`, `ALREADY_CANONICAL`, `UNRELATED`, `CONFLICT` or `STALE`. No entire worktree was copied.

## 5. FILES CANONICALIZED

Core runtime:

- `src/app/staff/approvals/page.tsx`
- `src/lib/staff-pwa/approval-history.ts`
- `src/app/staff/approvals/history/[domain]/[sourceId]/page.tsx`
- `src/components/staff-pwa/mobile-approval-form.tsx`
- `src/app/staff/requests/page.tsx`
- `src/app/staff/requests/attendance-corrections/page.tsx`
- `src/app/staff/requests/overtime/[finalResultId]/page.tsx`
- `src/app/staff/requests/overtime/actions.ts`
- `src/lib/staff-pwa/overtime-approvals.ts`
- `src/lib/attendance/overtime-service.ts`
- `src/lib/attendance/management-service.ts`
- Approval V2-only rules in `src/app/staff/staff-consolidation.css`

Coverage:

- `tests/unit/staff-approval-center-v2.test.ts`
- `tests/unit/staff-attendance-approval-consistency.test.ts`
- `tests/unit/staff-mobile-team-approvals.test.ts`
- `tests/unit/staff-manager-overtime-approval.test.ts`
- `tests/unit/staff-mobile-attendance-corrections.test.ts`
- `tests/unit/staff-pwa.test.ts`
- existing Attendance integration coverage was retained.

## 6. CONFLICTS RESOLVED

- Exact-file reconciliation was used for new accepted V2 files.
- Narrow hunks preserved newer Home/Time/Schedule/History/Timesheet work.
- Requests changed only the allowed manager entry contract: `Approvals`, `N waiting for you`, `All clear`.
- Mobile verification found Attendance rejection still labelled and accepted an optional note. This contradicted the explicit accepted contract. It was corrected narrowly in HTML (`required`, `minLength=3`) and in the canonical Attendance service schema (3–500 characters for `REJECTED`).
- No capability, tenant, branch, self-review, workflow, data-model or Payroll boundary was weakened.

## 7. PENDING

**PASS**

- Shows only currently actionable items.
- Domain counts cover Leave, Claims, Attendance and OT.
- Ordering remains oldest actionable first.
- Pending links delegate mutations to the canonical domain workflows.
- Local manager UAT showed one Attendance item and matching parent/child count of 1.

## 8. MY HISTORY

**PASS**

- `Pending` and `My History` are separate views.
- Current month is selected by default.
- Twelve month choices, domain filters, employee filter and 20-item server pagination remain present.
- August 2026 local fixture returned six decisions across Attendance, OT, Claims and Leave.

## 9. HISTORY OWNERSHIP

**PASS**

History is a read projection over immutable canonical evidence. Queries are constrained by the authenticated manager's canonical actor identity (`actorUserId` / `actorId`), business and allowed branches. It is not company-wide history and does not introduce an `ApprovalHistory` table.

## 10. HISTORY DETAIL

**PASS**

Route: `/staff/approvals/history/[domain]/[sourceId]`

- Requires employee Staff authentication and approval capability.
- Revalidates business, branch and personal reviewer ownership.
- Is read-only: no Approve, Reject or Adjust control is rendered.
- Protected Leave documents and Claim receipts keep their scoped download routes.
- Mobile scroll-end evidence places the final boundary at `748.14px`, above the fixed navigation top at `779.36px` (about `31px` clearance).

The accepted source currently repeats the Attendance request summary once in the common Request fact and once in the domain facts. It is presentation redundancy in the already-approved source, not a mutation/security defect, and was not visually redesigned during this canonicalization-only task.

## 11. LEAVE REGRESSION

**PASS**

Leave decisions still use the canonical Leave workflow, stage/revision guards and capability scope. Decision history does not imply that supporting evidence was verified merely because Leave was approved.

## 12. CLAIMS REGRESSION

**PASS**

Claim decisions still use the canonical Claim workflow, branch/business scope and revision guards. Approval wording remains separate from reimbursement/payment state; approved does not mean paid.

## 13. ATTENDANCE REGRESSION

**PASS**

- Parent Approval count and Attendance child queue use the same actionable projection.
- Pending exceptions and resolution cases remain canonical Attendance records.
- Employee self-service history remains separate from the manager queue.
- Rejection reason is required in both the mobile form and service schema.
- No Attendance, Timesheet or Payroll state was bypassed.

## 14. OT REGRESSION

**PASS**

- Approve, Adjust and Reject remain available only through the canonical OT service.
- Adjust uses hours/minutes in the UI and canonical minutes in the service.
- Adjustment and rejection reasons are required.
- Latest immutable review/final-result version wins.
- Employee-facing OT stays in hr/min language.

## 15. SELF-REVIEW SECURITY

**PASS**

- Normal Staff access is denied without approval capability.
- Business and allowed-branch scope are enforced server-side.
- Leave/Claims exclude the authenticated actor.
- Attendance excludes the actor membership.
- OT list, detail and write paths exclude/reject the actor membership.
- Approve, Adjust and Reject self-review tests reject before any write.
- History and history deep links cannot expose another manager's personal decisions.
- Cross-business/cross-branch source IDs fail closed.

## 16. REQUESTS APPROVAL ENTRY

**PASS**

The capability-gated permanent Requests entry targets `/staff/approvals`:

- Label: `Approvals`
- Pending > 0: `N waiting for you`
- Pending = 0: `All clear`

Approval Center remains outside the bottom navigation.

## 17. STALE TEST FIX

**STALE TEST FIXED**

The old assertion for `You’re all caught up · View approval history` / `History` was replaced with the accepted `All clear` contract. The old `Team approvals` assertion was also removed. Functional assertions were not weakened.

## 18. HOME REGRESSION

**PASS**

Home V2 was not changed. `Needs My Approval` remains capability-driven and appears only when pending count is greater than zero. No manager History shortcut was added to Home.

## 19. TIME REGRESSION

**PASS**

Time Hub, Schedule, Attendance History and Timesheet/OT presentation were regression-tested and not redesigned by this task. Bottom navigation remains `Home / Time / Requests / Pay / Profile`.

## 20. MOBILE 360

**PASS**

- Requested viewport: 360-class × 800.
- In-app runtime reported a 361px CSS viewport; document/body/shell widths all equalled 361px.
- No horizontal page overflow.
- Pending tabs, horizontally scrollable domain filters, card and fixed bottom nav remained usable.
- 44px touch-target contract retained.

Screenshot: `artifacts/staff-approval-center-v2-canonicalization/approval-pending-360x800.jpg`

## 21. MOBILE 390

**PASS**

- Requested viewport: 390 × 844.
- In-app runtime reported a 391px CSS viewport; `scrollWidth === innerWidth === 391`.
- Pending, My History, month/employee filters and read-only detail were verified.
- At History list scroll end, last decision bottom was `748.53px`, above nav top `779.36px`.
- At History detail scroll end, final boundary bottom was `748.14px`, above nav top `779.36px`.
- Attendance reject UI exposed `required`, `minLength=3` and clear reason copy.

Screenshots:

- `artifacts/staff-approval-center-v2-canonicalization/approval-pending-390x844.jpg`
- `artifacts/staff-approval-center-v2-canonicalization/approval-history-390x844.jpg`
- `artifacts/staff-approval-center-v2-canonicalization/approval-history-bottom-390x844.jpg`
- `artifacts/staff-approval-center-v2-canonicalization/approval-history-detail-390x844.jpg`
- `artifacts/staff-approval-center-v2-canonicalization/approval-history-detail-bottom-390x844.jpg`

## 22. MOBILE 412

**PASS**

- Viewport: 412 × 915.
- Document, body and shell widths all equalled 412px.
- No horizontal page overflow.
- Pending/category navigation, actionable card and fixed bottom navigation remained clear.

Screenshot: `artifacts/staff-approval-center-v2-canonicalization/approval-pending-412x915.jpg`

## 23. FULL TEST RESULTS

Canonical workspace:

| Gate | Result |
|---|---|
| Focused Approval/Leave/Claims/Attendance/OT/Home/Time | 90 / 90 PASS |
| Full unit | 1,382 / 1,382 PASS |
| Attendance integration | 5 / 5 PASS with embedded PostgreSQL |
| TypeScript | PASS |
| ESLint | PASS — 0 errors, 5 pre-existing unrelated warnings |
| Next.js 16.3 production build | PASS |

Clean Testing release source:

| Gate | Result |
|---|---|
| Focused Approval/Attendance/OT/Home/Time | 55 / 55 PASS |
| Full unit | 1,292 / 1,292 PASS |
| TypeScript | PASS |
| ESLint | PASS — 0 errors, 3 pre-existing unrelated warnings |
| Next.js 16.3 production build | PASS |

One initial local build attempt hit a Windows Prisma DLL `EPERM` while the dev server held the file. After ending that server, the required clean build passed. This was not a source failure.

## 24. FILES CHANGED

Canonical Approval scope is listed in section 5. Additional task artifacts:

- `TETAMU_STAFF_APPROVAL_CENTER_V2_RECONCILIATION_MANIFEST.md`
- `TETAMU_STAFF_APPROVAL_CENTER_V2_CANONICALIZATION_REPORT.md`
- `artifacts/staff-approval-center-v2-canonicalization/*.jpg`

The clean deployment commit contains exactly six final reconciliation files and has a clean Git status.

## 25. NO DUPLICATE DATA MODEL

**CONFIRMED**

No `ApprovalHistory`, approval-copy, duplicate OT state or duplicate Attendance decision table was introduced. History reads canonical immutable HR decision, Attendance resolution/audit and OT review evidence.

## 26. NO NEW MIGRATION

**NO NEW MIGRATION**

No Prisma schema or migration was added or modified by this canonicalization.

## 27. TESTING DEPLOYMENT

Environment: **testing**  
Service: `tetamu-staff-app`  
Region: Railway Singapore (`asia-southeast1-eqsg3a`)  
Source branch: `codex/staff-approval-center-v2-canonicalization`

Commit: `2ebf7643eddd83fa2a8cfddf960c52ef70bde85b`  
Deployment ID: `ac2584b7-40fa-439c-8855-c9f5b00ce940`  
Image digest: `sha256:aaae868c4cbfdb310344a8959c46f9cda671f5e785d20b614828320d79bbf7cd`  
Status: **SUCCESS / RUNNING**

Post-deploy smoke:

- `/api/health` — HTTP 200
- `/staff/login` — HTTP 200
- `/staff/manifest.webmanifest` — HTTP 200
- Runtime environment validation — `testing` PASS
- Runtime port — 3000

## 28. PRODUCTION STATUS

**TESTING ONLY**

**PRODUCTION NOT ACCESSED**

**PRODUCTION NOT MODIFIED**

No Production service, deployment, database, variable, credential, log, endpoint or application data was accessed or changed.

