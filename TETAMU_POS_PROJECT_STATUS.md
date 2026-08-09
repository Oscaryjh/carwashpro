# Tetamu POS Project Status

> Audit date: 2026-08-08 (Asia/Singapore)
> Repository: `C:\CodexTetamuP0`
> Audited baseline: Git `6db4e3d` plus the working-tree changes present at audit time
> Status basis: current source code, Prisma schema and all 128 migrations, routes, server actions, APIs, workers, configuration, tests, and existing documentation. README and old milestone documents were treated as historical evidence only.

## Audit rules and confidence

This report uses the following labels:

- ✅ **COMPLETE** — the main business flow is present from UI/API through server-side logic to database persistence, with meaningful automated evidence.
- 🟡 **PARTIAL** — useful functionality exists, but the full requested flow, production dependency, security boundary, operational path, or acceptance evidence is incomplete.
- 🔵 **IN DEVELOPMENT** — active working-tree code or recent repository work shows the module is being extended now.
- ⚪ **PLANNED** — design/documentation exists but no usable implementation exists.
- 🔴 **BLOCKED / RISK** — implementation is intentionally blocked or has a launch/security issue that must be resolved.

“Route exists”, “table exists”, and “test file exists” are not sufficient for COMPLETE. “Production Ready” in this report means repository evidence supports production use; it does **not** certify the external hosting environment, credentials, legal compliance, real bank portals, or current WhatsApp account.

### Audit-time verification

| Check | Result | Interpretation |
|---|---:|---|
| Main application production build | **PASS** | `npm.cmd run build`; 102 static pages generated. There are non-blocking image, hook, ARIA, and CSS warnings. |
| Main unit tests | **592 / 593 PASS** | One failing test is the uncommitted Public Bank readiness document heading mismatch. The application test baseline is not fully green. |
| PostgreSQL integration tests | **61 / 61 PASS** | Executed against the repository's embedded local PostgreSQL after confirming all 128 migrations were applied. |
| WhatsApp connector unit/build | **NOT EXECUTED SUCCESSFULLY** | Connector dependencies are not installed in its subproject checkout. Current connector status is `TEST STATUS UNKNOWN`; historical V3 acceptance remains separate evidence. |
| Browser E2E / current manual UAT | **NOT FOUND** | No Playwright/Cypress suite and no current whole-platform signed acceptance result were found. |

The working tree already contained unrelated, user-owned changes before this report. In particular, Public Bank payment-provider readiness files, WhatsApp documentation, `.gitignore`, and working-directory documentation were in progress. They were not modified by this audit.

---

# 1. Product Overview

Tetamu POS is now a multi-tenant, multi-branch service-business operations platform, not merely the “Car Wash CRM POS MVP” described by the old README. The current code contains two explicit industry modes:

- `AUTO_DETAILING` — car wash / auto detailing, vehicle-centric CRM, work orders, ready-for-pickup, and work-order POS.
- `SALON_BEAUTY` — salon / beauty, customer/staff/service-centric appointments and direct appointment checkout.
- `OTHER_SERVICES` and `OTHER` enum support — generic service-business groundwork exists, but no equally complete industry-specific UI and acceptance flow is proven.

The authority and tenancy hierarchy is:

```text
Platform (PLATFORM_ADMIN)
└─ Business Group (GROUP_OWNER / GROUP_MANAGER)
   └─ Business (independent transaction tenant)
      └─ Branch
         ├─ Business Owner
         ├─ Manager-like Staff via capabilities
         └─ Staff / Employee
```

Important boundary: a Business Group is a management/reporting layer. Transaction records remain owned by `businessId`; group users switch into an authorized Business context rather than moving transactions to the Group.

The application stack is Next.js 15 App Router, React 19, Prisma 6, PostgreSQL, JWT cookie sessions, Zod validation, and separate long-running Node workers. WhatsApp uses a standalone Baileys connector rather than the official Meta Cloud API.

---

# 2. Current Module Status

## 2.1 Core Platform

| Capability | Status | Current code fact | Readiness |
|---|---|---|---|
| Authentication | 🟡 PARTIAL | Email/password login, bcrypt, signed JWT cookie, session refresh, active-user/business revalidation, logout, and business-context recovery exist. No password-login throttling, MFA, password reset self-service, or session revocation store is present. | Testing Only |
| Platform administration | ✅ COMPLETE | Platform Admin can create/update Businesses, first owners, branches, credentials, vehicle defaults, templates, and Groups. Platform Admin is kept out of tenant operational routes. | Testing Only |
| Business | ✅ COMPLETE | Industry, profile, timezone, business-day cutoff, SST configuration, status, owner and settings are persisted and validated. | Testing Only |
| Branch | 🟡 PARTIAL | Branch model, platform-admin create/status management, operational branch resolution, and branch-scoped data exist. Tenant `/branches` editing deliberately throws “managed by platform administrator”; Business Owner cannot manage branches directly. | Testing Only |
| Business Group | ✅ COMPLETE | Group creation, membership history, group-only accounts, Group Owner/Manager scopes, business context switching, audit, overview, closing and reports exist. | Testing Only |
| RBAC / permissions | 🟡 PARTIAL | Rich direct-staff and group capability systems exist, with fine-grained Payroll/Bank/Statutory permissions. New domains enforce capabilities strongly; several older mutations and WhatsApp APIs use unqualified `requireBusinessUser()` and depend on route/UI guards. | Development Only until authorization audit |
| Staff / Employee | 🟡 PARTIAL | Legacy POS `User` and canonical `EmployeeAccount` / `EmployeeBusinessMembership` are linked through a guarded one-to-one migration. People directory, branch assignments, roles/levels, schedules and employment details exist. Compatibility code remains large and dual-identity behavior is still active. | Testing Only |
| Audit | 🟡 PARTIAL | Business, Group, Attendance, Leave, Payroll, Bank and Statutory operations write audit records; Payroll-sensitive data is redacted and several records are append-only. Audit coverage is not proven for every legacy POS mutation, and there is no complete audit-view UI for all domains. | Testing Only |

## 2.2 CRM

| Capability | Status | Current code fact | Readiness |
|---|---|---|---|
| Customers | ✅ COMPLETE | Create, update, notes/profile, search, delete with protected-history checks, DOB and salon profile data exist; tenant filtering is used. | Testing Only |
| Vehicles | ✅ COMPLETE for Auto | Create/update/search, size resolution, business overrides and vehicle-specific CRM pages exist. Salon can operate without a vehicle. | Testing Only |
| Vehicle ownership | ✅ COMPLETE | `VehicleOwnershipHistory` preserves previous/new owner, branch, transfer time and notes. | Testing Only |
| Customer history | 🟡 PARTIAL | Customer page joins appointments, jobs, invoices, packages, loyalty and vehicles. There is no single immutable cross-domain event timeline/read model. | Testing Only |

## 2.3 Appointment

| Capability | Status | Current code fact | Readiness |
|---|---|---|---|
| Appointment calendar | ✅ COMPLETE | Large calendar UI supports filtering, staff, schedules, service duration, conflicts and industry-specific displays. | Testing Only |
| Appointment creation | ✅ COMPLETE | Customer-only Salon appointments, vehicle Auto appointments, inline customer/vehicle creation, services, products/packages and staff assignment are supported. | Testing Only |
| Appointment → Cashier | ✅ COMPLETE with two paths | Auto converts an Appointment to a Work Order; Salon completes services and checks out directly against the Appointment. | Testing Only |
| Status lifecycle | ✅ COMPLETE | `SCHEDULED → CONFIRMED → ARRIVED → IN_SERVICE → COMPLETED/CONVERTED_TO_JOB`, plus `CANCELLED` and `NO_SHOW`, with industry-specific transition rules. | Testing Only |
| Staff assignment | ✅ COMPLETE | Bookable staff, branch scope, service assignment, availability, break/time-off checks and conflict locking exist. | Testing Only |
| Appointment reminders | 🟡 PARTIAL | Configurable reminder scheduling, rescheduling cancellation and dedupe keys exist in `NotificationQueue`; live delivery depends on connector and worker deployment. | Testing Only |

