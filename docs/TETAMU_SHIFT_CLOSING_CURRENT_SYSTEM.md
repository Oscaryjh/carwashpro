# TETAMU POS — Shift Closing Current System Dossier

> Evidence-based current-state document for product review, UX review, engineering handover, and ChatGPT analysis.
>
> Audit date: 28 Aug 2026  
> Scope: current workspace only  
> Code changed: no business logic changed  
> Business data changed: no  
> Production accessed: no

---

## 1. Executive summary

Tetamu's closing domain has two related but different layers:

1. **Shift Closing** — a cashier opens and closes their own cash drawer shift.
2. **Daily Closing** — a branch-level, business-date-level frozen financial snapshot.

The main flow is:

```text
Cashier starts shift
→ POS transactions are linked to that shift
→ Cash payments / cash refunds / drawer expense payouts accumulate
→ Cashier counts physical cash
→ Cashier ends shift
→ If it is the branch's final open shift, Tetamu creates Daily Closing automatically
→ Daily Closing freezes the report and WhatsApp summary
→ History and Group Closing read the frozen snapshot
```

The system also provides a separate explicit **Confirm Daily Closing** action when no automatic final-shift snapshot exists.

Shift Closing is not Payroll, a bank reconciliation, or a general accounting period close. It is the POS cash-drawer and branch daily-sales closing workflow.

---

## 2. User-facing routes

| Route | Purpose | Write capability |
|---|---|---|
| `/closing` | Start/end shifts, view shift totals, confirm or view Daily Closing | Yes |
| `/closing/history` | Search and inspect frozen Daily Closing records | No, except WhatsApp retry/resend from related UI |
| `/cashier` | POS transactions; requires an open shift | Creates shift-linked payments |
| `/groups/{groupId}/closing` | Group-level closing records and missing-closing audit | Read-only |
| `/groups/{groupId}/closing/export` | Export filtered closing/audit data as CSV, XLSX, or PDF | Read-only |

There is no standalone public REST/JSON Closing API. The business UI uses authenticated Next.js Server Actions.

---

## 3. Access and module boundaries

Closing is available through all of these gates:

```text
POS module enabled
AND business capability RUN_CLOSING
AND staff permission CLOSING
AND authorised business/branch scope
```

Current permission definition:

```text
CLOSING
Label: Shift Closing
Description: Start/end cashier shifts and view shift totals.
```

Navigation only renders **Shift Closing** for store users who:

- have the POS module;
- are not using the group-manager store shell;
- can see `CLOSING`.

`RUN_CLOSING` maps to the `CLOSING` staff permission. Server Actions repeat the authorization checks; hiding the menu is not the security boundary.

Daily Closing is currently supported only for:

- `SALON_BEAUTY`
- `AUTO_DETAILING`

---

## 4. Core data models

### 4.1 `CashierShift`

One cashier drawer session.

Important fields:

| Field | Meaning |
|---|---|
| `businessId` | Owning business |
| `branchId` | Operational branch; nullable at schema level |
| `cashierId` | User who owns the shift |
| `status` | `OPEN` or `CLOSED` |
| `openingFloat` | Cash placed in drawer at start |
| `closingCash` | Physical cash counted at close |
| `expectedCash` | System-calculated expected physical drawer cash |
| `cashDifference` | Counted cash minus expected cash |
| `startedAt` / `endedAt` | Shift time range |
| `notes` | Closing explanation, required when the shift differs |

Relations:

- `Payment[]`
- `PaymentRefund[]`
- `CashierShiftExpensePayout[]`

### 4.2 `CashierShiftExpensePayout`

Represents a POS-drawer cash expense paid during a shift.

It links:

```text
Business Expense Payment Event
→ Branch
→ Cashier Shift
→ Creator
```

`paymentEventId` is unique, preventing one expense payout from reducing drawer cash twice.

### 4.3 `DailyClosingSnapshot`

The branch's immutable closing record for one business date.

Important fields:

