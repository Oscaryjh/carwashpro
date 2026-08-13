# TETAMU INVENTORY PHASE 1 — CORE STOCK FOUNDATION

## A. Objective

Phase 1 establishes explicit product tracking, branch balances, an immutable stock ledger, POS sale/refund/void integration, manual stock commands, transfer, low-stock visibility, and read-only reconciliation. All implementation and validation in this closure was performed in Local / Testing only.

## B. Existing Audit

The pre-Phase-1 product catalog already had SKU, price, cost price, branch `ProductStock`, and reorder level. Stock quantity was a directly mutable field, every product was implicitly treated as stock-controlled, three sale entry points implemented their own decrement, and there was no canonical movement ledger, revision, transfer, refund disposition, reconciliation, or Inventory module boundary. These areas were `PARTIAL` or `UNSAFE`, not `READY`.

## C. Product vs Inventory

The Product catalog remains owned by POS and continues to work when Inventory is disabled. Inventory is a separate operational module. A product's identity, SKU, price, tax, and status remain Product concerns; tracking, branch balance, reorder threshold, and movements are Inventory concerns.

## D. Module Entitlement

`INVENTORY` is an independent `BusinessModuleKey` with a dependency on `POS`. Navigation and pages require the module, and service actions also enforce module and capability checks. Disabling Inventory hides and denies Inventory operations without disabling Product catalog or ordinary POS sales.

## E. Tracking Model

`Product.trackInventory` defaults to `false`, so existing products remain untracked after migration. Tracking is explicit. Once a tracked product has ledger history, the UI cannot disable tracking; it may instead be made inactive. Tracked status is snapshotted onto each `InvoiceItem.inventoryTracked`, preserving sale-time truth.

## F. Branch Balance

`ProductStock` is the materialized current balance per Business + Branch + Product and now carries an optimistic `revision`. Composite tenant foreign keys bind balances to the correct Business and Branch. Balance changes are accepted only through the Inventory service and must match the movement's before/delta/after arithmetic.

## G. Stock Movement Ledger

`InventoryMovement` is append-only and records Business, Branch, Product, type, signed delta, before, after, actor, source, operation key, reason, reference, and timestamp. Database triggers reject UPDATE and DELETE. Corrections are represented as new reversing or correction movements.

