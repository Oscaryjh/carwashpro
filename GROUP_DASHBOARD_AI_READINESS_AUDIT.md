# Tetamu POS — Business Group / All Stores Dashboard AI Readiness Audit

**Audit date:** 2026-07-29  
**Scope:** Current codebase, Prisma/PostgreSQL schema, Group Dashboard UI, server-side authorization, automated tests, and the local `car_wash_crm_pos` dataset.  
**Method:** Read-only inspection. No application code, migration, test, database row, production configuration, OpenAI integration, or deployment was changed.  
**Status vocabulary:** `COMPLETE`, `PARTIAL`, `MISSING`, `BLOCKED`, `NOT APPLICABLE`.

## CRITICAL FINDINGS

| Severity | Finding | Exact location | Impact | Required fix |
|---|---|---|---|---|
| **CRITICAL** | Group reports and Daily Closing do not use the same business-day boundary. Group reporting uses each store's `timezone` and `businessDayCutoffTime`; Daily Closing hard-codes `Asia/Kuching` and `00:00–24:00`. The audited stores use a `02:00` cutoff. | `src/lib/business-groups/all-stores-kpi.ts` (`buildBusinessPeriods`, `getCurrentBusinessDateValue`); `src/lib/business-day.ts`; `src/lib/daily-closing/range.ts` (`DAILY_CLOSING_TIME_ZONE`, `getDailyClosingRange`); `src/lib/daily-closing/snapshot.ts` (`buildDailyClosingSnapshotPayload`) | Transactions between 00:00 and 01:59 can be assigned to different business dates. The All Stores dashboard can disagree with a frozen closing snapshot for the same displayed date, which makes financial reconciliation and AI explanations unreliable. | Make Daily Closing call the same per-business range service used by Group reporting. Freeze `timezone`, `cutoff`, `businessDate`, and a metric-definition version in every snapshot. Add cross-module reconciliation tests around midnight, cutoff, and DST. |
| **HIGH** | “Sales”, “gross”, and “net” are not canonical across views. Group reporting is invoice-recognition based, auto-detailing/salon dashboards contain payment-based revenue, while Daily Closing has its own calculation path. | `src/lib/business-groups/all-stores-kpi.ts`; `src/lib/business-groups/group-reports.ts`; `src/app/(business)/dashboard/page.tsx`; `src/app/(business)/salon/dashboard/page.tsx`; `src/app/(business)/reports/page.tsx`; `src/lib/daily-closing/calculator.ts` | The same date/store can produce different numbers under similar labels. An AI layer would confidently explain contradictory totals. | Publish a versioned metric contract: recognized sales, collections, refunds, outstanding, gross, net, tax, tips, discounts, and package liability. Reuse one calculation library or an analytics fact layer. |
| **HIGH** | Historical group attribution is reconstructed from current active membership. Transaction tables do not preserve the group that owned the store at event time. | `prisma/schema.prisma` (`BusinessGroupMember`, `Invoice`, `Payment`, `Appointment`, `WorkOrder`); `src/lib/business-groups/all-stores-access.ts` | Moving/removing a store can rewrite the meaning of historical group reports: past activity can disappear from the old group or appear under a new group. This breaks period comparisons and auditability. | Add effective-dated group membership history (`valid_from`, `valid_to`) and persist/derive immutable group attribution for analytics facts at event time. Never use current membership alone for historical reporting. |

# 1. Executive Summary

## 1.1 Conclusion

The current All Stores feature is a **useful early Group BI/reporting implementation**, not merely a basic report, but it is **not AI-ready**. Its strongest areas are server-side scope enforcement, multi-store sales aggregation, store comparisons, transaction drill-down/export, per-store timezone/cutoff handling in Group reports, and frozen Daily Closing snapshots.

Its weakest areas are canonical metric definitions, historical analytics modeling, profitability/cost data, group-wide customer identity, staff/operation attribution, marketing attribution, inventory movements, and scalable pre-aggregation. These gaps prevent reliable answers to many owner-level questions and make an LLM interface unsafe because it could return plausible but statistically inconsistent explanations.

## 1.2 Completion score

**Overall Group Dashboard AI readiness: 31%.**

Scoring method:

- Each audited metric/domain item is scored as `COMPLETE = 1`, `PARTIAL = 0.5`, and `MISSING`/`BLOCKED = 0`.
- `NOT APPLICABLE` items are excluded.
- The score covers metric availability, definition consistency, dimensions, historical validity, database support, testability, authorization, and query scalability.
- Architecture/security foundations score considerably higher than advanced analytics; the 31% represents end-to-end AI answer readiness, not only whether a page renders.

Approximate domain scores:

| Domain | Readiness |
|---|---:|
| Sales overview | 52% |
| Store performance | 35% |
| Revenue trends | 35% |
| Customers | 18% |
| Appointments | 35% |
| Services | 32% |
| Products/inventory | 28% |
| Packages | 32% |
| Staff | 18% |
| Financial/profitability | 15% |
| Marketing | 8% |
| Operations | 20% |
| Daily Closing | 55% |
| Filters/dimensions | 55% |

## 1.3 API/read-model readiness

**Status: PARTIAL**

- Server-side functions already behave like protected read services: `getAllStoresKpiReport`, `getGroupReports`, and `getGroupClosingReport`.
- They re-resolve authorization from the user/group rather than accepting a client-supplied list of business IDs.
- They return structured objects suitable for internal UI use.
- They are not stable, versioned analytics APIs: there is no shared metric catalog, no response schema/version contract, no freshness metadata, no lineage metadata, no confidence flags, no long-range endpoint, and no AI-safe semantic query layer.
- The current functions aggregate raw transactions in application memory. They should not be exposed directly as a general AI tool.

## 1.4 Five largest gaps

1. **No canonical, versioned analytics layer:** calculations are duplicated and the 31-day raw-query model cannot support monthly, yearly, seasonality, or large groups reliably.
2. **Profit cannot be calculated correctly:** service cost, historical item cost, expenses, payroll, commission, and complete cost-of-goods data are absent.
3. **No group-wide customer identity and retention model:** customers are store-scoped; cross-store visits, group-level repeat rate, churn, lifetime value, and migration between stores are unreliable.
4. **Missing operational attribution/ledgers:** invoice lines lack staff and cost snapshots; inventory lacks movement history; packages lack expiry/redemption history; appointment reschedule/cancellation reasons are incomplete.
5. **Metric and time semantics conflict:** Daily Closing, Group Dashboard, and single-store dashboards can assign dates and revenue differently; historical group membership is mutable.

# 2. Existing Architecture

## 2.1 Page and navigation architecture

