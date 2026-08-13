# TETAMU COMMISSION ENGINE — FOUNDATION + FINAL CLOSURE

## A. Canonical workspace

- Canonical workspace: `C:\CodexTetamuP0`
- Branch: `codex/business-group-user-accounts`
- Starting HEAD: `42dffd1066b9a839cdcea275be136f74d1db0a62`
- Existing dirty worktree was preserved. No reset, checkout, commit, push or deployment was performed.
- Scope is Local / Testing only. Production was not accessed or validated.

## B. Existing-system audit

The existing POS already supplied immutable paid invoice facts, line-level service assignments, proportional invoice discount allocation, refunds, package sale/redemption facts, Payroll variable pay and business-module entitlements. It did not have a durable Commission domain, effective-dated rule registry, independent period approval, immutable statements or a frozen Payroll bridge.

## C. Scope decision

This closure adds the minimum complete Commission foundation without entering PCB, Statutory Human Review, statutory activation, Claims Payroll Bridge, Public Bank, Payroll Payment, AI, SAVT or Production. Split commission is explicitly deferred because the current POS does not capture a safe line-level split attribution.

## D. Module entitlement

`COMMISSION` is a first-class add-on module with a `CORE` dependency. Route and navigation visibility require both module entitlement and capability. A direct request by a POS-only tenant is redirected to the module-not-enabled page; permissions never override entitlement.

## E. Domain model

The database now contains tenant-scoped models for rules, rule revisions, source events, periods, statements, accruals and adjustments. Monetary values use integer cents. Source events, accruals and adjustment facts are append-only. Composite foreign keys and database guards reject cross-business, cross-branch and cross-membership references.

## F. POS integration boundary

Checkout persists an explicit line-level commission membership snapshot for service, product and package-purchase lines when a salesperson is selected. Commission recovery reads already committed paid invoices; it is not part of the financial checkout transaction. A Commission calculation or recovery failure therefore cannot roll back or corrupt POS payment facts.

## G. Staff attribution

Service lines use the explicit line assignment. A service may use the appointment's assigned staff only when that evidence is present. Product and package purchases can use the explicit salesperson selected at checkout. Cashier identity is never used as commission attribution. Lines without explicit evidence remain `REVIEW_REQUIRED` and block calculation instead of guessing. This is a deliberate fail-closed control.

## H. Service commission

Service rules support all-service, category and item scopes. Rule selection is effective-dated, non-stacking and deterministic. Item scope wins over category, which wins over all; priority and stable identifiers break ties.

## I. Product commission

Product source events and product rules are supported. POS checkout now captures an optional explicit salesperson for product-only sales. Calculation proceeds only where that attribution exists; legacy or unattributed product lines remain blockers. Cashier fallback is prohibited.

## J. Fixed-amount rules

`FIXED_AMOUNT` rules award a configured integer-cent amount per eligible line. Negative awards and invalid configurations are rejected.

## K. Percentage rules

`PERCENTAGE` rules use basis points and deterministic integer rounding. Rules may use gross or net-after-discount basis.

## L. Tiered rules

`TIERED_PERCENTAGE` rules use validated, ordered, non-overlapping whole-period tiers. A period's eligible basis selects exactly one rate; tier stacking and overlapping ranges are rejected.

## M. Discount handling

Invoice discounts are allocated proportionally across eligible invoice lines in cents. Remainders are distributed deterministically so allocated line discounts exactly reconcile to the invoice discount. Net-basis commission never double-counts discount.

## N. Package safety

Package purchase is a distinct source type and is eligible only when an effective package-purchase rule and explicit attribution exist. Package redemption is always excluded, preventing commission from being awarded once at sale and again at redemption.

## O. Rule versioning

Rules have effective dates and immutable revisions. Material changes create a new revision and audit reason rather than rewriting prior calculation evidence. Calculation records the selected rule revision and source digest.

## P. Recovery and idempotency

Paid-invoice recovery uses stable SHA-256 digests and source revisions. Re-running recovery, calculation, approval, refund capture, void capture or Payroll linking does not duplicate the same source, statement adjustment or Payroll variable pay. Approval uses optimistic revision checks and returns the already locked canonical result for an exact replay.

## Q. Period lifecycle

Commission periods move through controlled `DRAFT`, calculated/review and approved/locked states. Each calculation creates an immutable revision with source and rule digests. Attribution blockers or missing effective rules prevent approval. Managers can inspect the frozen source, basis, rule revision and adjustment trace before approval.

## R. Approval and separation of duties