## 2.4 Work Orders

| Capability | Status | Current code fact | Readiness |
|---|---|---|---|
| Work order creation | ✅ COMPLETE for Auto | Customer/vehicle/service creation flow, number generation, branch scope, tax and notification enqueue exist. | Testing Only |
| Service workflow | ✅ COMPLETE | `WAITING → IN_PROGRESS → READY_FOR_PICKUP → COMPLETED` plus cancellation is enforced by transition rules. | Testing Only |
| Customer / vehicle linking | ✅ COMPLETE | Required Auto relationships are tenant-scoped; pickup contact can differ from owner. | Testing Only |
| Completion | ✅ COMPLETE | Cash payment/package redemption updates invoice/payment state and can complete the job. | Testing Only |
| Cross-industry use | ⚪ PLANNED / not applicable | Middleware prevents Salon from entering Work Orders; Salon uses Appointment checkout. | Not Implemented for Salon |

## 2.5 Cashier / POS

| Capability | Status | Current code fact | Readiness |
|---|---|---|---|
| Catalog / categories | ✅ COMPLETE | Services, Products, Packages, categories and reusable discounts are queryable by industry/branch. | Testing Only |
| Services | ✅ COMPLETE | Taxability, pricing, vehicle sizing, duration and staff assignments are supported. | Testing Only |
| Products / inventory | 🟡 PARTIAL | Product CRUD, branch stock, reorder level, guarded decrement and checkout are implemented. There is no stock movement ledger, receiving/purchase-order flow, transfer, cycle count or inventory audit report. | Testing Only |
| Packages | ✅ COMPLETE | Package sale lines, pending-to-active purchase state, multi-service benefits and package invoice linkage exist. | Testing Only |
| Discounts | ✅ COMPLETE | Percentage/fixed discounts, line scope, minimum spend, caps, references and loyalty redemption coexist. | Testing Only |
| Checkout | ✅ COMPLETE | Unified Salon cashier and Auto Work Order POS create invoices, items, payments, stock changes, package purchases/redemptions and audit in database transactions. | Testing Only |
| Payments | 🟡 PARTIAL | Cash, card, DuitNow, e-wallet, bank transfer and package tenders are recorded. These are records only; no acquirer/gateway settlement integration exists. | Testing Only |
| Partial payments | ✅ COMPLETE | Work Order and Salon Appointment payment states support sequential partial collection and outstanding balances. | Testing Only |
| Split tender | 🟡 PARTIAL | Sequential partial payments can use different methods, but there is no explicit atomic multi-tender checkout abstraction or external tender reconciliation. | Testing Only |
| Refunds | 🟡 PARTIAL | Partial/full refunds, credit notes, package-use restoration and loyalty reversal exist. Product/package invoice void/refund rules have special restrictions and multiple purchase paths increase consistency risk. | Testing Only |
| Invoice | ✅ COMPLETE | Invoice/line snapshots, SST, payment summary, credit notes and PDF/58mm rendering exist. | Testing Only |
| Idempotency | 🔴 BLOCKED / RISK | Legacy POS checkout/payment actions do not carry a durable client command/idempotency key comparable to Attendance/Payroll. Duplicate submissions or retries are a financial race risk. | Development Only |

## 2.6 Packages

| Capability | Status | Current code fact | Readiness |
|---|---|---|---|
| Package creation | ✅ COMPLETE | Category, status, price, validity, vehicle size, legacy single-service and multi-service benefits exist. | Testing Only |
| Package purchase | 🟡 PARTIAL | Purchase is implemented from package/customer, Work Order cashier, unified Cashier and Appointment checkout. Logic is distributed across several large actions. | Testing Only |
| Package redemption | ✅ COMPLETE | Customer ownership, active state, vehicle size and service balance are checked; redemption is recorded as a Payment. | Testing Only |
| Balance tracking | ✅ COMPLETE | Aggregate uses and per-service balances are stored and updated; activation occurs only after purchase payment. | Testing Only |
| Refund/cancellation consistency | 🟡 PARTIAL | Some purchase refunds clear pending balances and restore redemption, but repository documentation itself flags differing package purchase/refund paths for consolidation. | Development Only |

## 2.7 WhatsApp

| Capability | Status | Current code fact | Readiness |
|---|---|---|---|
| Manual deep link | ✅ COMPLETE | `wa.me` flow and manual state tracking remain available. | Testing Only |
| Message queue | ✅ COMPLETE | Persistent queue, priorities, state transitions, retry schedule, dedupe keys and monitoring page exist. | Testing Only |
| Templates | ✅ COMPLETE | Managed, industry-specific templates and variable validation exist. | Testing Only |
| Send modes | ✅ COMPLETE | Worker requires explicit `mock` or `live`; invalid/missing mode fails closed. | Testing Only |
| Connector send | 🟡 PARTIAL | Separate Baileys service supports text/document/audio/image, QR/pairing, reconnect and multi-session directory layout. Current checkout could not be rebuilt/tested because subproject dependencies are absent. | Development Only |
| Delivery / read status | 🟡 PARTIAL | Receipt webhook and DB statuses `DELIVERED`/`READ` exist. Current real-device acceptance is not proven. | Testing Only |
| Webhook | 🔴 BLOCKED / RISK | Incoming/history/receipt endpoints validate a shared secret only when it is configured; if absent they accept requests. No HMAC timestamp/replay protection exists. | Development Only |
| Inbox | 🟡 PARTIAL | Conversations, contact sync/linking, inbound history and queued replies with media are present. Media is written under public runtime uploads. | Testing Only |
| Multi-session | 🟡 PARTIAL | Code and one connector test target per-Business sessions; README still describes a single-session connector and current connector test did not run. | Development Only |
| Appointment messages | 🟡 PARTIAL | Configurable reminders are queued and deduplicated; live worker/connector required. | Testing Only |
| Invoice messages | 🟡 PARTIAL | Invoice PDFs and messages can be queued/sent; delivery depends on live connector. | Testing Only |
| Ready-for-pickup | 🟡 PARTIAL | Auto Work Order status enqueues notification. | Testing Only |
| Daily closing report | 🟡 PARTIAL | Frozen closing text and PDF/document queue integration exist. | Testing Only |
| Automation | 🟡 PARTIAL | Welcome, service confirmation, pickup, invoice, appointment and closing automations exist; they require a continuously running queue worker and durable connector session storage. | Testing Only |

## 2.8 Daily Closing

| Capability | Status | Current code fact | Readiness |
|---|---|---|---|
| Opening float | ✅ COMPLETE | One open Cashier Shift per cashier context is created with opening float and business date checks. | Testing Only |
| Shift closing | ✅ COMPLETE | Expected cash, entered closing cash, difference, notes and payment/refund scope are persisted. | Testing Only |
| Frozen daily snapshot | ✅ COMPLETE | Snapshot contains report JSON, WhatsApp text, version, totals, actor, timezone and unique Business/Branch/Date key. | Testing Only |
| Business-day cutoff | ✅ COMPLETE | IANA timezone plus configurable `HH:mm` cutoff drives local business-date ranges. DST cases are unit tested. | Testing Only |
| Closing history | ✅ COMPLETE | Per-business history and Group closing records exist. | Testing Only |
| Closing audit | ✅ COMPLETE | Snapshot actor, report version and audit log are stored; Group report exposes closing audit records. | Testing Only |
| Expected closing | ✅ COMPLETE | Expected cash derives from opening float plus cash receipts less refunds for the frozen range. | Testing Only |
| Missing closing | ✅ COMPLETE | Group expectation builder classifies required Business/Branch/Date combinations as COMPLETE or MISSING. | Testing Only |
| WhatsApp summary | 🟡 PARTIAL | Auto/manual send, retry, recipients, deadlines and dedupe exist, but live acceptance and webhook security are unresolved. | Testing Only |
| Group closing overview | ✅ COMPLETE | Group scope, historical membership, expected/missing counts, pagination and CSV/XLSX/PDF exports exist. | Testing Only |

## 2.9 Dashboard / Group Analytics

