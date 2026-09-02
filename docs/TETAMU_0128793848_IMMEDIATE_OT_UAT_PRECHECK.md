# TETAMU — 0128793848 Immediate OT Real-Device UAT Precheck

## 1. Executive Summary

This audit was executed against Railway `testing` only on 27 Aug 2026. The Testing web health endpoint returned release commit `4070f2fdeca66870004065efdad3b0d69d5274c6` and a server time of approximately 16:01 MYT before roster preparation.

`UAT-PAYROLL-001` is a valid global Staff App identity and has an active Royal Salon membership at `salon online`. Its attendance, leave, overtime, timesheet, holiday, and payroll inputs were clean for 27 Aug 2026. Manager `EMP-005` also has the required Royal Salon branch scope and attendance-management permission.

A canonical published-roster amendment was attempted for 16:30–17:00 MYT with a zero-minute break. The roster service created publication revision 2, but incorrectly classified the new future shift as `RETROSPECTIVE_REVIEW_REQUIRED` and did not materialise a current `AttendanceExpectedDay`.

The immediate real-device test is therefore **BLOCKED**. No one should Clock In against this incomplete fixture.

## 2. Identity Resolution

- Global Employee Account: `7260972a-e431-4ea1-bc69-b604a997ef0a`
- Name: Real Device Payroll UAT Staff
- Normalised phone: `+60128793848`
- Global status: `ACTIVE`
- Royal Salon membership: `72f21dad-66d0-45fc-a326-2a8c5f55ffdb`
- Payroll UAT Business membership: `091ba7be-ced0-418b-8cf9-526921f10866`
- Legacy/User rows attached directly to the EmployeeAccount: none
- Employee sessions show that both Royal Salon and Payroll UAT Business have previously been selected successfully.

The canonical Staff App identity is the active `EmployeeAccount` plus an eligible active business membership and branch assignment. A Desktop `User` row is not required for ordinary employee login.

## 3. Royal Salon Membership

- Business ID: `611b0c19-ebf7-4548-8a48-a3b6a7af8a81`
- Membership ID: `72f21dad-66d0-45fc-a326-2a8c5f55ffdb`
- Employee code: `UAT-PAYROLL-001`
- Membership status: `ACTIVE`
- Attendance enabled: yes
- Branch ID: `41575966-238f-46ab-a114-22bbee4949c5`
- Branch: `salon online`
- Branch assignment ID: `87fe598c-8884-44c5-8c2f-ca9c03f73fa1`
- Primary assignment: yes
- Assignment status: `ACTIVE`
- Clock In allowed: yes
- Branch Attendance setting: enabled
- Time zone: `Asia/Kuala_Lumpur`
- Geofence required: no
- Business selector can reach Royal Salon: yes; a prior Royal Salon employee session exists.

## 4. Staff User Contradiction

Classification: **QUERY / SCOPE BUG**.

The Royal Salon membership and Payroll UAT membership both have `staffUser = null`. This does not mean the employee lacks a Staff App identity. Employee authentication resolves the global `EmployeeAccount` and eligible memberships directly. The later OT employee search treated the optional membership-to-Desktop-User relation as if it were the Staff App identity, producing the misleading “no linked Staff User” result.

Current login state:

- Global Staff identity: usable
- Staff App login: enabled by active EmployeeAccount, membership, attendance setting, primary branch assignment, and `canClockIn`
- Optional Desktop `staffUser`: missing
- `loginEnabled`: not applicable to the employee EmployeeAccount flow

## 5. Attendance Eligibility

Before roster preparation, the Royal Salon membership passed all employee gates:

- Active global identity: PASS
- Active Royal Salon membership: PASS
- Active primary `salon online` assignment: PASS
- Attendance enabled: PASS
- Can Clock In: PASS
- HR module enabled: PASS
- No current Timesheet lock: PASS
- No payroll attendance snapshot: PASS

The employee must select **Royal Salon**, not Payroll UAT Business, for this OT test.

## 6. Today Conflict Check

Read-only checks for 27 Aug 2026, Royal Salon membership only, before the roster operation:

| Check | Result |
| --- | --- |
| Approved Leave / Leave day | none |
| Pending Leave | none |
| Attendance row | none |
| Clock In / Clock Out punches | none |
| P2 final result | none |
| Attendance correction | none |
| OT review | none |
| Roster assignment | none |
| Published roster for target | none |
| Current Expected Day | none |
| Locked monthly Timesheet | none |
| PayrollAttendanceInputSnapshot | none |
| Payroll Entry | none |
| HolidayOccurrence / PayrollHoliday | none |

No Attendance, punch, P2 result, OT review, correction, Timesheet lock, or Payroll data was created by this task.

## 7. Workday Type

Calendar checks found no public holiday, rest-day evidence, or leave conflict for the target. The intended shift was a normal `WORKDAY`.

After publication, however, the target still has no current `AttendanceExpectedDay`. The effective current workday type is therefore **OTHER / NOT MATERIALISED**, not a safe normal workday.

