# Tetamu Supplier Bill / Accounts Payable Phase 1

## Scope and environment

This phase was implemented and verified only against the canonical Local / Testing workspace. It does not access, migrate, deploy, or validate Production.

The phase establishes the purchasing-to-payables chain without introducing a general ledger, supplier credit notes, banking integration, inventory valuation, or an expense adapter:

`Supplier -> Purchase Order -> Goods Receipt -> Supplier Bill -> Accounts Payable -> Supplier Payment`

## Canonical boundaries

- A Purchase Order records what was ordered.
- A Goods Receipt and its reversals record net quantity received and are the only events in this phase that affect stock.
- A confirmed Supplier Bill records the payable. A draft bill creates no payable and no stock movement.
- A completed Supplier Payment reduces the payable. It never changes stock or Business Spending.
- A Supplier Payment Reversal is append-only and restores the outstanding payable. Completed payments are not edited or deleted.
- No Supplier Bill or Supplier Payment creates a `BusinessExpense`; the Inventory Purchase Expense Adapter remains deferred.

Canonical outstanding is derived at read time from facts:

`Outstanding = Confirmed Bill Total - Valid Completed Supplier Payments`

The derived payment state is `UNPAID`, `PARTIALLY_PAID`, or `PAID`; it is not directly editable.

## Domain model and lifecycle

### Supplier Bill

The bill header stores tenant, branch, supplier, invoice identity, invoice/due dates, totals, lifecycle status, confirmation/void provenance, optimistic version, and audit timestamps. Bill lines snapshot product, description, unit, quantity, ordered unit price, billed unit price, variance, matching state, and their optional PO-line provenance.

Lifecycle:

`DRAFT -> CONFIRMED -> VOID`

- Drafts can be edited and do not enter AP.
- Confirmation validates supplier/PO scope, invoice uniqueness, quantity matching, price variance acknowledgement, totals, authority, and current canonical state in one serializable transaction.
- A confirmed bill can be voided only while it has no valid payment. Void is audited and does not delete history.

Supplier invoice identity is normalized, with an active tenant/supplier unique guard. Application checks provide an actionable error and the database provides the final concurrency boundary.

### Ordered / received / billed trace

The trace keeps three independent facts:

- Ordered quantity from approved PO lines.
- Net received quantity from completed Goods Receipts minus completed Receipt Reversals.
- Billed quantity from confirmed, non-void Supplier Bill lines.

Default confirmation requires `confirmed billed quantity <= net received quantity`. Partial billing is supported. The service re-reads every matching fact inside the confirmation transaction so concurrent confirms cannot over-bill.

Unit-price variance is visible and requires explicit acknowledgement plus a reason before confirmation. A later Goods Receipt reversal that makes billed quantity exceed net received quantity produces an AP reconciliation issue; it does not rewrite an immutable confirmed bill.

### Supplier Payment

Payments are append-only completed facts with bill, supplier, branch, amount, payment date, method, reference, actor, idempotency key, and audit provenance. Recording and reversal are protected by current TOTP step-up authorization.

The payment transaction re-reads the confirmed bill and all valid payments before accepting the amount. Partial and full payment are supported; zero, negative, and overpayment are rejected. A completed payment is reversed by creating a separate reversal record, never by edit or delete. Concurrent payment attempts cannot exceed the canonical outstanding.

### Attachments

Supplier invoice files reuse the existing private attachment storage and validation architecture. Metadata is tenant/branch/bill scoped, checksum-bound, quarantined by default, and served through an authorized no-store endpoint only after a clean/safe release state. They are never placed in a public path.

## Security and access control

The INVENTORY module controls the entire Supplier Bill/AP surface. Direct capabilities separate view, draft creation/edit, confirmation, void, AP viewing, payment recording/reversal, and attachment viewing.

Every server action and read service uses trusted authenticated business and branch scope. Database composite foreign keys and scope triggers prevent cross-business, cross-branch, cross-supplier, and cross-user references. Reviewer/creator separation is the default; an explicit business-owner path is the only documented self-confirmation exception.

High-risk payment record/reversal actions require a one-time, short-lived TOTP step-up authorization that is consumed inside the financial transaction. The browser never supplies the authoritative outstanding or matching balance.

## Idempotency, concurrency, and audit

Supplier AP commands have tenant-scoped idempotency keys and stored result references. Bill confirmation, payment, and reversal run at serializable isolation and lock their canonical state through transactionally re-read facts. Unique and check constraints provide the final database boundary.

All lifecycle and money changes append audit events. Confirmed bills, completed payments, and completed reversals are protected from destructive mutation at the database layer.

## Accounts Payable views

The AP overview provides total outstanding, unpaid/partially-paid/paid state, due-soon and overdue views, supplier outstanding balances, and reconciliation issues. Supplier detail and PO detail expose the same canonical trace rather than maintaining a second balance.

## Local / Testing browser acceptance scenario

The Local browser scenario verified:

1. Salon PO 10 x RM20 and approval.
2. Receive 6; stock increases only through Goods Receipt.
3. Draft and confirm a 6 x RM20 bill; AP becomes RM120 while stock and Business Expense remain unchanged.
4. Pay RM50; outstanding becomes RM70 and state becomes `PARTIALLY_PAID`.
5. Pay RM70; outstanding becomes RM0 and state becomes `PAID`.
6. Reverse the RM70 payment; outstanding returns to RM70 and state returns to `PARTIALLY_PAID`.
7. Receive the remaining 4 and confirm a second bill; trace becomes ordered 10 / received 10 / billed 10.
8. Over-billing, normalized duplicate supplier invoice, cross-branch access, and cross-tenant access are denied.
9. Price variance is visible and requires acknowledgement/reason.
10. A post-billing receipt reversal creates a reconciliation issue.

Automated integration coverage repeats the financial flow and additionally races concurrent confirmation and concurrent payment commands to verify one canonical winner without over-billing or overpayment.

## Deferred items

- Inventory Purchase Expense Adapter and Business Spending linkage
- General ledger and accounting journals
- COGS, FIFO, and inventory valuation
- Supplier credit note / debit note
- Bank and Public Bank integrations
- Automated attachment malware scanning provider integration beyond the existing release gate

## Final environment statement

`LOCAL / TESTING ONLY`

`PRODUCTION NOT ACCESSED`

`PRODUCTION NOT VALIDATED`