| Capability | Status | Current code fact | Readiness |
|---|---|---|---|
| Business Dashboard | 🔴 BLOCKED / RISK | A substantial page exists, but middleware redirects `/dashboard` to `/reports`; it is not currently reachable as the product dashboard. | Development Only |
| Salon Dashboard | 🔴 BLOCKED / RISK | Schedule/staff dashboard code exists, but middleware redirects `/salon/dashboard` to `/reports`. | Development Only |
| Branch Dashboard | ⚪ PLANNED | Reports can filter by Branch; no dedicated branch dashboard route/read model exists. | Not Implemented |
| Group Dashboard / All Stores | 🟡 PARTIAL | Group overview has authorized stores, current/previous KPI comparison, store ranking and navigation. | Testing Only |
| KPI | 🟡 PARTIAL | Invoice sales, payments, refunds, ATV, package redemption, order counts and payment mix exist. Customer, retention, staff, capacity, inventory and marketing KPI coverage is incomplete. | Testing Only |
| Sales comparison / trends | 🟡 PARTIAL | Custom/current/previous ranges, Group report trends and long-term daily summaries exist. | Testing Only |
| Top services/products | 🟡 PARTIAL | Group catalog ranking exists, but data confidence and historical definition coverage are still surfaced as limitations. | Testing Only |
| Analytics worker | 🟡 PARTIAL | Lease/heartbeat/checkpoint/late-event repair and versioned daily summaries exist. Production requires a separately deployed worker and explicit read mode; default production read mode is OFF. | Development Only |
| AI-ready data layer | 🟡 PARTIAL | Useful group read models exist, but `GROUP_DASHBOARD_AI_READINESS_AUDIT.md` identifies metric and index gaps. There is no stable AI API contract. | Development Only |

## 2.10 Reports

| Capability | Status | Current code fact | Readiness |
|---|---|---|---|
| Business sales | ✅ COMPLETE | Date/branch-scoped gross/net collection, invoice, refund and SST metrics exist. | Testing Only |
| Payment methods | ✅ COMPLETE | Payment and refund grouping by method exists. | Testing Only |
| Branches | ✅ COMPLETE | Business report filters and Group store comparison use branch/business scopes. | Testing Only |
| Services | ✅ COMPLETE | Service rankings and work-order/service aggregates exist. | Testing Only |
| Packages | 🟡 PARTIAL | Package sales/redemptions appear in closing and related views; there is no dedicated comprehensive package liability/expiry report. | Testing Only |
| Appointments | ✅ COMPLETE for current operational metrics | Appointment status, staff and revenue-related metrics exist in the Business report. | Testing Only |
| Work orders | ✅ COMPLETE for Auto | Work-order status and service metrics exist. | Testing Only |
| Refunds | ✅ COMPLETE | Refund and credit-note totals are included. | Testing Only |
| Business report export | ⚪ PLANNED | No Business Reports export route was found. | Not Implemented |
| Group report export | ✅ COMPLETE | CSV, XLSX and PDF exports with 5,000-row limits and authorized Group scope exist. | Testing Only |
| Attendance/Payroll/Statutory export | 🟡 PARTIAL | Attendance CSV, Payroll CSV/XLSX, payslip PDF and statutory files exist; external payroll-bank export is blocked. | Testing Only |

## 2.11 Attendance

| Capability | Status | Current code fact | Readiness |
|---|---|---|---|
| Employee login | 🟡 PARTIAL | Separate employee principal/session/cookie boundary exists. Production cannot deliver OTP because only the mock provider is implemented. | Development Only |
| OTP | 🔴 BLOCKED / RISK | Hashed one-time challenges, expiry, attempt/resend/provider limits and mock safeguards exist; no live SMS/WhatsApp OTP provider exists. | Development Only |
| GPS clock-in / clock-out | ✅ COMPLETE | Server-calculated geofence, accuracy states, device binding, branch assignment and immutable punches exist. | Testing Only |
| Break start/end | ✅ COMPLETE | State machine, paid/unpaid break policy and duration calculation exist. | Testing Only |
| Attendance records | ✅ COMPLETE | Staff self-history and manager records, filters, pagination and export exist. | Testing Only |
| Exceptions / missing punch | ✅ COMPLETE | Outside geofence, GPS unavailable/inaccurate, wrong branch, missed break, forgot in/out and other requests exist. | Testing Only |
| Attendance resolution | ✅ COMPLETE | Manager return/approve/correct workflow, append-only events, immutable final results, cancellation deadline and anti-self-resolution rules exist. | Testing Only |
| Late / early leave | ⚪ PLANNED | No roster/expected start-end model or classification logic was found. | Not Implemented |
| No attendance / no-show | ⚪ PLANNED | No scheduled-shift roster and no absent/no-show generation for employees without a punch were found. Appointment `NO_SHOW` is unrelated. | Not Implemented |
| Stale open shift | ✅ COMPLETE | Operations service identifies and closes/flags stale sessions. | Testing Only |
| Timesheet | ✅ COMPLETE | Monthly Business timesheet, per-Branch readiness, blocker totals, revisions and immutable entries exist. | Testing Only |
| Monthly approval | ✅ COMPLETE | All branches must be ready and blockers cleared before lock. | Testing Only |
| Timesheet lock / revise | ✅ COMPLETE | Locked revisions are immutable; a new revision is created when underlying truth changes. | Testing Only |
| Attendance → Payroll bridge | ✅ COMPLETE | Payroll must use the current locked Timesheet revision and retains provenance snapshots. | Testing Only |
| Photo attendance | ⚪ PLANNED | Explicitly absent from settings and tests. | Not Implemented |

## 2.12 Leave

| Capability | Status | Current code fact | Readiness |
|---|---|---|---|
| Leave types | ✅ COMPLETE for baseline Malaysia preset | Annual, sick, hospitalisation, maternity, paternity, unpaid and compassionate policies are installable. | Testing Only |
| Leave balance | ✅ COMPLETE | Entitlement by service length, carry-forward, adjustment, override and negative-balance policy exist. | Testing Only |
| Employee application | ✅ COMPLETE | Employee PWA can view, submit and cancel pending requests; overlapping pending/approved dates are blocked. | Testing Only |
| Approval | ✅ COMPLETE | Branch-scoped manager approval/rejection and audit exist. | Testing Only |
| Paid / unpaid determination | ✅ COMPLETE | Pay treatment is snapshotted on the request. | Testing Only |
| Attendance integration | 🟡 PARTIAL | Leave is not converted into punches; it is joined during Payroll generation, excluding dates that already have worked evidence. Calendar/no-show interaction is not implemented. | Testing Only |
| Documents | 🟡 PARTIAL | Policies can require a `documentReference`, but no complete Leave document upload/scan/review flow was found. | Development Only |

## 2.13 Payroll

| Capability | Status | Current code fact | Readiness |
|---|---|---|---|
| Employee payroll profile | ✅ COMPLETE | Canonical membership, pay basis, rates, targets, statutory/tax and versioned compensation profile exist. | Testing Only |
| Salary / compensation | ✅ COMPLETE | Monthly/daily/hourly basis and effective-month immutable compensation versions are implemented. | Testing Only |
| Recurring pay | ⚪ PLANNED | No recurring allowance/deduction rule model exists. | Not Implemented |
| Payroll run / entries | ✅ COMPLETE | Generate/refresh from locked Timesheet, employee snapshots, statutory calculation and manual draft editing exist. | Testing Only |
| Overtime | 🟡 PARTIAL | Additional minutes over daily targets and multipliers are calculated. No approved overtime-request/roster classification workflow exists. | Testing Only |
| Allowances | 🟡 PARTIAL | A single manual amount per Payroll Entry exists; no typed or recurring allowance lines. | Testing Only |
| Commissions | ⚪ PLANNED | No commission model or sales-to-payroll rule exists. | Not Implemented |
| Deductions | 🟡 PARTIAL | A single manual “other deductions” amount plus statutory deductions exists; no typed recurring deduction/loan/garnishment model. | Testing Only |
| Payroll review | ✅ COMPLETE | Draft submission, review state, return to draft and granular permission checks exist. | Testing Only |
| Approval / finalise | ✅ COMPLETE | Approval/finalisation checks current Timesheet and statutory readiness; finalized facts are DB-immutable. | Testing Only |
| Reopen | ✅ COMPLETE with strict block | Reopen is audited and blocked by statutory artifacts, active payment batches or approved payment instructions. | Testing Only |
| Payslip | 🟡 PARTIAL | Admin can download finalized payslip PDF. Employee publication/delivery is explicitly not available. | Testing Only |
| Payment batch | 🟡 PARTIAL / IN DEVELOPMENT | Draft, readiness blockers, frozen instructions, submit, approve, cancel, corrections, events and audit exist. It does not execute payment. | Development Only |
| Payment export | 🔴 BLOCKED | Public Bank adapter registry is intentionally empty. Official field-level specification and golden fixtures are missing; no bank file can be generated/downloaded. | Not Implemented |
| Payment settlement/import | ⚪ PLANNED | No bank result import, settlement confirmation, paid marking or reconciliation exists. | Not Implemented |
| Audit trail | ✅ COMPLETE for new Payroll domain | Sensitive audit redaction, command records, payment events and append-only DB guards are present. | Testing Only |

