# Tetamu Expense Phase 2B — Inventory Purchase Business Spending

## Status

`EXPENSE PHASE 2B — CONFIRMED SUPPLIER BILL → INVENTORY PURCHASE BUSINESS SPENDING`

This phase integrates the canonical Supplier Bill/AP domain with the existing Expense source-integration framework. It does not introduce accounting, COGS, inventory valuation, or a second AP balance.

## Canonical recognition boundary

Only a confirmed Supplier Bill creates a read-only `INVENTORY_PURCHASE` Business Expense representation:

`Confirmed Supplier Bill amount = Recorded Inventory Purchase spending`

- Purchase Order is ordering evidence and never creates Expense.
- Goods Receipt changes stock and never creates Expense.
- Draft Supplier Bill has no AP or Expense effect.
- Confirmed Supplier Bill creates AP and one Expense representation at its confirmed revision.
- Supplier Payment and Payment Reversal change only AP settlement. They never create a second Expense and never change the recorded amount.
- Supplier Bill and its payment lifecycle never modify inventory.

The system records `sourceType`, `sourceId`, confirmed `sourceRevision`, branch, supplier, invoice date, category, immutable source snapshot, and SHA-256 digest. The database enforces the tenant/branch/source identity and exact-one active system representation.

## Settlement projection

`ExpenseSourceSettlement` is a derived AP projection, not user-editable Expense payment data:

`Outstanding = Confirmed Supplier Bill amount - valid completed Supplier Payments`

It exposes `UNPAID`, `PARTIALLY_PAID`, `PAID`, and `VOID` plus paid and outstanding amounts. The recorded Business Expense amount remains fixed at the confirmed bill amount throughout payment and reversal.

## Lifecycle and failure isolation

- Confirm creates the source representation after the canonical AP transaction commits.
- Adapter failure never rolls back a valid Supplier Bill, payment, or reversal.
- Reconciliation detects missing, duplicate, stale, wrong-amount, wrong-branch, wrong-revision, missing snapshot, settlement drift, and AP matching issues.
- Authorized repair replays canonical Claim, Payroll, and Supplier Bill adapters. It does not invent a new financial fact.
- Historical paid or void bills without a provable confirmation revision are marked `LEGACY_CONFIRMATION_REVISION_REQUIRED`; migration does not guess.
- Voiding an unpaid canonical bill voids the active Expense representation while retaining immutable revision history.

## Module, RBAC, scope, and privacy

Expense materialization runs only when the Expense module is enabled. The source domain remains Inventory/AP. Expense users see the read-only representation; the canonical Supplier Bill drill-down appears only when Inventory is enabled and the user has `VIEW_SUPPLIER_BILL`.

All writes use trusted server-side business and branch scope. Composite foreign keys, database guards, module entitlements, capabilities, optimistic revision checks, serializable AP transactions, and idempotency keys remain authoritative. Supplier invoice attachments stay in Supplier/AP private storage; Expense copies only an attachment-available flag and never duplicates the file or private metadata.

## Reporting semantics

Business Spending now supports:

`Manual + Claims + Payroll + Inventory Purchases = Recorded Business Spending`

The UI explicitly states that Inventory Purchases are recorded obligations, not COGS. It does not present Gross Profit, Net Profit, official P&L, FIFO, inventory valuation, GL, or tax accounting.

The deterministic Local Salon fixture verifies:

`RM1500 Manual + RM100 Claim + RM3000 Payroll + RM120 Supplier Bill = RM4720 Recorded Business Spending`

## Verification matrix

| Requirement | Result |
|---|---|
| Draft Bill creates no Expense | PASS |
| Confirmed RM120 Bill creates exactly one RM120 representation | PASS |
| Invoice date, branch, supplier, category, source ID/revision | PASS |
| RM50 payment → paid 50 / outstanding 70 / partially paid | PASS |
| RM70 payment → paid 120 / outstanding 0 / paid | PASS |
| RM70 reversal → paid 50 / outstanding 70 / partially paid | PASS |
| Payments/reversal create no second Expense | PASS |
| Bill/payment/reversal leave stock unchanged | PASS |
| Bill void retains history and voids representation | PASS |
| GR reversal becomes AP/Expense reconciliation issue | PASS |
| Cross-tenant and cross-branch isolation | PASS |
| Auto business isolation | PASS |
| Expense entitlement disabled → safe skip | PASS |
| Read-only source UI and permission-gated AP drill-down | PASS |
| RM4720 source total | PASS |
| 390px usability | PASS |
| Browser console/hydration errors | 0 |

## Deferred

- General Ledger and accounting journals
- COGS, FIFO, and inventory valuation
- Supplier Credit Note / Return to Supplier
- Non-PO Supplier Bill
- Public Bank and bank APIs
- Roster Phase 2
- AI business analysis
- Production deployment or validation

## Environment

`LOCAL / TESTING ONLY`

`PRODUCTION NOT ACCESSED`

`PRODUCTION NOT VALIDATED`
