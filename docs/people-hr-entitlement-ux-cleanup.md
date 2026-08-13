# People & HR Entitlement UX Cleanup

## A. Objective

Keep People/Team in `CORE`. HR, Payroll, Statutory and Claims are independent extension views over the same canonical User / EmployeeBusinessMembership / EmployeeAccount relationships.

## B. Existing Audit

| Surface | Previous classification | Finding |
| --- | --- | --- |
| `/team`, staff role/branch/login/service assignment | MIXED / NEEDS CLEANUP | Core operations existed, but the page title, attendance readiness, employee-only queries and edit eligibility leaked HR/Payroll assumptions. |
| Profile Overview / Personal | MIXED / NEEDS CLEANUP | Core navigation existed, but Overview loaded attendance/employment fields and Personal loaded date of birth. |
| Employment / Attendance / Leave | HR | Capabilities and routes already existed; profile metadata was not centralized. |
| Payroll profile | MIXED / NEEDS CLEANUP | Payroll loader also loaded Statutory and Tax data. |
| Statutory | STATUTORY | Route gating existed, but profile data was nested inside Payroll. |
| Claims | CLAIMS | Navigation, profile and Staff PWA were already entitlement-gated. |
| Permission editor | MIXED / NEEDS CLEANUP | Disabled-module permissions remained visible and could be submitted by an owner. |
| Staff PWA | HR / PAYROLL / CLAIMS | Navigation and direct pages already use module gates. |

## C. People Core Boundary

Core includes staff name/contact, branch, operational role, login state, permissions, service/appointment assignment and active account state. `VIEW_TEAM_DIRECTORY`, `MODIFY_TEAM` and `MANAGE_TEAM_PERMISSIONS` do not imply HR.

## D. HR Extension

Employment, Attendance and Leave profile tabs require both HR entitlement and the corresponding capability. Attendance list/settings/timesheet/leave routes retain their server gates.

## E. Payroll Extension

Payroll tab and its compensation, bank, run, history and payslip loaders require PAYROLL plus the corresponding capabilities. People Core creation never asks for pay basis, salary, work target or staff level.

## F. Statutory Extension

Statutory now has its own profile tab and loader. Payroll no longer loads EPF, SOCSO, EIS, LINDUNG24, identity or tax data. Active-rule/readiness semantics were not changed and no Human sign-off or activation was performed.

## G. Claims Extension

Claims tab, manager route, Staff PWA route, receipt route and APIs remain gated by CLAIMS and their capabilities. Claims domain behavior was not redesigned.

## H. Navigation

The main label is `People` when HR is disabled and `People & HR` when HR is enabled. Attendance, Leave, Claims, Payroll and Statutory children require their own entitlement and capability. Disabled tabs are omitted rather than rendered as locks.

## I. People List

POS-only list loads Staff/User operational data and does not query employee-only memberships, Attendance devices or Attendance rows. Attendance readiness appears only with HR. Payroll staff-level joins occur only for authorized Payroll users.

## J. People Profile

The centralized registry records `requiredModule` and capabilities for every section. POS-only profiles expose Overview and Personal/Contact. Unlinked operational Staff profiles remain fully viewable without creating a second employee record. Future empty tabs are hidden.

## K. Server Data Boundary

Core Overview no longer selects employment type, joined date, attendance flag, salary or pay basis. Core Personal no longer selects date of birth. Statutory data is loaded only in the Statutory branch. Team Attendance queries require HR and Attendance capability.

## L. Actions / APIs

People Core create/update uses a User-backed operational Staff command and never writes EmployeeBusinessMembership HR/payroll fields. Existing membership links are preserved. HR and Payroll legacy commands remain separately capability/module gated. Submitted role permissions are rejected when their commercial module is disabled.

## M. Sensitive Fields

POS-only People does not load/display salary, pay basis, bank account, EPF/SOCSO identifiers, tax identity, leave balances, Attendance devices or claim receipts. NRIC/passport remains classified as Statutory/Tax profile data, not People Core.

## N. Module / RBAC Relationship

Visibility/access requires `enabled module AND capability AND business/branch scope`. The existing Module Registry and entitlement resolver remain the source of truth; no new feature-flag system was added.

## O. POS-only Experience

People, staff creation/editing, roles, branch assignment, login and service/appointment assignment remain available with HR disabled. HR/Payroll/Statutory/Claims tabs and navigation are absent.

## P. HR Experience

With HR enabled, People becomes `People & HR`; Employment, Attendance and Leave sections become visible according to capability. Existing Attendance/Leave history remains untouched.

## Q. Payroll Experience

Payroll entitlement adds the Payroll tab without changing People Core. Compensation and bank loaders remain capability and whole-business-scope aware.

## R. Disable / Re-enable

Entitlement changes only affect visibility/access. No historical HR, Payroll, Statutory or Claims rows are deleted or migrated; re-enabling restores access to the same canonical records.

## S. Staff Assignment

Appointment/service Staff uses the existing User/service assignment relation and does not depend on HR. Auto Work Order assignment support remains unchanged where implemented.

## T. Tenant / Group

All reads keep business and allowed-branch scope predicates. Owners do not bypass disabled modules. Group Managers still require module, capability and selected-business scope and do not gain payroll/statutory sensitive data through People Core.

## U. UI Copy

Operational UX uses People, Team Member and Staff. HR wording appears only when HR is enabled. Database/domain names were not renamed.

## V. Regression

People/module composition, appointment Staff assignment, POS financial paths, Attendance, Leave, Claims, Payroll, Statutory readiness and tenant/RBAC regressions passed. No Leave, Claims, Payroll or Statutory business rules were redesigned.

## W. Tests

Local/Testing final results:

- Targeted People/Profile/entitlement unit suite: 15/15 passed after the final HR-upgrade adjustment.
- Full unit suite: 750/750 passed.
- Full integration suite against embedded Local PostgreSQL: 105/105 passed.
- POS-only browser: `People` label, People list, Core Staff create/profile, appointment Staff assignment and module-denied direct routes passed.
- HR-only browser: `People & HR`, Attendance, Leave and Monthly Timesheets passed; Payroll, Statutory and Claims stayed absent.
- Full-business browser: HR, Claims, Payroll and Statutory navigation passed; HR and Payroll form composition remained separate from Statutory data.
- HR disable/re-enable browser: People remained available, HR routes were denied while disabled, and Timesheets returned after re-enable.
- Targeted browser console/page-error listeners: zero console events and zero page errors on the tested POS-only and HR-only client navigations.
- TypeScript: passed.
- Lint: passed with one pre-existing WhatsApp `<img>` performance warning.
- Local production-mode build: passed, 108 pages generated; pre-existing CSS/autoprefixer warning retained.
- Prisma generate and validate: passed.
- Migration status: 148 migrations; Local schema is up to date. No schema change was made by this task, so no new fresh rebuild was required.
- Canonical guard, secret scan and `git diff --check`: passed at final handoff.

## X. Remaining Risks

Core Staff and HR Employee membership remain intentionally linkable representations of the same person. Legacy linked records are preserved; ambiguous historical identities still require explicit manual linking. This task does not redesign that canonical relationship.

## Y. Product Recommendation

Keep the public product structure stable: People is Core; HR, Payroll, Statutory and Claims compose additional sections. Add-on discovery belongs in Settings / Modules, not locked People tabs.

## Z. Final Status

`PEOPLE & HR ENTITLEMENT UX CLEANUP → READY`

`LOCAL / TESTING ONLY`

`PRODUCTION NOT ACCESSED`

`PRODUCTION NOT VALIDATED`
