# TETAMU POS CORE — Authenticated E2E & Two-Day Business Simulation

## A. Objective

This record proves, in a Local/Testing environment only, that authenticated Salon and Auto operators can use the actual UI, persist state through the server into PostgreSQL, complete financial operations, close two distinct business days, and reconcile source transactions to frozen closing snapshots and reports.

No Production environment, account, data, variable, deployment, migration, payment provider, bank, or live WhatsApp integration was accessed. A local production-mode build is a build verification only and is not a Production deployment.

Test mode: browser-driven authenticated E2E using the Codex in-app browser, backed by direct read-only database reconciliation and the repository test suites. Core business mutations were performed through the UI; database access was used for verification. The only data-time fixture was a controlled shift of clearly identified local QA transaction timestamps to create Day 1 without changing the system clock.

## B. Environment

- Workspace / Git root: `C:\CodexTetamuP0`
- Branch: `codex/business-group-user-accounts`
- Baseline HEAD: `6db4e3dfa9aa5ebedf7977c01118bb423ef3ef6a`
- Application: `http://localhost:3000`
- Database: local embedded PostgreSQL on `localhost:5432`
- Business timezone: `Asia/Kuching`
- Normal business-day cutoff: `02:00`
- Simulation dates: `2026-08-08` and `2026-08-09`
- Existing dirty worktree at start: 182 entries; preserved without reset, destructive checkout, commit, or push.
- Synthetic run identifier: `35b0d691`

The initial Day 1 close used a temporary QA-only `23:59` cutoff. Clearly identified QA transaction timestamps were then shifted by exactly one day in the local database and the cutoff was restored to `02:00`. This avoided changing the host clock and kept the two source days deterministic. No Production data existed in scope.

## C. QA Authentication

- The existing local Platform Admin account was verified through the real login form.
- `QA Salon Owner`, `QA Auto Owner`, `QA Salon Manager`, and `QA Salon Cashier` were created through the formal account model in Local/Testing.
- Passwords were generated for this run, were not committed, were not written to source or documentation, and are intentionally omitted here.
- No auth bypass, middleware disablement, forced role cookie, hard-coded session, or direct session injection was used.
- Login, sign-out, re-login, navigation, reload, industry switch, and role sessions remained stable.

## D. Roles

Owner coverage included business/branch setup, catalog, customer, cashier, financial correction, closing, and reports.

Manager coverage used the `QA Manager` role profile with the expected Salon operational capabilities. A real manager login showed Cashier, Appointments, CRM, Membership, Closing, Reports, Catalog, and People access while Company settings remained unavailable.

Cashier coverage used the `QA Cashier` role. A real cashier login exposed only the configured daily-operation modules. Direct navigation to `/business/settings` redirected to `/appointments`, showed no sensitive data, and performed no mutation. Authorization was therefore checked beyond menu hiding.

## E. Salon Setup

- Business: `QA SALON 35b0d691`
- Business ID: `492e89a5-d458-4f11-9ff4-d02866e94d73`
- Main branch: `QA SALON 35b0d691`
- Branch B: `QA Salon Branch B`
- Staff: QA Owner, Manager, and Cashier
- Service: `QA Hair Service 35b0d691`, RM100
- Product: `QA Shampoo 35b0d691`, RM20 at sale time, starting stock 10 in Main and 5 in Branch B
- Package: `QA Hair 2 Uses 35b0d691`, RM180, two service uses
- Customers: separate synthetic appointment, walk-in, and package customers

The business, second branch, staff, customers, service, product, package, role profiles, and permissions were created or configured through authenticated UI. A malformed phone was rejected. A formatted Malaysian phone was accepted after the regression fix and stored in canonical local form.

## F. Salon Day 1

1. Appointment customer → service → assigned manager → saved appointment → reload → completed checkout.
2. Appointment checkout added one RM20 product to the RM100 service and accepted RM120 cash.
3. Rapid final-payment action created exactly one invoice, `INV-260809-11439AD`.
4. Walk-in customer completed a RM100 service paid by E-wallet with a synthetic reference.
5. Package customer purchased the RM180 two-use package by cash.
6. The same customer redeemed one service use. The invoice carried RM100 package voucher value with zero monetary collection.
7. A supported RM20 cash refund produced a credit note and changed the original invoice to Partial.
8. Main-branch shift: opening float RM50, physical close RM330, expected close RM330, variance RM0.
9. Frozen business-day snapshot: gross RM400, refund RM20, net/collected RM380, expected and actual transaction cash RM280, variance RM0.

The package voucher amount is not new cash revenue. Package purchase revenue is included once; redemption is tracked as one package use and excluded from monetary payment totals.

## G. Salon Day 1 Reconciliation