| Component | Status | Current behavior | Evidence |
|---|---|---|---|
| Group overview | COMPLETE | `/groups/[groupId]/overview`; supports today, 7 days, 30 days, and custom range up to 31 business days. | `src/app/(group)/groups/[groupId]/overview/page.tsx`; `src/lib/business-groups/all-stores-kpi.ts` |
| Group reports | COMPLETE | Filters, summary, daily trend, store ranking, catalog ranking, paginated transactions, CSV/XLSX/PDF export. | `src/app/(group)/groups/[groupId]/reports/page.tsx`; `src/lib/business-groups/group-reports.ts`; `src/lib/business-groups/group-report-export.ts` |
| Group Daily Closing | COMPLETE | Aggregates immutable closing snapshots and cash reconciliation. | `src/app/(group)/groups/[groupId]/closing/page.tsx`; `src/lib/business-groups/group-closing-report.ts` |
| Group navigation breadth | PARTIAL | Only All Stores, Group Reports, and Daily Closing exist. Customer, appointment, staff, inventory, profitability, and data-quality modules are absent. | `src/lib/business-groups/navigation.ts` |
| Business context switcher | COMPLETE | Authorized users can switch between store contexts and All Stores. | `src/components/business-context-switcher.tsx`; `src/lib/business-groups/business-context.ts` |
| Login landing on All Stores | PARTIAL | A group-only user without an active business is recovered to an authorized store and redirected to that industry's home. All Stores is then selected manually. | `src/lib/auth/login-destination.ts`; `src/app/login/actions.ts`; `src/app/business-context/recover/route.ts`; `src/lib/business-groups/business-context.ts` |

## 2.2 Authorization and tenancy

| Control | Status | Finding |
|---|---|---|
| Server-side group resolution | COMPLETE | `resolveAuthorizedGroupReportingScope` resolves live group grants and active members on the server. |
| Group owner scope | COMPLETE | Owner receives active stores in the authorized group. |
| Group manager scope | COMPLETE | Manager is read-only and limited by `SELECTED_BUSINESSES`/business access records. |
| Cross-group isolation | COMPLETE | Unauthorized/inactive/platform/direct-only users do not receive reporting contexts. |
| Minimum All Stores scope | COMPLETE | All Stores requires at least two authorized stores. |
| Query tenant filter | COMPLETE | Core Group queries apply authorized `businessId` and time-period filters. |
| Historical tenant/group attribution | PARTIAL | Tenant isolation is live, but group attribution is based on current membership rather than event-time membership. |
| Authorization test coverage | COMPLETE | Unit and integration tests cover owner/manager scope, inactive members, unauthorized groups, and live membership. |

Key evidence:

- `src/lib/business-groups/all-stores-access.ts`
- `src/lib/business-groups/capabilities.ts`
- `src/lib/business-groups/business-context.ts`
- `tests/unit/all-stores-access.test.ts`
- `tests/integration/all-stores-access.test.ts`
- `tests/integration/tenant-isolation.test.ts`

## 2.3 Current query architecture

```text
Page request
  -> load group reporting contexts
  -> load business switching contexts
  -> selected group report service re-resolves authorization
  -> query Invoice / InvoiceItem / Payment / PaymentRefund or DailyClosingSnapshot
  -> aggregate in Node.js
  -> render server component
```

There is no analytics warehouse, OLAP store, materialized view, cache, background refresh job, metric registry, or semantic query API. Group IDs are not present on transaction facts; all aggregation starts from authorized store IDs.

## 2.4 Existing tests

The current tests are a strong foundation:

- KPI arithmetic in integer cents, package vouchers, refunds by event date, unpaid/partial transaction counts, previous-period comparison, timezone/cutoff/DST, authorization-before-query, and 31-day validation.
- Group Reports filter validation, bounded logical queries, daily zero-fill, catalog ranking, event-date semantics, pagination, and scope.
- Daily Closing frozen snapshot aggregation and authorized filtering.
- Tenant isolation for customers, audit logs, and WhatsApp data.

Missing test families are listed in sections 8, 9, and 12.

# 3. Existing Metrics

## 3.1 Group overview and sales

| Metric/capability | Status | Definition/current support | Evidence |
|---|---|---|---|
| Gross sales | COMPLETE | Non-void invoice totals excluding tips and package-voucher value, with discounts added back. | `calculateAllStoresKpis` in `src/lib/business-groups/all-stores-kpi.ts` |
| Net sales | COMPLETE | Non-void invoice totals excluding tips/package vouchers, less refunds in the refund event period. | Same as above |
| Payments collected | COMPLETE | Active, non-package payments by `paidAt`. | Same as above |
| Refund amount | COMPLETE | `PaymentRefund` by `refundedAt`. | Same as above |
| Transaction count | COMPLETE | Count of non-void invoices, including unpaid/partial once. | Same as above |
| Average transaction value | COMPLETE | Net sales divided by transaction count, in integer cents. | Same as above |
| Previous-period comparison | COMPLETE | Same-length prior period with signed percentage and new/no-change states. | `compareKpiValues` |
| Per-store cards/ranking | COMPLETE | Same six KPIs per authorized store. | `src/app/(group)/groups/[groupId]/overview/page.tsx`; `src/lib/business-groups/group-reports.ts` |
| Multi-timezone business day | COMPLETE | Per-store timezone and cutoff used in Group KPI/report periods. | `src/lib/business-day.ts`; `buildBusinessPeriods` |
| Daily net-sales trend | COMPLETE | Zero-filled per-business-date series; refunds use their own event date. | `buildGroupReportTrend` |
| Payment-method filter | COMPLETE | Cash, card, DuitNow, e-wallet, bank transfer. | `parseGroupReportFilters`; report page |
| Invoice-status filter | COMPLETE | Paid, partial, unpaid, refunded, void. | Same |
| Store filter | COMPLETE | Restricted to the server-authorized store set. | Same |
| Transaction drill-down | COMPLETE | Paginated transaction list with store/timezone context. | `getGroupReports` |
| CSV/XLSX/PDF export | COMPLETE | Hard limit of 5,000 transactions. | `getGroupReportExportData`; `group-report-export.ts` |

## 3.2 Catalog and closing

| Metric/capability | Status | Definition/current support | Evidence |
|---|---|---|---|
| Top services by sales | COMPLETE | Invoice item name/amount ranking. | `buildGroupCatalogRankings` |
| Top products by sales | COMPLETE | Invoice item name/amount ranking. | Same |
| Top packages by sales | COMPLETE | Lines associated with `customerPackageId`. | Same |
| Closing gross/net/collections/outstanding/refunds | COMPLETE | Summed only from valid frozen snapshot payloads. | `src/lib/business-groups/group-closing-report.ts` |
| Expected vs actual cash | COMPLETE | Snapshot cash reconciliation. | Same |
| Balanced/over/short counts | COMPLETE | Derived from closing cash differences. | Same |
| Closing actor/time/note | COMPLETE | Stored and displayed per snapshot. | Same |
| WhatsApp closing send status | COMPLETE | Latest send information is included. | Same |
| Frozen closing report | COMPLETE | Snapshot JSON is immutable for reporting and versioned as v1. | `src/lib/daily-closing/snapshot.ts`; `prisma/schema.prisma` |

