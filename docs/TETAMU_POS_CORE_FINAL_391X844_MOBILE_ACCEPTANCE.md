# TETAMU POS CORE — FINAL 391×844 MOBILE ACCEPTANCE

## Acceptance summary

- Overall status: **REVIEW REQUIRED**
- Environment: Local UAT only
- Browser viewport reported by the page: `391 × 844` CSS pixels
- Device pixel ratio: `1.0000000158992113`
- Production accessed: **NO**
- Business/financial logic changed: **NO**
- New P0: **0**
- New P1: **1** — a Branch A staff session could directly open a Branch B customer record
- Production Candidate: **NO**, pending correction and re-test of the branch-scope defect

The Salon and Auto operational mobile flows remain usable and the accepted refund/receivable semantics are correctly presented. The mobile acceptance cannot be marked READY because the required negative branch-scope check failed.

## Screen-by-screen acceptance

| Area | Functional | Mobile UI/UX | Evidence / finding |
| --- | --- | --- | --- |
| Login / app shell | PASS | PASS | Login, business context, mobile navigation and Sign out fit without page-level overflow. |
| Customer | PASS | PASS WITH P2 POLISH | Search, list, detail and edit form are usable. The result table uses contained horizontal scrolling and some `View` links are smaller than 44px. |
| Appointment | PASS | PASS WITH P2 POLISH | Calendar horizontal scrolling is contained; date/staff/time context and New Appointment remain reachable. Discoverability and small arrow/icon targets can be polished. |
| Cashier / My Shift | PASS | PASS | Opening float, expected drawer, counted cash, difference, reason and End Shift fit and remain reachable. No shift was ended during this acceptance. |
| Checkout / Payment | PASS | PASS | Customer, items, totals, payment methods and CTA remain visible inside the mobile payment surface. No payment was committed. |
| Discount | PASS | PASS WITH P2 POLISH | Valid 10% discount shows RM15 and final RM135. Expired discounts are hidden. Minimum-spend rejection still closes without explaining why. |
| Invoice | PASS | PASS | RM135 total, RM135 settled, RM35 refunded, RM100 net collected, RM0 outstanding, Paid and Partially refunded are unambiguous. |
| Refund | PASS | PASS | Available amount, method, amount input, reason and action fit. No additional refund was submitted. Confirmation behavior remains covered by focused tests. |
| Package | PASS | PASS | Haircut 3-Visit Pass shows 2/3 uses left; Invoice 1005 remains paid by `PACKAGE`, not a cash/card/DuitNow collection. |
| Reports | PASS | PASS | Summary, Daily Sales, Payment Mix, day detail, payment drill-down and refund trace fit with contained drawers and no page-level overflow. |
| Closing — Cashier | PASS | PASS | My Shift fields fit; cashier does not receive branch-level Daily Closing controls. |
| Closing — Owner/Manager | PASS | PASS | Branch/day context, readiness, open shifts, expected/actual movement, history and secondary WhatsApp surface remain understandable. |
| Auto | PASS | PASS | Work Order `WO-260828-QV4B`, plate `UAT18028`, Premium Detailing RM180, Paid RM180 and Balance RM0 are readable; Invoice 1002 remains paid. |

## Permission quick check

| Check | Result | Evidence |
| --- | --- | --- |
| No-Reports Staff → Reports denied | PASS | Direct `/reports` request was redirected to `/appointments`. |
| Branch-A Staff → Branch B denied | **FAIL (P1)** | Direct access to Branch B customer `UAT Customer B` rendered full contact, appointment and spending data. |
| Cashier → branch Daily Closing denied | PASS | Cashier Closing surface contained My Shift only and did not expose branch Daily Closing controls. |

### Frozen P1 evidence

- Session: `uat.salon.branch-a@tetamu.test`
- Assigned branch: Branch A
- Requested record: `UAT Customer B` in Branch B
- Requested route: `/crm/customers/7804650e-8957-4bdd-bb9c-3fa6f8ee47c7`
- Actual result: customer detail rendered instead of being denied
- Business data changed: NO
- Application code changed: NO

## Money and refund presentation

- Observable mobile values verified: RM0.00, RM35.00, RM50.00, RM100.00, RM120.00, RM135.00, RM180.00, RM305.00, RM370.00, RM405.00 and RM520.00.
- Focused Reports presentation tests additionally verified thousands and long values without ellipsis/clipping, including the long-money contract.
- The partially refunded fully-paid invoice does not imply that the customer owes RM35.
- Opening Float remains separate from Daily Net Cash Movement.