| Field | Meaning |
|---|---|
| `businessDate` | Store business date, not necessarily midnight-to-midnight |
| `timezone` | Timezone frozen at closing |
| `businessType` | Industry frozen at closing |
| `status` | Currently only `CLOSED` |
| `closedAt` / `closedByUserId` | Closing identity and time |
| `expectedCashCents` | Expected net cash movement |
| `actualCashCents` | Confirmed actual net cash movement |
| `cashDifferenceCents` | Actual minus expected |
| `closingNote` | Optional branch-level note |
| `reportDataJson` | Frozen versioned full report payload |
| `whatsappText` | Frozen WhatsApp message |
| `reportVersion` | Snapshot schema version |

Uniqueness rule:

```text
one DailyClosingSnapshot per business + branch + business date
```

This is the database-level idempotency boundary for Daily Closing.

### 4.4 WhatsApp closing models

- `ClosingWhatsAppSetting`
- `ClosingWhatsAppBranchSetting`
- `ClosingWhatsAppRecipient`
- `ClosingWhatsAppSendAttempt`

They configure automatic reports, unclosed reminders, recipients, branch overrides, send attempts, dedupe keys, retry/resend reasons, and delivery status.

---

## 5. State model

### 5.1 Shift states

```text
No shift
  └─ Start Shift → OPEN

OPEN
  ├─ POS payment/refund/expense activity
  └─ End Shift → CLOSED

CLOSED
  └─ Immutable operational record; no reopen workflow exists
```

### 5.2 Daily Closing states

```text
No snapshot
  ├─ Final branch shift closes → CLOSED snapshot created automatically
  └─ Authorised user confirms Daily Closing → CLOSED snapshot created manually

CLOSED snapshot
  ├─ Read from History / Group Closing
  ├─ WhatsApp delivery can retry/resend
  └─ Financial snapshot itself cannot edit, reopen, or recalculate
```

There is no Draft Daily Closing record and no Reopen Daily Closing state.

---

## 6. Start Shift workflow

Server Action: `startShiftAction`

Input:

- authorised branch;
- opening float, minimum RM0.00;
- safe return path, restricted to `/cashier`.

Canonical behavior:

1. Requires `RUN_CLOSING`.
2. Resolves an authorised operational branch.
3. Calculates the branch business date using the business timezone and cutoff.
4. Blocks start if that branch/business date already has a `DailyClosingSnapshot`.
5. Blocks if the same cashier already has an open shift.
6. Creates an `OPEN` `CashierShift` in a transaction.
7. Normalises the opening float to two-decimal currency precision.
8. Writes audit event `SHIFT_STARTED`.
9. Revalidates `/closing` and redirects with a success result.

The POS sale action looks up the current cashier's open shift and stores `shiftId` on payment records. This is how Shift Closing receives its transaction scope.

---

## 7. Activity captured inside a shift

The closing calculation reads shift-linked activity, not an editable summary entered by the cashier.

Included:

- active cash payments;
- active cash refunds;
- POS-drawer cash expense payouts;
- non-cash payment totals for display;
- package usage/restoration for operational reporting.

Important distinctions:

- `PACKAGE` is not treated as a cash/payment-method collection.
- Restored package usage is not a monetary refund.
- Tips are shown in the report contract but do not become gross or net sales.
- Products do not enter the Top Services ranking.

---

## 8. End Shift workflow

Server Action: `endShiftAction`

Input:

- shift ID;
- physical closing cash count;
- optional note, conditionally required.

Security and integrity checks:

1. Requires `RUN_CLOSING` and `CLOSING`.
2. Cashier may only close their own `OPEN` shift.
3. Shift must belong to the active business.
4. Counted cash must be a valid non-negative currency amount.
5. Processing occurs in a serializable transaction.
6. Atomic `updateMany` changes `OPEN` to `CLOSED`, preventing double-close races.

### 8.1 Shift cash formula

```text
Expected drawer cash
= Opening float
+ Active CASH payments
- Active CASH refunds
- POS drawer cash expense payouts
```

```text
Cash difference
= Counted closing cash
- Expected drawer cash
```

Example:

```text
Opening float                 RM100.00
Cash payments                 RM500.00
Cash refunds                   RM20.00
Drawer cash expense payout     RM30.00
------------------------------------------------
Expected drawer cash           RM550.00

Counted drawer cash            RM545.00
Difference                     -RM5.00 (short)
```

If difference is not zero, a closing note is mandatory. The action rejects a short/over shift without an explanation.