# 4. Missing Metrics

## 4.1 Sales and financial

| Missing item | Status | Why unavailable | Required source/model |
|---|---|---|---|
| Gross profit and profit margin | MISSING | Services have no cost; invoice items do not snapshot cost; expenses/payroll absent. | Item cost snapshot, service cost model, expenses, payroll/commission facts |
| Operating profit / EBITDA-style view | MISSING | No operating expense ledger. | Expense categories, accrual/cash dates, branch allocation |
| Cash flow | MISSING | Collections exist, but outflows/payables/expenses do not. | Cash ledger, expenses, supplier payments, payroll |
| COGS by store/service/product | MISSING | Product current cost is not historical; service/package cost absent. | Immutable line-level cost at sale/redemption |
| Budget vs actual / targets | MISSING | No budget/target tables. | Store/month target and budget facts |
| Year-over-year / YTD / rolling 12 months | MISSING | Request range is capped at 31 days; no monthly summaries. | Monthly aggregate table and long-range API |
| Service charge/fees | MISSING | No canonical charge dimension beyond tax/tip. | Invoice charge fact |
| Promotion/voucher ROI | MISSING | Invoice stores only total discount/reason, not campaign/promotion ID. | Promotion, redemption, attributable discount facts |
| Refund rate by item/staff/reason | MISSING | Refund is payment/invoice-level; credit-note lines lack catalog attribution. | Refund allocation fact with item/staff/reason |

## 4.2 Customer

| Missing item | Status | Why unavailable | Required source/model |
|---|---|---|---|
| Unique customers across all stores | MISSING | `Customer` is unique only by `(businessId, phone)`. One normalized phone already appears in multiple audited stores. | Group customer identity/key with controlled matching |
| Cross-store customer journeys | MISSING | No group identity or event stream. | Group customer ID on analytical events |
| New vs returning customers group-wide | MISSING | Can be computed store-locally only; identity across stores is absent. | Group identity plus first/last visit facts |
| Retention cohorts | MISSING | No cohort/read model and only ~33 days of current data. | Customer cohort monthly table |
| Churn / win-back | MISSING | No canonical last-visit group dimension or thresholds. | Customer feature table and policy |
| Customer lifetime value / frequency / recency | MISSING | Fragmented store identities; no long-history aggregate. | Group customer feature snapshot |
| Referral/source/channel | MISSING | Customer and transaction acquisition source is not captured. | Source/referral/campaign dimensions |
| Complaint/satisfaction/NPS | MISSING | No complaint, rating, or survey model. | Feedback and complaint facts |

## 4.3 Appointment and operations

| Missing item | Status | Why unavailable | Required source/model |
|---|---|---|---|
| Reschedule rate and reasons | MISSING | No original schedule/rescheduled timestamp/reason history. | Appointment event history |
| Cancellation reason analysis | MISSING | Cancellation timestamp exists, reason does not. | Reason code and free-text note |
| Lead time and booking source | MISSING | Created/scheduled timestamps exist, but source/channel does not. | Booking source dimension |
| Capacity/utilization | MISSING | No bay/chair/resource capacity schedule. | Resource and availability fact |
| Cycle time by process stage | MISSING | Work order lacks started/completed/ready event history. | Work-order status event table |
| Queue/wait time | MISSING | No queue entry/service-start event pair. | Operational event stream |
| Rework/comeback rate | MISSING | No relationship marking a repeat job as rework. | Rework link/reason/warranty |
| SLA/target compliance | MISSING | No operational target configuration. | Store/service SLA definitions |

## 4.4 Products, inventory, packages

| Missing item | Status | Why unavailable | Required source/model |
|---|---|---|---|
| Inventory movement/adjustment history | MISSING | `ProductStock` stores current quantity only. | Stock movement ledger |
| Purchases/suppliers/landed cost | MISSING | No supplier or purchase-order model. | Supplier, PO, receipt, landed-cost facts |
| Wastage/shrinkage/expiry | MISSING | No movement reasons or batch/expiry model. | Stock batches and reasoned adjustments |
| Stockout duration/lost sales | MISSING | No stock-state history or missed-sale capture. | Stock daily snapshot and stockout event |
| Package expiry liability | MISSING | `CustomerPackage` has no `expiresAt`. | Expiry policy and immutable expiry date |
| Package redemption ledger | MISSING | Remaining counters and package payments exist, but no dedicated immutable redemption event. | Package redemption fact |
| Breakage / unused package value | MISSING | No expiry and no historical liability snapshots. | Package liability daily/monthly table |

## 4.5 Staff and marketing

| Missing item | Status | Why unavailable | Required source/model |
|---|---|---|---|
| Staff sales at invoice-line level | MISSING | Invoice items and work-order items lack `staffId`. Salon infers staff from the appointment. | Line-level performer/assistant allocation |
| Staff commission | MISSING | No commission rules or ledger. | Versioned commission plan and payout fact |
| Staff productivity/profitability | MISSING | Incomplete attribution and no labor cost. | Staff service time, cost, attendance, sales facts |
| Late/overtime/schedule adherence | MISSING | Attendance exists but schedules/expected shifts and approval data are incomplete. | Planned shift and overtime facts |
| Marketing campaigns | MISSING | WhatsApp messages exist, but no campaign entity, spend, audience, or conversion attribution. | Campaign/send/cost/conversion facts |
| CAC/ROAS | MISSING | No spend or acquisition source. | Campaign cost and attributed customer/revenue |
| WhatsApp conversion funnel | MISSING | Delivery/read data exists; campaign and conversion windows do not. | Message-to-booking/sale attribution |

# 5. Partial Metrics