## 8. Manager Scope

Manager:

- Name: Real Device UAT Manager
- Employee ID: `EMP-005`
- Phone: `+601151300932`
- Manager membership ID: `3ed1909b-f624-49cb-9457-efecec9e776a`
- Manager User ID: `5840c06f-fd53-4d8f-8983-e70d0011f876`
- Business: Royal Salon
- Branch: `salon online`
- User status: active
- Login enabled: yes
- Role: `STAFF`
- Raw permission: `ATTENDANCE_EMPLOYEE_MANAGE`

Scope result:

- Same business: PASS
- Authorized branch: PASS
- `ATTENDANCE_EMPLOYEE_MANAGE`: PASS
- `MODIFY_ATTENDANCE_EMPLOYEES`: PASS through the direct-staff capability mapping
- Self approval conflict: NO
- Manager mobile route: `/staff/requests/overtime`

## 9. Timesheet State

Royal Salon has no August 2026 `AttendanceMonthlyTimesheet` row for this precheck scope. Therefore:

- Monthly Timesheet locked: NO
- OT decision blocked by Timesheet lock: NO
- Timesheet reopened or altered: NO
- Payroll snapshots altered: NO

## 10. Roster Preparation

Requested candidate shift:

- Date: 27 Aug 2026
- Shift: 16:30–17:00 MYT
- Break: 0 minutes
- Intended Expected Day: `WORKDAY`
- Reason: `REAL_DEVICE_OT_UAT_TESTING_ONLY`
- Canonical actor: Oscar Salon (`44558b92-05a0-44cf-90f7-1c38c2947933`)

Canonical workflow evidence created in Royal Salon only:

- Roster period: `d27b4a99-c996-4259-8938-4a5689b79a90`
- Prior publication revision: 1
- New publication revision: 2
- Roster assignment: `59db8760-8b72-4d2b-a4d4-6c8e406bdb77`
- Roster publication: `454ceb54-787e-48f6-aeb4-53bf387a00b2`
- Published assignment snapshot: `5c827344-b7ba-483f-9096-6c51c3b46bfa`
- Published at: 27 Aug 2026 16:02:13 MYT
- Snapshot disposition: `RETROSPECTIVE_REVIEW_REQUIRED`
- Evidence reference: null
- Current Expected Day created: NO

The publication code stores historical state in a date-only set. Another Royal Salon employee already had a 09:00–18:00 MYT shift on 27 Aug, which had started by publication time. That made the whole date historical. The later snapshot loop checked only the date, so the target's still-future 16:30 shift inherited retrospective treatment. This is a code defect in the canonical publication path, not an employee-data blocker.

No direct `AttendanceExpectedDay` write or other workaround was performed.

## 11. Human Employee Steps

For the current 27 Aug fixture:

1. Do **not** Clock In at 16:30 MYT.
2. Do not create or correct Attendance manually.
3. Do not use Payroll UAT Business for this OT test.
4. Wait for a separately authorized fix and Testing verification of the date-level retrospective classification defect.
5. Re-run this precheck and publish a new future shift before starting the human device flow.

## 12. Human Manager Steps

Do not open or approve an OT item for this fixture because no valid Expected Day or Attendance final result exists. After a future clean fixture is prepared, the Manager flow remains:

`EMP-005` → `/staff/requests/overtime` → Approve full OT.

## 13. Employee Final Check

Do not expect an OT result for the current fixture. After a later human Clock In/Out and Manager approval on a valid fixture, the employee result route is:

`/staff/timesheet` → My overtime → `APPROVED`.

## 14. Payroll UAT Isolation

- Payroll UAT Business ID: `b87aaa12-b41d-44b5-908e-72d04e6a08a0`
- Payroll UAT membership ID: `091ba7be-ced0-418b-8cf9-526921f10866`
- Payroll UAT Business data changed: NO
- Published payslip changed: NO
- Locked Timesheet changed: NO
- Payroll run changed: NO
- Statutory evidence changed: NO
- Production touched: NO

All created roster evidence belongs only to Royal Salon / `salon online`.

## 15. Final Verdict

**BLOCKED**

Exact blocker: the canonical Roster publication incorrectly applies same-date retrospective classification to the target's future shift because another employee's shift on that date has already started. The target receives a retrospective snapshot and no current `WORKDAY` Expected Day.

Next clean date candidate: **28 Aug 2026**. Read-only checks found no target Leave, Attendance, P2 final, OT review, Roster, Expected Day, Timesheet lock, Payroll snapshot, Payroll Entry, or holiday conflict for that date. Because another employee's normal 09:00 MYT shift exists, any retry should occur only after the defect is fixed, or under a separately reviewed plan that publishes before any same-date shift begins. A fresh precheck remains mandatory.

Code changed: NO application code.

Deployment: NOT REQUIRED and not performed.

Real-device OT UAT: **NOT YET PASS — HUMAN ACTION MUST NOT START ON THIS FIXTURE**.
