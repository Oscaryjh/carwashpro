# STAFF APP 3000 / 3100 CURRENT STATE & CONSOLIDATION AUDIT

> Audit date: 2026-08-29 (Asia/Singapore)  
> Scope: current working trees, not historical design documents.  
> 3000 source: `C:\CodexTetamuP0`, branch `codex/testing-release-2026-08-24`, HEAD `9037025b10adb215a17d19acf61df51e23ef95fb`.  
> 3100 source: `C:\CodexTetamuP0-staff-ui`, branch `codex/staff-ui-testing-integration`, HEAD `0f8fcbf3d5314db8a673a8442ab9f5a92dea0965`.  
> The 3000 working tree contains extensive uncommitted work; the 3100 tree is almost clean (`next-env.d.ts` modified). This report therefore describes the files actually present on disk, not only either branch HEAD.

## Audit method and status legend

The audit covered the two real route trees, Staff components and CSS, Staff REST Route Handlers, Server Actions, shared domain services, authentication/session code, Prisma schemas and migration directories, capability mapping, navigation builders, PWA manifests/runners, and existing Staff unit tests.

- **READY** — routed and backed by real domain/service/database behavior; not merely visual.
- **PARTIAL** — useful implementation exists, but it is incomplete, not the active runtime, or diverges from the other tree in a material way.
- **PLACEHOLDER** — intentionally non-functional or only explanatory UI.
- **DEAD / UNUSED** — code exists but has no current reachable entry, or a configured redirect bypasses it.
- **NOT PRESENT** — no implementation was found in that tree.

Two important validations were also performed:

- 3000 selected Staff tests: **52/52 passed**.
- 3100 selected Staff tests: **85/85 passed**.

These are code-level validations, not a full production/UAT sign-off. No database writes, migration deploys, or code changes were made during this audit.

## Executive finding

There are not two cleanly separated products. There are two diverged copies of one monorepo:

1. **3000 is the current main-system worktree and owns the newer backend/payroll/statutory work**, but its development `/staff/*` entry is explicitly retired in favor of a redirect to 3100.
2. **3100 is the isolated Staff surface and owns the better iPhone UI plus several Staff-only features**, but it carries an older/divergent copy of shared backend code and a conflicting migration history.

The current 3000 `next.config.mjs` redirects `/staff/:path*` to `STAFF_APP_ORIGIN`, defaulting in development to `http://localhost:3100`. The 3000 unit suite even asserts that “the main system retires Staff pages in favour of the standalone Staff App.” Therefore, 3000’s internal Staff pages are currently a **shadow implementation**, not the canonical development entry.

---

## 1. Staff 3000 Current State

### 1.1 Entry point

| Item | Current state | Status |
|---|---|---|
| Browser entry | `/staff` inside the 3000 Next app | **DEAD / UNUSED** when `STAFF_APP_ORIGIN` is set; development defaults to 3100 |
| Runtime behavior | `/staff/:path*` returns a temporary redirect to `${STAFF_APP_ORIGIN}/staff/:path*` | **READY** as a retirement/forwarding mechanism, not as an independent Staff UI |
| Internal Staff implementation | Full `src/app/staff` route tree remains in the main repository | **PARTIAL** because it is implemented and tested but bypassed by the configured entry |
| PWA | Manifest starts at `/staff`, scope `/staff`, standalone display | **READY** in code, but the active host depends on redirect/deployment configuration |

Production nuance: if `STAFF_APP_ORIGIN` is absent in production, the redirect list is empty and the dormant 3000 Staff pages can render again. This environment-dependent resurrection is a major source of the “3000/3100 changed back” behavior.

### 1.2 Routes and all pages

| Route | Purpose | Implementation status |
|---|---|---|
| `/staff` | Home, clocking, employee overview | **PARTIAL** — real implementation, shadowed by redirect |
| `/staff/login` | Mobile number login | **PARTIAL** — real OTP UI, shadowed by redirect |
| `/staff/verify` | Six-digit OTP verification | **PARTIAL** — real verification flow, shadowed by redirect |
| `/staff/select-workplace` | Choose eligible employer/membership | **PARTIAL** — real multi-employer flow, shadowed by redirect |
| `/staff/history` | Attendance history and missing-punch request | **PARTIAL** — real API-backed page, older UI |
| `/staff/roster` | Published weekly schedule | **PARTIAL** — real data, older monolithic page |
| `/staff/timesheet` | Final work results, corrections, OT | **PARTIAL** — real and relatively feature-rich, shadowed |
| `/staff/leave` | Balances, leave request, documents, history | **PARTIAL** — real full-page flow, less iPhone-focused |
| `/staff/claims` | Expense claim submission, receipt, history | **PARTIAL** — real guided multi-step submission |
| `/staff/commission` | Employee commission statements | **PARTIAL** — real read-only data |
| `/staff/pay` | Pay hub and latest published pay summary | **PARTIAL** — real read-only published data |
| `/staff/payslips` | Published payslip list | **PARTIAL** — real read-only data |
| `/staff/payslips/[publicationId]` | Protected payslip PDF download Route Handler | **PARTIAL** — real protected download |
| `/staff/requests` | Employee requests plus manager summaries | **PARTIAL** — real, but IA differs from 3100 |
| `/staff/requests/overtime` | Manager OT approval queue | **READY** in code; **DEAD / UNUSED** through the current 3000 entry |
| `/staff/requests/overtime/[finalResultId]` | OT approve/adjust/reject task | **READY** in code; **DEAD / UNUSED** through the current 3000 entry |
| `/staff/approvals` | Manager Leave/Claims inbox | **READY** in code; **DEAD / UNUSED** through the current 3000 entry |
| `/staff/approvals/[domain]/[requestId]` | Leave/Claim decision detail | **READY** in code; **DEAD / UNUSED** through the current 3000 entry |
| `/staff/profile` | Employee, workplace, device, sign-out | **PARTIAL** — no avatar upload and contains redundant workplace UI |
| `/staff/device` | Profile/device confirmation view | **PARTIAL** — thin alias around Profile |
| `/staff/module-not-enabled` | Entitlement guard explanation | **READY** |
| `/staff/appointments` | Assigned appointments | **NOT PRESENT** |
| `/staff/leave/new` | Dedicated leave creation task page | **NOT PRESENT** |
| `/staff/requests/attendance-corrections` | Manager attendance correction queue | **NOT PRESENT** |
| Staff notifications page | Employee notifications | **NOT PRESENT** |