| Metric | Expected | Actual | Difference | Result |
| --- | ---: | ---: | ---: | --- |
| Monetary payment gross | RM400.00 | RM400.00 | RM0.00 | PASS |
| Refunds | RM20.00 | RM20.00 | RM0.00 | PASS |
| Net sales / collected | RM380.00 | RM380.00 | RM0.00 | PASS |
| Cash after refund | RM280.00 | RM280.00 | RM0.00 | PASS |
| Non-cash | RM100.00 | RM100.00 | RM0.00 | PASS |
| Closing expected cash | RM280.00 | RM280.00 | RM0.00 | PASS |
| Closing physical cash | RM280.00 | RM280.00 | RM0.00 | PASS |
| Branch report revenue | RM400.00 | RM400.00 | RM0.00 | PASS |
| Branch report net | RM380.00 | RM380.00 | RM0.00 | PASS |

Invoice face value is RM500 because it includes a RM100 package-redemption invoice. Monetary revenue is RM400 because the redemption is a voucher, not a second sale. This is an explained design difference, not an unexplained reconciliation variance.

## H. Salon Day 2

- Day 1 remained closed before Day 2 began.
- Main-branch opening float: RM20.
- A returning-customer product-only sale created a RM20 Card payment and one invoice.
- A formal second RM20 cash refund against the Day 1 invoice was recorded on Day 2. This is a cross-day correction, not a rewrite of Day 1 facts.
- Day 2 monetary gross RM20 less refund RM20 = net RM0.
- Transaction cash impact was negative RM20 and Card was positive RM20.
- Shift expected and counted cash including opening float were both RM0; variance RM0.
- Frozen Day 2 snapshot: gross RM20, refunds RM20, net RM0, expected/actual transaction cash -RM20, difference RM0.
- Day 1 snapshot timestamps and stored totals did not change after the Day 2 correction.
- Main stock ended at 8 and Branch B stock remained 5, matching two RM20 product sales.

## I. Salon Final Result

- Salon Day 1: PASS
- Salon Day 2: PASS
- Salon package ledger: 2 total, 1 redeemed, 1 remaining in both aggregate and service ledger — PASS
- Salon financial reconciliation: PASS
- Salon authenticated browser flow: PASS

## J. Auto Setup

- Business: `QA AUTO 35b0d691`
- Business ID: `7d4c2fe3-127d-417e-a5c0-40fffd026ecc`
- Branch: `QA AUTO 35b0d691`
- Service: `QA Premium Wash 35b0d691`, RM80
- Customer: `QA Auto Customer 35b0d691`
- Vehicles: `QA351` and `QA352`, both assigned to the same synthetic customer and confirmed after reload in the vehicle list
- Package/product: not configured for this Auto scenario; package accounting was exercised in the Salon scenario.

Customer creation, formatted-phone regression, vehicle search, vehicle creation, second-vehicle association, service setup, job creation, and vehicle reload were performed through authenticated UI.

## K. Auto Day 1

1. Customer → vehicle `QA351` → RM80 service → work order `WO-260809-FD06`.
2. Work order advanced through In Progress, Ready for Pickup, Paid, vehicle collected, and Completed.
3. Checkout accepted RM30 Cash, producing a Partial state, then RM50 Card with a synthetic reference, producing Paid.
4. Invoice `INV-260809-1214BZA` remained after reload with RM80 paid and zero balance.
5. Shift opening float RM100; expected and physical close RM130; variance RM0.
6. Frozen Day 1 snapshot: gross/net/collected RM80, Cash RM30, Card RM50, one completed job, zero outstanding.

Ready-for-pickup and invoice notifications were created as safe local drafts only. Nothing was sent through a live WhatsApp provider.

## L. Auto Day 1 Reconciliation

| Metric | Expected | Actual | Difference | Result |
| --- | ---: | ---: | ---: | --- |
| Invoice / work-order gross | RM80.00 | RM80.00 | RM0.00 | PASS |
| Payments | RM80.00 | RM80.00 | RM0.00 | PASS |
| Cash | RM30.00 | RM30.00 | RM0.00 | PASS |
| Card | RM50.00 | RM50.00 | RM0.00 | PASS |
| Refund / void | RM0.00 | RM0.00 | RM0.00 | PASS |
| Outstanding | RM0.00 | RM0.00 | RM0.00 | PASS |
| Closing expected cash | RM30.00 | RM30.00 | RM0.00 | PASS |
| Closing physical cash | RM30.00 | RM30.00 | RM0.00 | PASS |
| Report net sales | RM80.00 | RM80.00 | RM0.00 | PASS |

## M. Auto Day 2