## 2.14 Malaysia Statutory

| Capability | Status | Current code fact | Readiness |
|---|---|---|---|
| Employee statutory/tax profile | ✅ COMPLETE | Nationality, DOB, identity, EPF member, SOCSO category, tax number/country and company employer profiles exist with granular permissions. | Testing Only |
| EPF / KWSP | 🟡 PARTIAL | Versioned contribution schedule calculation and e-Caruman CSV builder exist and have fixture tests. Current real portal/UAT acceptance is not in the repository. | Testing Only |
| SOCSO / PERKESO | 🟡 PARTIAL | Act 4 contribution bands and combined fixed-width export exist. Current real portal/UAT acceptance is not proven. | Testing Only |
| EIS | 🟡 PARTIAL | EIS is calculated and included in the combined PERKESO export. Current real portal/UAT acceptance is not proven. | Testing Only |
| PCB / MTD | 🔴 BLOCKED / RISK | CP39 fixed-width export exists, but Payroll generation initializes PCB to zero; PCB is manual entry. No MTD tax calculation engine exists. | Development Only |
| Statutory export | 🟡 PARTIAL | Finalized-only validation, encrypted immutable artifacts, key rotation and correction revisions exist. Production requires valid encryption keys and external format acceptance. | Testing Only |
| Submission tracking | ✅ COMPLETE as internal workflow | Draft/exported/submitted/accepted/rejected states, portal reference, correction and audit exist. It does not submit directly to government portals. | Testing Only |

## 2.15 SAVT

| Capability | Status | Current code fact | Readiness |
|---|---|---|---|
| Integration status | ⚪ PLANNED | Only `docs/SAVT_TETAMU_POS_INTEGRATION_ARCHITECTURE.md` and an “External rewards are not connected yet” Cashier notice exist. | Not Implemented |
| Member lookup / OTP registration | ⚪ PLANNED | No SAVT model, API client, route or worker exists. | Not Implemented |
| Points earn / redemption | ⚪ PLANNED | Local Tetamu Loyalty exists, but SAVT reward ownership is deliberately separate and not implemented. | Not Implemented |
| Voucher / offer redemption | ⚪ PLANNED | No reservation/confirm/release state machine exists. | Not Implemented |
| SAVT Cash | 🔴 BLOCKED | Requires a new tender, refund/reconciliation rules and official SAVT API/sandbox/signature specification. | Not Implemented |

## 2.16 AI

| Capability | Status | Current code fact | Readiness |
|---|---|---|---|
| Current AI functionality | ⚪ PLANNED | No OpenAI dependency, client, route, prompt, tool, vector store or AI UI exists. | Not Implemented |
| Group AI Analysis readiness | 🟡 PARTIAL | Group read services, daily summaries, data-confidence report and a detailed readiness audit exist. Metric completeness and stable API contracts are missing. | Development Only |
| Future API/data layer | 🟡 PARTIAL | Data services can be reused, but they are server-internal functions rather than an approved tenant-safe AI tool/API boundary. | Development Only |

---

# 3. Status Classification Summary

| Classification | Modules / examples |
|---|---|
| ✅ COMPLETE | Core Business/Group data model; CRM; Auto Work Orders; core Appointment flows; invoice/PDF; package balances; frozen Daily Closing; Attendance punch/resolution/timesheet; Payroll run review/finalise/reopen; internal statutory submission tracking. |
| 🟡 PARTIAL | Auth hardening; RBAC consistency; inventory; payment/refund edge cases; WhatsApp live operations; Business/Group analytics; Leave documents; Payroll adjustments/payslip publication; EPF/SOCSO/EIS external acceptance. |
| 🔵 IN DEVELOPMENT | Payroll Payment P3 provider-neutral/Public Bank readiness in the current working tree; related documentation/test alignment. |
| ⚪ PLANNED | Attendance late/early/no-show; recurring payroll items; commissions; employee payslip publishing; bank settlement; SAVT; actual AI features. |
| 🔴 BLOCKED / RISK | Optional WhatsApp secrets; live Attendance OTP provider missing; POS idempotency gap; bank-file generation; PCB calculation; unreachable Dashboard routes; production deployment/worker topology not codified. |

---

# 4. Testing Status

## 4.1 What the repository proves

- **Automated unit coverage:** 108 main unit test files, 593 test cases executed at audit time. Coverage is especially strong for Business Day/timezones, Group scope/KPI, Attendance state/security, Payroll calculations/workflows, statutory file construction, audit redaction, RBAC mapping, refunds and WhatsApp template/queue rules.
- **Database integration coverage:** 33 integration files, 61 test cases executed successfully against local PostgreSQL. These verify real triggers/constraints, tenant isolation, historical Group membership, worker leases, Attendance immutability/idempotency, Timesheet locking, canonical Payroll writes, payment foundation, statutory artifact immutability, People linking and rollback on audit failure.
- **Build smoke:** main optimized build passes. This proves compilation/type checking/static generation, not runtime user acceptance.
- **Historical WhatsApp acceptance:** `docs/V3_ACCEPTANCE_RESULT.md` records a PASS dated 2026-07-03 for four live queue/connector scenarios. The current connector has since evolved (delivery/read, history, media, multi-session and closing), so that result is historical evidence only.

## 4.2 What is only automated

- Group access, KPI, trends, closing reports and exports.
- Attendance auth/state/geofence/database guards/resolution/timesheet.
- Leave core service and database guards.
- Payroll calculation, compensation version, workflow, payment foundation and statutory artifacts.
- Statutory file record lengths and selected official schedule examples.
- Current build and route generation.

No repository evidence proves a human completed these current flows in a deployed Testing environment after the latest Attendance/Payroll changes.

## 4.3 Smoke/manual evidence

| Area | Evidence | Status |
|---|---|---|
| WhatsApp V3 welcome/work-order/pickup/invoice queue | Dated acceptance result with provider message IDs | Historical PASS, current commit `TEST STATUS UNKNOWN` |
| Main POS demo flow | `docs/demo-script.md` contains steps | Checklist only; current execution `TEST STATUS UNKNOWN` |
| Whole-platform browser smoke | No current result artifact | `TEST STATUS UNKNOWN` |
| Connector multi-session | One test file exists but dependencies are not installed | `TEST STATUS UNKNOWN` |
| Payroll Payment UI | Unit/integration tests and recent P2 commits | Automated only; external UAT `TEST STATUS UNKNOWN` |
| Statutory portals | No upload acceptance evidence | `TEST STATUS UNKNOWN` |

## 4.4 Mock dependencies

- Employee OTP uses an in-memory mock provider in development/Testing. Production selects `provider` mode but no provider implementation exists.
- WhatsApp `WHATSAPP_SEND_MODE=mock` returns simulated provider IDs without connector calls. `.env.example` defaults to mock.
- Payroll bank artifact tests use internal test artifacts; no real bank adapter is registered.
- Claim storage foundation has testable filesystem/S3 interfaces, but the Claim product workflow is absent.