### 1.3 Bottom navigation / main navigation

3000 builds navigation dynamically from enabled business modules:

- Home → `/staff`
- Time → `/staff/history` (HR module; active for History, Roster and Timesheet)
- Requests → `/staff/requests` (HR or Claims)
- Pay → `/staff/pay` (Payroll or Commission)
- Profile → `/staff/profile`

The Chrome component still contains a complete “More” bottom sheet, workplace switcher, install action and sign-out action. However, `buildStaffNavigation()` always returns `more: []`; consequently the More sheet is **DEAD / UNUSED** while Profile is a direct primary tab.

### 1.4 Feature/domain state

| Domain | Current behavior | Status |
|---|---|---|
| Home | Greeting, Today card, domain cards, team approval summary | **PARTIAL** — real but older/card-heavy and not the active entry |
| Clock In / Out | Confirmed actions, idempotency, device capability, branch, GPS/geofence, exception path | **READY** in code |
| Breaks | Start/end break, repeat-break confirmation, flexible break total and short-break reason | **READY** in code |
| GPS | Browser geolocation, accuracy/outside-geofence handling, manager exception request; HTTPS required on mobile | **READY** |
| Attendance history | Date/branch/status filtering, canonical sessions/final outcomes | **READY** in code; older UI |
| Missing Punch | Employee correction submission and status | **READY** |
| Roster | Published shifts, approved leave, rest day/holiday evidence, weekly navigation | **READY** in data; **PARTIAL** UX |
| Timesheet | Monthly final records, issues, correction entry, potential and approved OT, locked OT | **READY** in code |
| Leave | Balance, application, withdrawal, document capture/upload/replace/remove, history | **READY** in code |
| Claims | Category-driven multi-step expense flow, mileage/general, receipt, withdrawal, history | **READY** in code |
| Commission | Estimated/approved statements | **READY** read-only |
| Payslip | Published-only list and protected PDF | **READY** read-only |
| Payroll-related views | Latest Gross/Deductions/Net summary and published documents only | **READY** read-only; payroll administration is **NOT PRESENT** |
| Leave/Claim approvals | Separate manager inbox/detail using canonical services | **READY** in code |
| OT approval | Separate queue/detail; approve, adjust or reject canonical OT review | **READY** in code; unique to 3000 |
| Attendance Correction approval | No Staff manager queue | **NOT PRESENT** |
| Profile | Identity, employment, workplace, device, multi-workplace switch, sign-out | **PARTIAL** — no avatar upload; duplicate workplace section |
| Settings | No general Staff settings page | **NOT PRESENT** |
| Employer selection | OTP membership choice plus in-app workplace switch | **READY** |
| Attendance branch selection | Can switch among authorized branches when no active shift | **READY** |
| Notifications | No Staff inbox, push subscription, or notification preference UI | **NOT PRESENT** |
| Appointments | No Staff appointment calendar | **NOT PRESENT** |

---

## 2. Staff 3100 Current State

### 2.1 Entry point

| Item | Current state | Status |
|---|---|---|
| Standalone runner | `npm run dev:staff` / `npm run start:staff` → `scripts/run-staff-app.mjs` | **READY** |
| Port | `STAFF_APP_PORT`, default `3100` | **READY** |
| Surface isolation | Sets `TETAMU_APP_SURFACE=staff`; middleware redirects back-office pages to Staff login while Staff APIs remain available | **READY** |
| PWA | `/staff` start URL, `/staff` scope, standalone display | **READY** |
| Local UAT route | `/staff/uat-sign-in`, localhost-only and production 404 | **READY** as test tooling; not a product feature |

3100 is a logical standalone surface, not a physically extracted application: the worktree still includes the full monorepo, Prisma schema and migrations.

### 2.2 Routes and all pages

