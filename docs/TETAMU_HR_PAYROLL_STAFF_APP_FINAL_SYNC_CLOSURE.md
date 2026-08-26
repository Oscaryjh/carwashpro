# TETAMU HR & Payroll — Staff App Final Sync Closure

Date: 26 August 2026
Workspace: `C:\CodexTetamuP0`
Standalone Staff App: `C:\CodexTetamuP0-staff-ui`
Desktop local port: `3000`
Standalone Staff App local port: `3100`

## 1. Executive Summary

The standalone Staff App has been brought materially closer to the canonical TETAMU HR & Payroll workflow without creating a second Leave, Claims, Attendance, OT, Commission, Payslip, Payroll or Approval engine.

The Staff App now presents the intended five-entry mobile information architecture:

1. Home
2. Time
3. Requests
4. Pay
5. Profile

`Requests` consolidates employee Leave, Claims and attendance-correction activity and provides a capability-gated entry to Team Approvals. `Pay` exposes only published payslips and recorded commission statements. OT remains derived from approved Attendance because the canonical product does not currently contain a separate employee OT-request workflow.

The three stale test/data-contract expectations identified by the previous closure have been corrected. Five-role local browser UAT has now been executed for Employee, Supervisor, Branch Manager, HR and Business Owner. The current fresh unit suites pass at 1160/1160 in both workspaces, TypeScript and changed-file ESLint pass, and the complete Integration suite passes at 184/184 in both workspaces through isolated disposable databases so local development data cannot invalidate the result.

Final verdict: **CONDITIONAL PASS**.

The previous five-role browser-coverage gap is closed. This closure remains explicitly **not Production Ready** because a fresh mutation journey across Employee → Manager → HR/Payroll → published employee document, physical-device validation and release-operational controls are still required.

## 2. Starting State

The preceding Desktop closure was already a Conditional Pass. Desktop supported the monthly HR and Payroll path, but the standalone Staff App was behind the canonical product:

- fixed navigation still emphasized older standalone pages;
- there was no unified `Requests` hub;
- there was no unified `Pay` hub;
- Team Approvals existed but was visually inconsistent on narrow mobile widths;
- OTP database transactions were vulnerable to ordinary production database latency;
- employee-facing copy did not explain the canonical OT and frozen-Payroll boundaries clearly.

No core calculation engine was replaced in this sync.

## 3. Scope

In scope:

- audit the standalone Staff App against canonical Desktop readers and services;
- synchronize mobile navigation and entry points;
- reuse existing Leave, Claims, Attendance, Approval, Payslip and Commission logic;
- expose final/frozen Payroll information safely;
- preserve OTP, multi-business switching and Staff authentication;
- validate narrow mobile layout, permissions and tenant isolation;
- produce evidence-based closure documentation.

Out of scope:

- new Payroll calculations;
- new statutory calculations;
- a new OT request engine;
- real payment, real statutory submission or real SMS activity;
- Production deployment;
- modifying Production configuration or data.

## 4. Staff App Audit

| Area | Starting state | Closure state |
|---|---|---|
| Navigation | Older standalone grouping | Home / Time / Requests / Pay / Profile |
| Requests | Separate pages only | Unified employee hub plus recent activity |
| Manager Approvals | Existing mobile implementation | Integrated into Requests and narrow-screen styling completed |
| Leave | Canonical service existed | Reused; no duplicate workflow |
| Claims | Canonical service existed | Reused; no duplicate workflow |
| Attendance corrections | Canonical reader existed | Surfaced in Requests |
| OT | Canonical Attendance-derived candidate logic | Clearly described as derived, not a separate request |
| Pay | Separate Payslip/Commission pages | Unified read-only Pay hub |
| Payroll safety | Published Payslip reader existed | Explicit final-record-only boundary |
| OTP | Existing SMS123/auth flow | Transaction timeouts increased without changing provider behavior |

## 5. Sync Matrix

| Staff surface | Canonical source | Write behavior | Status |
|---|---|---|---|
| Home | Existing Staff home readers | Existing actions only | Synced |
| Time | Attendance history, roster and timesheet | Existing Attendance endpoints | Synced |
| Requests | Leave, Claim and Attendance resolution readers | Existing domain forms/services | Synced |
| Team Approvals | Unified Approval Center plus Leave/Claim services | Existing guarded approval mutations | Synced |
| Pay | Published Payslip and Commission readers | Read-only | Synced |
| Profile | Existing employee self-service profile | Existing profile actions | Preserved |
| OT | Attendance OT candidate/approval flow | No employee OT request invented | Canonical boundary preserved |

