# TETAMU MASTER UAT / COMMERCIAL LAUNCH ACCEPTANCE — FINAL STATUS

Audit date: 2026-08-12 (Asia/Singapore)

## A. Canonical Workspace

- Workspace / Git root: `C:\CodexTetamuP0`
- Branch: `codex/business-group-user-accounts`
- HEAD: `42dffd1066b9a839cdcea275be136f74d1db0a62`
- Existing dirty worktree: preserved; no reset, clean, destructive checkout, commit or push.
- Canonical working-directory guard: PASS.
- Final `git diff --check`: PASS (see final gate section).

## B. Environment

```text
LOCAL / TESTING ONLY
PRODUCTION NOT ACCESSED
PRODUCTION NOT VALIDATED
```

- Local PostgreSQL: `localhost:5432`, canonical Local database only.
- Local web: `http://localhost:3000`; login returned HTTP 200 after the final build restart.
- No Production account, database, variables, secrets, deployment, migration, provider payment, OTP or live statutory action was used.
- A Local production-mode build is only a build verification; it is not a Production deployment.

## C. Golden QA Accounts

Long-lived Local Golden identities were reused and selected by stable ID/slug rather than by random test data:

| Fixture | Canonical identity | Coverage |
| --- | --- | --- |
| QA SALON | `492e89a5-d458-4f11-9ff4-d02866e94d73` / `qa-salon-35b0d691` | 2 branches, Owner, Manager, Cashier, Staff, catalog, customers, packages, POS and frozen closes. |
| QA AUTO | `7d4c2fe3-127d-417e-a5c0-40fffd026ecc` / `qa-auto-35b0d691` | Customer, vehicle, work order, POS, split payment and void history. |
| QA HR COMPANY | `22588c35-97af-4d19-b739-3c3fa1adf39b` / `qa-commission-browser-salon`, plus established Staff/Roster/Payroll closure fixtures | Owner/approver/staff, Staff App, Roster, Attendance, Leave, Claims, Commission, Timesheet, Payroll and Payslip. |
| QA GROUP | `748a3487-7f3a-47f3-abea-d04f372bd295` | Group Owner and 3 active stores with different financial/module coverage. |
| MASTER UAT AP GOLDEN | `d5f61794-2fbf-416d-b91f-d3483ffa6165` / `master-uat-ap-golden` | Clean Supplier → PO → GR → Bill → AP → Payment → Reversal → Expense adapter evidence. |

The Local-only AP fixture is reproducible and idempotent through `scripts/prepare-master-uat-golden.ts`. Local QA passwords were never placed in source, documentation, console output, or this report.

## D. Commercial Onboarding

Status: **PASS**.

- Platform Admin used the real UI to create `MASTER UAT ONBOARD 33702245` (`master-uat-onboard-33702245`).
- The journey created one owner and one branch, enabled the intended POS + Salon modules, and preserved entitlement separation.
- New owner authentication used the normal login flow and landed in Cashier.
- The first-use empty catalog was actionable: “No sale items yet” with create-product/package links. It did not fail or invent sample financial facts.
- Commercial tests prove immutable plan versions, promotions, overrides, usage limits, scheduled changes and canonical subscription isolation.

## E. Salon

Status: **PASS**.

- Authenticated Owner Cashier loaded the real service/product catalog and product selection UI.
- The stable two-day browser simulation covers Owner/Manager/Cashier paths, customer creation, service/product/package sales, partial payment, refund, daily close and cross-branch isolation.
- Frozen Golden Salon values remain: day 1 gross RM400.00, refunds RM20.00, net/collected RM380.00, expected/actual cash RM280.00, difference RM0.00; day 2 sale/refund net RM0.00 and cash difference RM0.00.
- Branch B remains an isolated zero-close fact, not mixed into Main Branch.

## F. Auto

Status: **PASS**.

- Stable browser evidence covers customer, vehicle, work order, service/product lines, split payment and invoice history.
- Day 1 gross/net RM80.00, cash RM30.00, card RM50.00 and close difference RM0.00.
- Day 2 void keeps net RM0.00 and close difference RM0.00.
- Salon and Auto customer/vehicle/work-order facts remain tenant isolated.