| Route | Purpose | Implementation status |
|---|---|---|
| `/staff` | iPhone-first Home and Today | **READY** |
| `/staff/login` | Mobile number login | **READY** |
| `/staff/verify` | Auto-checking six-digit OTP | **READY** |
| `/staff/select-workplace` | Employer choice | **READY** |
| `/staff/appointments` | Assigned appointment day/week calendar | **READY** |
| `/staff/history` | Employee attendance history | **READY** |
| `/staff/roster` | Compact weekly schedule | **READY** |
| `/staff/timesheet` | Compact monthly work record | **READY** |
| `/staff/leave` | Balances and request history | **READY** |
| `/staff/leave/new` | Dedicated iPhone-style leave request page | **READY** |
| `/staff/claims` | Compact expense submission and history | **READY** |
| `/staff/commission` | Earnings/commission statements | **READY** read-only |
| `/staff/pay` | Published pay and commission hub | **READY** read-only |
| `/staff/payslips` | Published payroll documents | **READY** read-only |
| `/staff/payslips/[publicationId]` | Protected payslip PDF download | **READY** |
| `/staff/requests` | Employee request status and manager entry | **READY**, but manager IA is split |
| `/staff/requests/attendance-corrections` | Manager attendance exception/correction queue | **READY** |
| `/staff/approvals` | Manager Leave/Claims inbox | **READY** |
| `/staff/approvals/[domain]/[requestId]` | Leave/Claim decision detail | **READY** |
| `/staff/profile` | Avatar, identity, device and sign-out | **READY** |
| `/staff/device` | Device/profile confirmation | **PARTIAL** — thin alias rather than distinct settings IA |
| `/staff/module-not-enabled` | Entitlement explanation | **READY** |
| `/staff/requests/overtime` | Manager OT queue | **NOT PRESENT** |
| Staff notifications page | Employee notifications | **NOT PRESENT** |

Roster, Timesheet and Appointments include route-level loading/error states. The Staff root, Payslips and approval inbox also include loading/error handling.

### 2.3 Bottom navigation / main navigation

The same module-derived concepts are used:

- Home
- Time
- Requests
- Pay
- Profile

3100 stores Profile in `navigation.more`, but the Chrome renders those items directly in the bottom bar. It does **not** render a More sheet. This is semantically confusing in code but visually results in a direct Profile tab.

Task flows can call `setTaskNavigationHidden(true)` so the bottom navigation disappears while a full-screen task/sheet is open. This is better for iPhone focus than allowing the navigation to cover forms.

Home also contains direct quick-access entries for Schedule, Leave, Timesheet, Claims, Commission and Payslips. Appointments is **not** in the current navigation builder or quick-access grid; its Home entry appears only when an actual next appointment exists. The route remains directly addressable, so Appointments is currently a conditional/hidden entry rather than a guaranteed main navigation destination.

### 2.4 Feature/domain state

| Domain | Current behavior | Status |
|---|---|---|
| Home | Avatar/name, workplace, Today, next appointment only when present, upcoming schedule, compact quick access | **READY** |
| Clock In / Out | Same canonical Attendance endpoints and safety controls as 3000, reorganized for mobile | **READY** |
| Breaks | Same canonical break behavior | **READY** |
| GPS | Same browser geolocation/geofence/exception behavior; secure context required | **READY** |
| Attendance history | Compact canonical history, meaningful issue copy and 390px overflow protection | **READY** |
| Missing Punch | Employee correction flow | **READY** |
| Roster | Dedicated read model, neutral rest/leave/holiday states, multiple shifts/branches | **READY** |
| Timesheet | Locked-snapshot-first monthly record, regular hours, approved OT, confirmed daily outcomes, correction entry | **READY** |
| Leave | Dedicated create route, iPhone date picker, balances, document capture/upload, withdrawal, evidence state | **READY** |
| Claims | Compact single-form expense submission, receipt and history | **READY**; less guided than 3000’s wizard |
| Commission | Earnings statements | **READY** read-only |
| Payslip | Published-only documents and protected PDF | **READY** read-only |
| Payroll-related views | Employee-only pay/commission/payslip; no draft payroll | **READY** read-only |
| Leave/Claim approvals | Separate canonical manager inbox/detail | **READY** |
| Attendance Correction approval | Separate scoped queue, excludes self-review, reuses canonical resolution workflow | **READY** |
| OT approval | No Staff manager queue/detail | **NOT PRESENT** |
| Appointments | Read-only assigned bookings, exact membership-linked staff mapping, status/week/day/conflict indicators | **READY** |
| Profile | Self avatar upload, employee/workplace/device, sign-out | **READY** |
| Appearance | Business Staff logo and configurable six quick-access images | **READY** in this branch, schema-dependent |
| Employer selection | Multi-employer login and in-app switch | **READY** |
| Attendance branch selection | Same authorized switch behavior | **READY** |
| Notifications | No Staff inbox/push/preferences | **NOT PRESENT** |

---

## 3. Navigation Comparison

| Area | Staff 3000 | Staff 3100 | Audit finding |
|---|---|---|---|
| Bottom tabs | Home / Time / Requests / Pay / Profile, module-dependent | Same domain model; Profile is internally stored under `more` but displayed directly | 3100 rendering is cleaner; its navigation data model should be simplified |
| More menu | Full sheet code exists but `more` is always empty | No More sheet; `more` items render directly | 3000 More code is **DEAD / UNUSED** |
| Home quick access | Domain cards and request/approval summaries | Compact icon grid plus upcoming schedule/appointment | 3100 is easier at 390px, but duplicates some bottom-tab destinations |
| Time hierarchy | Time tab lands on History; Roster/Timesheet are nested/quick links | Same concept, with richer Schedule/Timesheet pages | “Time” is vague; route labels switch among Time, Attendance, Schedule and Timesheet |
| Requests hierarchy | Leave/Claims/self status plus Team Approvals and OT approval | Leave/Claims/self status plus Team Approvals and Attendance Corrections | Manager work is fragmented differently in each branch |
| Pay hierarchy | Pay hub → Commission/Payslips | Pay hub → Commission/Payslips | Mostly consistent |
| Profile | Primary tab plus duplicated workplace selector in page/header | Direct visual tab, workplace selector mainly in header | 3100 avoids more duplicate entry points |
| Workplace switch | Header, More sheet, and Profile section | Header/workplace sheet; Profile no duplicate list | 3000 is confusing; 3100 is clearer |
| Hidden task behavior | Bottom nav may remain behind forms/sheets | Task flows can hide bottom nav | 3100 is better on iPhone |
| Appointments | No entry | Dedicated page, but Home link appears only when a next appointment exists | 3100 only; currently a conditional/hidden entry |
| Manager OT | Requests → Overtime | No entry | 3000 only |
| Manager Attendance Corrections | No entry | Requests → Attendance Corrections | 3100 only |

