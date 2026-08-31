# TETAMU STAFF OT SELF-REVIEW AND COUNT FIX REPORT

## 1. FINAL VERDICT

**PASS — automated gates and Railway Testing deployment passed.**

The Staff 3000 OT read and write paths now enforce self-review exclusion with the canonical employee membership identity. The fix is deployed to Railway Testing. A final physical Android refresh is still required to visually reconfirm the Royal Salon fixture on the owner's device; no Production environment is required or permitted for that check.

## 2. REAL DEVICE DEFECT

On the physical Android session for `0128793848` / **Real Device UAT Manager**, Approval Center reported three pending OT items:

1. Louis stylist — 22 Aug 2026
2. Real Device UAT Manager — 21 Aug 2026
3. test — 20 Aug 2026

The second record belongs to the current manager and was incorrectly included in the actor's actionable approval projection.

## 3. ROOT CAUSE

The Staff adapter excluded self-review with:

`candidate.employeeUserId !== access.actor.userId`

That comparison crossed two identity domains. OT ownership is canonical on `AttendanceP2FinalResult.membershipId`, while the previous guard depended on the optional StaffUser projection. A missing, stale, or differently mapped StaffUser link therefore allowed the actor's own membership-owned OT result into the queue and count.

The summary and queue also implemented their own candidate filtering separately, which allowed count/queue drift.

## 4. CANONICAL IDENTITY COMPARISON

**Actor:** authenticated Staff employee context `EmployeeAuthContext.membershipId`.

**Subject:** canonical OT source `AttendanceP2FinalResult.membershipId` (and the matching candidate/review membership ID).

**Comparison key:** `actorMembershipId === subjectMembershipId`.

Display name and phone are not used. StaffUser remains the capability/audit actor, but it is not the canonical OT subject identity.

## 5. OT QUEUE FIX

- Added `excludedMembershipId` to the canonical OT candidate reader.
- Staff 3000 passes the authenticated actor membership ID to that server-side reader.
- A second membership-level defense remains at the Staff adapter boundary.
- The candidate database query preserves Business, authorized Branch, period and status scope.
- The actor's own OT record is not deleted or mutated; it is excluded only from this actor's actionable projection.

## 6. OT COUNT FIX

Home, Approval Center and the OT queue now reuse `listVisibleStaffOvertimeCandidates`, the same membership-filtered candidate reader.

The OT summary counts `PENDING_REVIEW` only after applying the same Business, Branch, month and self-review exclusion as the queue. This removes the previous possibility of `OT = 3` while the actionable queue contains only two items.

## 7. DIRECT ROUTE SECURITY

The OT detail reader resolves an item through the membership-filtered OT queue. A manually supplied final-result ID belonging to the current actor resolves to no actionable detail and fails closed.

Tenant, branch, capability and period scope remain in force.

## 8. WRITE ACTION SECURITY

The canonical `decideAttendanceOvertime` service now independently compares `actorMembershipId` with the final result's `membershipId` before any review write.

**Approve:** rejected with `SELF_APPROVAL_NOT_ALLOWED` before a write.

**Adjust:** rejected with `SELF_APPROVAL_NOT_ALLOWED` before a write.

**Reject:** rejected with `SELF_APPROVAL_NOT_ALLOWED` before a write.

The existing StaffUser fallback guard, locked Timesheet guard, stale revision/concurrency guard, Leave conflict guard, tenant scope and branch scope were retained.

## 9. OTHER REVIEWER VISIBILITY

Transactional integration coverage created two authorized managers in the same Business/Branch. The actor's own OT item:

- was absent for the actor;
- remained present for the different authorized reviewer;
- remained available through that reviewer's detail reader;
- had no review record created or mutated by the visibility test.

This proves the record is not globally hidden or deleted.

## 10. COUNT RECONCILIATION

**Home:** non-OT pending domains + filtered OT pending (`2` for the supplied Royal Salon three-item fixture).

**All:** the same non-OT domain total + the same filtered OT pending.

**OT:** `2` actionable pending items for the current actor.

**Queue:** `2` matching actionable items.

The exact absolute Home/All total still depends on pending Leave, Claims and Attendance items; the OT contribution and queue now come from the same helper.

## 11. ROYAL SALON RESULT

**Before:** `3`

**After:** `2` actionable OT items under the deployed actor-membership projection.

**Visible:**

- Louis stylist
- test

**Excluded:**

- Real Device UAT Manager

No fixture mutation, OT deletion, pre-approval or duplicate OT record was performed. Railway SSH was unavailable during the final run, so the data-specific result is derived from the supplied three-item Testing fixture plus the deployed canonical membership filter; the owner should refresh the physical Android session to record the final visual confirmation.

## 12. MOBILE 390

The OT presentation code was not redesigned. The existing `max-width: 430px` contract covers 390 px and retains:

- `overflow-x: clip` on the OT page;
- a two-column compact queue row with `minmax(0, 1fr)`;
- `overflow-wrap: anywhere` for long names/details;
- 44–50 px action targets;
- bottom action spacing of `84px + safe-area-inset-bottom`.

The focused mobile contract test passed. No horizontal-overflow or bottom-navigation CSS was weakened by this server-side fix.

## 13. MOBILE 412

The same `max-width: 430px` contract covers 412 px. Queue status moves below the content column, long labels wrap, actions remain reachable, and safe-area spacing remains active. The focused mobile contract test passed.

## 14. TEST RESULTS

- Focused Staff OT/security unit tests: **11/11 passed**.
- Staff OT + mobile approval unit group: **15/15 passed**.
- Focused Attendance/OT/Timesheet integration group: **12/12 passed**.
- Full unit suite: **1222/1222 passed**.
- Disposable protected integration suite: **188/188 passed**.
- Employee Attendance route flow: **1/1 passed**.
- TypeScript (`npx tsc --noEmit`): **passed**.
- ESLint: **passed with 0 errors** (3 unrelated pre-existing warnings).
- Prisma schema validation: **passed**.
- Production build: **passed**, including TypeScript and all 144 app routes/pages.
- Railway Testing runtime smoke: `/api/health`, `/staff`, `/staff/login`, `/staff/approvals`, and `/staff/requests/overtime` all returned HTTP 200; protected routes remained fail-closed without an employee session.
- `git diff --check`: **passed**.

Coverage includes self queue/count/detail, Approve/Adjust/Reject, another reviewer, branch/tenant scope, missing capability, locked Timesheet, stale/concurrency protection, shared count projection and mobile safety contracts.

## 15. NO NEW MIGRATION

**NO NEW MIGRATION.**

No Prisma schema or migration file was changed. The fix is an identity-correct read/write authorization change only.

## 16. TESTING DEPLOYMENT

- Environment: **Railway Testing only**
- Service: `tetamu-staff-app`
- Region: Southeast Asia
- Commit: `92e674b` — `fix(staff): exclude own overtime approvals`
- Deployment ID: `fb8293d1-ab2e-46fc-b101-3166c57be9df`
- Deployment status: **SUCCESS**
- Release environment validation: **testing contract valid**
- Runtime start: Next.js ready successfully

## 17. PRODUCTION STATUS

**TESTING ONLY**

**PRODUCTION NOT ACCESSED**

**PRODUCTION NOT MODIFIED**

Staff 3100 was not used or reintroduced.