On success it stores:

- `closingCash`
- `expectedCash`
- `cashDifference`
- `notes`
- `endedAt`
- status `CLOSED`

It also writes audit event `SHIFT_ENDED`.

---

## 9. Final-shift automatic Daily Closing

After a shift closes, Tetamu checks the branch:

### Another branch shift remains open

```text
Current shift → CLOSED
Daily Closing → waits
```

### No branch shift remains open

```text
Current shift → CLOSED
Final shift detected
→ create frozen DailyClosingSnapshot if none exists
```

The business date is derived from the shift start using the store timezone and business-day cutoff.

For the automatic path, actual branch cash movement is derived from closed shifts:

```text
Actual daily net cash movement
= sum(shift closing cash - shift opening float)
```

Opening floats are therefore reconciled at shift level but excluded from branch daily cash movement.

If a snapshot already exists, the action does not create a second snapshot.

---

## 10. Manual Confirm Daily Closing workflow

Server Action: `closeDailySnapshotAction`

This is the explicit branch-level close available when no frozen snapshot exists.

Input rules:

- valid authorised branch UUID;
- valid non-future business date;
- actual cash is finite, non-negative, maximum RM21,474,836.47;
- at most two decimal places;
- note maximum 1,000 characters;
- generated operation ID for idempotency.

Workflow:

1. Requires `RUN_CLOSING` and `CLOSING`.
2. Confirms the industry supports Daily Closing.
3. Resolves authorised branch scope.
4. Rejects future business dates.
5. Runs the canonical financial operation `DAILY_CLOSING`.
6. Creates the frozen report and WhatsApp content in one transaction.
7. Writes audit event `DAILY_CLOSING_CONFIRMED`.
8. Queues the closing WhatsApp report when automation is enabled.

Unlike Shift Closing, the manual Daily Closing form currently does not require a note merely because actual and expected cash differ; the note is optional.

The confirmation UI tells the user that the snapshot cannot be edited, reopened, or recalculated.

---

## 11. Daily cash reconciliation

At branch Daily Closing level:

```text
Expected cash
= Net CASH collections
- POS drawer cash expense payouts
```

```text
Daily cash difference
= Actual net cash movement
- Expected cash
```

This differs deliberately from shift expected cash:

- Shift expected cash includes opening float because it reconciles physical drawer cash.
- Daily expected cash excludes opening float because it reconciles business-day cash movement.

---

## 12. Business-date range

Reports do not assume a fixed calendar day.

The query uses:

- business timezone;
- configured business-day cutoff time;
- inclusive start boundary;
- exclusive next-cutoff boundary.

Conceptually:

```text
[business date at cutoff, next business date at cutoff)
```

New v2 snapshots freeze:

- timezone;
- business-day cutoff;
- business-day definition version;
- financial metric definition version.

Legacy v1 payloads remain readable with a `00:00` cutoff compatibility value.

---

## 13. Daily report sources

`getDailyClosingReport` queries the selected business, branch, and business-day range.

### Financial sources

- non-void invoices issued in range;
- active payments by `paidAt`;
- active monetary refunds by `refundedAt`;
- drawer cash expense payouts by `occurredAt`.

### Salon operational sources

- completed appointments by `completedAt`;
- cancelled appointments by `cancelledAt`.

### Auto operational sources

- completed work orders by `pickedUpAt`;
- cancelled work orders currently use `createdAt` because the model has no cancellation timestamp.

### Package sources

- customer packages purchased in range;
- active/used-up packages;
- non-void invoice backing;
- package uses and restored uses.

### Shift sources

- shifts started or ended in range;
- currently open shifts relevant to the day.

---

## 14. Daily report metrics

Financial values use the canonical versioned `calculateFinancialMetrics` contract.

### Financial summary

- Gross sales
- Discounts, including loyalty discount
- Net sales
- Gross collections
- Refunds
- Net collections
- Outstanding balances
- Tips
- Package voucher value

### Payment breakdown

Each real payment method is reported separately:

- Cash
- Card
- DuitNow
- E-wallet
- Bank transfer
- Foreign currency
- Crypto

For each method:

```text
gross collections
refunds
net collections
```

### Invoice status counts

- Paid
- Partial
- Refunded
- Unpaid
- Total

