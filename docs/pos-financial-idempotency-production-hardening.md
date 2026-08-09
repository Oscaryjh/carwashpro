# POS Financial Idempotency & Production Hardening

## A. Objective

本阶段只处理 POS Core 财务安全。核心不变量是：

```text
One business action = at most one financial effect.
```

用户 double click、网络 timeout、Server Action 重试、两个 tab、进程在 commit 后丢失 response，均不得重复创建 Invoice、Payment、Refund、Package effect 或 Daily Closing。

## B. Existing Financial Write Audit

| Write path | Entry point | Transaction / isolation | Operation identity | DB guard | Side-effect order | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Unified Salon cashier / walk-in / product / package checkout | `completeCashierSaleAction` | `runFinancialOperation`, Serializable | Client `checkout:*` | tenant/type/key unique；invoice source unique；conditional stock/package balance | commit 后 invoice notification | Hardened |
| Legacy standalone product sale | `sellProductAction` | `runFinancialOperation`, Serializable | Client `product-sale:*` | operation unique；conditional stock decrement；invoice number unique | commit 后 invoice notification | Hardened |
| Salon appointment checkout / additional partial payment | `recordSalonAppointmentPaymentAction` | `runFinancialOperation`, Serializable | Client `salon-payment:*` | appointment canonical invoice unique；operation unique | commit 后 invoice notification | Hardened |
| Auto work-order cash/card payment | `recordPaymentAction` | `runFinancialOperation`, Serializable | Client `payment:*` | work-order canonical invoice unique；balance recheck in transaction | commit 后 invoice notification | Hardened |
| Auto package redemption | `usePackagePaymentAction` | `runFinancialOperation`, Serializable | Client `package-redemption:*` | operation unique；serializable package row conflict | commit 后 invoice notification | Hardened |
| Pending package activation payment | `recordPackagePurchasePaymentAction` | `runFinancialOperation`, Serializable | Client `package-purchase:*` | customer-package canonical invoice unique；pending status recheck | commit 后 invoice notification | Hardened |
| Multi-package cashier purchase | `purchasePackageFromCashierAction` | `runFinancialOperation`, Serializable | Client `package-purchase:*` | operation unique；invoice/customer-package/payment atomic | commit 后 invoice notification | Hardened |
| Refund / Credit Note | `refundPaymentAction` | `runFinancialOperation`, Serializable | Client `refund:*` | operation unique；refundable amount re-read；credit-note refund unique | none | Hardened |
| Invoice void / payment reversal | `voidInvoiceAction` | `runFinancialOperation`, Serializable | Client `invoice-void:*` | operation unique；append/status reversal，不删除财务事实 | none | Hardened |
| Explicit Daily Closing | `closeDailySnapshotAction` | `runFinancialOperation`, Serializable | Client `daily-closing:*` | business/branch/date unique；immutable snapshot | durable queue in same transaction | Hardened |
| Last shift automatic closing | `endShiftAction` | existing Serializable transaction | shift identity + conditional OPEN→CLOSED | shift conditional update；business/branch/date snapshot unique | durable closing queue in transaction | Existing safe path retained |
| Invoice number generation | `makeInvoiceNumber` | inside owning financial transaction | generated business number | `businessId + invoiceNumber` unique；operation retry regenerates on collision | none | Race-safe; no `MAX + 1` |
| Invoice WhatsApp outbox | `sendInvoiceIfConnected` | after financial commit | `INVOICE_SENT:<businessId>:<invoiceId>` | `notification_queue.dedupe_key` unique | queue worker performs external work | Hardened |

No `Invoice`, `Payment`, `PaymentRefund`, `CustomerPackage` or `DailyClosingSnapshot` hard-delete mutation exists in the runtime financial paths.

## C. Risk Matrix

| Risk | Previous state | Control |
| --- | --- | --- |
| Walk-in double submit | High | stable checkout operation + unique operation record + result replay |
| Timeout after commit | High | completed operation stores canonical resource IDs/result JSON |
| Same key, changed amount/items | High | canonical SHA-256 request fingerprint and formal conflict |
| Two tabs overpaying one work order | High | Serializable re-read of outstanding balance + bounded retry |
| Package final-use race | High | Serializable transaction and conditional/row conflict handling |
| Duplicate refund | High | refund operation identity + refundable amount recheck |
| Duplicate closing | Medium | operation replay + existing business/branch/date unique constraint |
| Duplicate invoice notification | Medium | tenant/invoice stable queue dedupe key |
| Partial mutation after error | High | operation row and all financial mutations share one DB transaction |
| Cross-tenant replay leak | High | business-scoped lookup and DB branch/business scope trigger |