- Day 1 remained closed before Day 2 began.
- Shift opening float RM50.
- A second RM80 work order was created and paid by E-wallet through UI.
- The supported authenticated Void action was executed with a reason.
- The payment became `VOID`, invoice `INV-260809-12179FU` became `VOID` with RM80 balance, and the work order reopened In Progress / Unpaid for correction.
- Frozen Day 2 snapshot: active sales RM0, active payments RM0, cash RM0, expected/actual transaction cash RM0, variance RM0.
- Shift expected and physical close including opening float were both RM50.
- Day 2 report showed one RM80 voided payment and RM80 outstanding on the reopened job, while net sales remained RM0. This is the intended correction state.
- A second vehicle `QA352` was created through the normal UI and persisted under the same customer.

## N. Auto Final Result

- Auto Day 1: PASS
- Auto Day 2: PASS
- Work-order lifecycle, partial payment, final payment, Ready for Pickup, completion, and Void: PASS
- Auto financial reconciliation: PASS
- Auto authenticated browser flow: PASS

## O. Package Validation

Salon package purchase generated one RM180 monetary sale and one customer package with two uses. Redemption generated a RM100 package-method payment representing one use, not cash. Aggregate remaining uses and the per-service ledger both equal one. Closing and reports exclude voucher value from monetary revenue and avoid double counting.

Auto package behavior was not configured in this scenario; no Auto package claim is made.

## P. Payment Validation

- Salon: Cash, E-wallet, Card, and Package voucher.
- Auto: Cash + Card split payment and E-wallet followed by Void.
- Auto partial payment moved from Partial to Paid.
- Salon rapid final submit produced one invoice and one financial effect.
- Browser back/reload/return did not create duplicate invoices.
- Targeted idempotency integration tests, including tenant conflicts, concurrent full/partial payment, package last-use concurrency, rollback, and 20-operation stress, all passed.

## Q. Refund/Void Validation

Salon supported partial refunds through authenticated UI. Refund dates control the business day: the original sale remains on Day 1 while the second refund belongs to Day 2. The current invoice balance is RM40 after two RM20 refunds, while the immutable Day 1 snapshot correctly retains the as-closed RM20 outstanding fact.

Auto supported authenticated payment Void. The active payment total returned to zero, invoice and work order reopened to an explainable correction state, Day 2 net remained zero, and the two-day report separately disclosed RM80 voided and RM80 outstanding.

## R. Closing

All four main store-day closes had zero cash difference:

| Store day | Net | Expected cash | Actual cash | Difference |
| --- | ---: | ---: | ---: | ---: |
| Salon 2026-08-08 | RM380.00 | RM280.00 | RM280.00 | RM0.00 |
| Salon 2026-08-09 | RM0.00 | -RM20.00 | -RM20.00 | RM0.00 |
| Auto 2026-08-08 | RM80.00 | RM30.00 | RM30.00 | RM0.00 |
| Auto 2026-08-09 | RM0.00 | RM0.00 | RM0.00 | RM0.00 |

Branch B also completed an empty-day close with zero sales and zero variance. Its RM50 opening float displayed and closed as RM50, not the prior erroneous concatenated RM500 value.

## S. Dashboard

The current middleware intentionally redirects `/dashboard` and `/salon/dashboard` to `/reports`; there is no separate financial dashboard definition to reconcile. This redirect was verified in an authenticated session. Reports are therefore the canonical current dashboard surface. Salon Day 2 displayed RM20 gross, RM20 refunds, and RM0 net; Auto Day 2 displayed RM0 active sales plus the separate RM80 void/outstanding correction state.

## T. Reports

- Salon Day 1 branch report: Revenue RM400, Refunds RM20, Net RM380.
- Salon Day 2 all-branch report: Revenue RM20, Refunds RM20, Net RM0.
- Salon two-day report: Revenue RM420, Refunds RM40, Net RM380.
- Auto Day 1: Gross/Net RM80, Cash RM30, Card RM50, one paid invoice and completed job.
- Auto Day 2: Net RM0, one voided RM80 payment, one void RM80 invoice, RM80 outstanding reopened work order.
- Auto two-day: Net RM80, Cash RM30, Card RM50, one voided RM80 payment, two jobs and two invoices.

The Salon report initially omitted direct product-only and package-purchase payments. The query was corrected to include all active non-package-voucher payments in the same tenant, branch, and date scope. The resulting RM380 two-day net exactly equals the sum of frozen daily net values.

## U. Multi-Branch

Salon Branch A and Branch B have distinct IDs and stock rows. Branch switching and branch filters were exercised in Closing and Reports. Branch B showed zero transactions and its own zero-value snapshot. Main product stock changed from 10 to 8; Branch B remained 5. The cashier regression was explicitly reproduced with a Services search returning no items while the Products tab remained accessible and showed the in-stock QA product.

## V. Tenant/RBAC