Supported movement types are `OPENING_BALANCE`, `SALE`, `REFUND_RESTOCK`, `STOCK_IN`, `STOCK_OUT`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`, `TRANSFER_OUT`, `TRANSFER_IN`, `VOID_REVERSAL`, and `SYSTEM_CORRECTION`.

## H. Opening Balance

Enabling tracking requires explicit per-branch opening inputs. Positive quantities create immutable `OPENING_BALANCE` movements. Zero is represented by a balance row without a fake zero-delta movement. Existing legacy quantities are not silently promoted into canonical ledger truth.

## I. Stock In

`/inventory/stock-in` records a positive `STOCK_IN` movement with an operation key, actor, reason, optional reference, and branch scope.

## J. Stock Out

`/inventory/stock-out` records a negative `STOCK_OUT` movement. The service rejects a result below zero and never leaves a partial balance update.

## K. Adjustment

`/inventory/adjustment` accepts an explicit signed delta and requires a reason. It submits the visible balance revision; stale revisions fail safely and require a refresh. The Local browser test exercised both the stale rejection and a successful latest-revision adjustment.

## L. Branch Transfer

`InventoryTransfer` records one completed transfer. Source and destination must be distinct active branches in the same Business. `TRANSFER_OUT` and `TRANSFER_IN` movements share the transfer ID and commit in one Serializable transaction. A failure on either side rolls back both.

## M. Sale Integration

Cashier checkout, Salon appointment checkout, and standalone Auto product sale call the same `recordSaleInventory` service inside the existing financial transaction. A successful tracked sale creates exactly one `SALE` movement per invoice line. Financial records and stock commit atomically; a stock failure rolls back the invoice and payment. WhatsApp queuing remains after commit.

When Inventory is disabled or a product is untracked, POS continues without a stock movement or negative-stock block.

## N. Refund / Restock

A refund of a tracked product requires an explicit returned quantity and one of:

- `RESTOCK`: creates `REFUND_RESTOCK` and increases the branch balance.
- `NO_RESTOCK`: requires a reason, records the disposition, and does not change stock.

Returned quantity is cumulative and cannot exceed the sold quantity. The browser audit found and fixed an existing page/action branch that misclassified standalone product invoices as package purchases; direct product refunds now support partial refund plus explicit stock treatment while genuine package purchases retain full/unused validation.

## O. Void

Eligible invoice void flows append `VOID_REVERSAL` movements for prior SALE movements in the same financial transaction. Existing financial eligibility rules remain authoritative; Phase 1 does not broaden which invoices may be voided.

## P. Negative Stock Policy

Negative stock is not allowed for effectively tracked products. The policy is enforced in the central service with Serializable transactions, optimistic revision checks, and database arithmetic/non-negative constraints. Concurrent last-unit tests confirm only one competing sale succeeds.

## Q. Low Stock

The Inventory dashboard shows tracked products, stock on hand, low-stock rows, out-of-stock rows, selling value, branch filters, search, and recent movements. Low stock means `quantity <= reorderLevel`; out of stock means `quantity <= 0`.

## R. Reconciliation

`/inventory/reconciliation` compares materialized balances to a grouped ledger sum and compares tracked invoice lines to SALE movements for missing, duplicate, quantity mismatch, and orphan cases. It reports `MATCH` or explicit mismatches and never repairs automatically. The grouped query avoids an N+1 movement scan.

A rebuild helper exists only for explicit Local / Testing engineering use and fails closed outside a Local database unless the testing override is set. It is not exposed through Production UI.

## S. Idempotency

Every movement requires a Business-scoped operation key. Replays with the same canonical input return the original movement; the same key with different input is rejected. Database uniqueness protects operation keys, and a partial unique index protects one SALE movement per Business + invoice source line.

## T. Concurrency

Inventory commands run at Serializable isolation with bounded retry for write conflicts. Tests cover concurrent identical operations, competing transfers, stale revisions, and last-unit sales. No successful path can create a negative balance or duplicate effect.

## U. Permissions / Tenant

Inventory capabilities are separated into view, manage, adjust, and transfer. Business owner and scoped staff rules continue to use trusted server session context. Composite foreign keys and actor scope triggers reject cross-Business Branch, Product, refund, transfer, and actor references.

## V. UI / Navigation

Inventory navigation appears only when entitlement and capability allow it. Pages include dashboard, Stock In, Stock Out, Adjustment, Transfer, Movement History, and Reconciliation. Movement history supports pagination and Branch/type/date/product filters. Product forms expose tracking and opening balances only when Inventory is enabled.

At a 390px test viewport, Inventory controls remained usable, document width did not exceed the viewport, navigation used intentional horizontal overflow, and browser console errors were zero.

## W. POS Regression

Product catalog, untracked sales, existing Salon/Auto entry points, financial idempotency, payment totals, refund credit notes, and post-commit notification behavior remain intact. Full unit and integration suites passed after the direct-product refund fix.

## X. Tests / Build / Migration

- Unit: `797/797` passed.
- Integration: `120/120` passed.
- Inventory integration: opening, sale, restock/no-restock refund, transfer, adjustment, idempotency, concurrency, immutability, tenant isolation, disabled entitlement, negative stock, and reconciliation passed.
- Prisma schema validation and client generation: passed.
- TypeScript: passed.
- Lint: passed with the existing WhatsApp `<img>` warning only.
- Local production-mode build: passed; 117 routes generated. Existing CSS autoprefixer warnings remain outside Inventory Phase 1.
- Fresh disposable database rebuild: all `158` migrations passed.
- Local browser QA: Salon `10 -> 8 -> 9`, Auto `5 -> 4`, transfer pair, stale revision rejection, adjustment, reconciliation MATCH, 390px viewport, and zero console errors passed.
- Independent Local database browser-fixture verifier: passed with balance = ledger for both businesses.

## Y. Deferred Phase 2 / 3

Supplier management, Purchase Orders, Goods Receive, Delivery Orders, supplier returns, Stock Take, cycle count, batch/lot/expiry, barcode hardware, COGS/accounting, Expense, and AI forecasting remain deferred. No placeholder workflow was presented as complete.

## Z. Final Status

`INVENTORY PHASE 1 — CORE STOCK FOUNDATION: READY`

`LOCAL / TESTING ONLY`

`PRODUCTION NOT ACCESSED`

`PRODUCTION NOT VALIDATED`