| Metric | Status | What exists | Why only partial |
|---|---|---|---|
| Discounts | PARTIAL | Invoice-level discount total and optional reason; `CatalogDiscount` exists. | Invoice does not link to a discount/promotion ID; no line allocation or campaign ROI. |
| Tax | PARTIAL | Invoice/credit-note tax totals and single-store report display. | Not exposed as a complete Group Dashboard metric; no tax-by-store/time reconciliation view. Real audited data has zero tax. |
| Tips | PARTIAL | Invoice tip amount and salon report. | Excluded from Group sales and not shown as a group metric; no staff allocation. Real audited data has zero tips. |
| Outstanding receivables | PARTIAL | Daily Closing and single-store reports can calculate balances. | Not included in All Stores overview/group report KPI set; aging buckets absent. |
| Payment mix | PARTIAL | Payment method filter and underlying method values exist. | No group payment-method distribution, trend, share, or reconciliation panel. |
| Store ranking | PARTIAL | Stores rank by sales KPIs. | No profitability, growth decomposition, customer, appointment, closing completion, or operational scorecard. |
| Revenue trend | PARTIAL | Daily net-sales trend for up to 31 days. | No weekly/monthly/quarterly/yearly/seasonal trend or forecast. |
| Service performance | PARTIAL | Top service sales and quantity by name. | No immutable group catalog mapping, cost/margin, staff, duration, attachment, refund, or trend. |
| Product performance | PARTIAL | Top product sales; current `costPrice` and stock quantity exist. | No historical cost snapshot, movement ledger, margin, turnover, stockout, wastage, or purchasing. |
| Package performance | PARTIAL | Package sales/ranking, remaining uses, and package-payment redemptions exist. | No expiry, liability aging, redemption ledger, breakage, renewal, or profitability. |
| Appointment funnel | PARTIAL | Appointment statuses and several lifecycle timestamps exist; salon report has completed/cancelled/no-show/repeat. | Not group-wide; no source, reasons, reschedule history, capacity, or conversion funnel trend. |
| Staff sales | PARTIAL | Salon report attributes invoice item value to assigned appointment staff. | Attribution is inferred, one staff per appointment, and not valid for all industries/line items. |
| Attendance | PARTIAL | Attendance schema supports clock-in/out/status. | Real database has zero records; no expected schedule, lateness, overtime, or group dashboard. |
| Loyalty | PARTIAL | Store-scoped membership balances, lifetime points, and transaction history exist. | No group-level loyalty identity, cohort, redemption ROI, or cross-store balance policy. |
| WhatsApp engagement | PARTIAL | Message/send/read/open state and chat messages exist. | No campaign, spend, audience, attribution, or group funnel metric. |
| Closing completion | PARTIAL | Existing snapshots show financial/cash results. | Query only sees completed snapshots; it cannot list required-but-unclosed branches or completion percentage. Real database has zero snapshots. |
| New/returning customers | PARTIAL | Daily Closing calculator and single-store report can infer within a store. | No group identity and insufficient long history. |
| Cross-store catalog ranking | PARTIAL | Catalog lines aggregate by lower-cased item name. | Different items with the same name can be merged; renamed items split. No group catalog key. |

# 6. AI Question Readiness Matrix

`YES` means the current data and metric definition can answer reliably within supported date limits. `PARTIAL` means a constrained answer is possible with caveats. `NO` means the answer would be misleading or unavailable.

| # | Typical owner question | Readiness | Reason |
|---:|---|---|---|
| 1 | How much did all stores sell today? | **YES** | Group net/gross sales are available with per-store business-day handling. |
| 2 | How does today compare with the previous equivalent period? | **YES** | Same-length comparison is implemented. |
| 3 | Which store has the highest net sales? | **YES** | Store performance rows are available. |
| 4 | Which stores are declining for three consecutive months? | **NO** | 31-day cap and no monthly historical summaries. |
| 5 | What are collections and refunds today? | **YES** | Payment/refund event metrics exist. |
| 6 | Why does Daily Closing not match the dashboard? | **PARTIAL** | Data is visible, but definitions currently conflict; no automated reconciliation/explanation. |
| 7 | What is outstanding and how old is it? | **PARTIAL** | Balance exists in source/some reports; no group KPI or aging buckets. |
| 8 | Which payment method is growing fastest? | **PARTIAL** | Method data/filter exists; no trend/read model beyond 31 days. |
| 9 | Which services generate the most revenue? | **YES** | Top service sales are available, but mapped by name. |
| 10 | Which services generate the most profit? | **NO** | Service cost and reliable line-level cost are absent. |
| 11 | Which products have the best margin? | **NO** | Historical cost at sale is not frozen. |
| 12 | Which products are at risk of stockout? | **PARTIAL** | Current quantity/reorder level exist store-locally; no velocity/lead-time model or group view. |
| 13 | How much inventory was wasted or adjusted? | **NO** | No stock movement ledger. |
| 14 | Which packages sell best? | **YES** | Current group catalog ranking can answer by amount/name. |
| 15 | What is our unused/expiring package liability? | **NO** | Expiry and liability snapshots are absent. |
| 16 | How many unique customers visited the group? | **NO** | Customers are duplicated by store; no group customer identity. |
| 17 | What is our group repeat customer rate? | **NO** | Store-level inference is insufficient across stores and history. |
| 18 | Which customers are likely to churn? | **NO** | No group identity, long-range features, or churn definition. |
| 19 | Which store acquires the most new customers? | **PARTIAL** | Store customer creation can be counted, but acquisition source and cross-store identity are absent. |
| 20 | What is appointment no-show/cancellation rate by store? | **PARTIAL** | Appointment statuses exist; no Group Dashboard metric and reason/source dimensions are missing. |
| 21 | Which staff member generates the most sales? | **PARTIAL** | Salon inference exists, but line-level/all-industry attribution is absent. |
| 22 | Which staff member is most profitable/productive? | **NO** | Labor cost, commission, full attribution, and capacity are absent. |
| 23 | Which marketing campaign produced the most revenue? | **NO** | Campaign/spend/conversion attribution is absent. |
| 24 | Which branches have not closed today or have cash shortages? | **PARTIAL** | Shortages in existing snapshots are visible; missing closings are not enumerated and the date-boundary bug remains. |
| 25 | Forecast next month's revenue and explain the drivers. | **NO** | Only ~33 days of real history, 31-day query cap, no monthly facts, and incomplete drivers. |

**Current AI answerability:** 6 `YES`, 9 `PARTIAL`, 10 `NO`. Even the `YES` questions require metric-definition/version metadata before being safely exposed to an AI assistant.

# 7. Database Gaps

## 7.1 Schema and event gaps

