# Inventory Phase 3 — Stock Take / Physical Count / Reorder Foundation

## A. Objective

Phase 3 adds branch physical counts, immutable count evidence, reviewed variance movements, stock-count reconciliation, and an operational reorder read model. It remains inside the existing `INVENTORY` entitlement and reuses the Phase 1 ledger and Phase 2 Purchase Order domain.

## B. Existing Audit

Phase 1 already supplied tracked products, branch balances, immutable movements, stock in/out, adjustment, transfer, sale/refund/void integration, negative-stock protection, idempotency, concurrency, and reconciliation. Phase 2 already supplied Supplier, Purchase Order, partial/full Goods Receipt, reversal, and remaining ordered quantity. No stock-count domain, branch target level, purchase suggestion, or outbound Delivery Order contract existed. Terms related to delivery were limited to supplier `deliveryReference` on inbound Goods Receipts.

## C. Stock Count Domain

`StockCountSession`, `StockCountLine`, immutable `StockCountLineRevision`, and append-only `StockCountCommand` are business and branch scoped. Session numbers use the atomic Business sequence `SC-######`; UUID identity is retained. A partial unique index prevents two active sessions from containing the same branch/product.

## D. Count Lifecycle

The lifecycle is `DRAFT → IN_PROGRESS → SUBMITTED → APPROVED`, with pre-approval `CANCELLED`. A submitted session can return to `IN_PROGRESS` only through an audited reopen reason. Optimistic revisions and Serializable transactions protect stale browser actions and competing approvals.

## E. Count Lines

Full-branch sessions include every active tracked product. Selected-product sessions include only explicitly selected active tracked products. Services and non-tracked products are excluded. Actual quantities are non-negative whole units. A full/selected session cannot submit until every required line has been counted.

## F. Expected Snapshot

Expected quantity is read from canonical `ProductStock` when the physical actual is saved—not when the session is created. The same transaction freezes actual quantity, count timestamp, counter, latest ledger watermark, digest, expected quantity, and deterministic variance.

## G. Physical Count

Counting is server-canonical and resumable. Each save creates an immutable line revision. Recounting after reopen creates a new revision with a new expected snapshot and timestamp; prior observations remain visible.

## H. Variance

`varianceQuantity = actualQuantity - expectedQuantityAtCount`. It represents a quantity difference only. No valuation, shrinkage expense, write-off, COGS, journal, Supplier Bill, AP, or payment is created.

## I. Approval

Approval requires a submitted, complete, current revision. A user who counted a non-zero line cannot approve that variance. All lines are validated and posted atomically; any stale line, disabled tracking, concurrent transition, or negative-stock violation aborts the entire approval.

## J. Recount / Reopen

Reopen requires reason, actor, timestamp, optimistic revision, idempotency, and audit. The counter can then save a new line revision and submit again. Approved sessions and all historical revisions are database-protected from mutation.

## K. Adjustment Movement

Approval never overwrites `ProductStock.quantity`. Positive variance calls the Phase 1 movement service as `ADJUSTMENT_IN`; negative variance uses `ADJUSTMENT_OUT`; both use `sourceType=STOCK_COUNT` and stable key `STOCK_COUNT:<sessionId>:<lineId>`. Zero variance creates no movement.

## L. Operational Movements During Count

The variance is a delta. A Sale, Stock In/Out, Goods Receipt, refund restock, transfer, or void after counting changes the current balance normally; approval then applies only the frozen variance. Verified examples include `20 → actual 18 → sale 1 → balance 19 → approve -2 → 17` and `20 → actual 18 → receive 5 → 25 → approve -2 → 23`.

## M. Stale Count Protection

Post-count `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`, or `SYSTEM_CORRECTION` for the same branch/product invalidates old evidence and requires recount. This prevents two corrections from silently fixing the same difference twice. Legitimate operational movements remain valid.

## N. Reconciliation