Approval is independent from calculation and requires the dedicated approval capability. Self-approval is rejected. Approval freezes the selected statement revision; later POS or rule changes do not silently rewrite it.

## S. Refund and reversal

Refunds create append-only commission adjustments linked to the refund fact and original accrual. Voided paid sources are also recovered with idempotent append-only reversal adjustments. Duplicate webhook/recovery runs are idempotent. If the original statement is already frozen, recovery is carried to a future statement rather than mutating paid history. Authorised manual corrections require a non-zero amount and reason, reject self-correction, and are always future-payroll adjustments.

## T. Payroll bridge

Payroll consumes only approved and locked Commission statements. It never reads live POS transactions or draft Commission calculations. Linking requires an explicit target payroll month and is blocked for finalized or incompatible Payroll runs. The bridge creates an idempotent system-approved variable-pay record with statement provenance.

## U. Statutory boundary

Commission inclusion in statutory remuneration remains governed by the existing statutory classification and activation controls. The Commission engine does not make legal classifications, execute Human Sign-off or activate EPF, SOCSO, EIS or LINDUNG24. Missing statutory authority remains fail-closed.

## V. Tenant isolation and RBAC

Capabilities are separated into view, rule management, calculation, approval, adjustment and Payroll linking. Every service call binds trusted business and, for branch-scoped staff, trusted branch scope. Statement and adjustment reads are tenant-scoped. Staff users can see only their own calculated, approved or Payroll-applied statement history.

## W. Manager experience

`/team/commission` provides entitlement-aware recovery, immutable calculation, effective-dated rule setup, period review, calculation trace, independent approval/freeze, append-only correction and Payroll-link controls. The page displays attribution blockers and the package/split safeguards instead of hiding them.

## X. Staff experience

`/staff/commission` is a read-only view of the authenticated staff member's own calculated/pending, approved and Payroll-applied statements. Other employees' earnings, management controls and approval actions are not exposed.

## Y. Verification evidence

- Commission unit tests: 6/6 passed.
- Commission integration lifecycle: 1/1 passed.
- Full unit suite: 781/781 passed.
- Full integration suite: 117/117 passed with isolated embedded PostgreSQL.
- TypeScript: passed.
- ESLint: passed; one pre-existing WhatsApp `<img>` warning remains.
- Production-mode build executed locally: passed; 111 routes/pages generated, including manager and staff Commission routes.
- Prisma format and validate: passed.
- Fresh local migration rebuild: 156/156 migrations passed.
- Browser E2E: Salon completed RM100 service, 20% discount, RM8 net-basis commission, independent approval/freeze, September Payroll link and RM40 refund recovery as a future -RM4 adjustment without changing frozen Payroll. Auto Detailing Commission remained accessible, POS-only direct access was blocked, and no Commission browser error was observed.
- Existing POS, Payroll and HR suites remained green.

## Z. Final closure and explicit deferrals

The foundation is ready for controlled Local / Testing use with safe attribution, calculation, independent approval, immutable history, recovery and frozen Payroll inclusion.

Explicit deferrals:

- Split commission awaits a future POS line-split attribution contract.
- Legacy product/package lines without explicit salesperson evidence remain blocked; new POS checkout can record an explicit salesperson and still has no cashier fallback.
- Statutory Human Review, Human Sign-off and activation remain separate authorised-human tasks.
- Production deployment and validation are out of scope.

```text
COMMISSION MODULE             → PASS
SERVICE COMMISSION            → PASS
PRODUCT COMMISSION            → PASS (FAIL-CLOSED WITHOUT EXPLICIT ATTRIBUTION)
FIXED COMMISSION              → PASS
TIERED COMMISSION             → PASS
STAFF ATTRIBUTION             → PASS
DISCOUNT HANDLING             → PASS
REFUND / REVERSAL             → PASS
PACKAGE SAFETY                → PASS
RULE VERSIONING               → PASS
COMMISSION PERIOD             → PASS
APPROVAL / FREEZE             → PASS
IDEMPOTENCY                   → PASS
CONCURRENCY                   → PASS
PAYROLL BRIDGE                → PASS
STATUTORY SEPARATION          → PASS
TENANT ISOLATION / RBAC       → PASS
POS REGRESSION                → PASS
PAYROLL REGRESSION            → PASS
HR REGRESSION                 → PASS

TETAMU COMMISSION ENGINE — READY

LOCAL / TESTING ONLY
PRODUCTION NOT ACCESSED
PRODUCTION NOT VALIDATED
```