## 6. Navigation Changes

Implementation:

- `C:\CodexTetamuP0-staff-ui\src\lib\staff-pwa\navigation.ts`
  - `buildStaffNavigation()` now builds the five-entry information architecture from live module entitlements.
  - `activePrefixes` keeps nested Leave, Claims, Approvals, Payslip and Commission pages highlighted under their correct hub.
- `C:\CodexTetamuP0-staff-ui\src\components\staff-pwa\staff-pwa-chrome.tsx`
  - supports grouped active prefixes;
  - uses distinct Requests and Pay icons;
  - preserves workplace branding, switching and the isolated Staff shell.

Module behavior:

- `Time` appears when HR is enabled.
- `Requests` appears when HR or Claims is enabled.
- `Pay` appears when Payroll or Commission is enabled.
- `Profile` remains directly accessible.

Appointments remain reachable from Home rather than taking one of the five fixed navigation positions.

## 7. Requests

New route:

- `C:\CodexTetamuP0-staff-ui\src\app\staff\requests\page.tsx`

Current behavior:

- requires an authenticated employee session through `getEmployeeSelfServiceAuthContext()`;
- reads enabled modules through `loadBusinessModuleContext()`;
- loads Leave with `getEmployeeLeaveOverview()`;
- loads Claims with `getEmployeeClaimOverview()`;
- loads Attendance corrections with `loadEmployeeAttendanceResolutionCases()`;
- loads manager counts through `getStaffTeamApprovalSummary()`;
- sorts recent activity by canonical timestamps;
- displays status without recomputing domain outcomes in the UI;
- redirects safely when neither HR nor Claims is enabled.

## 8. Leave

Canonical implementation reused:

- `C:\CodexTetamuP0-staff-ui\src\lib\leave\service.ts`
  - `getEmployeeLeaveOverview()`
  - `getManagerLeaveDashboard()`
  - `reviewLeaveRequest()`
- `C:\CodexTetamuP0-staff-ui\src\lib\leave\document-service.ts`
  - protected supporting-document preparation, authorization and review.

Staff behavior:

- employee submission and balance views remain on the existing Leave route;
- Requests shows the latest Leave activity and status;
- manager review delegates to canonical Leave review logic;
- frozen treatment, overlap prevention, entitlement consumption and cancellation restoration remain service/database responsibilities.

No Leave balance is recalculated inside the new Requests page.

## 9. Claims

Canonical implementation reused:

- `C:\CodexTetamuP0-staff-ui\src\lib\claim\service.ts`
  - `getEmployeeClaimOverview()`
  - `getManagerClaimDashboard()`
  - `reviewEmployeeClaim()`

Staff behavior:

- employee submission, receipts and reimbursement tracking remain on the existing Claims route;
- Requests shows recent claim number, amount and status;
- Team Approvals delegates approval/rejection to `reviewEmployeeClaim()`;
- claim lines, approved amounts, immutable policy snapshots and reimbursement boundaries remain canonical.

## 10. Attendance Corrections

Canonical implementation reused:

- `C:\CodexTetamuP0-staff-ui\src\lib\attendance\resolution-read-service.ts`
  - `loadEmployeeAttendanceResolutionCases()`
- existing Attendance exception and history services remain responsible for mutations and locked-period checks.

Requests provides an `Attendance corrections` entry and recent items. It does not manufacture an absence, completed attendance state or missing-punch outcome from raw punches.

## 11. OT

Canonical implementation remains:

- `C:\CodexTetamuP0-staff-ui\src\lib\attendance\overtime-service.ts`
  - `listAttendanceOvertimeCandidates()`
  - `deriveOvertimeCandidate()`

Staff App behavior:

- no separate employee OT request was added;
- Requests explicitly explains that OT is derived from approved Attendance;
- only approved OT is represented in employee Timesheet views;
- normal-day, rest-day, public-holiday and cross-midnight context remains canonical;
- Payroll rates and money calculation remain outside the Staff UI.

## 12. Approvals

Canonical mobile approval adapter:

- `C:\CodexTetamuP0-staff-ui\src\lib\staff-pwa\team-approvals.ts`
  - `resolveStaffTeamApprovalAccess()`
  - `getStaffTeamApprovalSummary()`
  - `getStaffTeamApprovalInbox()`
  - `getStaffTeamApprovalDetail()`
  - `reviewStaffLeave()`
  - `reviewStaffClaim()`

The adapter reuses:

- `getUnifiedApprovalCounts()` and `getUnifiedApprovalInbox()`;
- canonical Leave and Claim manager dashboards;
- canonical stage resolution through `getHrApprovalStages()`.

Only Leave and Claims are exposed in mobile Team Approvals. Other approval domains continue through Desktop Action Center/Approvals.

## 13. Approval Security

Verified controls:

- employee membership must be active in the authenticated business;
- a linked active `staffUser` is required for manager review;
- actions require capability checks, not a visual role label;
- branch scope is resolved server-side;
- Business Owner or `ALL_BRANCHES` receives whole-business scope;
- ordinary managers are restricted to their current authorized branch;
- HR and Claims modules are checked server-side;
- Leave requires `APPROVE_LEAVE`;
- Claims requires `REVIEW_CLAIM`;
- self-approval is excluded in the query;
- current stage visibility is checked before showing a request;
- expected revision is passed to canonical services to reject stale decisions;
- protected document routes remain authorization-scoped.

## 14. Pay

New route:

- `C:\CodexTetamuP0-staff-ui\src\app\staff\pay\page.tsx`

Current behavior:

- requires an authenticated employee session;
- respects live Payroll and Commission module entitlements;
- shows published Payslip count;
- shows recorded Commission statement count;
- never exposes draft or unfinalized Payroll values;
- redirects safely if both modules are disabled.

## 15. Payslip

Canonical reader:

- `C:\CodexTetamuP0-staff-ui\src\lib\payroll\payslip-publication.ts`
  - `loadPublishedPayslipsForEmployee()`
  - `loadOwnPublishedPayslip()`

The Pay hub links to the existing `/staff/payslips` route. Browser validation showed the August 2026 published document and download action. No draft Payroll entry is exposed as a Payslip.

## 16. Commission

Canonical reader:

- `C:\CodexTetamuP0-staff-ui\src\lib\commission\read.ts`
  - `getEmployeeCommissionStatements()`

Canonical engine remains in:

- `C:\CodexTetamuP0-staff-ui\src\lib\commission\service.ts`
- `C:\CodexTetamuP0-staff-ui\src\lib\commission\calculation.ts`

The Pay hub does not calculate Commission. It shows recorded calculated/approved statements and states that a Commission statement does not itself prove payment.

## 17. Payroll Freeze

The Staff sync preserves the existing rule:

- draft and unfinalized amounts are hidden;
- Payslips are read from published Payroll records;
- employee views do not mutate a finalized Payroll entry;
- Claims and Commission retain their existing Payroll bridge/idempotency behavior;
- reopened Attendance/Timesheet revisions do not rewrite old locked snapshots.

## 18. Frozen Snapshot Audit

Evidence remains in the canonical database/service layer rather than being copied into Staff UI state:

- Leave policy/treatment snapshot per request;
- Claim category/policy and reimbursement snapshot;
- approved OT and locked Attendance source contracts;
- finalized Payroll and published Payslip snapshots;
- Commission period/rule resolution and Payroll-link idempotency.

The Staff UI is a reader and action surface; it is not the audit source of truth.

## 19. Home UX

The existing Staff Home was preserved. It continues to use canonical Today, schedule and employee readers and keeps quick-access cards for Schedule, Leave, Timesheets and Claims.

The new fixed navigation reduces reliance on Home quick links while retaining backward familiarity. No new business-domain calculation was introduced on Home.

## 20. Mobile 390px

In-app browser validation was executed at a requested 390 × 844 viewport. The browser reported an effective layout width of 391 px.

Observed evidence:

- document `scrollWidth`: 391 px;
- all five bottom-navigation items remained inside the 391 px viewport;
- each item was approximately 75.77 px wide;
- Requests and Pay rendered without horizontal document overflow;
- Team Approvals rendered compact filters and empty state at the same width;
- fixed bottom navigation remained reachable.

Additional responsive CSS is in:

- `C:\CodexTetamuP0-staff-ui\src\app\staff\staff.css`

