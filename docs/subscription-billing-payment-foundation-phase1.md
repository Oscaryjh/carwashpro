# TETAMU SUBSCRIPTION BILLING / PAYMENT FOUNDATION PHASE 1

## A. Objective

Close the Local / Testing subscription billing foundation without building an online payment provider. The implementation preserves the commercial subscription as the contract source, creates an independent invoice/receivable source, and records settlement as independent payment facts.

## B. Existing Audit

- LOCAL / TESTING ONLY.
- Production was not accessed, changed, migrated, deployed, or validated.
- Workspace: `C:\CodexTetamuP0`.
- Existing dirty worktree was preserved. No reset, destructive checkout, commit, or push was performed.

The existing commercial module was the canonical source for subscription configuration, immutable plan versions, promotions, overrides, allowances, and renewal dates. It did not contain a subscription invoice, accounts-receivable, or subscription payment domain. Supplier AP, POS invoices, Expenses, AI quota and Module Entitlement were audited as separate domains and remain unchanged by billing settlement.

## C. Billing Domain Boundary

The new boundary is explicit:

```text
CommercialSubscription != SubscriptionInvoice != SubscriptionPayment
Commercial effective price != money received
POS Invoice != SubscriptionInvoice
Supplier AP / SupplierPayment != Subscription Receivables
```

## D. Subscription Invoice

```text
SubscriptionInvoice: DRAFT -> ISSUED -> VOID
SubscriptionPayment: COMPLETED -> REVERSED
```

- Draft invoices have zero canonical outstanding and do not enter receivables.
- Issuing freezes the commercial snapshot and creates the collectible amount.
- Issued invoice content cannot be edited. An error is voided and replaced.
- Completed payments cannot be edited or deleted. An error is reversed.

## E. Billing Period

Billing periods are stored as canonical date-only start-exclusive-end intervals. Monthly and annual renewal use the subscription billing interval; annual pricing must come from the configured annual price and is never derived from monthly multiplication. Invoice date and due date are stored separately.

## F. Price Snapshot

Every invoice stores:

- scope and subscription identity;
- billing interval and period;
- pinned plan-version line identity, code, name, and version;
- list price;
- promotion discount or explicit price override adjustment;
- setup fee charged once;
- active, included, and billable branch/employee counts;
- branch/employee unit prices and charges;
- total MYR integer cents and an auditable JSON price snapshot.

Missing configured monthly or annual price fails with `SUBSCRIPTION_CONFIGURED_PRICE_REQUIRED`; it never becomes RM0.

## G. Versioned Pricing

Invoice lines pin each commercial plan-version ID, plan code/name and version. A later plan activation, scheduled change or price edit cannot rewrite an existing invoice.

## H. Promotions / Overrides

Eligible active promotions are frozen as a discount. An active price override replaces the recurring effective price while preserving list-price and adjustment evidence. The plan version itself is never mutated.

## I. Setup Fee

The setup fee is added only when there is no earlier issued setup-fee invoice for the subscription. A voided draft/issued invoice does not silently manufacture an additional historical charge.

## J. Add-ons

Active add-on subscription items are separate frozen lines with their own plan-version identity, quantity and configured interval price.

## K. Branch / Employee Unit Charges

- Business unit counts come from canonical active Branch and EmployeeBusinessMembership facts at invoice generation.
- Included count, active count, billable count, unit price and line total are frozen.
- Group invoices do not invent branch or employee unit charges.
- Invoice generation never creates, deletes or reassigns a branch or employee.

## L. Business Billing

Business invoices carry `scopeType=BUSINESS` and the canonical Business ID. The active Business Owner can read only that business's billing history and cannot issue, mark paid, reverse or void.

## M. Group Billing

Group invoices carry `scopeType=GROUP` and the canonical Business Group ID. Only an active Group Owner membership can read that Group history; Business and Group invoice/payment scopes cannot be crossed.

## N. Invoice Lifecycle

```text
DRAFT -> ISSUED -> VOID
```

Draft is not collectible. Issue freezes the receivable. Issued financial facts are immutable; an error requires reasoned `VOID` followed by a replacement. A paid invoice cannot be voided until all completed payments are reversed.

## O. Supplier/Other Payment Separation

Supplier Bill/AP payment, POS Invoice/payment and Subscription Invoice/payment remain separate tables and services. No cross-domain payment is counted in subscription outstanding.

## P. Subscription Payment

Manual payment facts store immutable amount, date, method and safe reference with a global `SUB-PAY-######` number. No bank login, card number, CVV, payment-provider claim or gateway credential is stored.

## Q. Partial / Full Payment

Canonical settlement is derived as:

```text
Issued invoice total
- valid COMPLETED payments without a reversal
= outstanding
```

Derived state is `UNPAID`, `PARTIALLY_PAID`, or `PAID`. Overdue is derived from an issued invoice with positive outstanding after due date.

Materialized paid/outstanding/status fields are transactionally refreshed for efficient dashboards and checked by reconciliation against payment facts. RM100 against RM169 produces RM69 and `PARTIALLY_PAID`; the final RM69 produces zero and `PAID`.

## R. Payment Reversal

- Positive integer cents only.
- Manual Phase 1 methods: Bank Transfer, DuitNow QR, Cash, Cheque, Card Manual, Other.
- Global immutable numbers: `SUB-PAY-######`.
- Overpayment is rechecked inside the same serializable transaction after an advisory lock.
- Concurrent payments cannot both consume the same outstanding amount.
- Reversal is an immutable separate record and restores receivables; completed payment is never edited or deleted.

## S. Outstanding / Overdue

`Due Soon` and `Overdue` are read-time derivations over issued invoices with positive canonical outstanding. Overdue never auto-suspends a subscription in Phase 1.

## T. Renewal

`renewSubscriptionWithInvoice` performs one atomic transaction:

1. lock subscription billing;
2. use the canonical current renewal date as period start;
3. apply one due scheduled plan change deterministically;
4. generate and issue one frozen invoice;
5. advance the next renewal by one monthly or annual interval;
6. record audit and idempotent result.

Replay does not issue another invoice or advance renewal again.

## U. Idempotency / Concurrency

- Global immutable invoice numbers use `SUB-INV-######`.
- A database partial unique index allows only one non-void invoice for one subscription and billing period.
- Invoice, payment and renewal operation keys replay canonical results.
- Serializable transactions, advisory locks, optimistic revisions, retry and DB uniqueness prevent duplicate invoice periods and overpayment races.
- Database triggers block financial fact deletion and protect invoice/payment snapshots.

## V. Reconciliation

`reconcileSubscriptionBilling` re-derives paid, outstanding and payment status from immutable payment facts, and detects draft receivable violations and overpayment. Repair is limited to derived settlement projections; frozen invoice totals and payment amounts are never rewritten.

## W. Security / MFA

- Platform Admin is the only mutation authority.
- Business Owner and active Group Owner receive read-only scoped billing history.
- Other-business and non-owner group access is denied server-side.
- `Record Payment`, `Reverse Payment`, and `Void Issued Invoice` use current true TOTP/recovery-code MFA architecture.
- Step-up is one-time, five-minute, exact-action and exact-resource bound, and consumed inside the financial transaction.
- The new capability key is `MANAGE_COMMERCIAL_BILLING`; it is platform-only in this phase and is not a business permission grant.

## X. Browser / Tests / Migration

- `/admin/commercial/billing`: platform receivables metrics, draft generation, renewal generation, invoice list, frozen breakdown, payment history, MFA mutations.
- `/business/settings#subscription`: read-only business billing history.
- `/groups/[groupId]/commercial`: read-only active Group Owner billing history.
- Tables retain explicit horizontal containment while all forms collapse to one usable column at 389/390-class width.
- Authenticated Local browser acceptance verified draft creation and issuance, frozen breakdown, receivable transition, MFA mutation UI, 389px and 1440px layouts, zero page overflow, zero console errors, zero hydration errors and zero runtime overlays.
- True TOTP browser acceptance recorded an RM50 Local payment, verified `PARTIALLY_PAID`, reversed that payment with a fresh one-time code, and verified the full RM469 receivable was restored. The secret and codes were never printed or persisted in source or documentation; the temporary Local MFA credential was removed after acceptance.
- Targeted billing tests: 11/11. Full unit: 847/847. Full integration: 160/160.
- TypeScript, lint, Prisma validate/generate/status, 171-migration disposable fresh rebuild, Local production-mode build, changed-content secret scan, canonical guard and `git diff --check` passed. Lint/build retain only pre-existing non-billing warnings.

## Y. Deferred Gateway / SST / Proration

- Stripe/payment gateway integration;
- automatic bank reconciliation;
- e-Invoice submission;
- tax accounting and General Ledger;
- credit notes and refunds;
- proration;
- failed-payment retry/dunning automation;
- Production deployment or Production billing data.
- Subscription invoice PDF / official receipt.

## Z. Final Status

```text
TETAMU SUBSCRIPTION BILLING / PAYMENT FOUNDATION PHASE 1
-> READY
```

LOCAL / TESTING ONLY. PRODUCTION NOT ACCESSED. PRODUCTION NOT VALIDATED.