## D. Idempotency Architecture

`FinancialOperation` is an additive, forward-only boundary. Identity is:

```text
businessId + operationType + operationKey
```

It records actor, optional branch, request fingerprint, state, timestamps and canonical result JSON. The operation is inserted as `IN_PROGRESS`, the financial mutation runs, and the operation becomes `COMPLETED` in the same transaction. A failure before commit rolls back both operation and mutation, so there is no durable stuck `IN_PROGRESS` record.

Completed operations and their request identity are protected by database triggers from update/delete. Same key/same fingerprint returns the original result. Same key/different fingerprint raises `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD` semantics.

## E. Checkout

Unified cashier and standalone product checkout receive client-generated UUID operation IDs. The same mounted UI action keeps the same ID while pending/retrying. Unified cashier additionally keeps the key in session storage until it receives success, covering response loss followed by refresh.

Invoice, items, payment rows, stock, new package activation, package redemption, loyalty mutation and audit log remain atomic.

## F. Invoice

Walk-in invoices depend on the checkout operation. Appointment, Work Order and Customer Package canonical invoices retain their existing unique source relations. Invoice business numbers retain the existing human format; database uniqueness is the final race guard and bounded retry handles rare number collisions.

## G. Payments

Every payment-taking entry point now requires a stable operation ID. Work-order outstanding balance is read inside Serializable execution. A second concurrent full payment retries against committed state and fails the overpayment rule.

## H. Partial Payments

Payment idempotency is operation-based, not `invoiceId`-unique. RM40 and RM60 with distinct operation IDs remain two valid payments; retry of either operation replays its original Payment ID.

Invoice and Work Order payment status are server-derived in the same transaction from canonical totals/current payment state. UI cannot directly force a paid state.

## I. Package Purchase

Unified checkout, multi-package cashier sale and pending-package activation are covered by `PACKAGE_PURCHASE` or the containing checkout operation. CustomerPackage, service balances, invoice, payment, loyalty and audit changes commit together.

## J. Package Redemption

Package payments already provide an immutable usage ledger through `Payment.method=PACKAGE`, `packageUses`, customer-package/service-balance references, and corresponding Refund/Void restoration records. No competing ledger was introduced.

Redemption runs inside Serializable execution. Unified cashier also uses conditional expected-balance updates. Retry of one redemption decrements once; concurrent independent attempts for the last use produce one winner.

## K. Appointment Checkout

Salon appointment invoice uniqueness remains the source guard. Checkout/payment operations add retry identity and result replay. A second independent attempt cannot create another canonical appointment invoice.

## L. Work Order Checkout

`Invoice.workOrderId` remains unique. Payment operations re-read the Work Order inside Serializable execution, preventing duplicate invoice and concurrent overpayment.

## M. Walk-in

Walk-in has no source entity, so the client-generated checkout/product-sale operation is the canonical request identity. Same ID replays; a different ID represents a deliberately new walk-in sale.

## N. Refund / Void

Refund uses a stable operation ID, rechecks remaining refundable cents inside the transaction, and atomically creates PaymentRefund, Credit Note, loyalty reversal, package restoration and invoice/work-order totals. Concurrent refunds cannot exceed the original payment.

Void is an idempotent status/reversal workflow. It marks Invoice/Payment rows void and restores package use where required; it does not delete/recreate financial history.

## O. Daily Closing

Explicit close uses operation replay plus the existing `businessId + branchId + businessDate` unique constraint. Snapshot report data is frozen. Automatic closing after the final shift retains conditional shift closing, Serializable isolation and the same snapshot uniqueness.

## P. External Side Effects

Invoice WhatsApp generation runs only after the financial transaction commits. The exported helper catches notification failures and logs only operation/resource identifiers; payment success is not converted into payment failure.

The durable queue uses `INVOICE_SENT:<businessId>:<invoiceId>`. Queue creation replays the existing row on unique conflict. Daily Closing creates its durable queue record in the closing transaction; the external worker runs later.