Inventory reconciliation now compares every approved variance with `sourceType=STOCK_COUNT` movements and detects missing, duplicate, wrong-quantity, wrong-product, wrong-branch, wrong-session, and orphan movement conditions. Existing balance/ledger, sale, Goods Receipt, reversal, and PO received-quantity checks remain intact.

## O. Reorder Level

Existing branch/product `reorderLevel` remains the low-stock trigger. A product needs reorder visibility when on hand is at or below that level.

## P. Target Stock

Nullable `targetStockLevel` is stored per Business + Branch + Product on `ProductStock`. It is not a global Product setting. Blank means no configured purchase quantity.

## Q. On-order Quantity

On Order is the sum of `orderedQuantity - receivedQuantity` from only `APPROVED` and `PARTIALLY_RECEIVED` Purchase Orders. Draft, Received, Closed, and Cancelled orders contribute zero. Partial receipt therefore immediately exposes only the remainder.

## R. Projected Stock

`Projected Stock = On Hand + On Order`. It is a purchasing signal and is never sellable/reserved stock.

## S. Suggested Purchase Quantity

When a target exists, `suggestedQty = max(0, targetStockLevel - projectedStock)`. Without a target, the UI says `Not configured`; it never guesses.

## T. Purchase Order Shortcut

Reorder rows can open the existing Phase 2 New Purchase Order page with Branch, Product, and Suggested Quantity prefilled. The manager must choose Supplier and save a Draft. The shortcut does not create or approve a PO and does not change stock or Expense.

## U. Delivery Order Decision

`DELIVERY_ORDER → DEFERRED_PENDING_FULFILLMENT_CONTRACT`.

The repository does not define an outbound delivery source document, recipient, dispatch event, Sale linkage, stock-deduction ownership, cancellation/return semantics, or proof that POS Sale has not already deducted stock. Implementing a Delivery Order now could duplicate Branch Transfer or double-deduct a Sale. Future work must first define delivery source document, stock deduction event, Sale linkage, recipient, dispatch semantics, and return semantics.

## V. Permissions / Tenant / Branch

Phase 3 adds granular view/create/count/submit/approve/reopen/cancel/reorder capabilities and matching staff permissions, all mapped to `INVENTORY`. Business module checks run before services. Actions resolve the trusted operational branch; composite business foreign keys, actor scope triggers, and tenant-scoped queries reject guessed cross-tenant or cross-branch IDs.

## W. Mobile / UX

Inventory now links to Stock Counts and Reorder. Count history is paginated and filterable. Detail shows progress, frozen expected/actual/variance, variance filters, large-variance warning, immutable revision history, lifecycle controls, and ledger trace. Count cards collapse to a single-column 390px layout with an immediately operable quantity field and save action.

## X. Tests / Regression

Unit contracts cover entitlement mapping, schema/trigger guards, delta-only approval, reorder formula, PO shortcut, Delivery Order deferral, and action scope. Integration covers creation, duplicate active guard, frozen snapshot, line replay, positive/negative/zero variance, Sale during review, Goods Receipt during review, stale correction, recount history, approval race, negative-stock guard, cancellation, target stock, remaining On Order, cross-tenant rejection, module-disabled rejection, and reconciliation. Full unit/integration, TypeScript, lint, Local production-mode build, Prisma validation/generation, and fresh migration rebuild are release gates.

## Y. Deferred Expense / Accounting

Inventory valuation, COGS, shrinkage accounting, write-off journal, Expense, Supplier Bill, Accounts Payable, Supplier Payment, preferred-supplier engine, barcode, warehouse, route planning, driver app, proof of delivery, and forecasting remain deferred. HR, Payroll, Roster, Statutory, and Production are untouched.

## Z. Final Status

Inventory Phase 3 Core is ready when the recorded build, migration, regression, and Local browser evidence all pass. Delivery Order remains safely deferred and does not block the Core status.

`LOCAL / TESTING ONLY`
`PRODUCTION NOT ACCESSED`
`PRODUCTION NOT VALIDATED`