## 4.5 Can be live-tested safely

- Core CRM, catalog, Appointment, Auto Work Order, local tender recording, package, closing, Group report, Attendance/Leave/Payroll draft flows using synthetic data in an isolated Testing database.
- WhatsApp queue in `mock` mode.
- Real WhatsApp only with a dedicated Testing phone/session, explicit live mode, non-production recipients and secured private connector network.
- Statutory export generation using synthetic employees; do not submit files as real filings.

## 4.6 Cannot be safely live-tested yet

- Real employee Attendance OTP in Production: provider missing.
- Public Bank payment upload/execution: adapter/specification/golden fixture absent. Do not authorize a real payment.
- PCB calculation as an automated statutory result: no calculator exists.
- SAVT member/reward/cash flows: not implemented.
- AI access to tenant data: no approved AI permission/tool boundary.
- Internet-exposed WhatsApp webhook/connector without mandatory secrets and replay protection.

---

# 5. Production Readiness

| Module | Judgment | Why |
|---|---|---|
| Core CRM / Catalog / Auto Work Orders | **Testing Only** | Functionally substantial and tested, but no current E2E UAT, deployment topology or full legacy authorization/idempotency hardening. |
| Appointments / Salon Cashier | **Testing Only** | Main flow exists; current manual acceptance is unknown. |
| POS payments/refunds/invoices | **Testing Only** | Internal tender records only; duplicate-command and package/refund consistency risks remain. |
| WhatsApp | **Development Only** | Optional secrets, public media storage, connector checkout not verified, and operational dependencies. |
| Daily Closing | **Testing Only** | Strong transactional/snapshot evidence; live WhatsApp summary remains dependent. |
| Group Dashboard/Reports | **Testing Only** | Access and aggregation tests pass; metric completeness and production analytics worker/read mode remain incomplete. |
| Attendance | **Development Only** | Core is strong, but no production OTP delivery and no roster late/absence logic. |
| Leave | **Testing Only** | Baseline request/balance/approval/Payroll treatment works; documents and attendance calendar semantics incomplete. |
| Payroll calculation/workflow | **Testing Only** | Strong immutable workflow, but compensation types, current UAT and downstream payment are incomplete. |
| Payroll payment | **Development Only** | Preparation/approval foundation only; no bank file, execution or settlement. |
| EPF/SOCSO/EIS | **Testing Only** | Calculators/export builders exist; external portal acceptance is unknown. |
| PCB/MTD | **Development Only** | Manual PCB only; no calculation engine. |
| Exports | **Testing Only** | Group, Attendance, Payroll and Statutory exports exist; Business report and bank payment export are absent. |
| SAVT | **Not Implemented** | Architecture only. |
| AI | **Not Implemented** | Readiness analysis only. |

No major module can be certified **Production Ready** from repository evidence alone at this audit point.

---

# 6. Database Architecture

The Prisma schema has 100 models and 128 ordered migrations. PostgreSQL is used not only for storage but also for important cross-tenant, immutability, append-only and lifecycle guards.

## 6.1 Tenant and authority graph

- `BusinessGroup` has historical `BusinessGroupMember` rows; a Business can have one active membership while old memberships remain for historical reporting.
- `BusinessGroupUser` grants `GROUP_OWNER` or `GROUP_MANAGER`; manager business allowlists are stored in `BusinessGroupUserBusinessAccess`.
- `Business` is the transaction tenant. Most domain rows include `businessId`.
- `Branch` belongs to one Business; operational records may be branch-specific.
- `User` is the POS/admin identity. `EmployeeAccount` is the employee authentication identity. `EmployeeBusinessMembership` is the canonical employment record. `User.employeeBusinessMembershipId` links them one-to-one when applicable.

## 6.2 Core commerce graph

```text
Business
├─ Branch
├─ Customer ─ Vehicle ─ VehicleOwnershipHistory
├─ Service / Product / Package
├─ Appointment ─┬─ optional WorkOrder
│               ├─ Invoice
│               └─ Payment
├─ WorkOrder ─ WorkOrderItem ─ Invoice ─ InvoiceItem
├─ CustomerPackage ─ CustomerPackageServiceBalance
└─ Payment ─ PaymentRefund ─ CreditNote ─ CreditNoteItem
```

- `Appointment` can be customer-only for Salon and vehicle-based for Auto; it can link to a Work Order or direct Invoice/Payments.
- `WorkOrder` belongs to Business/Branch/Customer/Vehicle and owns service line snapshots.
- `Invoice` snapshots items, discounts, tax and totals. It can represent Work Order, Appointment, product or package purchases.
- `Payment` links to Work Order, Appointment, Invoice, CustomerPackage and/or a service balance. `PaymentRefund` preserves refund facts; `CreditNote` provides the document trail.
- `Package` has one or more `PackageServiceBenefit`; purchased balances live in `CustomerPackageServiceBalance`.

## 6.3 Operations and analytics graph

- `CashierShift` stores opening/closing cash and links payments/refunds.
- `DailyClosingSnapshot` freezes one Business/Branch/Business Date report and WhatsApp text.
- `AnalyticsDailyStoreSummary` and `AnalyticsDailyPaymentMethodSummary` are versioned daily read models produced by refresh-run/checkpoint workers.
- WhatsApp uses `NotificationQueue` for automation delivery and separate conversation/message/contact/connection/worker-command models for the Inbox/connector.

## 6.4 Attendance → Timesheet → Payroll graph

```text
EmployeeAccount
└─ EmployeeBusinessMembership
   ├─ EmployeeBranchAssignment
   ├─ EmployeeAttendance ─ AttendancePunch
   │  ├─ AttendanceException / AttendanceAdjustment
   │  └─ AttendanceResolutionCase ─ AttendanceFinalResult / Events
   ├─ AttendanceMonthlyTimesheet
   │  └─ AttendanceTimesheetRevision ─ immutable RevisionEntry
   ├─ EmployeeCompensationVersion
   ├─ LeaveRequest ─ LeaveRequestDay
   └─ PayrollEntry
      └─ PayrollRun
         ├─ PayrollStatutorySubmission ─ encrypted ExportArtifact
         └─ PayrollPaymentBatch ─ Instruction / Event / Artifact
```

- Attendance terminal punches and final resolution results are immutable.
- Monthly Timesheet revisions preserve source digest and provenance.
- Payroll Run snapshots current locked Timesheet, compensation version, statutory rule version and employee facts.
- Finalized Payroll and statutory/payment artifacts are protected by PostgreSQL triggers/constraints.

---

# 7. RBAC / Security

## 7.1 Roles and scopes

- Platform: `PLATFORM_ADMIN`.
- Direct Business: `BUSINESS_OWNER`, `STAFF`.
- Group: `GROUP_OWNER`, `GROUP_MANAGER`, with `ALL_BUSINESSES` or selected-business access.
- Employee PWA: separate `EmployeeSession`, not a POS `User` session.
- Branch scope: direct Staff generally receives its assigned `branchId`; `ALL_BRANCHES` expands direct reporting access. Attendance resolves allowed active assignments independently.
- Business scope: session active Business is revalidated on every `requireUser()` and by `resolveBusinessAccess()`.
- Group scope: live/historical group membership and manager business grants are resolved server-side; browser-supplied Business lists are not authoritative.

## 7.2 Sensitive capabilities

Fine-grained capabilities exist for:

- Compensation: view/edit.
- Payroll Runs: view/create/edit/submit/return/approve/reopen/export.
- Payslip: view/publish (publish not implemented).
- Bank: view masked profile/edit/verify.
- Payment batches: view/create/submit/approve/cancel/audit/export/process (export/process not implemented).
- Statutory: view/edit profile, view/edit tax, view/export/submit/resolve submissions.
- Claims: view/review/verify/settings/link-to-payroll, although the Claim product is not implemented.