| Gap | Current model | Consequence | Recommended change |
|---|---|---|---|
| Effective-dated group membership | Active/historical rows exist but reporting uses current `ACTIVE` membership. | Historical group reports can change after membership changes. | Add `validFrom`, `validTo`, reason, actor; build event-time group attribution. |
| Group customer identity | `Customer` unique by `(businessId, phone)`. | Double-counted group customers and broken journeys. | Add privacy-controlled `GroupCustomerIdentity` and mapping table; retain store customer ownership. |
| Service cost | `Service` has price/duration, no cost. | Service/package profitability unavailable. | Versioned labor/material/overhead cost model. |
| Historical product cost | `Product.costPrice` is current; `InvoiceItem` has no cost snapshot. | Past margins change when cost is edited. | Add `unitCostSnapshot`, `lineCost`, and cost-source version to sale lines/facts. |
| Staff sale attribution | Invoice/work-order lines lack performer IDs. | Staff revenue, commission, productivity unreliable. | Add line allocation table supporting multiple staff/weights. |
| Inventory ledger | Only current `ProductStock.quantity`. | No turnover, wastage, shrinkage, stockout, or audit trail. | Add immutable `InventoryMovement` and daily stock snapshot. |
| Package expiry/redemption ledger | Remaining counters; no `expiresAt`; package payments carry uses. | Liability, breakage, expiry, and redemption history unreliable. | Add immutable purchase terms, expiry, and redemption/reversal events. |
| Appointment event history | Lifecycle timestamps exist, but original/reschedule/reason/source history absent. | Funnel and operational root-cause analysis incomplete. | Add `AppointmentEvent` plus source/reason codes. |
| Work-order stage history | Current status and a few timestamps only. | Cycle/wait/rework analysis unavailable. | Add `WorkOrderStatusEvent`, resource/bay, rework linkage. |
| Expense/payroll/commission | No corresponding accounting facts. | Profit/cash-flow/staff-cost questions impossible. | Add expense, payroll, commission rules and posted ledgers or integrate accounting source. |
| Marketing attribution | WhatsApp records exist, but no campaign/spend/conversion model. | ROAS/CAC/conversion unavailable. | Add campaign, audience, send, spend, and attribution facts. |
| Refund item allocation | Payment refunds are invoice/payment-level; credit-note item dimensions are limited. | Item/staff/store reason analytics weak. | Add refund-line allocations with source invoice-line IDs. |
| Analytics freshness/lineage | No watermark/run metadata. | AI cannot state data age or failed refreshes. | Add analytics refresh run/watermark and quality result tables. |

## 7.2 Index gaps for current Group queries

Existing single-column indexes help, but high-volume time-range queries need composite indexes aligned to tenant and date:

| Table | Existing relevant index | Recommended candidate |
|---|---|---|
| `Invoice` | `businessId`, `status`; no `issuedAt` index in the audited schema | `(businessId, issuedAt, status)` and optionally `(businessId, branchId, issuedAt)` |
| `Payment` | Separate `businessId`, `paidAt`, `status` indexes | `(businessId, paidAt, status, method)` |
| `PaymentRefund` | `(businessId, refundedAt)` | Keep; consider `(businessId, refundedAt, method)` only after query-plan evidence |
| `Appointment` | `(businessId, assignedStaffId, scheduledAt)` plus separate date/status | `(businessId, scheduledAt, status, branchId)` |
| `WorkOrder` | Separate business/status indexes | `(businessId, createdAt, status, branchId)` |
| `InvoiceItem` | Separate business/invoice/catalog indexes | Prefer joining through pre-aggregated sale-line facts; otherwise query-specific composite indexes |
| `Customer` | `businessId`; unique `(businessId, phone)` | `(businessId, createdAt)` for acquisition trends |

All index changes must be validated with `EXPLAIN (ANALYZE, BUFFERS)` on production-like volumes. Do not add every candidate blindly.

## 7.3 Local data readiness

Read-only counts from the local `car_wash_crm_pos` database:

| Entity | Count | Readiness observation |
|---|---:|---|
| Businesses / active group stores | 3 / 3 | One store has no transaction data. |
| Branches | 2 | Sparse for multi-branch testing. |
| Invoices / payments / invoice items | 61 / 65 / 7 | Only about 33 days of history; invoice-item coverage is sparse. |
| Refunds / credit notes | 0 / 0 | Refund analytics and edge cases are `BLOCKED` for real-data validation. |
| Daily closing snapshots | 0 | Group Closing is `BLOCKED` for real-data validation. |
| Attendance | 0 | Staff attendance analytics are `BLOCKED`. |
| Customers | 6 | At least one normalized phone occurs in more than one business. |
| Appointments / work orders | 15 / 55 | Small sample, concentrated in two stores. |
| Product stocks / packages / customer packages | 10 / 12 / 5 | Too small for trend, stockout, expiry, or liability validation. |
| WhatsApp message / chat message | 275 / 1,308 | Engagement data exists, but campaign/conversion attribution is missing. |

Additional completeness:

- All 61 invoices are paid; there are no partial, unpaid, refunded, or void invoices in the local data.
- 61/61 invoices have branches, but only 7/61 have customers.
- 54/61 invoices link to work orders and 4/61 to appointments.
- Two invoices contain discounts; tax and tips are zero in all audited invoices.
- All 10 products currently have cost, but historical invoice-line cost is not preserved.
- All 15 appointments have a branch and assigned staff; 14 have a service; 6 are converted.

The implementation has unit fixtures for several edge cases, but local data is not representative enough to validate real operational AI answers.

# 8. Permission and Security Risks

## 8.1 Positive controls

| Control | Status | Evidence |
|---|---|---|
| Server derives business scope | COMPLETE | `resolveAuthorizedGroupReportingScope` |
| Client cannot submit arbitrary business-ID list | COMPLETE | KPI/report/closing services accept group/filter context and re-authorize |
| Manager selected-store enforcement | COMPLETE | `BusinessGroupUserBusinessAccess` scope |
| Group owner/manager capability split | COMPLETE | `src/lib/business-groups/capabilities.ts` |
| Tenant-isolation tests | COMPLETE | `tests/integration/tenant-isolation.test.ts` |
| Live membership integration tests | COMPLETE | `tests/integration/all-stores-access.test.ts`; `tests/integration/group-reports.test.ts` |

## 8.2 Risks before adding AI

| Risk | Severity | Status | Mitigation |
|---|---|---|---|
| AI tool accepts free-form SQL or client business IDs | Critical if introduced | MISSING control | AI must call allow-listed, versioned metric endpoints; scope must come from authenticated server context. |
| PII leakage across stores/groups | High | PARTIAL | Group customer identity needs explicit legal/business policy, field-level access, masking, audit logs, and deletion propagation. |
| Manager infers unauthorized store values from group totals/comparisons | High | PARTIAL | Always compute totals only from authorized businesses; add negative tests for totals, exports, caching, and AI responses. |
| Cache key omits user/scope/grant version | High | MISSING control | Key cache by group, authorized business-set hash, role/capability version, filters, metric version, and data watermark. |
| Export size and sensitive detail | Medium | PARTIAL | 5,000-row cap exists; add export permissions, audit logging, expiration, and PII minimization. |
| Historical access after store removal | High | PARTIAL | Define policy: former members should not remain queryable merely because historical analytics facts exist. Apply current authorization on top of event-time attribution. |
| Prompt injection through customer/item/note text | High | NOT APPLICABLE today | Before AI, treat all database text as untrusted data, not instructions; separate structured values from model instructions. |
| AI answer without freshness/definition disclosure | High | MISSING | Return metric version, timezone/cutoff, filters, updated-at, completeness, and caveats with every response. |
| Auditability of AI access | High | MISSING | Log user, group, authorized store set, question/tool, metric IDs, time range, result hash, and export action. Do not log secrets or unnecessary PII. |

No current evidence was found that the Group reporting code leaks data across groups. The main concern is preserving these controls when caching, analytics tables, exports, and AI tools are added.

