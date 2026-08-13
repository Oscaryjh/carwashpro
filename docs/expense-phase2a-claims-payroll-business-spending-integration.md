# Expense Phase 2A — Claims + Payroll Business Spending Integration

## A. Scope and environment

This closure is limited to Local and Testing. It does not access, mutate, migrate, deploy to, or validate Production. Supplier Bill, Accounts Payable, Supplier Payment, Inventory Purchase Expense Adapter, Accounting/GL, COGS, valuation, depreciation, P&L, tax reporting, Roster, AI, Public Bank, PCB closure and statutory human review are out of scope.

## B. Domain ownership

Claims remains the canonical source of Claim approval, approved amount, branch, reimbursement channel and payment. Payroll remains the canonical source of finalized employee and employer cost. Expense stores only a materialized Business Spending representation. Expense never writes Claim or Payroll facts.

## C. Source identity

Every system representation uses `sourceType`, `sourceId` and `sourceRevision`. Claim identity uses the canonical reimbursement ID plus approved Claim revision. Payroll identity uses Payroll Run ID plus `finalizedAt`. A database partial unique index permits at most one non-void Claim or Payroll representation per canonical source.

## D. Explicit source mappings

`ExpenseIntegrationSetting` stores an explicit Claims default Expense category and Payroll cost category. Both references are tenant-scoped composite foreign keys to active categories. No category-name matching and no silent `Other` fallback are used.

## E. Claim recognition

Only `APPROVED` and `PARTIALLY_APPROVED` Claims with a canonical reimbursement obligation materialize. Draft, submitted and rejected Claims do not. The Expense amount is the approved reimbursement amount; submitted and approved totals are frozen separately for traceability.

## F. Claim branch and date

Claim Expense uses the canonical Claim branch. Recognition date is the canonical review timestamp. No branch allocation is inferred.

## G. Claim payment state

`AWAITING_CHANNEL`, `OUTSIDE_PAYROLL_PENDING` and `PAYROLL_LINKED` are unpaid spending obligations. `OUTSIDE_PAYROLL_PAID` and `PAYROLL_SETTLED` make the existing Expense paid without changing its recorded amount.

## H. Claim cancellation and history

An approved unpaid Claim cancellation voids the active Expense through an immutable Expense revision. Reimbursed Claims are already protected from cancellation by Claims. Old representations are retained.

## I. Claim receipts and privacy

Receipt bytes are never copied to Expense. The source snapshot stores only receipt availability. Viewing the receipt remains subject to Claims authorization and privacy/malware controls. Expense descriptions avoid medical or free-text Claim details.

## J. Payroll recognition boundary

Only `FINALIZED` Payroll Runs materialize. Draft and Review runs do not. One Payroll Run creates one business-wide Expense representation for each finalized source revision.

## K. Payroll cost formula

The frozen formula is:

```text
gross remuneration
+ actual frozen employer EPF / SOCSO / EIS
+ other employer cost (currently zero unless an actual frozen source exists)
- Claim reimbursement pass-through
= total Business Payroll Cost
```

Gross remuneration is represented as frozen wage gross plus Claim pass-through, then pass-through is explicitly excluded. This makes the exclusion visible while preserving the existing Payroll fact that Claim reimbursement increases net pay, not gross pay. Employee EPF, SOCSO, EIS, LINDUNG24 and PCB deductions are never added as employer cost. Commission already included in frozen gross pay is not materialized again.

## L. Statutory boundary

Only employer contribution amounts actually frozen on Payroll Entries are included. No EPF, SOCSO, EIS, LINDUNG24 or PCB amount is inferred from inactive or pending statutory rulesets.

## M. Payroll branch scope

Payroll Run is currently business-wide and has no canonical branch allocation. Payroll Expense therefore uses `branchId = null`. Phase 2A does not invent branch allocation.

## N. Payroll payment semantics

Payroll `FINALIZED` means a confirmed unpaid Business Spending fact. It does not mean paid. Payroll payment remains a separate future source transition.

## O. Payroll reopen and re-finalize

