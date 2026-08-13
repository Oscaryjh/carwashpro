# Expense Phase 1 — Business Expense Foundation

## A. Objective

Provide an independent, tenant-safe record of manual business spending with categories, branch scope, payment state, private receipts, recurring monthly drafts and operational reporting. This module is not an accounting ledger.

## B. Existing Audit

- No canonical `BusinessExpense` domain existed before this phase.
- Claims already provided private quarantine storage, MIME/magic-byte validation, checksum verification and release policy; Expense reuses that security foundation without reusing the Claim domain.
- Inventory Phase 2 provides Supplier, Purchase Order and Goods Receive, but no Supplier Bill, Accounts Payable or Supplier Payment obligation.
- Payroll and Claims have their own immutable canonical facts and are not imported in Phase 1.

## C. Expense Domain

`BusinessExpense` owns a business-scoped atomic `EXP-######` number, optional branch, MYR amount, Expense Date, category snapshot, payee text, description, lifecycle, independent payment state, source identity and revision history. Canonical money uses PostgreSQL `DECIMAL(12,2)` / Prisma `Decimal`; JavaScript floating point is not used for writes.

## D. Expense vs Claims / Payroll / Inventory

Expense, Claim, Payroll and Inventory Purchase remain separate source-of-truth domains. PO, Goods Receive, branch transfer, stock adjustment and stock-count variance do not create an Expense. Commission continues through Payroll variable pay. Manual salary/claim/purchasing entries display an honest future double-count warning.

## E. Module Entitlement

`EXPENSE` is an operational module that depends only on `CORE`. Disabled entitlement hides navigation and server-side routes/actions fail through `requireBusinessUserForModule`. Owner status does not bypass a disabled module.

## F. Categories

Starter categories are provisioned idempotently on first Expense use. Businesses can create, rename, group, reorder, require receipts, activate and deactivate categories. Categories are never treated as a statutory chart of accounts. Used categories cannot be hard deleted; Expenses preserve category-name snapshots.

## G. Manual Expense

Manual entry supports Expense Date, optional branch, category, payee text, amount, paid/unpaid state, payment details, description, private receipt and notes. Manual source is always `MANUAL` with null source ID/revision.

## H. Expense Lifecycle

Lifecycle is independent from payment state: `DRAFT → CONFIRMED → VOID`. Drafts can be edited with optimistic revision checks. Confirmed facts require an immutable correction revision. Void requires a reason and preserves the canonical record. Paid Expenses cannot be directly voided.

## I. Paid / Unpaid

Payment state is `UNPAID` or `PAID`; partial Expense payment is deferred. `UNPAID → PAID` is a one-way idempotent transition. Mark Paid creates one append-only payment event and does not change the recorded Expense amount.

## J. Payment Details

Paid state requires a separate Payment Date and Expense Payment Method (`CASH`, `BANK_TRANSFER`, `CARD`, `EWALLET`, `OTHER`). Expense payment never writes POS Payment, Invoice, Cashier Shift or Daily Closing.

## K. Payee

Phase 1 stores safe free-text `payeeName`. It is intentionally not forced to an Inventory Supplier. A future Supplier Bill may add an explicit relationship.

## L. Receipt / Attachment

Expense receipts reuse the Claims private quarantine engine: 10MB limit, JPG/PNG/WebP/PDF allowlist, magic-byte/declared-MIME match, filename sanitization, non-guessable object key, checksum verification, business/branch authorization and private no-store responses. Object keys and private URLs are never returned by Expense UI/API or audit logs. Release requires `CLEAN` malware status and `SAFE`/`SANITIZED` privacy status. Local correctly reports `MALWARE_SCANNER_NOT_CONFIGURED`; it does not pretend scanning occurred.

## M. Branch Scope

Owner access covers authorised business-wide and branch Expenses. Direct staff are limited to their assigned active branch and cannot see or create business-wide Expenses. Group Manager access is explicit, read-only, entitlement-gated and business-scoped; it does not grant receipt access or mutations automatically.

## N. Recurring Expense

Monthly `RecurringExpenseTemplate` records effective dates, optional branch, category, payee, amount and default description. Generation is an explicit command, creates an unpaid Draft, and is unique by template plus `YYYY-MM`. Template revisions/deactivation never rewrite generated Expenses. No scheduler or auto-pay engine was introduced.

