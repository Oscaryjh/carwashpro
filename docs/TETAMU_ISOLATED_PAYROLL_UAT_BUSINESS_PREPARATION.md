# TETAMU Isolated Payroll UAT Business Preparation

Prepared on 26 August 2026 for Railway Testing only.

## 1. Testing Boundary

- Environment: `testing`
- Desktop: `https://tetamu-pos-web-testing.up.railway.app`
- Staff App: `https://tetamu-staff-app-testing.up.railway.app`
- Database: Railway Testing Postgres (`Postgres-Singapore`)
- Production touched: **NO**
- Application deployed: **NO**
- OTP sent: **NO**
- Payment, bank export, and statutory submission performed: **NO**

The preparation script requires the Railway environment name to be `testing`, the service name to be `tetamu-pos-web`, an approved Railway Testing Postgres hostname, and the exact pre-existing Royal Salon membership contract before it can write.

## 2. Business

- Name: `Payroll UAT Business`
- Business ID: `b87aaa12-b41d-44b5-908e-72d04e6a08a0`
- Slug: `payroll-uat-business`
- Industry: `GENERAL_SERVICE`
- Timezone: `Asia/Kuching`
- Status: `active`
- Enabled modules: `HR`, `PAYROLL`
- Purpose: Testing-only Payroll and Payslip Real Device UAT

No real merchant profile, payment configuration, or production data was added.

## 3. Branch

- Name: `Payroll UAT Branch`
- Branch ID: `552e3d2d-f355-43d6-8e51-bafc1d724377`
- Country: `MY`
- Status: `ACTIVE`
- Timezone: `Asia/Kuching`
- Attendance setting: enabled
- Geofence requirement: disabled for this isolated Testing fixture

This is the only branch in the new Business.

## 4. Employee Global Identity

- Name: `Real Device Payroll UAT Staff`
- Phone: `+60128793848`
- Global Employee Account ID: `7260972a-e431-4ea1-bc69-b604a997ef0a`

The existing global identity was reused. No duplicate `EmployeeAccount` was created.

The existing Royal Salon membership remains unchanged:

- Royal Salon Membership ID: `72f21dad-66d0-45fc-a326-2a8c5f55ffdb`

## 5. New Business Membership

- Employee ID: `UAT-PAYROLL-001`
- Membership ID: `091ba7be-ced0-418b-8cf9-526921f10866`
- Business: `Payroll UAT Business`
- Status: `ACTIVE`
- Employment type: `FULL_TIME`
- Joined: `2026-07-01`
- Attendance enabled: **YES**
- Primary branch: `Payroll UAT Branch`
- Clock-in access: **YES**

## 6. Multi-business Isolation

The Staff App canonical membership resolver returns both eligible memberships for `+60128793848`:

1. Royal Salon
2. Payroll UAT Business

The Staff App uses workplace selection when multiple eligible memberships exist. Employee sessions are bound to one `businessId`, `membershipId`, and primary branch, so selecting Payroll UAT Business does not merge Royal Salon data into that session.

Verification result: **PASS**.

Relevant canonical implementation:

- `src/lib/attendance/employee-auth/membership.ts`
- `src/lib/attendance/employee-auth/otp-service.ts`
- `src/lib/attendance/employee-auth/session.ts`
- `/staff/select-workplace`
- `/api/employee-auth/workplaces`
- `/api/employee-auth/switch-workplace`

## 7. Employment

- Status: `ACTIVE`
- Joined: `2026-07-01`
- Terminated: **NO**
- August 2026 employment eligibility: **PASS**

## 8. Compensation

- Pay basis: `MONTHLY`
- Currency: `MYR`
- Basic salary: `RM 3,000.00`
- Effective month: `2026-08-01`
- Source: canonical version-aware compensation workflow
- Royal Salon compensation reused: **NO**

The compensation version is scoped to Membership `091ba7be-ced0-418b-8cf9-526921f10866` and Business `b87aaa12-b41d-44b5-908e-72d04e6a08a0`.

## 9. Attendance Eligibility

- Membership attendance enabled: **YES**
- Active primary branch assignment: **YES**
- Branch attendance setting enabled: **YES**
- Assignment can clock in: **YES**
- Staff App attendance membership resolution: **PASS**

No attendance event was created.

## 10. Staff Login

- Phone lookup: **PASS**
- Global account active: **PASS**
- New membership selectable: **PASS**
- Royal Salon membership still selectable: **PASS**
- OTP provider expected in Testing: SMS123
- OTP sent in this preparation: **NO**

## 11. HR / Payroll Actor

- Name: `Payroll UAT Owner`
- Login: `payroll-uat.owner@tetamu.local`
- Role: `BUSINESS_OWNER`
- Business scope: Payroll UAT Business only
- Platform Admin: **NO**
- Employee membership: **NO**

The actor uses the existing Testing Real Device UAT HR password credential contract without exposing or duplicating the plaintext secret. It does not enter the payroll employee population.

The Payroll workflow identifies Business Owner self-approval as the canonical owner override. This preserves the existing separation-of-duties behavior without bypassing it.

## 12. Permissions

The Business Owner capability resolver passed all required checks:

- View, create, edit, and publish roster: **PASS**
- View and edit compensation: **PASS**
- View and create payroll run: **PASS**
- Submit payroll review: **PASS**
- Approve/finalize payroll: **PASS**
- View payslip: **PASS**
- Publish payslip: **PASS**

No Platform Admin capability was created or used for the Business actor.

## 13. Payroll Population

- Active branches: `1`
- Payroll-eligible memberships for August 2026: `1`
- Eligible employee: `UAT-PAYROLL-001`
- Desktop actors represented as employee memberships: `0`

Isolation result: **PASS**.

The following prohibited fixture records remain absent:

- Roster assignments: `0`
- Attendance records: `0`
- Attendance expected days: `0`
- Monthly timesheets: `0`
- Payroll runs: `0`
- Payroll entries: `0`
- Payslip publications: `0`

## 14. Statutory Safety

The new membership remains unconfigured for:

- EPF
- SOCSO
- EIS
- PCB
- LINDUNG 24

No statutory identity, number, profile, rule activation, artifact, export, or submission was created.

## 15. Payment Safety

- Bank account versions: `0`
- Payment instructions: `0`
- Payment batch: not created
- Marked paid: **NO**
- Bank export: **NO**

## 16. Preflight Matrix

| Capability | Status |
| --- | --- |
| Business exists | PASS |
| Branch exists | PASS |
| Employee membership active | PASS |
| Primary branch | PASS |
| Attendance enabled | PASS |
| August employment eligible | PASS |
| Compensation valid from 1 Aug | PASS |
| Basic salary RM3,000 | PASS |
| Staff App login eligible | PASS |
| Payroll UAT Business selectable | PASS |
| HR Desktop actor ready | PASS |
| Timesheet permission ready | PASS |
| Payroll permission ready | PASS |
| Payslip publish permission ready | PASS |
| Other Business data isolated | PASS |

## 17. Final Verdict

```text
ISOLATED PAYROLL UAT BUSINESS
READY
```

The next phase may prepare August Roster, Expected Days, Attendance, Monthly Timesheet, Timesheet Lock, Payroll, Finalization, and Payslip publication. None of those actions were started in this preparation.

Fixture preparation is implemented by:

- `scripts/prepare-testing-isolated-payroll-uat-business.ts`