## Q. DB Constraints

| Invariant | Database enforcement | Service enforcement |
| --- | --- | --- |
| one operation effect | unique business/type/key | fingerprint replay/conflict |
| operation tenant branch | scope trigger | authenticated business context |
| immutable completed result | update/delete triggers | no mutation API |
| one Work Order invoice | unique `workOrderId` | source lookup |
| one Appointment invoice | unique `appointmentId` | source lookup |
| one package purchase invoice | unique `customerPackageId` | pending-state lookup |
| unique invoice number | business/invoice-number unique | retry on collision |
| one closing per business day | business/branch/date unique | existing lookup/replay |
| one invoice outbox event | notification dedupe unique | stable tenant/invoice key |
| non-negative consumed stock/use | conditional update / Serializable conflict | availability validation |

## R. Transaction Isolation

Financial operation paths use Serializable only where the business invariant depends on a read followed by financial writes. Retry is bounded to five attempts with short exponential jitter. This avoids a global business lock: independent rows/operations proceed concurrently, while conflicting Work Order/package/source rows serialize through PostgreSQL.

## S. Retry / Crash Recovery

- Commit followed by lost response: same operation key returns stored Invoice/Payment/resource IDs.
- Failure before commit: operation and partial financial mutations roll back together; retry can start normally.
- Unique-operation race: the loser reads and replays the completed operation.
- Serializable conflict/deadlock: bounded retry executes the same business operation key.

## T. Permissions / Tenant Safety

All Server Actions still call the existing authenticated business context and existing POS/CLOSING/owner permission checks before operation lookup. Knowing another tenant's operation key is insufficient because lookup uniqueness and replay are scoped by `businessId`. Branch/business mismatch is blocked by a database trigger.

## U. UI Retry Behaviour

Financial forms generate UUID-backed operation IDs. Submit buttons use pending state and show processing labels. UI disable is only usability protection; correctness remains enforced by Server Action + database transaction + unique constraints.

## V. Tests

Targeted tests cover:

- canonical fingerprint field ordering;
- same-key concurrent checkout replay and one Invoice;
- same key/different payload conflict;
- cross-business same-key isolation;
- immutable completed result and cross-tenant branch trigger;
- response-loss style replay;
- rollback followed by successful retry;
- concurrent RM100 + RM100 against RM100 outstanding;
- distinct RM40 + RM60 partial payments and per-operation replay;
- package 3→2 on retry;
- last package use with two independent concurrent attempts;
- one outbox row under duplicate enqueue;
- 20 checkout operations across two branches, each invoked twice concurrently, producing 20 effects.

Authenticated browser E2E was intentionally not entered because this phase explicitly stops at POS financial idempotency engineering gates.

## W. Performance

The new unique index is narrow and tenant-prefixed. Transactions lock/conflict on operation/source/balance rows, not all rows for a business. The bounded stress test verifies multi-branch operations can progress without an entire-business application lock.

## X. Remaining Risks

- Human invoice numbers use the existing random suffix instead of a strict sequential fiscal counter. Duplicate numbers cannot commit because of the database unique constraint; rare collisions are retried.
- External card/e-wallet/provider settlement is not performed in this POS flow; references remain recorded payment facts. Real provider idempotency must be handled by its future adapter/specification.
- Historical transactions have no FinancialOperation row. The migration is intentionally additive and does not rewrite legacy records.
- WhatsApp message-log drafts can exist for a simultaneous notification preparation race, but the durable outbox/business delivery event is unique and only one external send is queued.

## Y. Production Blockers

No POS financial-idempotency blocker remains after all engineering gates pass. Production deployment/migration execution, real provider calls and real customer messaging remain outside this task and were not performed.

## Z. Completion Gate

All completion gates passed in the canonical workspace on 2026-08-09:

- unit tests: 704/704;
- integration tests: 89/89;
- TypeScript: passed;
- lint: passed with one pre-existing WhatsApp image optimization warning;
- production build: passed;
- Prisma validate and client generation: passed;
- full fresh migration rebuild: passed;
- canonical workspace guard: passed;
- `git diff --check`: passed.

**POS FINANCIAL IDEMPOTENCY — READY**