### Duplicate or confusing entry points

- Home quick access can duplicate bottom tabs (Schedule/Leave/Pay-related features).
- `/staff/requests` is both employee self-service and a manager launchpad.
- `/staff/approvals` is a second manager workspace while Attendance Corrections and OT live outside it.
- “Time”, “Attendance”, “History”, “Schedule/Roster” and “Timesheet” are not consistently distinguished.
- 3000 has workplace switching in header, More sheet and Profile; 3100 has already removed most of that duplication.
- Both retain `/staff/device` even though Profile already displays the device.

---

## 4. Feature Matrix

| Feature | Staff 3000 | Staff 3100 | Better implementation | Notes |
|---|---|---|---|---|
| Login / OTP | **PARTIAL** active entry redirected; current main backend includes SMS123 operational alerts | **READY** standalone UI/flow | Split decision | Use 3100 UI with current 3000 auth/provider hardening |
| Multi-employer | **READY** in code | **READY** | 3100 UX | Same membership/session concept |
| Workplace selection | **READY**, duplicated in Profile/More/header | **READY**, cleaner header sheet | 3100 | Both server-scope tenant switch and hard-reset client state |
| Home | **PARTIAL** older shadow UI | **READY** iPhone-first | 3100 | Preserve canonical readers, not old cards |
| Clock In / Out | **READY** | **READY** | Tie, 3100 presentation | Core Route Handlers are identical |
| GPS | **READY** | **READY** | Tie | HTTPS/secure context is mandatory on mobile |
| Breaks | **READY** | **READY** | Tie | Same canonical behavior |
| Roster | **READY** data, older UI | **READY** dedicated read model | 3100 | 3100 has better neutral states/loading/error |
| Attendance History | **READY** | **READY** | 3100 | 3100 has clearer issue language and 390px guards |
| Missing Punch | **READY** | **READY** | 3100 UX | Same correction endpoints |
| Timesheet | **READY**, exposes potential/approved/locked OT | **READY**, locked-snapshot-first compact UI | 3100 UI; preserve 3000 OT detail | Do not lose potential-vs-approved explanation |
| Leave Balance | **READY** | **READY** | 3100 | Same canonical Leave service |
| Leave Application | **READY** inline with page | **READY** dedicated task page | 3100 | Both support private evidence documents |
| Claims | **READY** guided wizard | **READY** compact form | Needs decision | Preserve 3000’s guided validation; use 3100 shell/layout |
| Commission | **READY** read-only | **READY** read-only | 3100 UX | Same statement source |
| Payslip | **READY** published-only | **READY** published-only | 3100 UX | Protected PDF route in both |
| OT employee view | **READY** potential/approved/locked | **READY** approved canonical OT | Needs decision | 3000 is more transparent; 3100 is simpler |
| OT manager approval | **READY** | **NOT PRESENT** | 3000 | Must be preserved or moved to canonical Approval Center |
| Approvals | **READY** Leave/Claims plus separate OT | **READY** Leave/Claims plus separate Attendance Corrections | Neither complete | Consolidate manager tasks |
| Leave Approval | **READY** | **READY** | Tie | Identical Staff approval route/action files |
| Claim Approval | **READY** | **READY** | Tie | Identical Staff approval route/action files |
| Attendance Correction Approval | **NOT PRESENT** | **READY** | 3100 | Canonical resolution workflow, branch scoped, self-review blocked |
| Notifications | **NOT PRESENT** | **NOT PRESENT** | Neither | Notification infrastructure elsewhere is not exposed as Staff UI |
| Appointments | **NOT PRESENT** | **READY** | 3100 | Read-only and privacy-scoped |
| Profile | **PARTIAL**, no avatar and redundant workplace block | **READY**, avatar/device/sign-out | 3100 | Avatar depends on 3100 API/runtime storage strategy |
| Staff appearance/logo/icons | **NOT PRESENT** in current 3000 Prisma schema | **READY** | 3100 | Migration/schema conflict must be resolved first |
| General Settings | **NOT PRESENT** | **NOT PRESENT** | Neither | Device is informational, not a complete settings area |

---

## 5. Approval Architecture

### 5.1 Where approvals currently live

- **Leave approval is not inside the employee Leave page.** Managers use `/staff/approvals` and `/staff/approvals/LEAVE/:requestId`.
- **Claim approval is not inside the employee Claims page.** Managers use `/staff/approvals` and `/staff/approvals/CLAIMS/:requestId`.
- A separate Staff **Team Approvals** page therefore exists in both trees.
- 3000 adds another separate manager flow under `/staff/requests/overtime`.
- 3100 adds another separate manager flow under `/staff/requests/attendance-corrections`.