# 9. Performance Risks

## 9.1 Current request cost

Approximate logical Prisma calls before ORM relation expansion:

| Page | Calls | Risk |
|---|---:|---|
| Overview | At least ~9 | Context lists are loaded, then reporting scope is resolved again, then three transaction queries run. |
| Group Reports | At least ~11 | Context lists + re-authorization + five report data queries. |
| Group Closing | At least ~7 | Context lists + re-authorization + one snapshot query. |

The duplicate authorization/context reads are correct for security but inefficient. A request-scoped, immutable authorization context can remove duplication without trusting the client.

## 9.2 Scaling limits

| Risk | Severity | Evidence/impact |
|---|---|---|
| Node.js in-memory aggregation | High | Group KPI/Reports load matching invoices, items, payments, and refunds, then aggregate in application memory. |
| Summary invoices include all matching items | High | `getGroupReports` loads complete summary invoice sets for up to 31 days. High-volume groups can exhaust memory or time out. |
| Large authorized-store `OR` predicates | Medium/High | One range per store is generated to preserve local timezone/cutoff. Hundreds/thousands of stores make SQL large. |
| No cache/pre-aggregation | High | Every page request recomputes historical totals from transactional tables. |
| No monthly/yearly path | High | 31-day safety cap prevents owner questions across quarters/years. Removing the cap without architecture changes would be unsafe. |
| Catalog grouping by normalized name in Node | Medium | Memory grows with line count and semantic collisions remain. |
| Relation-fetch query expansion | Medium | Prisma can issue additional SQL for nested relations depending on strategy/version. Validate with query logging. |
| Single-business dashboard query fan-out | Medium | Auto-detailing dashboard runs many concurrent raw aggregates; salon report uses eight parallel queries plus a staff lookup. |

## 9.3 Expected scale

- **Up to ~10 stores, low volume:** current approach is likely usable within the 31-day cap.
- **~100 stores or high transaction volume:** pre-aggregation, composite indexes, query-plan testing, and caching become necessary.
- **1,000–10,000 stores:** current per-store range predicates and Node aggregation are not viable. Use normalized business-date facts, partitioned daily aggregates, asynchronous refresh, and bounded drill-down APIs.

## 9.4 Performance test gaps

`MISSING`:

- Production-shaped seed with 100/1,000 stores and millions of lines.
- p50/p95/p99 latency and memory budgets.
- Query-count assertion at the actual SQL level.
- `EXPLAIN ANALYZE` baselines for date/store/status filters.
- Concurrent load and cache-isolation tests.
- Export stress/timeout tests.
- Analytics refresh backfill and late-arriving-event tests.

# 10. Recommended Analytics Architecture

## 10.1 Principles

1. Transactional tables remain the source of truth.
2. Define metrics once in a versioned metric registry.
3. Convert every event to both UTC event time and canonical local `business_date` using the event-time store timezone/cutoff.
4. Preserve event-time group membership while still applying current user authorization at query time.
5. Store money as integer cents and quantities with explicit precision.
6. Make refreshes idempotent and able to recompute a date/store partition.
7. Return freshness, lineage, completeness, and metric version with every API result.
8. AI receives only allow-listed structured metrics, never direct unrestricted SQL.

## 10.2 Recommended fact and dimension layer

| Table | Purpose / key fields | Source | Refresh/recompute |
|---|---|---|---|
| `analytics_group_membership_history` | PK id; `group_id`, `business_id`, `valid_from`, `valid_to`, status, actor/reason | Business group member changes/audit | Synchronous append on membership change; immutable corrections |
| `analytics_metric_definition` | PK `metric_key`, `version`; name, formula, event-date policy, inclusion/exclusion, unit | Code/config governance | Migration/release controlled |
| `analytics_sales_line_fact` | PK source invoice-item/version; group/store/branch/customer/catalog/staff keys, business date, gross/discount/tax/tip/net/package voucher, cost snapshots | Invoice + item + payment allocation | Incremental; recompute store/date on invoice/refund change |
| `analytics_payment_event_fact` | PK payment event; group/store/branch/invoice, method/status, paid business date, amount | Payment | Near-real-time incremental |
| `analytics_refund_event_fact` | PK refund; group/store/branch/invoice/source line/reason/staff, refund business date, amount | Refund/credit note | Near-real-time; allocate lines deterministically |
| `analytics_appointment_event_fact` | PK appointment event; group/store/branch/customer/staff/service, event type/time/business date/source/reason | Appointment lifecycle | Append events; rebuild appointment partition if corrected |
| `analytics_work_order_event_fact` | PK status event; group/store/branch/work order/resource/staff/status/time | Work order lifecycle | Append events |
| `analytics_package_event_fact` | Purchase/redemption/refund/expiry event; customer/package/service, uses/value/liability | Customer package + redemption ledger | Incremental; recompute affected package |
| `analytics_inventory_movement_fact` | Product/branch movement, reason, qty, unit cost, source, event date | New stock movement ledger | Append-only; corrections as reversing entries |
| `analytics_campaign_event_fact` | Campaign/channel/audience/send/read/click/booking/sale/spend attribution | WhatsApp + campaign source | Incremental with attribution-window recompute |
| `analytics_customer_group_map` | Group customer key to store customer; match method/confidence/consent | Customer identity service | Controlled incremental matching with manual override |

## 10.3 Recommended daily tables

| Table and grain | Essential fields | Update strategy |
|---|---|---|
| `analytics_store_daily` — one row per group/store/branch/business date/metric version | gross/net sales, collections, refunds, outstanding, discounts, tax, tips, invoice counts/statuses, ATV, package sales/redemptions, source watermark, completeness | Upsert affected date after transactional changes; nightly reconcile last 7–14 days |
| `analytics_store_payment_method_daily` — store/date/method | gross collected, refunded, net collected, transaction count | Incremental plus nightly reconciliation |
| `analytics_catalog_daily` — store/date/catalog type/group catalog key/local item key | quantity, gross/net, discount, refund, cost, margin, unique customers | Recompute store/date on invoice/refund/catalog-map changes |
| `analytics_customer_daily` — group customer/store/date | visits, invoices, revenue, refunds, package events, first/last flags | Incremental; identity merges trigger affected-history rebuild |
| `analytics_appointment_daily` — store/branch/date/status/source/service/staff | booked, arrived, completed, cancelled, no-show, converted, lead/wait/service minutes | Event-driven plus daily finalization |
| `analytics_staff_daily` — store/branch/date/staff | attributed sales, services, appointments, work minutes, attendance, commission, labor cost, margin | Recompute from allocations/events |
| `analytics_inventory_daily` — branch/date/product | opening, received, sold/used, adjusted, wasted, closing, average cost, stockout minutes | Ledger fold; nightly balance validation |
| `analytics_package_daily` — store/date/package | sold, redeemed, refunded, expired, active uses/value liability | Event fold with expiry job |
| `analytics_closing_daily` — required branch/date | expected status, closed status/time, cash expected/actual/difference, snapshot version, reconciliation delta | Generate expected rows per active branch; update on closing |
| `analytics_data_quality_daily` — source/store/date/check | row count, missing keys, late events, reconciliation deltas, severity | Run after each refresh |