It includes compact hub cards, request activity rows, approval facts/forms, 44 px touch targets and horizontally scrollable filter tabs where appropriate.

## 21. Tenant Isolation

Tenant isolation is enforced through authenticated `businessId`, membership lookup, branch scope and canonical service filters. The focused integration suite passed explicit tenant-isolation coverage for customers, audit logs, WhatsApp records and approval projections.

The Staff workplace switcher continues to perform a hard tenant reset while preserving only the verified device identity. The navigation reads module entitlement again after workplace/login context changes.

## 22. Permission Matrix

| Persona | Employee self-service | Team Approvals | Scope |
|---|---|---|---|
| Employee | Own Home, Time, Requests, Pay, Profile | None unless linked to an authorized staff user | Own membership/business |
| Supervisor | Own employee surface | Leave/Claims only when capability exists | Authorized branch |
| Branch Manager | Own employee surface | Leave/Claims when capability exists | Current authorized branch |
| HR | Own employee surface plus canonical HR capabilities | Domains granted by capability; mobile remains Leave/Claims | Authorized branch(es) |
| Business Owner | Own employee surface | Leave/Claims mobile access | All active branches in own business |

Role names do not bypass module, capability, branch, tenant, self-approval or stage checks.

## 23. Employee Tests

Interactive local browser UAT: **PASS**.

- authenticated unprivileged Core B employee session opened the standalone Staff App at `:3100`;
- Home, Time, Requests, Pay and Profile were available;
- Requests exposed Leave, Claims, Attendance corrections and the canonical OT explanation;
- one published Payslip was visible and no Draft Payroll value was exposed;
- direct `/staff/approvals` access returned to the employee surface and exposed no manager actions;
- the persona had no linked `staffUser`, preventing accidental management capability inheritance.

## 24. Supervisor Tests

Interactive local browser UAT: **PASS**.

- Action Center exposed Leave and Claims only;
- branch selection was restricted to Acceptance Main Branch;
- Payroll was absent from navigation;
- no owner-only or cross-branch action was presented.

## 25. Branch Manager Tests

Interactive local browser UAT: **PASS**.

- HR navigation exposed Overview, Time and Leave;
- Action Center exposed Leave and Claims within Acceptance Main Branch;
- Payroll was absent from navigation;
- branch scope remained server-derived.

## 26. HR Tests

Interactive local browser UAT: **PASS**.

- canonical `/team/payroll/workspace` loaded;
- August 2026 displayed six employees, gross RM 18,264.90 and net RM 18,269.52;
- six of six Payslips were available;
- calculation gate was ready;
- Payment Access was not granted and statutory actions remained restricted;
- follow-up bank/statutory profile actions were visible without widening capability.

## 27. Business Owner Tests

Interactive local browser UAT: **PASS**.

- whole-business Payroll workspace loaded;
- August 2026 was locked with six employee entries and six published Payslips;
- locked Timesheet revision 1 was visible as the Payroll source;
- base pay, OT, paid leave, unpaid leave, claim and commission acceptance outcomes matched the canonical Core Acceptance fixture.

## 28. Employee → Manager → HR UAT

The five-role **surface and permission** UAT is complete. The canonical Core Acceptance data proves the final Payroll outcomes across Attendance, OT, Leave, Claims, Commission, Timesheet, Payroll and Payslip.

A single fresh browser mutation scenario traversing Employee submission → manager decision → HR/Payroll finalization → employee published document was deliberately not performed against the shared acceptance fixture. This remains a release UAT item and is one reason the final verdict stays Conditional Pass.

## 29. Regression

Current execution results:

### Fresh current results

- Main Desktop unit suite: **1160/1160 passed**.
- Standalone Staff App unit suite: **1160/1160 passed**.
- Main Desktop TypeScript: passed.
- Standalone Staff App TypeScript: passed.
- changed-file ESLint in both workspaces: passed.
- focused corrected contracts:
  - OTP public response includes canonical `requestStatus`;
  - Payroll P5 absence result derives from the current HR company policy;
  - legacy Payroll route assertion follows `/team/payroll/workspace`.
- complete Integration execution now uses a freshly migrated disposable local database through `npm run test:integration:disposable` instead of the mutable development database.
- Main Desktop disposable Integration: **184/184 passed**.
- Standalone Staff App disposable Integration: **184/184 passed** (183 shared-suite tests plus 1 isolated Attendance route-flow test).