Reopening a finalized Payroll Run voids the active Expense as stale and retains immutable history. A later finalization gets a new timestamp source revision; any older active representation is superseded before the new representation is created.

## P. Existing Claims-to-Payroll bridge

The existing bridge remains source-owned. READY/SETTLED Claim reimbursement adds only to Payroll net pay. A forward migration aligns the database component invariant with the existing application formula. Expense records the Claim once and explicitly excludes the same pass-through from Payroll cost.

## Q. Adapter transaction boundary

Claim approval/payment/cancellation and Payroll finalize/reopen commit first. The Expense adapter runs afterwards. Adapter failure returns `DEFERRED` and never rolls back a canonical source transition. Controlled reconciliation can detect and repair the missing representation.

## R. Idempotency and concurrency

Source operations use deterministic operation keys. Source revision uniqueness and the one-active-source database index fail closed on duplicates. Frozen `ExpenseSourceSnapshot` rows are protected by a database trigger that rejects update and delete. Expense payment and void operations continue to use optimistic revision checks and serializable transactions.

## S. Reconciliation

`reconcileExpenseSources` detects missing representations, duplicate active representations, stale source rows, wrong amount, wrong branch, wrong payment state, wrong source revision and missing frozen source snapshots. `assertExpenseSourceReconciliation` fails with `EXPENSE_SOURCE_RECONCILIATION_FAILED`.

## T. Backfill and repair

Reconciliation defaults to dry-run. Repair requires an explicit authorized actor and calls the same canonical adapters. There is no ordinary user-facing repair button. The integrations page exposes read-only source health.

## U. System source read-only enforcement

Source Expense facts cannot be edited or corrected in Expense. Manual payment and void services deny system sources unless called with the internal adapter flag. Edit, confirm, mark-paid and void controls are hidden for source rows. Authorized users can open the source domain.

## V. Module entitlement matrix

- `EXPENSE` only: Manual Expense remains available; no Claims or Payroll adapter is required.
- `EXPENSE + CLAIMS`: approved Claims can materialize; Payroll remains absent.
- `EXPENSE + PAYROLL`: finalized Payroll can materialize; Claims remain absent.
- all enabled: both sources materialize and Claim pass-through is excluded from Payroll cost.
- Expense disabled: Claims and Payroll workflows continue and adapters safely skip.
- a source module later disabled: historical Expense representations remain intact.

Neither Claims nor Payroll requires POS for this integration.

## W. Dashboard and history

Dashboard totals include confirmed non-void Manual, Claim and Payroll representations once. Cards separate Manual, Claims and Payroll. History and CSV support source filtering. Paid/unpaid changes do not change Recorded Business Spending.

## X. Income comparison wording

Where whole-business canonical analytics summaries are authorized and available, Net Sales is shown beside Recorded Business Spending. The UI explicitly states that no Net Profit is inferred. Branch-restricted viewers do not receive a whole-business sales comparison.

## Y. Audit and security

Audit actions distinguish Claim materialization, Payroll materialization, Claim payment sync, Claim void, Payroll supersession, source mapping updates and controlled reconciliation repair. Snapshots expose only aggregate Payroll totals, never employee salary lines. Claim receipt bytes and sensitive purpose/description text are not copied.

## Z. Verification and stop point

The closure gate covers schema validation, migration rebuild, unit/integration tests, TypeScript, lint, build, canonical workspace guard, `git diff --check`, Local authenticated browser checks and the exact dashboard fixture:

```text
Manual RM 1,500 + Claim RM 100 + Payroll RM 3,000
= Recorded Business Spending RM 4,600
```

After this gate, stop. Do not enter Supplier/AP, Inventory Expense Adapter, Accounting, Roster, AI, Public Bank, PCB, statutory human review, or Production.

Local authenticated browser verification covers the Expense overview, source filters, integration health, Claim and Payroll drill-down, system-source read-only controls, exact partial Claim recognition and payment sync, and 390px horizontal-overflow checks. The Claim browser fixture is submitted through the canonical Claim service, then partially approved, routed outside Payroll and marked paid through the manager UI. Console and hydration error counts are zero.