## G. POS / Financial

Status: **PASS**.

- Idempotent checkout, partial payment, split payment, refund, void, closing and concurrency protections passed targeted, unit and integration coverage.
- Money was verified from canonical invoices, payments, refunds and frozen daily closes; no editable aggregate was treated as source of truth.
- Package benefit consumption and reversal remain separate from ordinary product stock facts.

## H. Inventory

Status: **PASS**.

- Stock ledger, stock-in/out, branch transfer, stock take, variance, reorder, refund choice, concurrency and tenant/branch isolation passed.
- Golden Salon stock remains Main 8 and Branch B 5 after its recorded flows.
- Clean Master AP inventory reconciliation returned no missing/mismatch arrays.

## I. Purchasing / AP

Status: **PASS**.

Canonical Master UAT AP scenario:

```text
PO: 10 × RM20
Net received: 6
Confirmed bill: 6 × RM20 = RM120
Payment RM50 -> outstanding RM70
Payment RM70 -> paid
Reverse RM70 -> outstanding RM70 / PARTIALLY_PAID
```

- Ordered 10, Received 6 and Billed 6 remain independent facts.
- Bill confirmation did not change stock; payment and reversal did not change stock.
- AP reconciliation: `BALANCED`, zero issues.
- Over-bill, duplicate supplier invoice, overpayment and concurrent confirmation/payment protections passed.
- The intentionally broken legacy GR-reversal fixture correctly surfaces `RECEIPT_REVERSAL_AFTER_BILL`; it is diagnostic evidence, not the Golden baseline.

## J. Expense / Business Spending

Status: **PASS**.

- Manual Expense, recurring generation, Claims adapter, finalized Payroll adapter and confirmed Supplier Bill adapter are idempotent and tenant scoped.
- Draft Bill, PO, Goods Receive and Supplier Payment do not recognize Expense.
- Confirmed Supplier Bill produced one Inventory Purchase spending fact; payment/reversal produced no second Expense.
- Clean Golden Expense reconciliation returned `healthy: true` with zero issues.

## K. Staff App

Status: **PASS** for Local mock-OTP UAT; real OTP provider remains an external dependency.

- Real Staff session opened Home, Roster, Attendance history, Leave, Timesheet and Profile at 390px.
- The UI explicitly labels the Local/Testing mock OTP boundary.
- Direct staff navigation to manager Payroll redirected to Login and leaked no protected data.
- Server-side module entitlement and self-only scope tests passed; the Staff App does not duplicate domain calculations.

## L. Roster / Attendance

Status: **PASS**.

- Draft/publish/version/copy, overnight shift, overlap protection, retrospective-date protection, Locked Timesheet protection and expected-day reconciliation passed.
- When no published expected schedule exists, the Staff App shows “No published schedule available”; it does not infer Off Day or No-show.
- Punch facts, missing-punch corrections, resolution workflow, final-result versioning and branch scope passed integration tests.

## M. Leave / Claims

Status: **PASS**.

- Leave balance/request/approval and Attendance linkage retain their domain boundaries.
- Claim attachments remain private; employee ownership, manager decisions, partial approval, reimbursements, cancellation and duplicate-warning behavior passed.
- Claims cannot silently change wage/net pay and enter Business Spending only through the existing adapter.

## N. Timesheet / Payroll / Payslip

Status: **PASS**.

- Timesheet lifecycle remains `DRAFT → APPROVED → LOCKED`; Payroll consumes immutable locked evidence.
- Recurring, variable, adjustment, Attendance-to-Payroll, Commission, correction and finalization paths passed the 26-test HR wave and full suites.
- Payslip publication is employee scoped. High-risk Payroll and supplier-payment actions retain True TOTP MFA/step-up gates.
- Statutory activation is not claimed by this UAT.

## O. Business Dashboard

Status: **PASS**.

- Authenticated Dashboard loaded at 390px and 1440px without horizontal page overflow.
- Canonical Sales, Recorded Business Spending, Inventory and AP are aggregated without double counting.
- Missing module/source coverage is displayed as “Not included” / “Not available,” not zero.
- “Income vs Recorded Business Spending” is explicitly not labelled accounting net profit.