No Production database was used. Each Integration run created, migrated, tested and removed its own validated local disposable database.

## 30. Known Limitations

- no separate employee OT request exists because canonical OT is Attendance-derived;
- mobile Team Approvals covers Leave and Claims only;
- not every Desktop approval domain has a mobile decision screen;
- the five-role browser run validates surfaces and permissions, not a new destructive mutation journey;
- Home still contains quick-access links that overlap with the new fixed hubs by design;
- external mobile-network, device-install and Production infrastructure validation remain pending.

## 31. Production Blockers

Before Production Ready can be considered:

1. run one complete fresh Employee → manager → HR/Payroll → employee published-document mutation scenario;
2. verify the standalone Staff App on a physical 390 px-class iPhone and supported Android device;
3. complete deployment, environment, backup, observability and rollback checks in the intended non-Production environment;
4. perform payment/statutory sandbox checks separately without real payment or statutory submission.

## 32. Files Changed

Authored Staff App changes:

- `C:\CodexTetamuP0-staff-ui\src\app\staff\requests\page.tsx`
- `C:\CodexTetamuP0-staff-ui\src\app\staff\pay\page.tsx`
- `C:\CodexTetamuP0-staff-ui\src\app\staff\staff.css`
- `C:\CodexTetamuP0-staff-ui\src\components\staff-pwa\staff-pwa-chrome.tsx`
- `C:\CodexTetamuP0-staff-ui\src\lib\staff-pwa\navigation.ts`
- `C:\CodexTetamuP0-staff-ui\src\lib\attendance\employee-auth\otp-service.ts`
- `C:\CodexTetamuP0-staff-ui\tests\unit\staff-pwa.test.ts`
- `C:\CodexTetamuP0-staff-ui\tests\unit\staff-mobile-team-approvals.test.ts`

Closure document:

- `C:\CodexTetamuP0\docs\TETAMU_HR_PAYROLL_STAFF_APP_FINAL_SYNC_CLOSURE.md`
- `C:\CodexTetamuP0\docs\TETAMU_HR_PAYROLL_FIVE_ROLE_BROWSER_UAT.md`

Local-only UAT support:

- `C:\CodexTetamuP0\scripts\prepare-hr-payroll-five-role-uat.ts`
- `C:\CodexTetamuP0\src\app\api\local-uat\session\route.ts`
- `C:\CodexTetamuP0-staff-ui\src\app\staff\uat-sign-in\route.ts`
- `C:\CodexTetamuP0\scripts\run-integration-disposable.mjs`

No main Desktop product source file was modified for this Staff sync. Existing unrelated dirty workspace changes remain user-owned and were not reset.

## 33. Tests Executed

Commands/equivalent checks executed:

- standalone full unit test glob;
- focused Staff PWA, SMS123, Attendance history, Timesheet, Approval, OT and Commission unit tests;
- complete Main Desktop Integration suite in a disposable database: **184/184 passed**;
- complete standalone Staff App Integration suite in a disposable database: **184/184 passed**;
- standalone TypeScript no-emit check;
- main Desktop TypeScript no-emit check;
- standalone changed-file ESLint;
- main Desktop ESLint;
- standalone and main `git diff --check`;
- standalone webpack production build;
- in-app browser route and 390 px viewport inspection for Home, Requests, Pay, Payslips and Team Approvals.

No real SMS, real payment, real statutory submission, Production deployment or Production mutation was performed.

## 34. Final Verdict

**CONDITIONAL PASS**

What is ready:

- standalone Staff App navigation is synchronized to the intended five-entry model;
- Requests and Pay hubs reuse canonical readers and services;
- Leave, Claims, Attendance correction, OT, Approval, Payslip and Commission boundaries are preserved;
- tenant/branch/capability/self-approval guards are retained;
- 390 px mobile layout is usable;
- all five requested personas have completed local browser surface/permission UAT;
- the three previous stale contract expectations have been corrected;
- both current unit suites and TypeScript checks pass;
- complete Integration passes in both workspaces against isolated disposable local databases.

What prevents `CORE PRODUCT UAT READY`:

- the fresh mutation-based Employee → Manager → HR/Payroll → Employee browser journey remains outstanding;
- physical-device and release-operational validation remain outstanding.

The system must not be labelled Production Ready from this closure.