This does not create duplicate Leave or Claim records, but it does create duplicate manager navigation concepts.

### 5.2 Canonical backend records

| Approval domain | Canonical record/state | Manager write path |
|---|---|---|
| Leave | `LeaveRequest.status` and `revision` | `reviewLeaveRequest()` |
| Claim | `EmployeeClaim.status`, line decisions and `revision` | `reviewEmployeeClaim()` |
| Attendance exception | `AttendanceException.status` | `reviewAttendanceException()` |
| Attendance correction | `AttendanceResolutionCase` plus immutable/final result workflow | `applyManagerAttendanceResolution()` |
| OT | `AttendanceOvertimeReview.status`, approved minutes and review events | Canonical OT review service reused by 3000 mobile actions |

`getUnifiedApprovalInbox()` projects canonical records into a common `ApprovalInboxItem`; it does not persist a second approval item table. `HrApprovalPolicy` and `HrApprovalDecision` represent configured approval stages and decisions/audit. They do not replace `LeaveRequest.status` or `EmployeeClaim.status`.

### 5.3 Duplicate workflow risk

- Leave/Claims are reasonably canonical: both Staff trees call the same domain services and their common mobile approval pages/actions are identical.
- Attendance currently has multiple generations of records (`EmployeeAttendance`, `AttendanceException`, `AttendanceResolutionCase`, P2 correction/final result and OT review). These are domain pipeline stages, not specifically 3000/3100 duplicates, but they make merging UI by copying code dangerous.
- Mobile manager IA is not canonical: 3000 exposes OT; 3100 exposes Attendance Corrections; neither exposes a single complete “what needs my approval” experience.
- The generic approval reader supports a wider action-center concept, while the Staff mobile approval domain type is deliberately limited to `LEAVE | CLAIMS`. OT and Attendance Corrections are therefore parallel queues.

### 5.4 Who sees pending approvals

- A Business Owner linked to the active employee membership receives owner-level access and all active branches.
- A Staff user must have explicit capability-backed permissions:
  - `APPROVE_LEAVE` for Leave.
  - `REVIEW_CLAIM` for Claims.
  - `MODIFY_ATTENDANCE_EMPLOYEES` for Attendance corrections and 3000 OT approval.
- `ALL_BRANCHES` expands scope; otherwise the actor is limited to the current/assigned branch.
- Self-review is blocked/excluded.
- Relevant modules must also be enabled (`HR`, and `CLAIMS` where applicable).

---

## 6. Permissions / RBAC

### 6.1 Actual model

The database has only three application user roles: `PLATFORM_ADMIN`, `BUSINESS_OWNER`, and `STAFF`. “Supervisor”, “Branch Manager”, “HR” and “Payroll Admin” are not distinct `UserRole` enum values in this Staff App architecture. They are business-defined `StaffRoleProfile.name` labels with permission arrays.

This is important: **manager access is capability-based, not role-name-based**. Both Staff trees correctly use `canDirectStaff()` and explicit capabilities for manager actions. They do not grant approval because the profile name happens to be “Manager”.

### 6.2 Effective Staff App visibility

| Persona | What the Staff App actually shows |
|---|---|
| Normal Staff | Own Home, own clocking, own schedule/history/timesheet/Leave/Claims/Pay/Profile when the business module is enabled; no team approval queue |
| Supervisor | No automatic behavior from the word “Supervisor”; receives manager queues only if the linked `StaffUser` has the required capability and branch scope |
| Branch Manager | Same as Supervisor; usually branch-limited unless `ALL_BRANCHES` is granted |
| HR | No special enum; requires HR module plus `APPROVE_LEAVE` and/or `MODIFY_ATTENDANCE_EMPLOYEES` to see corresponding manager work |
| Payroll Admin | No payroll-admin workspace inside Staff App; can still see only their own published pay unless also granted a manager capability for another Staff workflow |
| Business Owner | All relevant Staff manager capabilities and whole-business branch scope, provided the owner is linked to an active employee membership/session |
| Platform Admin | Not a normal employee self-service persona; Staff pages are driven by Employee Auth, not platform session alone |

### 6.3 Gaps

- Self-service page visibility is primarily gated by **module entitlement** and active Employee Session/device, not fine-grained per-employee capabilities.
- `EmployeeAuthProfile.capabilities` only exposes `canView` and `canPunch`; manager capabilities are resolved indirectly from the membership’s linked `StaffUser`.
- The dual identity model (Employee membership for self-service, StaffUser for manager powers) is correct but easy to break during consolidation.
- Payroll Admin and HR are organizational personas, not code-level roles; documentation and UI should not imply role-name security.

---

## 7. Backend / API Dependency

### 7.1 Common REST Route Handlers

Both trees contain these Staff-facing Route Handlers:

- Authentication: `/api/employee-auth/request-otp`, `verify-otp`, `select-membership`, `workplaces`, `switch-workplace`, `me`, `modules`, `logout`.
- Attendance: `/api/employee-attendance/today`, `clock-in`, `clock-out`, `break-start`, `break-end`, `history`, `exception`, `p2-corrections`, `resolutions`, `switch-branch`.
- Leave: `/api/employee-leave` plus protected request/document endpoints.
- Claims: `/api/employee-claims`.
- Manager attachments: `/api/staff-approvals/claim-attachments/:id`, `/api/staff-approvals/leave-documents/:id`.

Clock/break/history/today and most auth route files are byte-identical. The exception, logout and Leave route implementations have diverged.