## P. Group Dashboard

Status: **PASS**.

- Group Overview loaded at 390px for the active Group Owner with 3 authorised stores.
- Ranking, aggregate coverage and missing-data semantics remain explicit.
- Live group membership controls current access; transfer-time history remains frozen to the appropriate group.

## Q. Ask Tetamu

Status: **PASS**.

- Business and Group Ask Tetamu pages loaded at 390px with no overflow or console errors.
- Existing acceptance conversations cover sales, profit-safety wording, inventory, AP, missing data and prompt-injection resistance.
- Quota displayed 2/2 consumed and 0 remaining; the next ask was disabled before a provider call.
- AI remains read-only and cannot mutate business facts. Real OpenAI acceptance was previously completed using the Local/Testing key boundary; this UAT did not expose or copy the key.

## R. Commercial Pricing

Status: **PASS**.

- Customer A remains pinned at RM169 while Customer B receives the active RM199 version.
- Explicit RM159 override outranks promotion while preserving list-price evidence.
- Add-ons, branch/employee limits, AI allowance and legacy-review fail-closed behavior passed.

## S. Subscription Billing

Status: **PASS**.

- `CommercialSubscription`, `SubscriptionInvoice` and `SubscriptionPayment` remain separate canonical domains.
- Draft invoice is not receivable; issue RM169, pay RM100 + RM69, reversal RM69 and outstanding restoration passed.
- Concurrent payment cannot overpay; completed payment is reversed rather than edited/deleted.
- Global subscription reconciliation returned `MATCH`.

## T. Upgrade / Downgrade / Renewal

Status: **PASS** for the Phase 1 supported lifecycle.

- Scheduled plan change preserves historical prices until effective, then applies at renewal.
- Renewal generation is idempotent and advances the renewal date once.
- Upgrade/downgrade does not rewrite issued invoices or independently change Module Entitlement.
- Online payment-provider collection and expanded cancellation/suspension commercial policy are deferred, not silently simulated.

## U. Security / Tenant / Branch

Status: **PASS**.

- Tenant, branch, group, staff self-only, revoked membership, module entitlement and capability gates passed.
- Password step-up and True TOTP are action/resource/session bound, short lived and replay safe.
- Cross-tenant Customers, WhatsApp, Inventory, AP, Expense, AI, Commercial and Subscription Billing access is denied.
- Production secrets were not accessed. Local QA credentials were not committed or documented.

## V. Responsive / Browser Quality

Status: **PASS**.

Real in-app browser checks at 390px covered:

- Cashier and Business Dashboard;
- Inventory, Purchase Orders, Supplier Bills, AP and Expense;
- Staff Home, Roster, Attendance History, Leave, Timesheet and Profile;
- Business Ask Tetamu and Group Ask Tetamu;
- Platform Commercial and Subscription Billing;
- Group Overview.

No page-level horizontal overflow, browser console error or hydration error was observed. Dashboard was also rechecked at 1440px. Two non-blocking build/lint advisories are recorded as P3 items.

## W. Reconciliation

All clean Golden sources reconcile:

| Reconciliation | Result |
| --- | --- |
| POS invoices / payments / refunds / closes | MATCH |
| Inventory ledger / stock | MATCH |
| AP confirmed bills / valid completed payments | MATCH |
| Expense source snapshots / spending | MATCH |
| Attendance ExpectedDay / published Roster | MATCH |
| Payroll locked Timesheet / snapshots | MATCH |
| Commercial subscription state | MATCH |
| AI usage / allowance ledger | MATCH |
| Subscription invoice / payment / reversal | MATCH |
| Group reporting scope / aggregates | MATCH |

The deliberately inconsistent legacy AP fixture reports an ISSUE by design and demonstrates that reconciliation does not auto-fix canonical source data.

## X. Bugs / Severity

The detailed register is `docs/master-uat-bug-register.md`.

```text
OPEN P0 BUGS -> 0
OPEN P1 BUGS -> 0
OPEN P2 BUGS -> 0
OPEN P3 BUGS -> 2
```