Payroll reads require whole-Business scope; branch-only users are denied before sensitive queries. Audit serializers redact compensation, identifiers, bank and statutory data. Bank numbers and immutable statutory artifacts use versioned AES-256-GCM keys; bank account fingerprints use a separate HMAC key.

## 7.3 Security findings

| Risk | Severity | Evidence-based finding |
|---|---:|---|
| Optional WhatsApp webhook secret | **CRITICAL** | Incoming/history/receipt routes authenticate only when `WHATSAPP_WEBHOOK_SECRET` is non-empty. Without it, a caller can submit a chosen valid Business UUID and mutate message/history/receipt state. |
| Optional Connector API secret | **CRITICAL if network exposed** | Connector `assertConnectorAccess()` allows all requests when `CONNECTOR_API_SECRET` is absent. Send/QR/logout/reconnect/session operations must never be public. |
| No webhook anti-replay/HMAC | **HIGH** | Shared header equality has no raw-body signature, timestamp or replay window. |
| Inconsistent legacy server authorization | **HIGH** | New Attendance/Payroll actions declare capabilities. Many older POS, Appointment, Work Order, CRM, Invoice, PDF and WhatsApp endpoints call unqualified `requireBusinessUser()` and then rely on page middleware, role checks or branch filters. This needs an endpoint-by-endpoint authorization test, not UI trust. |
| Public runtime media | **HIGH** | Incoming/reply/queue media is written to `public/uploads`; invoice/WhatsApp documents may be reachable by possession of an unguessable URL rather than an authenticated download policy. |
| Login brute-force controls | **HIGH** | Password login has no per-IP/account throttling or lockout. Employee OTP has stronger limits. |
| Session revocation | **MEDIUM** | JWT sessions are stateless for up to seven days. User status/permissions are refreshed from DB, but there is no explicit session table/revoke-all mechanism for POS users. |
| Security headers | **MEDIUM** | No application CSP, HSTS, frame-ancestors/X-Frame-Options or broad security-header policy was found in `next.config.mjs`. |
| Audit completeness | **MEDIUM** | Sensitive modern domains fail transactionally on audit failure; complete coverage of all legacy catalog/POS/WhatsApp mutations is not proven. |

No direct cross-Business data leak was observed in the inspected read services, and the local PostgreSQL tenant-isolation integration tests passed. The risks above concern missing mandatory controls and inconsistent enforcement patterns, not a claim that every affected path is currently exploitable.

---

# 8. Business Rules

| Rule | DESIGNED | CURRENT IMPLEMENTATION | GAP |
|---|---|---|---|
| Business Day Cutoff | Every Business uses its timezone and configurable cutoff. | Shared `business-time`, `business-day` and Daily Closing range helpers convert local calendar boundaries to UTC; default `Asia/Kuching`, cutoff `02:00`. | Some old reports/docs still use legacy language; every future query must reuse canonical helpers. |
| Branch scope | Staff operates only in assigned scope; owners may span Business. | Session/access resolution and `resolveOperationalBranchId` constrain Business/Branch; Attendance has independent active-assignment guards. | Older actions do not consistently declare a server capability; branch filter alone is not authorization. |
| Appointment → Cashier | Industry determines conversion. | Auto converts to Work Order; Salon directly completes Appointment services and creates Invoice/Payments. | Generic `OTHER` industry acceptance is unknown. |
| Appointment staff | Only active, bookable, authorized, available staff can be assigned. | Branch/effective assignment, service skills, schedules, breaks/time off and conflict locks are checked. | No workforce roster/shift planning link to Attendance. |
| Work Order lifecycle | Operational status is separate from payment. | Transition state machine; ready pickup notification; payment can complete a Work Order when fully paid. | No idempotent command envelope for concurrent retries. |
| Package purchase | Package becomes usable only after payment. | Purchase creates `PENDING_PAYMENT`, service balances, invoice/payment, then activates. | Logic exists in four entry points and should be consolidated. |
| Package redemption | Only valid customer/package/service/vehicle balance may be consumed. | Active ownership, service balance and vehicle sizing checked inside checkout transactions; Payment records package use. | Cross-path refund/cancel behavior needs one authoritative policy/service. |
| Invoice / Payment state | Invoice status derives from active payments minus refunds. | `UNPAID/PARTIAL/PAID/REFUNDED/VOID`; refunds and credit notes preserve history; amounts use integer-cent helpers in most calculations. | Payment actions lack durable external command idempotency; no settlement/reconciliation with acquirers. |
| Daily Closing | One immutable close per Business/Branch/Business Date. | Unique key, frozen report JSON/text/version, actor, expected/actual difference and history. | Production worker/WhatsApp delivery and operational UAT not proven. |
| Group aggregation | Group only reads authorized Businesses and honors membership time. | Live scope for current KPI; historical intersection for report events/closing; manager allowlist enforced server-side. | Several desired KPI domains are missing; analytics daily reads default OFF in Production. |
| Attendance state | One active session per membership; immutable evidence. | OTP/device/session, GPS, Clock In → Break → Clock Out state machine, idempotency, exceptions, resolutions and DB guards. | Live OTP provider, roster late/early/absence rules and photo evidence absent. |
| Timesheet | Payroll consumes approved immutable monthly truth. | Branch readiness + blocker checks → locked revision; revision entries and digest are immutable. | No no-punch employee roster entry, so “no attendance” cannot be inferred. |
| Leave → Payroll | Approved paid/unpaid leave affects pay without double-counting worked days. | Payroll joins approved `LeaveRequestDay`, excludes worked dates, snapshots treatment and computes paid/unpaid results. | Leave-to-roster/Attendance absence display and complete document verification are absent. |
| Payroll locking | Finalized Payroll cannot silently change. | Review before finalize, current Timesheet check, DB immutability and blocked reopen when statutory/payment evidence exists. | Payslip publication and payment settlement do not exist. |
| Statutory | Contributions and filings must be reproducible. | Versioned EPF/SOCSO/EIS rules; finalized-only immutable encrypted artifacts; corrections create revisions. | PCB is manual; real portal acceptance and ongoing regulatory update process are not proven. |
| Group permissions | Group Manager is mostly read-only; Group Owner may act across authorized Businesses. | Explicit capability matrix; Payroll sensitive operations require Group Owner and whole-Business scope. | Large owner capability set requires least-privilege review; legacy actions should require explicit capabilities. |

---

# 9. Technical Debt

The source scan found no material `TODO`/`FIXME` marker that reliably describes the roadmap; incomplete work is instead expressed through disabled UI, fail-closed registries, compatibility routes, tests and design documents. All 128 migrations were recognized and the local database reported no pending migration, so no currently incomplete migration was identified. That does not remove the runtime/schema debts below.

## CRITICAL

1. **WhatsApp trust boundary fails open when secrets are absent.** Both app webhook and connector API configuration must be mandatory in non-local environments, with HMAC/timestamp/replay validation.
2. **Core POS financial commands lack durable idempotency.** Checkout, Payment, package purchase and refund entry points can be retried by browsers/network; no unique command record prevents duplicate financial rows.
3. **Production Attendance login cannot work.** `createEmployeeOtpProvider()` throws for `provider` mode because no provider is implemented.

## HIGH

1. **Legacy authorization is inconsistent.** There is a split between capability-enforced modern domains and older unqualified `requireBusinessUser()` actions/APIs. Add server-side capability assertions and negative tests to every mutation/download.
2. **WhatsApp media/invoice attachments use public runtime storage.** Move to private durable object storage and authenticated time-limited downloads; add malware/type/size controls appropriate to media.
3. **Package checkout logic is duplicated.** `packages/actions.ts`, `work-orders/actions.ts`, `cashier/actions.ts` and `appointments/actions.ts` each implement purchase/activation/invoice behavior.
4. **Very large components/actions.** `appointment-calendar.tsx` ~2,927 lines, Appointment actions ~1,796, Cashier form ~1,538, Team page/actions ~1,300+, Closing and Reports pages ~1,200+. Reviewability and permission/transaction consistency suffer.
5. **No password login throttling.** Add account/IP rate limiting, lockout/alerting and security audit events.
6. **No production deployment topology in repository.** No Dockerfile, Procfile, Railway/Vercel config or CI workflow was found for Web + notification worker + analytics worker + connector + durable volumes.
7. **External statutory acceptance is unknown.** File format tests are not a substitute for portal validation; PCB calculation is absent.
8. **Business Dashboard code is dead at runtime.** Middleware unconditionally redirects both dashboard routes.