### Operational summary

- Completed operations
- Cancelled operations
- Distinct customers served
- New vs returning customers
- Distinct vehicles served for Auto
- Average net sales per completed operation
- Top three services by sales
- Packages sold and value
- Net package redemptions

### Deterministic alerts

- unpaid or partial invoices;
- refund activity;
- shift cash differences;
- open shifts;
- no-exception state when nothing requires attention.

---

## 15. Frozen snapshot behavior

The snapshot payload freezes:

- business and branch identity;
- business date, timezone, and cutoff;
- report/schema version identifiers;
- financial and operational report;
- expected, actual, and difference cash values;
- closing user, time, and note;
- final WhatsApp text.

After closing, `/closing` and `/closing/history` read this frozen payload. They do not silently recompute historical values from live invoices or payments.

If the stored payload version is unsupported or invalid, the UI identifies it as an unsupported frozen report instead of replacing it with newly calculated data.

---

## 16. WhatsApp automation

### 16.1 Automatic closing report

When a snapshot is created and automation is enabled:

```text
Snapshot
→ resolve business/branch recipient configuration
→ create WhatsAppMessage in DRAFT
→ create NotificationQueue in QUEUED
→ create ClosingWhatsAppSendAttempt
```

Recipient roles:

- Owner
- Branch Manager
- Finance

Recipient scope:

- Business
- Branch

Branch settings may inherit business recipients or use branch-specific recipients.

### 16.2 Unclosed reminder

The scheduler checks active branches whose closing automation and unclosed reminders are enabled.

At or after the configured deadline:

- if a Daily Closing snapshot exists, nothing is queued;
- if no snapshot exists, one reminder per recipient/business/branch/date is queued.

### 16.3 Delivery controls

Send types:

- `CLOSING_REPORT`
- `UNCLOSED_REMINDER`

Triggers:

- `AUTO_CLOSING`
- `AUTO_REMINDER`
- `MANUAL_RETRY`
- `MANUAL_RESEND`

Queue statuses include:

- Queued
- Sending
- Sent / Sent to server
- Delivered
- Read
- Failed
- Cancelled

Manual retry/resend creates a new deduplicated attempt, records the requesting user, and requires a reason. It does not alter the frozen closing snapshot.

---

## 17. `/closing` page information architecture

The current page contains:

1. **Page header** — Shift Closing and selected business date.
2. **Stale open-shift warning** — previous business-date shifts that remain open.
3. **Start Shift** — branch and opening cash.
4. **Current Shift** — cashier, branch, start time, opening float, net cash sales, drawer expenses, net cash movement, expected cash, counted cash, note, End Shift.
5. **Current Shift Totals** — gross collected, refunds, net collected, cash movement, drawer expenses, package uses.
6. **Daily Closing summary** — financial, payments, operational metrics, alerts, and WhatsApp preview.
7. **Daily Closing snapshot panel** — confirm immutable close or view frozen result.
8. **Shifts table** — up to 10 rows per page.
9. **Activity table** — payments, refunds, and drawer expenses; up to 10 rows per page.

Owner visibility covers authorised branches. Non-owner staff primarily see their own shifts and must remain within authorised branch scope.

---

## 18. History and group reporting

### 18.1 Branch history

`/closing/history` supports:

- branch filter;
- from/to business-date filter;
- 10 records per page;
- expected cash;
- actual cash;
- difference;
- WhatsApp aggregate status;
- closed by / closed at;
- report version;
- link back to the frozen record.

### 18.2 Group Closing

Group Closing consumes `DailyClosingSnapshot`; it does not rebuild local closings.

It provides:

- authorised-store-only reporting;
- required/completed/missing closing audit;
- snapshot and definition-version checks;
- frozen financial and cash summaries;
- branch/business/date filters;
- CSV, XLSX, and PDF export;
- formula-injection protection for CSV;
- export limit of 5,000 rows;
- report safety limit of 10,000 rows.

This makes the branch snapshot the source of truth for cross-store closing coverage.

---

## 19. Audit, idempotency, and concurrency controls

### Audit events

- `SHIFT_STARTED`
- `SHIFT_ENDED`
- `DAILY_CLOSING_CONFIRMED`
- WhatsApp manual retry/resend audit context

