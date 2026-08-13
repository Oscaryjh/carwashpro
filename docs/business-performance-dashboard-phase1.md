# TETAMU Business Performance Dashboard Phase 1

## A. Objective

Provide a read-only owner and authorised group-manager view over canonical POS, Expense, Inventory and Accounts Payable facts. The dashboard is not a source-of-truth, accounting engine or AI layer.

## B. Existing Dashboard Audit

The former `/dashboard` was industry-specific and queried Payment/Work Order facts directly. Salon had a separate appointment dashboard. Reports, All Stores, Daily Closing, Expense, Inventory and AP were already mature but disconnected. Phase 1 replaces the business landing view with one performance framework and preserves existing domain pages as drill-downs.

## C. Canonical Sources

- Sales: non-void Invoice plus monetary Payment Refund using the shared financial metric definition.
- Spending: confirmed materialized `BusinessExpense` facts only (`MANUAL`, `CLAIM`, `PAYROLL`, `INVENTORY_PURCHASE`).
- Inventory: `ProductStock` and immutable Inventory Movement reconciliation.
- AP: confirmed Supplier Bills less valid completed Supplier Payments.

## D. Business Performance Read Model

`src/lib/business-performance/read-model.ts` is the single server aggregation layer. It contains no mutation APIs and persists no duplicate source facts.

## E. Scope / Date / Timezone

Business and branch IDs come from resolved authorisation. Date ranges support Today, Yesterday, This/Last Week, This/Last Month and Custom. Sales periods use the business IANA timezone and Business Day cutoff, with a comparable previous period.

## F. Sales KPI

Net Sales, valid transaction count, average transaction value and refunds use the canonical financial metric definition. A zero previous denominator yields `NEW`/`NO_CHANGE`, never Infinity.

## G. Recorded Business Spending

Recorded Business Spending is read from Expense materialized facts. Claims, Payroll and confirmed Supplier Bills are never unioned directly by the dashboard.

## H. Income vs Spending

`Net Sales - Recorded Business Spending` is labelled `Income vs Recorded Spending`. It is never described as profit.

## I. Sales Trend

The current period is aggregated into business-local daily points with a bounded maximum of 31 points.

## J. Previous Period Comparison

Every selected range has an immediately preceding comparable range. This Month compares elapsed days against the preceding period of equal length in the business calendar.

## K. Branch Performance

Authorised branches show Net Sales, transactions, average transaction, refunds, branch-recorded spending and Income vs Spending. Business-wide Expenses remain explicitly unallocated.

## L. Group / All Stores

The existing All Stores engine continues to own group sales and historical membership security. Phase 1 adds canonical Recorded Spending only for the authorised businesses passed from that engine. Missing Expense entitlement is `Not available`, not zero.

## M. Product / Service Performance

Top Services and Top Products come from canonical non-void InvoiceItem facts and are limited to five rows per section.

## N. Inventory

Tracked products, low/out-of-stock counts and `Current Selling Price × On Hand` are shown. The label is Inventory Selling Value, never asset/accounting valuation.

## O. Accounts Payable

Outstanding AP, Due Soon, Overdue and Open Bills reuse the Supplier AP service. Outstanding AP is a liability/settlement view and is never added to Recorded Spending.

## P. Workforce Optional Metrics

Deferred in Phase 1. No salary, bank account, claim medical notes or employee-level payroll data enters the payload.

## Q. Coverage

Coverage identifies included modules and explicitly marks COGS and Accounting Profit unavailable. Missing module data is never presented as zero.

## R. Reconciliation Health

Data Health combines Expense Source, Inventory and AP reconciliation. Issues remain visible as `Needs Review`; the dashboard never repairs source facts.

## S. Module Entitlement

Sales, spending, Inventory and AP sections appear only when their modules are enabled. POS-only businesses retain a valid Sales dashboard.

## T. RBAC / Tenant / Branch / Group

Business access uses resolved tenant capability and `DASHBOARD` staff permission. Branch scope is derived from authorised Expense scope. Group totals receive only authorised business IDs.

## U. Performance / Cache

Queries are server-side, bounded by branch and date, use grouped aggregates and limit top-line results. No browser receives raw source tables. Current-period data is not cached.

## V. Mobile / Desktop UX

KPI cards, filters, trends, source breakdowns and health panels adapt from 1440px to 390px. Wide branch tables use controlled internal scrolling rather than page-level overflow.

## W. Browser E2E

Local browser acceptance covers business owner, date/branch URL filters, Salon and Auto isolation, All Stores authorised totals, 390px, 1440px, console, hydration and runtime overlays.

## X. Tests / Regression / Build

Targeted unit/integration cover date ranges, cutoff, zero denominator, canonical aggregation, module coverage and authorised group spending. POS, Inventory, Expense, AP and Business Group regressions remain part of the release gate.

## Y. Deferred AI / Accounting

AI, General Ledger, COGS, Inventory Accounting Valuation, Supplier Credit Notes, Return to Supplier, official P&L and forecasts remain deferred. Future AI may consume only a permission-filtered aggregate read model, never raw database facts.

## Z. Final Status

Final READY/PARTIAL is determined only after Local browser and full build gates. Production is outside scope.
