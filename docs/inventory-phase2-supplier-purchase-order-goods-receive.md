# Inventory Phase 2 — Supplier, Purchase Order & Goods Receive

## A. Canonical workspace and environment

Implementation and verification are restricted to `C:\CodexTetamuP0` in Local / Testing. Production access, database, migration, deployment, accounts, secrets, and validation are out of scope. Existing dirty worktree changes are preserved; this phase does not reset, commit, or push them.

## B. Phase boundary

This phase contains only Suppliers, Purchase Orders, Goods Receipts, receipt reversals, purchasing audit, and reconciliation. It does not implement Expense, Accounts Payable, supplier payment, accounting journals, COGS, delivery orders, stock take, reorder automation, barcode, warehouse, AI, or Inventory Phase 3.

## C. Source of truth

`ProductStock` remains the materialized balance and `InventoryMovement` remains the immutable stock ledger. Purchasing does not create another stock engine. A Goods Receipt calls the existing Phase 1 `applyInventoryMovement` service.

## D. Supplier domain

Suppliers are Business-scoped and support ACTIVE / INACTIVE lifecycle, code, contact, phone, email, address, and notes. Historical suppliers are never hard-deleted. New orders require an active supplier; already-approved orders may still receive after supplier deactivation.

## E. Purchase Order scope

Every PO is bound to one Business, Branch, and Supplier. New PO lines accept only active, inventory-tracked products. Composite foreign keys prevent cross-Business branch, supplier, product, PO, receipt, and line references.

## F. Purchase Order numbering

Business-owned atomic sequences generate `PO-######`. The sequence is incremented inside the same serializable transaction as order creation; `(businessId, poNumber)` is unique.

## G. Goods Receipt numbering

Business-owned atomic sequences generate `GRN-######`. `(businessId, receiptNumber)` is unique and allocation happens in the receipt transaction.

## H. Purchase Order lifecycle

Supported states are:

`DRAFT → APPROVED → PARTIALLY_RECEIVED → RECEIVED`

`DRAFT / APPROVED (zero receipts) → CANCELLED`

`APPROVED / PARTIALLY_RECEIVED → CLOSED`

Receipt reversal can derive an open order back from RECEIVED to PARTIALLY_RECEIVED or APPROVED. CLOSED remains a terminal commercial decision.

## I. Draft editing

Only DRAFT facts may be edited. Draft updates require the displayed revision and use a guarded update; stale forms fail. Approval freezes supplier, branch, dates, quantities, expected cost, and notes.

## J. Approval separation

Approval has its own capability. The creator cannot approve their own PO, including Business Owner accounts. Approval records actor and timestamp and explicitly leaves stock unchanged.

## K. Cancellation and close

Cancellation requires a reason and is allowed only for DRAFT or APPROVED orders with zero received quantity. A partially received order cannot be cancelled; its remaining quantity must be closed with a reason. Neither action creates an inventory movement.

## L. Partial receiving

APPROVED and PARTIALLY_RECEIVED orders accept one or more receipt lines. Quantities are positive whole numbers and may not exceed remaining ordered quantity. Multiple receipts are supported until all lines are fully received.

## M. Receiving inactive references

An approved order can receive an inactive Supplier or Product because its facts were frozen at approval. The target Branch must remain ACTIVE. This prevents operational ambiguity while preserving historical orders.

## N. Goods Receipt immutability

Goods Receipt facts and Goods Receipt Lines are append-only at database level. Only the derived header status may change. Update/delete triggers reject mutation of receipt facts and receipt lines.

## O. Inventory posting

Each receipt line posts exactly one positive `STOCK_IN` movement:

- `sourceType = GOODS_RECEIPT`
- `sourceId = GoodsReceipt.id`
- `sourceLineId = GoodsReceiptLine.id`
- stable operation key `GOODS_RECEIPT:<lineId>`

Receipt creation, PO quantity update, PO status update, ProductStock update, movement creation, command record, and audit log are one serializable transaction.

## P. Receipt reversal

Reversal never edits the receipt. It appends `GoodsReceiptReversal` and one negative movement with `sourceType = GOODS_RECEIPT_REVERSAL`. Reason is mandatory, quantity cannot exceed net received, and the existing inventory service blocks a reversal that would make stock negative. This is not a supplier return workflow.

## Q. Idempotency

Supplier create/update, PO create/update/approve/cancel/close, receive, and reversal use a Business-scoped operation key. SHA-256 request fingerprints allow exact replay and reject reuse of the same key with a different command or payload.

## R. Concurrency

Commands run at Serializable isolation with bounded retry for PostgreSQL serialization/deadlock conflicts. PO revisions and materialized line quantities use compare-and-update guards. Concurrent over-receive, cancel-vs-receive, close-vs-receive, stale draft edits, and duplicate commands cannot silently double-post.

## S. Permissions

The INVENTORY entitlement owns these capabilities:

- `VIEW_SUPPLIERS`
- `MANAGE_SUPPLIERS`
- `VIEW_PURCHASE_ORDERS`
- `CREATE_PURCHASE_ORDER`
- `APPROVE_PURCHASE_ORDER`
- `CANCEL_PURCHASE_ORDER`
- `RECEIVE_PURCHASE_ORDER`
- `REVERSE_GOODS_RECEIPT`

Direct Staff permissions map separately to these capabilities. Ordinary cashier access does not imply purchasing access. Server actions enforce the capability and Module entitlement; branch-scoped users cannot receive an order outside their operational branch.

## T. Audit

AuditLog records Supplier created/updated/deactivated, PO created/updated/approved/cancelled/closed, Goods Receipt created, and Goods Receipt reversed. Logs retain actor, Business, Branch where applicable, entity, before/after snapshots, and summary.

## U. Reconciliation

Inventory reconciliation checks:

- `ProductStock.quantity = SUM(InventoryMovement.quantityDelta)`
- tracked InvoiceItem = one SALE movement
- GoodsReceiptLine = one matching positive receipt movement
- GoodsReceiptReversal = one matching negative reversal movement
- PO line `receivedQuantity = SUM(receipts) - SUM(reversals)`
- product and branch identity match between purchasing facts and movements
- orphan, missing, duplicate, and quantity-mismatched movements

The reconciliation screen is read-only and never auto-repairs data.

## V. Supplier UX

`/inventory/suppliers` provides paginated search/status filters and supplier creation. Supplier detail supports edit/deactivation and recent purchase history.

## W. Purchase Order UX

`/inventory/purchase-orders` provides pagination, supplier/status/branch filters, and detail navigation. The create/edit form supports multiple tracked-product lines. Detail displays frozen facts, progress, separate approval, cancel/close, partial receive, immutable receive notes, and reasoned reversal.

## X. API and query safety

All reads include Business scope. PO lists include Supplier/Branch/counts in bounded queries; detail fetches lines, products, receipts, reversals, and actors without per-row queries. Server actions repeat authorization rather than relying on hidden UI.

## Y. Verification matrix

Required verification covers Prisma generation/validation, fresh migration rebuild, unit tests, integration tests, TypeScript, lint, production-mode Local build, canonical guard, `git diff --check`, secret scan, authenticated Salon and Auto browser flows, 390px layouts, and zero console/hydration errors.

## Z. Stop point

Inventory Phase 2 stops after Supplier / Purchase Order / Goods Receive closure. Expense/AP, accounting, COGS, stock take, reorder automation, delivery order, warehouse, barcode, AI, and Production remain untouched.
