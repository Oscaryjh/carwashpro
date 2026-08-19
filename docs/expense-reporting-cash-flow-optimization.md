# Expense Reporting & Settlement Optimization

## Scope

This Local / Testing phase separates two independent dimensions:

- one-off versus recurring-generated expenses;
- expense recognition versus expense settlement.

No General Ledger, P&L, COGS, tax accounting, bank reconciliation, automatic recurring payment, or Production rollout is introduced.

## Canonical rules

1. Only `CONFIRMED` `BusinessExpense` facts enter Recorded Business Spending.
2. Recognition follows `expenseDate`; draft and void records are excluded.
3. Payment follows immutable payment events and `paymentDate`; it never recognises spending again.
4. Outstanding is derived as confirmed amount less valid applied payments.
5. A recurring template and its generated draft have no report impact until the draft is confirmed.
6. Claims, finalized Payroll, and confirmed Supplier Bills materialize into the same canonical expense layer. Reports do not add their source tables again.
7. Payment method and funding source are separate facts. `CASH` does not imply `POS_DRAWER`.

## Reporting

Expense Overview and Reports expose:

- Net Sales;
- Confirmed Expenses;
- Simple Operating Balance (`Net Sales - Confirmed Expenses`);
- One-off and Recurring Expenses;
- Expense Payments in Period;
- Paid and Outstanding amounts.

Simple Operating Balance is an operational comparison, not accounting profit.

## Partial settlement

`BusinessExpensePaymentEvent` records each payment amount, method, source, date, reference, and actor. `PARTIALLY_PAID` is derived after an applied payment leaves a positive balance. Concurrent overpayment is blocked inside the serializable transaction.

## Cash drawer boundary

`POS_DRAWER` is an explicit funding source and never follows from the `CASH` payment method alone. It requires a branch-scoped, currently open `CashierShift`. The server re-reads that Shift, active cash sales, cash refunds and prior Expense payouts inside the serializable payment transaction.

Every accepted drawer payment creates one immutable `CashierShiftExpensePayout` linked one-to-one to its `BusinessExpensePaymentEvent`. Shift expected cash is:

```text
Opening float
+ active cash sales
- cash refunds
- POS drawer Expense payouts
= expected Shift cash
```

Business bank / DuitNow, company card, petty cash outside the POS drawer, owner advance and staff advance do not reduce Shift Closing cash. Daily Closing reports the drawer payout separately and subtracts it from expected cash without recognising the Expense a second time.

Status: `CASH DRAWER EXPENSE LINKAGE -> READY (LOCAL / TESTING)`.

Post-closing expense reconciliation is also deferred; backdated expense analytics may restate by `expenseDate`, while finalized shift history remains unchanged.

## Verification

- Unit suite: 885/885 passed.
- Integration suite: 165/165 passed.
- Targeted Expense integration: 8/8 passed.
- TypeScript: passed.
- Prisma validate, generate, migration status, and disposable fresh rebuild: passed.
- Lint: passed with pre-existing warnings only.
- Local production-mode build: passed.
- Local browser smoke for Expense Overview, Daily Report, and Monthly Report: passed with zero console errors.

Environment: Local / Testing only. Production was not accessed, modified, or validated.