No launch-blocking product defect remains. The only code defect introduced during this UAT was caught by TypeScript, minimally fixed in the Local fixture script, and retested.

## Y. External / Deferred Dependencies

These are not UAT bugs:

```text
REAL STAFF OTP PROVIDER -> PENDING
MALAYSIA STATUTORY HUMAN SIGN-OFF -> PENDING
PCB -> PARTIAL
PUBLIC BANK -> PUBLIC_BANK_SPEC_NOT_READY
ONLINE SUBSCRIPTION PAYMENT -> DEFERRED
SST / TAX INVOICE -> DEFERRED
SUPPLIER CREDIT NOTE -> DEFERRED
COGS / GL -> DEFERRED
AI PHASE 2 -> DEFERRED
```

## Engineering Gates

| Gate | Result |
| --- | --- |
| Targeted domain tests | 89/89 PASS |
| Full unit | 847/847 PASS |
| Full integration | 160/160 PASS |
| TypeScript | PASS |
| Lint | PASS, 1 existing non-blocking warning |
| Prisma validate | PASS |
| Prisma generate | PASS |
| Migration status | PASS; 171 migrations, database up to date |
| Fresh migration rebuild | NOT REQUIRED; no schema change in this UAT |
| Local production-mode build | PASS; 136 pages, 1 existing CSS advisory |
| Local service restart | PASS; `/login` HTTP 200 |
| Secret scan | PASS |
| Canonical guard | PASS |
| `git diff --check` | PASS |

## Required Master Matrix

```text
COMMERCIAL ONBOARDING -> PASS
OWNER FIRST LOGIN -> PASS
SALON CORE DAY -> PASS
AUTO CORE DAY -> PASS
POS FINANCIAL RECONCILIATION -> PASS
REFUND / VOID -> PASS
CUSTOMER HISTORY -> PASS
PACKAGE -> PASS
COMMISSION -> PASS
INVENTORY CORE -> PASS
BRANCH TRANSFER -> PASS
STOCK TAKE -> PASS
REORDER -> PASS
SUPPLIER / PO -> PASS
GOODS RECEIVE -> PASS
SUPPLIER BILL / AP -> PASS
SUPPLIER PAYMENT -> PASS
EXPENSE -> PASS
BUSINESS SPENDING -> PASS
STAFF APP -> PASS
ROSTER -> PASS
ATTENDANCE -> PASS
NO-ROSTER SAFETY -> PASS
LEAVE -> PASS
CLAIMS -> PASS
TIMESHEET -> PASS
PAYROLL CORE -> PASS
PAYSLIP -> PASS
BUSINESS DASHBOARD -> PASS
GROUP DASHBOARD -> PASS
ASK TETAMU BUSINESS -> PASS
ASK TETAMU GROUP -> PASS
AI QUOTA -> PASS
COMMERCIAL PRICING -> PASS
SUBSCRIPTION BILLING -> PASS
PARTIAL PAYMENT / REVERSAL -> PASS
RENEWAL -> PASS
UPGRADE / DOWNGRADE -> PASS
TENANT ISOLATION -> PASS
BRANCH ISOLATION -> PASS
STAFF PRIVACY -> PASS
RESPONSIVE -> PASS
CONSOLE / HYDRATION -> PASS
ALL RECONCILIATIONS -> PASS
OPEN P0 BUGS -> 0
OPEN P1 BUGS -> 0
OPEN P2 BUGS -> 0
OPEN P3 BUGS -> 2
```

## Z. Final Launch UAT Status

All core flows pass, all clean Golden financial reconciliations match, tenant/branch isolation passes, and open P0/P1 are zero. Therefore:

```text
TETAMU COMMERCIAL LAUNCH UAT -> READY

TETAMU MASTER UAT / COMMERCIAL LAUNCH ACCEPTANCE
-> READY

OPEN P0 BUGS -> 0
OPEN P1 BUGS -> 0

READY FOR PRODUCTION READINESS AUDIT -> YES

LOCAL / TESTING ONLY
PRODUCTION NOT ACCESSED
PRODUCTION NOT VALIDATED
```

This is acceptance readiness for the next audit. It is not a statement that Production has been validated or that the system is already Production ready.