### 7.2 3100-only endpoints

- `/api/employee-appointments`
- `/api/employee-auth/avatar`

### 7.3 Server-side readers/actions

This is not a tRPC application. Staff pages use:

- Next REST Route Handlers called by `staffApiFetch()` for interactive employee mutations.
- Next Server Actions for mobile manager approval forms.
- Direct server-side shared services/read models for Roster, Timesheet, Commission, Payslip and approval inboxes.

Key shared services include:

- `src/lib/attendance/*`
- `src/lib/roster/service.ts`
- `src/lib/leave/service.ts`
- `src/lib/claim/service.ts`
- `src/lib/commission/read.ts`
- `src/lib/payroll/payslip-publication.ts`
- `src/lib/approvals/service.ts`

### 7.4 Session and tenant identifiers

Both use `EmployeeAuthContext` with:

- `sessionId`
- `employeeAccountId`
- `membershipId` (the employee business membership)
- `businessId`
- `primaryBranchId`
- optional `attendanceBranchId`
- `deviceId`

The Staff APIs re-resolve the active session and tenant scope server-side. `businessId`, branch and membership are not trusted from arbitrary client form values.

### 7.5 Shared versus divergent dependencies

| Area | Relationship |
|---|---|
| Punch REST handlers | Mostly identical |
| Leave/Claims/Attendance canonical services | Conceptually shared, copied in both worktrees |
| OTP config | Identical provider configuration shape |
| OTP provider/service | Diverged; 3000 contains newer SMS123 operational alert hooks, while 3100 contains branch-specific OTP changes |
| Profile model | 3100 adds `avatarUrl` to Employee Auth profile |
| Home/Schedule/Timesheet read models | 3100-specific presentation/read-model modules |
| Appearance | 3100-specific service and Business fields |
| OT mobile manager service | 3000-specific |
| Attendance correction mobile manager service | 3100-specific |

---

## 8. Data / State Ownership

| Domain | Canonical source | Frontend/derived state | Divergence finding |
|---|---|---|---|
| Employee identity | `EmployeeAccount` + `EmployeeBusinessMembership` | Selected membership/session | Common concept; 3100 profile additionally exposes avatar |
| Session/device | `EmployeeSession` + `EmployeeDevice` | Cookie and local device identifier | Common concept; implementation files have drifted |
| Attendance | `EmployeeAttendance` + `AttendancePunch` | Today/history view models | Common canonical records |
| Attendance resolution | `AttendanceException`, `AttendanceResolutionCase`, final result models | Queue and employee issue copy | No separate app state, but multiple pipeline generations are architecturally complex |
| OT | `AttendanceOvertimeReview` + events, linked to P2 final result | Potential/effective/approved display | 3000 has manager UI; 3100 only employee display |
| Timesheet | `AttendanceMonthlyTimesheet` plus locked P2 snapshots | Monthly summary/daily cards | 3100 correctly prefers locked snapshots |
| Leave | `LeaveRequest`, balances, request days, evidence documents, ledger/buckets | Balance/history UI | Both write canonical Leave service |
| Claims | `EmployeeClaim`, lines, attachments, reimbursement, events | Form step/history UI | Both write canonical Claim service |
| Commission | `CommissionPeriod`, `CommissionStatement`, accruals/adjustments | Employee earnings view | Read-only in Staff |
| Payslip | `PayrollPayslipPublication` | Published document list/PDF | Read-only in Staff; draft payroll is never exposed |
| Approvals | Canonical domain status plus `HrApprovalDecision` stage history | Unified inbox projections | No persistent duplicate unified approval item |
| Appointments | Canonical `Appointment`, exact membership-linked User assignment | Day/week presentation and conflict warnings | 3100 only; read-only |

### Duplicate state conclusion

- There is **no evidence that 3000 and 3100 intentionally maintain separate Leave, Claim, Attendance, OT, Commission or Payslip tables**.
- There **is** duplicated application code and duplicated read-model logic capable of interpreting the same canonical records differently.
- Local component state (form steps, filters, selected files, loading/errors) is frontend-only and not a second domain source.
- The largest data risk is not duplicate rows; it is **schema/migration divergence**.

### Prisma/migration divergence — HIGH RISK

Both migration directories contain 211 migration folders, but three names exist only in each branch:

3000-only:

- `20260826173000_non_production_statutory_fixture_evidence_facility`
- `20260827153000_pcb_2026_p1_correctness_foundation`
- `20260827170000_effective_dated_statutory_participation`

3100-only:

- `20260822010000_staff_app_appearance`
- `20260822023000_development_concurrent_otp_challenges`
- `20260824130000_staff_app_sms123_otp`

The Prisma schema hashes differ. Notably, 3100’s `Business` includes Staff App logo/appearance fields that the current 3000 schema does not; 3100’s OTP challenge includes a provider message code field absent from 3000, while 3000 contains newer statutory participation models absent from 3100.

**Do not deploy migrations independently from these two worktrees against one database.** The migration histories must be reconciled before consolidation or deployment.

---

## 9. UI / UX Audit