### Idempotency controls

- one open shift per cashier is enforced in application flow;
- end shift uses an atomic status transition;
- Daily Closing uses a financial operation ID;
- snapshot uniqueness prevents duplicate branch/date close;
- WhatsApp queue uses stable dedupe keys;
- expense payout unique keys prevent double drawer deductions.

### Transaction controls

- shift close uses serializable processing;
- calculation and shift status update occur together;
- snapshot report, frozen payload, audit, and queue request are transactionally coordinated where applicable.

---

## 20. Main user-facing blocker/error cases

The system blocks or reports:

- user lacks Closing permission;
- branch is outside authorised scope;
- unsupported business industry;
- opening float is invalid;
- cashier already has an open shift;
- business date is already closed;
- shift is not open or does not belong to the cashier;
- closing cash is invalid;
- cash is short/over without a note;
- daily close targets a future date;
- Daily Closing actual cash is invalid or exceeds supported integer-cent range;
- duplicate Daily Closing request;
- frozen report version is unsupported;
- WhatsApp content, recipient, branch, or send record is missing;
- WhatsApp retry/resend was already queued.

Failed Server Actions return user-facing messages and do not partially save the closing operation.

---

## 21. Current limitations and important product boundaries

These are current-state observations, not implementation instructions.

1. **No shift reopen** — a closed `CashierShift` has no canonical reopen/revision workflow.
2. **No Daily Closing reopen** — a branch snapshot is explicitly immutable.
3. **Only two supported industries** — Salon & Beauty and Auto Detailing.
4. **Manual branch cash-difference note is optional** — unlike shift close, branch Daily Closing does not force an explanation when cash differs.
5. **Auto cancellation timing limitation** — cancelled work orders use creation time because there is no cancellation timestamp.
6. **Schema allows a branchless shift** — branch-level automatic Daily Closing requires a branch and skips that layer when absent.
7. **No direct Accounting/Payroll close** — closing does not post a general ledger journal, run Payroll, pay staff, settle a bank account, or submit statutory records.
8. **Historical values are intentionally frozen** — later invoice corrections do not rewrite an already closed snapshot.
9. **WhatsApp delivery is asynchronous** — queue acceptance is not proof of handset delivery; status tracking remains separate.
10. **Some UI copy may imply midnight boundaries** — the actual report engine uses the configured business cutoff, so any fixed `00:00` explanatory copy should not be treated as the calculation rule.

---

## 22. Existing automated test evidence

Focused unit tests were executed on 28 Aug 2026:

```text
Tests: 55
Passed: 55
Failed: 0
```

Covered areas:

- drawer expenses reduce expected cash;
- business timezone and cutoff range boundaries;
- DST-safe range behavior;
- empty-day results;
- sales, discounts, collections, refunds, outstanding balances;
- payment-method breakdown;
- packages, tips, products, and service classification;
- customer/vehicle/operation counts;
- deterministic alerts;
- frozen report and WhatsApp payload;
- snapshot version/metric contract;
- WhatsApp phone normalization, recipient inheritance, branch overrides, and dedupe keys;
- Group Closing required/completed/missing expectations;
- authorised store scope;
- CSV/XLSX/PDF exports and CSV injection protection.

Focused test files:

- `tests/unit/daily-closing.test.ts`
- `tests/unit/closing-whatsapp.test.ts`
- `tests/unit/financial-metrics.test.ts`
- `tests/unit/group-closing-expectations.test.ts`
- `tests/unit/group-closing-report.test.ts`
- `tests/unit/group-closing-navigation.test.ts`
- `tests/unit/group-closing-export.test.ts`

Additional database-backed coverage exists in:

- `tests/integration/group-closing-report.test.ts`

Current focused tests strongly cover report math, frozen snapshots, WhatsApp helpers, and group reporting. The action-level Start Shift / End Shift workflow is not represented by a dedicated test file named for those Server Actions.

---

## 23. Database migrations

Main closing migrations:

- `prisma/migrations/20260708162604_add_cashier_shifts`
- `prisma/migrations/20260723120000_add_daily_closing_snapshots`
- `prisma/migrations/20260724100000_add_closing_whatsapp_automation`

---

## 24. Primary source file inventory