Recommended primary key pattern: `(group_id, business_id, branch_id or sentinel, business_date, remaining dimensions, metric_version)`. Partition large fact/daily tables by business month or hash/group after real volume testing.

## 10.4 Recommended monthly tables

| Table and grain | Purpose |
|---|---|
| `analytics_store_monthly` — group/store/month | Monthly sales, collections, refunds, profit, customers, appointments, operations, targets, YoY/MoM and completeness |
| `analytics_customer_cohort_monthly` — group/cohort month/activity month | New/retained/reactivated/churned customers, revenue and visit retention |
| `analytics_catalog_monthly` — group/store/catalog/month | Service/product/package trend, margin, mix, refund rate |
| `analytics_staff_monthly` — group/store/staff/month | Productivity, sales, labor/commission cost, attendance and margin |
| `analytics_campaign_monthly` — group/campaign/channel/month | Spend, sends, engagement, bookings, revenue, CAC, ROAS |
| `analytics_inventory_monthly` — group/store/product/month | Turnover, days on hand, stockout, shrinkage, wastage, cost movement |

Monthly tables should be built from validated daily/fact tables, not directly from UI queries. They need a close/final status plus a late-adjustment revision number.

## 10.5 Read API for dashboard and future AI

Recommended endpoint/tool shape:

```text
get_group_metric({
  metricKeys,
  groupId,
  dateRange,
  grain,
  dimensions,
  filters,
  comparison
}) -> {
  scope,
  metricVersion,
  timezonePolicy,
  dataFreshness,
  completeness,
  values,
  comparison,
  caveats,
  lineage
}
```

The server must ignore or reject unauthorized store filters, cap result cardinality, validate allowed metric/dimension combinations, and attach a query/audit ID. Drill-down should be a separate paginated endpoint with stricter permissions.

# 11. Recommended Dashboard Sections

| Priority | Section | Content |
|---:|---|---|
| 1 | Executive pulse | Net/gross sales, collections, refunds, outstanding, transactions, ATV, prior period, freshness/confidence |
| 2 | Store performance matrix | Sales, growth, profit, customers, appointments, closing completion; sortable with thresholds |
| 3 | Trend and seasonality | Daily/weekly/monthly trend, store contribution, payment mix, YoY/MoM |
| 4 | Profitability | Gross profit/margin, COGS, labor, expenses, service/product/package margin |
| 5 | Customers | Group unique customers, new/returning, frequency, retention cohorts, churn/win-back, LTV |
| 6 | Appointments and funnel | Booked → arrived → completed → paid; no-show/cancel/reschedule, lead/wait time, source |
| 7 | Services/products/packages | Revenue, quantity, margin, mix, refunds, trends, package liability/redemption |
| 8 | Team | Sales attribution, appointments, productivity, attendance, utilization, commission/labor margin |
| 9 | Inventory | Stock health, days on hand, stockouts, reorder risk, adjustments, wastage, turnover |
| 10 | Marketing | Campaign spend, WhatsApp funnel, attributed bookings/revenue, CAC/ROAS |
| 11 | Closing and controls | Required vs completed closings, cash variance, reconciliation to analytics totals, anomalies |
| 12 | Data confidence | Freshness, missing fields, late events, metric version, failed checks, store coverage |
| 13 | “Ask the business” | Only after phases 1–4: suggested allow-listed questions, cited metrics, caveats, drill-down links |

Every section should support the same global dimensions: event-time group, authorized store/branch, industry, business date, comparison period, and metric version. Industry-specific metrics should be clearly labeled and excluded rather than treated as zero when not applicable.

# 12. Development Roadmap

## Phase 1 — Metric correctness and audit foundations

**Goal:** Make existing financial numbers consistent and historically defensible before adding more UI.

- **Scope:** Canonical business-day service, canonical metric contract, Daily Closing reconciliation, effective-dated group membership, data-quality checks.
- **Database:** Add membership validity history and analytics refresh/metric-version metadata. Extend closing snapshot metadata with actual timezone/cutoff/definition version.
- **Backend:** Consolidate gross/net/collection/refund/outstanding formulas; remove hard-coded closing range; expose reconciliation service.
- **Frontend:** Show metric definitions, date boundary, freshness, and closing/dashboard reconciliation warning.
- **Testing:** Cross-module same-input equality; midnight/cutoff/DST; membership move history; refund/void/partial/package voucher; currency rounding.
- **Risk:** Existing totals may visibly change after correction; communicate/version the change and backfill snapshots carefully.
- **Complexity:** **Medium–High**

## Phase 2 — Analytics fact and daily aggregate foundation

**Goal:** Replace repeated raw in-memory aggregation with versioned, recomputable facts/daily summaries.

- **Scope:** Sales/payment/refund facts, store daily and payment-method daily tables, refresh job, watermark, lineage, partition recompute.
- **Database:** Add fact/daily tables and composite indexes proven by query plans.
- **Backend:** Idempotent incremental processor; late-event reconciliation; authorized read API.
- **Frontend:** Switch existing Overview/Reports to the read API without changing visible semantics.
- **Testing:** Backfill parity with canonical transactional calculations; retry/idempotency; late refunds; deleted/voided events; performance at 100/1,000 stores.
- **Risk:** Dual-read drift during migration. Use shadow comparison and explicit cutover criteria.
- **Complexity:** **High**

## Phase 3 — Complete core Group BI

**Goal:** Deliver long-range, owner-grade reporting using the analytics layer.

- **Scope:** Monthly/yearly trends, store scorecard, payment mix, tax/tips/discount/outstanding aging, required-closing completion, stable catalog mapping.
- **Database:** Monthly aggregates, group catalog mapping, receivable aging snapshot, expected closing rows.
- **Backend:** Long-range query API, comparison/benchmark service, exports based on aggregate + paginated drill-down.
- **Frontend:** Recommended sections 1–3, 7, 11, and 12; reusable global filters.
- **Testing:** 12–24 month backfill, MoM/YoY, zero-activity stores, store join/leave, authorization/cache isolation, export parity.
- **Risk:** Catalog mapping ambiguity; require manual override and mapping confidence.
- **Complexity:** **Medium–High**

## Phase 4 — Capture missing business dimensions

**Goal:** Make profit, customer, staff, appointment, inventory, package, and marketing questions answerable.