| Criterion | Staff 3000 | Staff 3100 | Finding |
|---|---|---|---|
| Information hierarchy | Older hub/card pattern; Home and Requests carry more competing summaries | Today-first, compact sections and dedicated task pages | 3100 better |
| Navigation clarity | Dead More implementation, duplicate workplace switch, mixed self/manager Requests | Cleaner direct Profile and task-nav hiding, but manager queues still split | 3100 better but not final |
| Mobile usability | Mobile CSS exists, but more desktop-like cards/forms remain | Explicit iPhone-first work with `svh/dvh`, safe areas and compact card layouts | 3100 better |
| 390px responsiveness | Basic max-width/media rules; some long fields/cards are fragile | Dedicated compact rules and tested horizontal clipping | 3100 better |
| Visual clutter | More labels, larger cards, duplicate workplace data | Smaller hierarchy, conditional empty sections, icon quick access | 3100 better |
| Duplicate actions | Profile/header/More workplace switching; quick cards overlap nav | Fewer duplicates, but Home quick access still overlaps Time/Requests/Pay | 3100 better |
| Terminology | “Time”, “Attendance”, “History”, “Roster”, “Schedule”, “Timesheet & overtime” | Improved copy but still mixes Requests/Approvals/Corrections | Needs canonical glossary |
| Empty states | Present but inconsistent | More deliberate neutral schedule/history/appointment states | 3100 better |
| Loading states | Root and some areas only | Dedicated Roster/Timesheet/Appointments plus shared states | 3100 better |
| Error states | General root/profile errors; fewer route-specific recoveries | More route-specific, retry-oriented errors | 3100 better |
| Approval consistency | Leave/Claims and OT use different workspaces | Leave/Claims and Attendance Corrections use different workspaces | Neither complete |
| Employee comprehension | Functionally complete but manager terminology leaks into some areas | Better employee-safe copy and read-only boundaries | 3100 better |
| Manager discoverability | OT and Team Approvals separated | Attendance Corrections and Team Approvals separated | Both need one manager task center |

Additional UI findings:

- 3100’s Staff stylesheet is about 6,121 lines versus about 2,880 in 3000. Its UX is better, but the single growing stylesheet is a maintainability risk.
- Both `staff-today.tsx` copies still contain a mojibake location string (`Getting your locationâ€¦`) in one path.
- 3100 deliberately removed header blur and uses stronger iPhone safe-area behavior; this directly addresses prior “top is blurry / bottom blank” complaints.
- Fixed bottom navigation plus large forms remains sensitive to visual viewport changes when iOS opens the keyboard.
- Manager tasks should not be mixed with normal employee request history without a clear role-aware heading/badge.

---

## 10. 3000-only Features

1. **Mobile manager OT approval queue and detail** with approve/adjust/reject, branch scope, self-review guard and locked-timesheet guard.
2. **More transparent employee OT presentation** showing potential, approved and locked OT classifications.
3. **Richer guided Claims wizard** with staged validation/review before submit.
4. **Older Home team-approval summary** directly on Home.
5. **Current main-worktree backend advances**, including newer statutory/PCB models and SMS123 operational alerting.
6. **Dormant More-sheet implementation** — code-only and currently unused; it should not be preserved as a feature without a navigation decision.

---

## 11. 3100-only Features

1. **Assigned Appointments** day/week calendar, exact staff mapping and conflict warnings.
2. **Manager Attendance Correction queue** using canonical exception/resolution services.
3. **Dedicated `/staff/leave/new` task route** with iPhone-style date selection and focused submission.
4. **Employee avatar upload** and avatar rendering.
5. **Configurable Staff logo and six quick-access images**.
6. **Dedicated Staff Schedule and Timesheet presentation/read models**.
7. **More complete route loading/error states** for Roster, Timesheet and Appointments.
8. **Task navigation hiding** to prevent bottom navigation from covering focused workflows.
9. **Local-only UAT sign-in helper**, protected by production/hostname checks.

---

## 12. Duplicate / Conflicting Implementations

| Conflict | Evidence | Impact |
|---|---|---|
| Duplicate route tree | Both have nearly all `/staff` routes/components | Fixes can land in the wrong copy and silently disappear |
| Entry ownership conflict | 3000 contains Staff pages but redirects to 3100 in development | Environment changes can switch UI unexpectedly |
| Navigation model conflict | 3000 Profile is primary; 3100 Profile is stored in `more` but rendered primary | Harder to reason about active tabs and future More behavior |
| Requests/approval conflict | 3000 has OT; 3100 has Attendance Corrections | Neither branch is feature-complete alone |
| Home conflict | 3000 older cards/team summary; 3100 iPhone Today/quick access/appointments | Different hierarchy and duplicate entry decisions |
| Timesheet conflict | 3000 potential/approved/locked OT list; 3100 compact locked-snapshot model | Merging visually can lose compliance-relevant meaning |
| Claims conflict | 3000 guided wizard; 3100 compact one-page form | UX and validation rhythm differ despite same API |
| Profile conflict | 3000 workplace duplication/no avatar; 3100 avatar/cleaner workplace | API and data shape differ |
| Appearance conflict | 3100 queries schema fields absent in 3000 | Direct copy can trigger Prisma validation/runtime errors |
| OTP/backend conflict | Common config but provider/service/session files differ | Auth fixes can regress when UI branch is promoted wholesale |
| API conflict | Exception/logout/Leave/document handlers have branch differences | Same URL can behave differently by port |
| Schema conflict | Different Prisma schema and three unique migrations per branch | Highest risk; can break deployment or shared DB |
| CSS conflict | Large independent Staff style layers | Visual regressions, duplicated selectors and specificity fights |
| Status terminology | Same canonical states mapped to different labels | Employee/manager confusion and support burden |

---

## 13. Consolidation Risk