### UI and actions

- `src/app/(business)/closing/page.tsx`
- `src/app/(business)/closing/actions.ts`
- `src/app/(business)/closing/history/page.tsx`
- `src/components/daily-closing-snapshot-panel.tsx`
- `src/components/cashier-unified-sale-form.tsx`
- `src/app/(business)/cashier/actions.ts`

### Daily Closing domain

- `src/lib/daily-closing/types.ts`
- `src/lib/daily-closing/calculator.ts`
- `src/lib/daily-closing/range.ts`
- `src/lib/daily-closing/format.ts`
- `src/lib/daily-closing/query.ts`
- `src/lib/daily-closing/snapshot.ts`
- `src/lib/financial-metrics.ts`

### Drawer expenses

- `src/lib/expense/service.ts`
- `src/lib/expense/drawer-balance.ts`

### WhatsApp

- `src/lib/closing-whatsapp/types.ts`
- `src/lib/closing-whatsapp/templates.ts`
- `src/lib/closing-whatsapp/recipients.ts`
- `src/lib/closing-whatsapp/queue.ts`
- `src/lib/closing-whatsapp/scheduler.ts`
- `src/lib/closing-whatsapp/phone.ts`

### Group Closing

- `src/lib/business-groups/group-closing-expectations.ts`
- `src/lib/business-groups/group-closing-report.ts`
- `src/lib/business-groups/group-closing-export.ts`
- `src/lib/business-groups/group-closing-navigation.ts`
- `src/lib/business-groups/group-data-confidence.ts`

### Authorization and navigation

- `src/lib/auth/staff-permissions.ts`
- `src/lib/business-groups/capabilities.ts`
- `src/lib/modules/registry.ts`
- `src/components/app-shell.tsx`

### Schema

- `prisma/schema.prisma`

---

## 25. Concise end-to-end operational guide

### Cashier opens the day/shift

```text
Shift Closing
→ select branch
→ enter opening cash
→ Start Shift
→ continue to Cashier
```

### Cashier processes business

```text
POS payments, refunds, and drawer cash expenses
→ linked to the open shift
```

### Cashier closes their drawer

```text
Shift Closing
→ review expected cash
→ count physical drawer cash
→ enter counted cash
→ explain any short/over difference
→ End Shift
```

### Branch Daily Closing

```text
If more shifts are open
→ wait for final shift

If this is the final shift
→ Daily Closing snapshot is generated automatically

If no automatic snapshot exists
→ authorised user confirms Daily Closing manually
```

### Review later

```text
Shift Closing History
→ select branch/date
→ open frozen record
→ inspect cash difference, report, closer, and WhatsApp status
```

---

## 26. Current-state verdict

```text
SHIFT OPEN/CLOSE                       IMPLEMENTED
SHIFT-LINKED POS ACTIVITY              IMPLEMENTED
SHIFT EXPECTED CASH                    IMPLEMENTED
CASH SHORT/OVER NOTE GATE              IMPLEMENTED
FINAL-SHIFT AUTO DAILY CLOSE           IMPLEMENTED
MANUAL DAILY CLOSE                     IMPLEMENTED
IMMUTABLE VERSIONED SNAPSHOT           IMPLEMENTED
BUSINESS TIMEZONE/CUTOFF                IMPLEMENTED
DAILY SALES/OPERATIONS REPORT          IMPLEMENTED
WHATSAPP REPORT/REMINDER QUEUE          IMPLEMENTED
HISTORY                                IMPLEMENTED
GROUP CLOSING AUDIT/EXPORT              IMPLEMENTED
SHIFT REOPEN/REVISION                  NOT IMPLEMENTED
DAILY CLOSING REOPEN/REVISION          NOT IMPLEMENTED BY DESIGN
GENERAL LEDGER CLOSE                   OUT OF SCOPE
PAYROLL FINALIZATION                   OUT OF SCOPE
BANK RECONCILIATION                    OUT OF SCOPE
```

The current Shift Closing domain is a real, database-backed, permission-scoped and auditable workflow. Its strongest system boundary is the immutable `DailyClosingSnapshot`. Any future UX or workflow optimization should preserve the distinction between cashier drawer reconciliation and the branch-level frozen business-day report.