## MEDIUM

1. **Dual User/Employee compatibility remains.** Large legacy migration/update paths make identity and permission behavior harder to reason about.
2. **Old documentation is materially stale.** README and multiple WhatsApp release documents describe earlier capabilities/limitations, including single-session and no delivery/read/webhook, contradicting current code.
3. **Analytics mode can silently remain raw/OFF.** Production daily-summary reads require explicit configuration/backfill/worker deployment and data-confidence monitoring.
4. **Inventory has no ledger.** Direct quantity updates and sale decrements do not provide receiving/transfer/adjustment provenance.
5. **No complete observability stack.** Console logs and database queue pages exist; no metrics, alerting, dead-letter operations, trace correlation or worker health contract is defined.
6. **Session/security headers are incomplete.** Add POS session revocation and baseline browser security headers.
7. **Runtime file durability varies.** Business/Group logos, connector auth and media depend on local volumes; multi-instance behavior is not defined.
8. **Potential timezone duplication.** Canonical helpers are strong, but several large report/closing services still construct ranges independently; enforce one shared library and add all-business timezone tests when extending.
9. **Some analytics composite-index gaps remain.** Current schema now has useful Invoice and Payment composites, but Appointment lacks a `(businessId, scheduledAt, status, branchId)`-style index, Work Order lacks a Business/date/status composite, and Customer lacks a Business/created-date index. Add only after `EXPLAIN (ANALYZE, BUFFERS)` on production-like data.

## LOW

1. Main build emits `<img>`, `useMemo`, ARIA and CSS `flex-end` warnings.
2. Prisma warns that `package.json#prisma` configuration is deprecated for Prisma 7.
3. Several preview routes/components remain in source; routes self-limit to development, but their long-term ownership is unclear.
4. Naming remains mixed between WashFlow, Car Wash CRM POS and Tetamu POS across packages, cookies, docs and logs.

---

# 10. Current Development Phase

Tetamu POS is in a **post-MVP platform expansion and integrity-hardening phase**, with core service POS flows usable in Testing and the active effort concentrated on HR/Payroll and payment-readiness foundations.

## Recently Completed

- Attendance resolution hardening, monthly Timesheet and locked Timesheet → Payroll provenance.
- Versioned compensation and canonical sensitive profile writes.
- Payroll review/finalise/reopen and statutory immutable artifact revisions.
- Employee bank profile, Payroll Payment integrity foundation and Payment P2 workspace/UAT fixes.
- Claim private-storage/security foundation only (not a Claim product).

## Currently In Progress

- **Payroll Payment P3 / Public Bank readiness.** The working tree adds a provider-neutral adapter contract and an explicit fail-closed `PUBLIC_BANK_SPEC_NOT_READY` registry.
- The readiness documentation and its unit test currently disagree on the required heading, causing the one main unit-test failure.
- No Public Bank adapter, artifact route or real bank-file output exists; this is intentional until official specifications and golden fixtures are obtained.

## Next Logical Phase

Before adding more Payroll payment or AI UI, the logical next phase is **production boundary hardening**:

1. Mandatory webhook/connector security and private media.
2. Explicit server-side capability enforcement across legacy routes/actions.
3. POS financial idempotency and package/refund consolidation.
4. Live employee OTP provider and Attendance operational UAT.
5. Then complete Payroll payment provider specifications, bank-file UAT and settlement tracking.

---

# 11. Recommended Development Order

The dependency-driven order should be:

1. **Security and deployment foundation** — mandatory secrets, signed/replay-safe webhooks, private media, login throttling, security headers, worker/container topology, durable connector storage, health checks and CI.
2. **Authorization closure** — inventory every page/API/server action/download; require explicit capability and Business/Branch/Group scope; add negative tests.
3. **Commerce integrity** — idempotent POS command records, row locking/unique constraints, one authoritative checkout/package/refund service, tender reconciliation rules.
4. **Testing baseline** — restore 593/593 unit green, install/lock connector dependencies, current browser smoke suite, synthetic multi-industry UAT and release evidence.
5. **Employee production access** — implement a real OTP provider, delivery failure/retry/monitoring, consent/templates and Testing acceptance.
6. **Attendance completeness** — roster/expected schedule model, late/early/no-attendance rules, leave calendar interaction and manager resolution.
7. **Payroll product depth** — recurring allowances/deductions, commission rules, approved overtime source, employee payslip publication and notifications.
8. **Malaysia Statutory closure** — PCB/MTD calculator, regulatory version/update process, portal-validated golden files and correction UAT.
9. **Payroll payment execution** — obtain official Public Bank field specification; add provider config, synthetic golden fixtures, validation-only portal UAT, file download permission, result import, settlement and reconciliation. Never authorize real funds during format validation.
10. **Dashboard/report completion** — decide whether to restore Business/Salon dashboards, add Branch dashboard, inventory/package liability/customer/staff KPI, Business report export, analytics backfill and production PRIMARY read mode.
11. **SAVT** — only after official API/sandbox/signature and product decisions; implement merchant/member mappings, outbox/webhook inbox, then earn, voucher reservation, and finally SAVT Cash.
12. **AI** — last: expose a stable read-only, tenant-safe Group analytics tool/API with data-confidence metadata, audit, cost limits and no sensitive Payroll/Bank data by default.

---

# 12. Production Launch Blockers

## Blocker 1

**BLOCKER:** WhatsApp webhook and Connector API secrets are optional.
**IMPACT:** Forged messages/status/history or unauthorized connector control if endpoints are reachable.
**AFFECTED MODULE:** WhatsApp, Invoice notifications, Appointment reminders, Closing automation.
**RECOMMENDED FIX:** Require non-empty secrets outside local dev; add constant-time HMAC over raw body, timestamp/replay window, request-size limits, network isolation and rotation runbook.

## Blocker 2

**BLOCKER:** Core financial mutations have no durable idempotency command key.
**IMPACT:** Duplicate Payment, Invoice, package purchase/redemption, stock decrement or refund under retries/concurrency.
**AFFECTED MODULE:** Cashier, POS, Packages, Invoice/Refund, Inventory, Loyalty.
**RECOMMENDED FIX:** Introduce tenant-scoped unique command records and response replay; lock/compare financial aggregate state in serializable transactions; add concurrency integration tests.

## Blocker 3

**BLOCKER:** No live employee OTP provider.
**IMPACT:** Staff cannot authenticate to Attendance in Production.
**AFFECTED MODULE:** Attendance, Leave employee PWA.
**RECOMMENDED FIX:** Implement and monitor an approved provider, retain current hashed/rate-limited challenge boundary, and pass production-like Testing UAT.

## Blocker 4

**BLOCKER:** Legacy server-side authorization is not uniformly capability-enforced.
**IMPACT:** A crafted direct request/server-action invocation may exceed intended UI permissions; exact exploitability requires endpoint testing.
**AFFECTED MODULE:** POS, Work Orders, Appointments, CRM, Invoice downloads/refunds, WhatsApp APIs/settings.
**RECOMMENDED FIX:** Require explicit capability in every server entry point, then add denied-role/branch/group integration tests.

## Blocker 5

**BLOCKER:** Production process/deployment/durable-storage configuration is not codified.
**IMPACT:** Web can run while queues/analytics/connector do not; media/session files may disappear or diverge across instances.
**AFFECTED MODULE:** All, especially WhatsApp, Closing, Group analytics and uploads.
**RECOMMENDED FIX:** Define deploy manifests for Web, notification worker, analytics worker and connector; health/readiness probes; private/durable volumes or object storage; migrations; backups; secrets and alerts.

## Blocker 6