| Area | Risk classification | Recommendation |
|---|---|---|
| Identical Clock/Break REST handlers | **SAFE TO MERGE** | Keep one copy and retain existing tests |
| Leave/Claim mobile approval pages/actions | **SAFE TO MERGE** | They are identical and already call canonical services |
| 3100 Schedule/History/Timesheet presentation helpers | **SAFE TO MERGE** with regression tests | Move as presentation/read models; keep canonical domain services |
| 3100 Appointments | **SAFE TO MERGE** with SALON entitlement and privacy tests | Preserve exact membership-linked mapping |
| 3100 avatar UI/API | **NEEDS DECISION** | Decide durable object storage/runtime file strategy before production |
| Home/Bottom navigation | **NEEDS DECISION** | Define final IA first; do not combine both sets of cards/tabs |
| Claims UI | **NEEDS DECISION** | Choose guided wizard versus compact form; retain all validation |
| Employee OT presentation | **NEEDS DECISION** | Decide whether staff should see potential OT or approved OT only |
| Manager task center | **HIGH RISK** | Unify Leave, Claims, Attendance Corrections and OT without duplicating writes |
| Authentication/session/provider code | **HIGH RISK** | Base on current 3000 security/ops code, then port only required 3100 UI/data-shape additions |
| Prisma schema/migrations | **DO NOT MERGE DIRECTLY** | Reconcile both histories into one reviewed migration lineage |
| Whole-worktree copy/cherry-pick | **DO NOT MERGE DIRECTLY** | It would overwrite newer payroll/statutory/backend work or lose Staff features |
| Deleting 3000 Staff routes immediately | **DO NOT MERGE DIRECTLY** | First switch to one canonical entry and add route/feature regression coverage |

---

## 14. Recommended Canonical Base

### Recommendation: establish a new canonical Staff App shell inside the current 3000/main codebase

Do **not** treat either worktree as a complete drop-in base.

The recommended canonical result is:

1. **Repository/backend base: current 3000 main worktree.** It contains newer payroll/statutory work, operational SMS123 alerting and the main migration lineage that the rest of Tetamu is actively advancing.
2. **Staff presentation shell: port the 3100 iPhone-first route/component/read-model layer into that main worktree.** Preserve its Home, Appointments, Schedule, Timesheet, History, Leave task flow, avatar/Profile and mobile navigation behavior.
3. **Manager capabilities to preserve from both:** 3100 Attendance Corrections plus 3000 OT approval, folded into one canonical role-aware manager task center alongside Leave/Claims.
4. **One runtime only:** after parity tests pass, run Staff from the 3000 application/deployment and remove the redirect dependency. The current 3100 worktree should then stop being an independently deployable schema/migration owner.

Why not choose 3000 alone:

- Its current Staff entry is intentionally retired.
- It lacks Appointments, avatar, Attendance Correction manager UI and the strongest iPhone UX.

Why not choose 3100 alone:

- Its shared backend and migration history is behind/divergent from the current main tree.
- It lacks mobile OT manager approval.
- Promoting it wholesale risks overwriting newer payroll/statutory/auth/ops work.

This is effectively a **new canonical shell**, but it should live in the 3000/main repository and reuse one canonical backend/schema rather than becoming a third implementation.

---

## 15. Final Summary

**STAFF 3000 STATUS:**  
Implemented and tested shadow Staff copy inside the main application, but the development entry is explicitly redirected to 3100. Stronger/current backend ownership; incomplete current mobile feature set; unsafe as a direct UI base without porting 3100 work.

**STAFF 3100 STATUS:**  
The current standalone Staff surface and the better iPhone implementation. It is more complete for employee UX, Appointments, avatar and Attendance Corrections, but lacks mobile OT approval and carries a divergent backend/schema/migration copy.

**Recommended canonical base:**  
A new canonical Staff shell in the current 3000/main repository: 3000 backend/schema/security as the foundation, 3100 Staff UI/read-model features as the presentation layer.

**Features to preserve from 3000:**  
Current auth/OTP operational hardening, canonical payroll/statutory backend, OT manager approval, potential-vs-approved OT transparency, guided Claim validation, existing canonical approval and punch services.

**Features to preserve from 3100:**  
iPhone-first Home/navigation/safe-area behavior, Appointments, compact Schedule/History/Timesheet, dedicated Leave request route and date picker, Attendance Correction manager queue, avatar/Profile, appearance controls, route loading/error states.

**Duplicate/conflicting areas:**  
Route trees, navigation, Home, Requests/Approvals, Timesheet/OT labels, Claims flow, Profile/workplace, OTP/session implementation, REST handler variants, CSS, Prisma schema and migration history.

**Biggest UX problems:**  
Manager tasks are split across multiple places; feature labels are inconsistent; Home quick access duplicates navigation; 3000 has redundant workplace entry points; fixed mobile navigation and large forms remain sensitive to iPhone viewport/keyboard behavior.

**Biggest architecture risks:**  
Environment-dependent 3000 redirect behavior, two editable copies of shared services, dual EmployeeMembership/StaffUser identity mapping, multi-generation Attendance records, and especially incompatible Prisma migration lineages.

**Recommended consolidation direction:**  
First freeze one canonical schema/migration lineage, then port 3100 presentation features into 3000 behind the existing canonical services, combine all manager approvals into one capability-aware task center, run parity/security/mobile tests, switch the sole Staff entry to 3000, and only then retire the 3100 runtime. No direct folder overwrite or dual migration deployment should be attempted.