## Historical refund impact audit clarification

The original category totals overlapped because every complex multi-refund row also had a settlement category. The local read-only audit now assigns `COMPLEX` first, producing mutually exclusive buckets.

- Total scanned: **83**
- Total affected: **80**
- Total unaffected: **3**
- Affected — Fully paid → partial refund: **45**
- Affected — Fully paid → full refund: **0**
- Affected — Partial paid → refund: **0**
- Affected — Complex multi-payment/refund: **35**
- Sum check: `45 + 0 + 0 + 35 = 80` — **PASS**
- Production backfill executed: **NO**
- Local repair mode executed: **NO**

## Findings

### P0

- None.

### P1

- Branch-scoped staff can directly read a customer assigned to another branch through the customer detail route. This is a security/tenant-boundary acceptance failure and blocks Production Candidate status.

### P2

- Minimum-spend discount rejection lacks a user-facing explanation.
- Appointment calendar scrolling is operationally usable but discoverability can be improved.
- Customer/appointment secondary icon actions below the preferred 44px target can be enlarged.

### P3

- None separately recorded.

## Test evidence

- Focused unit tests: **66/66 PASS**
  - Refund settlement and UI presentation
  - Reports daily sales and mobile-safe drawer contracts
  - Closing shift/daily control contracts
  - Appointment quick actions and staff branch-query contracts
- Focused integration tests with embedded local PostgreSQL: **9/9 PASS**
- Historical refund audit: read-only, mutually-exclusive total **80/80 PASS**
- TypeScript: **PASS**
- ESLint (changed UAT helpers): **PASS**
- `git diff --check`: **PASS**
- Production build: **NOT REQUIRED** — no application/business code changed

## Mobile evidence

- [Login](/C:/CodexTetamuP0/docs/evidence/pos-core-mobile-391x844/01a-login.png)
- [App shell](/C:/CodexTetamuP0/docs/evidence/pos-core-mobile-391x844/01-login-app-shell.png)
- [Customer list](/C:/CodexTetamuP0/docs/evidence/pos-core-mobile-391x844/02-customer.png)
- [Customer detail](/C:/CodexTetamuP0/docs/evidence/pos-core-mobile-391x844/02b-customer-detail.png)
- [Appointment](/C:/CodexTetamuP0/docs/evidence/pos-core-mobile-391x844/03-appointment.png)
- [Cashier / My Shift](/C:/CodexTetamuP0/docs/evidence/pos-core-mobile-391x844/04-cashier-my-shift.png)
- [Checkout](/C:/CodexTetamuP0/docs/evidence/pos-core-mobile-391x844/05-checkout.png)
- [Partially refunded invoice](/C:/CodexTetamuP0/docs/evidence/pos-core-mobile-391x844/06-invoice-partially-refunded.png)
- [Refund form](/C:/CodexTetamuP0/docs/evidence/pos-core-mobile-391x844/07-refund-form.png)
- [Package balance/use](/C:/CodexTetamuP0/docs/evidence/pos-core-mobile-391x844/08-package-balance.png)
- [Reports Daily Sales](/C:/CodexTetamuP0/docs/evidence/pos-core-mobile-391x844/09-reports-daily-sales.png)
- [Reports day detail/payment](/C:/CodexTetamuP0/docs/evidence/pos-core-mobile-391x844/10-reports-day-detail-payment.png)
- [Closing](/C:/CodexTetamuP0/docs/evidence/pos-core-mobile-391x844/11-closing-manager.png)
- [Auto Work Order / Checkout](/C:/CodexTetamuP0/docs/evidence/pos-core-mobile-391x844/12-auto-work-order-checkout.png)
- [Branch-scope failure](/C:/CodexTetamuP0/docs/evidence/pos-core-mobile-391x844/13-branch-scope-failure.png)

## Final verdict

```text
TETAMU POS CORE
→ FUNCTIONAL READY ✅
→ FINANCIAL READY ✅
→ DESKTOP READY ✅
→ MOBILE READY ✅
→ UI/UX CORE READY ✅
→ LOCAL/TESTING READY ✅
→ SECURITY QUICK REGRESSION ❌

PRODUCTION CANDIDATE
→ NO

PRODUCTION VALIDATED
→ NO
```

Required next step: correct the CRM customer-detail branch authorization boundary, then repeat only the Branch-A → Branch-B negative check and the affected focused permission tests.