**BLOCKER:** Current release validation is incomplete.
**IMPACT:** One unit test fails, connector cannot build in the current checkout, and there is no current end-to-end UAT artifact.
**AFFECTED MODULE:** Whole platform / release process.
**RECOMMENDED FIX:** Restore green tests, install connector dependencies reproducibly, add browser smoke/E2E and create a dated environment/build acceptance record.

## Blocker 7

**BLOCKER:** Payroll payment and full Malaysian statutory automation are incomplete.
**IMPACT:** Salary cannot be safely exported/executed/reconciled; PCB is not calculated; official filings may be rejected.
**AFFECTED MODULE:** Payroll, Bank, PCB/MTD, Statutory.
**RECOMMENDED FIX:** Keep fail-closed; obtain official specifications/fixtures, implement PCB, conduct synthetic portal validation, and add settlement/submission reconciliation.

These blockers can be scoped. A limited internal pilot of core CRM/POS may exclude Attendance, live WhatsApp, Payroll payment, Statutory submission, SAVT and AI, but Blockers 2, 4, 5 and 6 still apply to any financial production pilot.

---

# 13. Project Completion Estimate

These percentages measure implemented, integrated and evidenced scope—not time spent and not route/table count.

| Area | Estimated completion | Basis |
|---|---:|---|
| Core POS platform | **78%** | Strong tenant/Business/Branch/People foundations; auth hardening, legacy RBAC consistency and production ops incomplete. |
| CRM | **88%** | Customer/vehicle/ownership/history useful end to end; unified timeline and some generic-industry depth missing. |
| Appointment | **80%** | Calendar, lifecycle, staff, Auto conversion and Salon checkout exist; live acceptance and generic industry gaps. |
| Cashier | **78%** | Full internal checkout/payment/invoice/refund/package/product flow; idempotency, external settlement and inventory ledger missing. |
| WhatsApp | **68%** | Queue/templates/inbox/status/automation broad; security, private storage, connector verification and official-provider ops incomplete. |
| Closing | **82%** | Strong cutoff, expected cash, frozen snapshots, missing closing and Group overview; production automation acceptance missing. |
| Group | **68%** | Scope, KPI, reports, closing, trends and exports exist; desired metric breadth, Branch dashboard and production summary mode incomplete. |
| Attendance | **70%** | Strong punch/security/resolution/timesheet; OTP provider and roster late/absence semantics missing. |
| Payroll | **62%** | Calculation/workflow/locks/payslip/admin payment prep exist; recurring items, commissions, employee publishing, payment execution/settlement missing. |
| Leave | **65%** | Core policies/balance/application/approval/Payroll link exist; documents, roster/absence and broader UAT incomplete. |
| Statutory | **55%** | EPF/SOCSO/EIS rules and immutable exports exist; PCB engine and official portal acceptance missing. |
| SAVT | **2%** | Architecture and UI unavailable notice only. |
| AI | **0%** | Readiness audit only; no AI product implementation. |

**Tetamu POS Core Product Completion: 77%**

This is the rounded average of the seven customer-facing platform areas from Core POS through Group (78, 88, 80, 78, 68, 82, 68), tempered by the fact that no area is yet certified Production Ready.

**Full Planned Platform Completion: 61%**

This is the rounded unweighted coverage across all 13 requested areas. It intentionally gives missing SAVT and AI, and incomplete HR/Payroll/Statutory, visible weight. It is not a schedule estimate.

---

# 14. Executive Summary

# TETAMU POS CURRENT STATE

Tetamu POS is a mature Testing-stage service-business platform with working Auto Detailing and Salon/Beauty operational flows, strong PostgreSQL integrity for newer Group/Attendance/Payroll domains, and a broad but uneven production boundary. It is beyond MVP in scope but not yet repository-certifiable for production launch.

## Stable

- Multi-tenant Business/Branch data ownership and Group membership/history.
- CRM customers/vehicles, service catalog, Auto Work Orders and core Appointment lifecycle.
- Invoice/payment/refund/credit-note and package balance fundamentals.
- Daily Closing frozen snapshots and business-day cutoff logic.
- Attendance immutable evidence/resolution/Timesheet and Payroll locked-provenance design.
- Payroll review/finalise/reopen and encrypted statutory/payment foundations.

## Usable in Testing

- Auto Detailing CRM → Work Order → POS → Invoice → Closing.
- Salon Appointment → service/product/package checkout → partial payment → Invoice.
- Group overview/reports/closing/exports with synthetic businesses.
- Attendance GPS/device/punch, exception resolution and monthly Timesheet using mock OTP.
- Leave application/approval and Payroll calculation from locked Timesheet.
- EPF/SOCSO/EIS calculation and synthetic statutory artifact generation.
- WhatsApp queue in mock mode; real connector only in an isolated secured Testing setup.

## In Development

- Payroll Payment P3 provider-neutral/Public Bank readiness, explicitly fail-closed.
- Production/security hardening needed around WhatsApp, legacy RBAC, idempotency and deployment.
- Group analytics daily summary rollout and broader KPI readiness.

## Missing

- Live Employee OTP provider.
- Attendance roster, late/early/no-show logic.
- Recurring Payroll components, commissions and employee payslip publication.
- Bank payment file/execution/result import/reconciliation.
- PCB/MTD calculator and proven portal UAT.
- Dedicated Branch Dashboard and currently reachable Business/Salon Dashboard.
- Business report export.
- SAVT integration and all AI product functionality.

## Critical Risks

- WhatsApp app/connector trust boundaries fail open when secrets are omitted.
- Financial checkout mutations lack command idempotency.
- Older server entry points do not uniformly enforce explicit capabilities.
- Public runtime media and uncodified durable worker/storage topology.
- Release evidence is not green/current end to end.

## Recommended Next Phase

Run a **Production Boundary & Commerce Integrity** phase first: mandatory signed integration security, private storage, explicit endpoint capabilities, POS idempotency, package/refund consolidation, deployment/worker health, and current E2E acceptance. Then implement live OTP, Attendance roster semantics, Payroll depth, PCB and bank execution. SAVT and AI should follow only after these foundations and their external contracts are stable.

---

## Primary evidence map

- Database and constraints: `prisma/schema.prisma`, `prisma/migrations/*`.
- Session/RBAC: `src/lib/auth/*`, `src/lib/business-groups/*`, `src/lib/tenant.ts`, `src/middleware.ts`.
- Commerce: `src/app/(business)/cashier/actions.ts`, `pos/actions.ts`, `appointments/actions.ts`, `work-orders/actions.ts`, `invoices/actions.ts`, `packages/actions.ts`.
- Closing: `src/app/(business)/closing/*`, `src/lib/daily-closing/*`, `src/lib/closing-whatsapp/*`.
- Attendance/Leave: `src/lib/attendance/*`, `src/lib/leave/*`, `src/app/staff/*`, `src/app/(business)/team/attendance*`.
- Payroll/Statutory/Payment: `src/lib/payroll/*`, `src/app/(business)/team/payroll/*`, `docs/payroll-*`.
- WhatsApp: `src/lib/whatsapp/*`, `src/lib/notification-queue/*`, `scripts/notification-queue-worker.ts`, `whatsapp-connector/src/*`.
- Tests: `tests/unit/*`, `tests/integration/*`, `whatsapp-connector/src/multi-session.test.ts`.
- Historical/current comparison: README, `docs/PROJECT_MILESTONE.md`, `docs/RELEASE_STATUS.md`, WhatsApp acceptance docs, `GROUP_DASHBOARD_AI_READINESS_AUDIT.md`, and `docs/SAVT_TETAMU_POS_INTEGRATION_ARCHITECTURE.md`.

## Explicit unknowns

- Current deployed Testing/Production environment variables, worker process state, database backups and secret rotation: **UNKNOWN**.
- Current live WhatsApp account/session and delivery/read behavior: **TEST STATUS UNKNOWN**.
- Current external payment/acquirer settlement behavior: **NOT IMPLEMENTED / UNKNOWN outside repository**.
- Current government portal acceptance of generated statutory files: **TEST STATUS UNKNOWN**.
- Current whole-platform manual UAT after the latest Payroll/Attendance work: **TEST STATUS UNKNOWN**.