- **Scope:** Group customer identity; line-level staff/cost; expenses/payroll/commission; appointment/work-order events; inventory ledger; package expiry/redemption; campaigns/attribution.
- **Database:** New operational ledgers and corresponding daily/monthly analytics tables.
- **Backend:** Identity resolution with consent, cost allocation, attribution rules, inventory balance checks, cohort/retention features.
- **Frontend:** Recommended sections 4–10 with data-completeness indicators.
- **Testing:** PII isolation/merge/unmerge/deletion; accounting reconciliation; inventory conservation; commission versioning; attribution-window tests.
- **Risk:** Highest domain and privacy risk. Roll out one domain at a time and do not fabricate metrics for stores that have not adopted the new capture flow.
- **Complexity:** **Very High**

## Phase 5 — AI-ready semantic and answer layer

**Goal:** Add controlled natural-language analysis only after trusted metrics exist.

- **Scope:** Allow-listed question intents, metric/dimension registry, structured tool calls, answer citations, caveats, audit logs, evaluation suite.
- **Database:** AI query audit and evaluation result tables; no direct LLM access to transactional credentials.
- **Backend:** Policy-enforced metric tools, cardinality limits, privacy redaction, prompt-injection-safe structured inputs, deterministic calculation path.
- **Frontend:** “Ask the business” panel with suggested questions, filters, metric citations, freshness, confidence, and drill-down.
- **Testing:** 25-question golden set from section 6, authorization adversarial tests, prompt injection, numerical exactness, stale/incomplete data, multilingual answers, hallucination refusal.
- **Risk:** AI can amplify inconsistencies or disclose scoped data. Do not start this phase until phases 1–3 pass parity/security gates and required Phase 4 domains are marked complete.
- **Complexity:** **High**

**Recommended first phase:** Phase 1. Fixing metric/time consistency and historical attribution gives the highest correctness return and prevents later analytics/AI work from encoding the wrong numbers.

# 13. Exact File References

## 13.1 Group pages and navigation

- `src/app/(group)/groups/[groupId]/overview/page.tsx`
- `src/app/(group)/groups/[groupId]/overview/loading.tsx`
- `src/app/(group)/groups/[groupId]/reports/page.tsx`
- `src/app/(group)/groups/[groupId]/closing/page.tsx`
- `src/lib/business-groups/navigation.ts` — `getBusinessGroupNavItems`
- `src/components/business-context-switcher.tsx`

## 13.2 Authorization and business context

- `src/lib/business-groups/all-stores-access.ts` — `getAvailableGroupReportingContexts`, `resolveAuthorizedGroupReportingScope`
- `src/lib/business-groups/capabilities.ts` — `canGroupManager`, `canGroupOwner`
- `src/lib/business-groups/business-context.ts` — `getAvailableBusinessContexts`, `authorizeBusinessContextTarget`, `getRecoveryBusinessContext`, `commitBusinessContextSwitch`
- `src/lib/auth/login-destination.ts` — `getLoginDestination`
- `src/app/login/actions.ts` — `loginAction`
- `src/app/business-context/recover/route.ts`
- `src/lib/tenant.ts`

## 13.3 Group reporting calculations and exports

- `src/lib/business-groups/all-stores-kpi.ts` — `getAllStoresKpiReport`, `calculateAllStoresKpis`, `compareKpiValues`, `validateCustomRange`, `buildBusinessPeriods`, `getCurrentBusinessDateValue`, `sumKpis`
- `src/lib/business-groups/group-reports.ts` — `GROUP_REPORT_PAGE_SIZE`, `GROUP_REPORT_EXPORT_LIMIT`, `getGroupReports`, `getGroupReportExportData`, `buildGroupReportTrend`, `buildGroupCatalogRankings`, `parseGroupReportFilters`
- `src/lib/business-groups/group-report-export.ts`
- `src/lib/business-groups/group-closing-report.ts` — `getGroupClosingReport`, `summarizeGroupClosings`
- `src/lib/business-day.ts`
- `src/lib/money.ts`

## 13.4 Daily Closing and single-store comparison

- `src/lib/daily-closing/range.ts` — hard-coded `DAILY_CLOSING_TIME_ZONE` and midnight range
- `src/lib/daily-closing/query.ts`
- `src/lib/daily-closing/calculator.ts`
- `src/lib/daily-closing/snapshot.ts` — `DAILY_CLOSING_REPORT_VERSION`, `buildDailyClosingSnapshotPayload`
- `src/app/(business)/closing/page.tsx`
- `src/app/(business)/dashboard/page.tsx` — server-local `startOfDay`
- `src/app/(business)/salon/dashboard/page.tsx` — server-local midnight
- `src/app/(business)/reports/page.tsx` — auto-detailing and salon report calculations
- `src/lib/business-time.ts` — legacy fixed business timezone helpers

## 13.5 Database schema and migration

- `prisma/schema.prisma`
  - `Business`, `Branch`
  - `BusinessGroup`, `BusinessGroupMember`, `BusinessGroupUser`, `BusinessGroupUserBusinessAccess`
  - `Customer`, `CustomerMembership`, `LoyaltyTransaction`
  - `Service`, `Product`, `ProductStock`, `Package`, `CustomerPackage`, `CustomerPackageServiceBalance`
  - `WorkOrder`, `WorkOrderItem`, `Appointment`
  - `Invoice`, `InvoiceItem`, `Payment`, `PaymentRefund`, `CreditNote`, `CreditNoteItem`
  - `EmployeeAttendance`, `Shift`, `DailyClosingSnapshot`
  - WhatsApp message/chat/conversation models
- `prisma/migrations/20260727100000_add_business_groups/migration.sql`
  - Partial unique index `business_group_members_one_active_business_key`
  - Active group-user uniqueness and selected-business access constraints

## 13.6 Automated tests

- `tests/unit/all-stores-access.test.ts`
- `tests/integration/all-stores-access.test.ts`
- `tests/unit/all-stores-kpi.test.ts`
- `tests/unit/group-reports.test.ts`
- `tests/integration/group-reports.test.ts`
- `tests/unit/group-closing-report.test.ts`
- `tests/integration/tenant-isolation.test.ts`
- `tests/integration/business-context-isolation.test.ts`
- `tests/integration/business-context-switch.test.ts`

## 13.7 Final readiness classification

| Area | Final status |
|---|---|
| Group authorization foundation | COMPLETE |
| Current 31-day sales/reporting UI | COMPLETE |
| Daily Closing code path | PARTIAL |
| Canonical financial semantics | PARTIAL |
| Long-range/scalable analytics | MISSING |
| Profitability | MISSING |
| Group customer intelligence | MISSING |
| Operational/staff/inventory analytics | PARTIAL |
| Marketing attribution | MISSING |
| AI semantic/API layer | MISSING |
| Representative local validation data | BLOCKED |

**Final classification:** **Early Group BI, 31% AI-ready.** Proceed with Phase 1 metric correctness and audit foundations before adding more dashboard modules or any AI interface.