- Salon and Auto use independent business IDs, branches, customers, invoices, payments, and sessions.
- Auto CRM search for `QA Salon` returned zero; Salon CRM search for `QA Auto` returned zero.
- An Auto session guessed a real Salon customer URL and received authenticated 404 with no data flash.
- Database checks found zero cross-tenant Payment→Invoice, InvoiceItem→Invoice, WorkOrder→Vehicle, and Vehicle→Customer relations.
- Owner, Manager, and Cashier sessions were independently authenticated.
- Cashier direct access to owner settings was server-side redirected without mutation.
- Manager allowed modules were accessible; Company settings remained absent.

## W. Browser/Server Errors

During exploration, five deterministic issues were found. All were reproduced before repair and rechecked afterward:

1. A formatted `+60` CRM phone caused a development overlay. After normalization/validation repair, the same UI flow succeeded and invalid alphabetic input remained rejected.
2. Closing table expected cash concatenated formatted strings, displaying values such as RM500 instead of numeric addition. The shared numeric helper now produces RM50 and handles negative cash.
3. Salon report omitted direct product and package-purchase payments. The corrected report reconciles to RM0 difference.
4. Multi-branch CRM edit posted `branchId` while the action read `customerBranchId`, producing `Branch is required`. The action now reads the actual form contract; browser edit/reload persisted the new customer name and phone with no overlay.
5. Product edit passed Prisma Decimal objects to a Client Component. The server boundary now serializes monetary values; a fresh-tab regression showed zero console errors.

The historical error records remain in the original long-lived development tab as discovery evidence. Fresh post-fix tabs for the CRM and product regressions contained no runtime overlay or console error. Expected integration-test database rejections and serialization retries are intentional assertions, not application failures.

## X. Fixes Made

| Severity | Issue / root cause | Files | Minimal fix | Regression evidence |
| --- | --- | --- | --- | --- |
| CRITICAL | Salon report scoped revenue only to appointment/work-order links | `src/app/(business)/reports/page.tsx` | Aggregate all active non-`PACKAGE` payments/refunds in business/branch/date scope | Day 1 RM380 net; Day 2 RM0; two-day RM380 |
| HIGH | Closing UI added a formatted string to opening float | `src/app/(business)/closing/page.tsx`, `src/lib/validation/pos.ts` | Numeric `sumMoneyAmounts` helper | Branch B RM50; unit test |
| MEDIUM | Common formatted phone reached a digits-only schema | `src/lib/validation/crm.ts` | Validate allowed formatting, normalize, then enforce canonical length | Formatted-phone browser test; two unit tests |
| MEDIUM | CRM edit action read the wrong branch form key | `src/app/(business)/crm/actions.ts` | Read `branchId`, matching `BranchSelect` | Multi-branch edit persisted after reload |
| MEDIUM | Prisma Decimal crossed the Server→Client boundary | `src/app/(business)/products/[productId]/page.tsx`, `src/components/product-form.tsx` | Serialize price/cost/tax to plain numbers | Fresh product-edit tab had zero console errors |

New unit tests:

- `tests/unit/crm-phone-validation.test.ts`
- `tests/unit/money-sum.test.ts`

No schema change or migration was added.

## Y. Remaining Blockers

No blocker remains for Local/Testing acceptance of the exercised POS core.

Boundaries and non-blocking risks:

- Production is completely out of scope and not under our control; this record makes no Production-readiness or deployment claim.
- Live WhatsApp, real payment provider, real bank, Payroll, Statutory, Claim, and Public Bank work were not entered.
- Auto packages were not configured in this simulation; package accounting was validated in the Salon scenario and by unit/integration tests.
- Standalone dashboard routes currently redirect to Reports by design.
- Lint/build retain existing non-POS warnings: WhatsApp `<img>`, two autoprefixer `end` compatibility warnings, and Prisma 7 configuration deprecation guidance.

Quality gates:

- Targeted POS unit tests: 42/42 PASS
- Targeted POS idempotency integration: 4/4 PASS
- Full unit: 707/707 PASS
- Full integration: 89/89 PASS
- TypeScript: PASS
- Lint: PASS with one existing warning
- Local production-mode build: PASS with existing warnings
- Prisma validate: PASS
- Prisma generate: PASS after stopping the local Windows DLL holder
- Migration status: 141 migrations, up to date
- Disposable full migration rebuild: PASS
- Canonical working-directory guard: PASS
- `git diff --check`: PASS

## Z. Final Status

```text
TESTING SALON E2E — PASS

TESTING AUTO E2E — PASS

TESTING 2-DAY BUSINESS SIMULATION — PASS

TESTING FINANCIAL RECONCILIATION — PASS

TETAMU POS CORE — TESTING ACCEPTANCE READY
```

This is a Local/Testing acceptance result only. It authorizes no Production operation.