## O. Source Identity

Non-manual representations require `sourceType + sourceId + sourceRevision`. A composite unique constraint prevents a canonical system source revision from appearing twice. Recurring drafts use stable template/period identity. Future adapters must use a finalized source snapshot, not mutable live data.

## P. Double-count Protection

System-source duplicate protection is guaranteed by stable identity and unique constraints. Manual semantic duplicates cannot be perfectly detected; the UI warns rather than claiming false prevention. Claim, Payroll and Inventory Purchase adapters remain deferred.

## Q. Dashboard

The overview aggregates confirmed, non-void records in SQL and presents Recorded Expenses, Paid, Unpaid, Transactions, Average, Highest, Top Category, Category Breakdown, Branch Breakdown and Recent Expenses. Pagination is used for history.

## R. Reports / History

History includes Draft, Confirmed and Void records with date, category, payee, branch, amount, payment state, source, receipt presence and status. Server-side filters cover date, branch, category, payment, lifecycle and search. CSV export reuses the same scope and excludes receipt URLs/bytes.

## S. Income vs Recorded Expenses

Phase 1 does not add an official profit card. If a future dashboard combines sales and Expense, the only approved label is `Income vs Recorded Expenses`; Payroll, Claim and Inventory purchasing exclusions must remain visible. `Net Profit`, Accounting Profit and official P&L are prohibited until their canonical domains exist.

## T. Security / Tenant

Composite tenant foreign keys protect branch, category, template, Expense, revision, payment and receipt references. Database actor-scope triggers reject cross-business users. Guessed Expense/receipt IDs are filtered by business and authorised branch scope. List queries return receipt metadata only.

## U. Audit

Category, Expense, confirmation, payment, void, correction, recurring creation/revision/deactivation/generation actions write tenant audit entries. Append-only triggers protect Expense revisions, payment events and commands. Audit sanitization removes object/storage keys and does not store receipt bytes or private URLs.

## V. Idempotency / Concurrency

All mutations use `businessId + operationKey`, SHA-256 payload fingerprints and immutable command records. Same-key/same-payload replay returns the canonical result; a different payload fails. Mutations use Serializable transactions and optimistic revisions. Concurrent Mark Paid has one canonical winner.

## W. Mobile / UX

Overview, History, Add Expense and Detail use responsive grids with a 390px single-column layout and no Expense page-level fixed-width dependency.

## X. Tests / Build / Migration

Unit contracts cover module mapping, schema/invariants, source boundaries, redirect control flow, 390px layout, wording and private receipt routes. Integration covers manual paid/unpaid, Mark Paid totals, void history, stale edits, concurrent payment, attachment quarantine/release, category deactivation, recurring idempotency, source dedupe, tenant actor rejection and PO/POS non-generation.

Local/Testing closure evidence: 812/812 unit tests, 125/125 integration tests, TypeScript, lint, production-mode Local build, Prisma validation and a fresh rebuild of all 161 migrations passed. Salon browser QA covered paid Marketing with a real PDF receipt, unpaid-to-paid Electricity, void exclusion, category deactivation and recurring August replay/September generation. Auto browser QA independently created and reported a branch Expense without reading Salon data. The Local receipt remained truthfully quarantined because no malware scanner is configured.

## Y. Deferred Payroll / Claims / Supplier Bill / Accounting

- `CLAIM_EXPENSE_ADAPTER → DEFERRED`
- `PAYROLL_EXPENSE_ADAPTER → DEFERRED`
- `INVENTORY_PURCHASE_EXPENSE_ADAPTER → DEFERRED_PENDING_SUPPLIER_BILL`
- `GROUP_EXPENSE_AGGREGATION → DEFERRED`
- `PARTIAL_EXPENSE_PAYMENT → DEFERRED`
- Supplier Bill, AP, Supplier Payment, Accounting, COGS, depreciation, official P&L and tax accounting are out of scope.

## Z. Final Status

`EXPENSE PHASE 1 — BUSINESS EXPENSE FOUNDATION → READY`

All acceptance evidence is Local/Testing only. Production was not accessed, deployed, migrated, modified or validated by this phase.
