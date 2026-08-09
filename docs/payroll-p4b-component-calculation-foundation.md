# Payroll P4B — Payroll Component Calculation Foundation

## A. Objective

P4B makes every Draft Payroll earning and non-statutory deduction explainable as a frozen component line. The calculation direction is:

```text
Frozen inputs -> component lines -> reconciled compatibility aggregates
```

It does not add Attendance P2, a new statutory engine, dynamic commission, payment processing or retroactive payroll.

## B. Previous Payroll Calculation Model

Before P4B, `basicPay`, `leavePay`, `overtimePay` and `publicHolidayPay` were calculated snapshots. P4A added immutable recurring component snapshots. `allowances`, `otherDeductions`, `grossPay` and `netPay` remained independently writable aggregate columns. Existing statutory amounts were stored as named Payroll Entry snapshots.

## C. Aggregate Override Risk

The previous Draft editor could change `allowances` or `otherDeductions` without creating a corresponding line. A recurring snapshot total of RM400 could therefore coexist with an allowance aggregate of RM700 with no source for RM300. This was classified **HIGH**.

P4B removes those aggregate fields from the normal UI/action input and adds deferred database reconciliation. An unexplained difference fails with `PAYROLL_COMPONENT_RECONCILIATION_FAILED`.

## D. Payroll Component Line Domain

`PayrollEntryComponent` stores:

- tenant, run, entry and membership scope;
- stable entry-local `lineKey`;
- `EARNING` or `DEDUCTION`;
- stable code and snapshotted display name;
- positive Decimal amount and MYR currency;
- source type and source/version/revision snapshots;
- effective month and calculation basis;
- `SYSTEM` or `MANUAL` origin;
- mandatory reason for manual lines;
- creator, timestamps and deterministic sort order.

Implemented source types are deliberately limited to `BASIC_SALARY`, `PAYROLL_CALCULATION`, `RECURRING_PAY` and `MANUAL_ADJUSTMENT`. Future modules can add source types in their own migrations.

## E. Basic Salary Materialisation

The existing `EmployeeCompensationVersion` and Payroll Entry compensation snapshot remain canonical. P4B materialises the already-calculated `basicPay` as a `BASIC_SALARY` earning line referencing that frozen compensation version. It does not introduce a second salary configuration model.

For Monthly employees, the line reflects the repository's current Monthly calculation policy, including its existing unpaid-leave treatment. Daily and Hourly lines reflect the existing locked-input calculation. P4B does not change those formulas.

## F. Recurring Pay Materialisation

Each active P4A snapshot materialises exactly once:

```text
Recurring component revision
-> PayrollEntryRecurringPaySnapshot
-> PayrollEntryComponent
```

The line carries the component code/name/amount, component ID, version ID, revision and effective month. Later employee configuration changes cannot update the line.

## G. Manual Adjustments

Manual earnings and deductions are individual `MANUAL_ADJUSTMENT` lines. Description, positive amount and reason are required. Authorized users can add, edit or remove them only while the run is `DRAFT`.

Each mutation is transactional, revision-checked and audited. Removing a Draft line removes the business row, while the append-only AuditLog retains the actor, action, reason-presence and redacted amount evidence.

## H. Source / Provenance

System lines identify their calculation source. Basic Salary references the Payroll Entry compensation version. Recurring lines must match an immutable recurring snapshot through a database provenance guard. Manual lines cannot claim an external source ID/version.

The UI exposes safe source labels and revision information, not raw internal source IDs.

## I. Aggregation

Canonical calculations are:

```text
grossPay = SUM(EARNING lines)
otherDeductions = SUM(DEDUCTION lines)
allowances = SUM(recurring + manual EARNING lines)
recurringAllowancesSnapshot = SUM(recurring EARNING lines)
recurringDeductionsSnapshot = SUM(recurring DEDUCTION lines)
netPay = MAX(0, grossPay - non-statutory lines - existing statutory snapshots)
```

The legacy aggregate columns remain as derived compatibility snapshots for existing exports, payslips and statutory/payment readers.

## J. Reconciliation

Reconciliation runs:

- after component/aggregate mutations through deferred PostgreSQL constraint triggers;
- after every service mutation;
- before submitting a run for review;
- before finalization.

Mismatch fails closed. There is no fallback to an old aggregate.

## K. Determinism

System lines use stable keys and deterministic ordering. The same compensation snapshot, calculation result and recurring revisions produce the same codes, amounts, provenance and ordering. Current time, latest employee profile, current branch and live recurring configuration are not consulted when reading an existing line.

## L. Idempotency

Draft refresh deletes only `SYSTEM` lines, recreates them from approved frozen/current generation inputs, preserves `MANUAL` lines, and re-derives aggregates. Entry-local unique `lineKey` prevents duplicate Basic Salary or recurring revisions.

## M. Payroll State / Immutability

| Run state | Add/edit/remove manual line | Regenerate system lines | Change aggregates |
| --- | --- | --- | --- |
| DRAFT | Allowed with capability, reason and revision | Allowed | Derived only |
| REVIEW | Denied | Denied | Denied |
| FINALIZED | Denied | Denied | Denied |

The existing audited `REOPEN_PAYROLL` transition can return an eligible Finalized run to Draft. Existing payment/statutory blockers still apply. No mutation is allowed while the run remains Finalized.

## N. Permissions

Component detail/edit UI requires whole-business scope plus both `EDIT_PAYROLL_ENTRY` and `VIEW_COMPENSATION`. Server actions repeat this enforcement. `VIEW_PAYROLL_RUN` remains the base Payroll Runs read gate.

Group Manager has no compensation capability by default. Staff cannot use admin adjustment actions. Staff payslips remain separate published DTOs and do not expose source IDs, compensation history or manager audit data.

## O. Tenant Isolation

Every line carries `businessId`, `payrollRunId`, `payrollEntryId` and `membershipId`. Composite foreign keys require the run, entry and employee membership to belong to the same Business. Services query entry/component IDs together with `businessId`; guessed cross-business IDs fail as not found.

## P. Money / Rounding

Database amounts use `Decimal(12,2)`. The calculation layer follows the repository's existing safe-integer-cent convention. Recurring Prisma Decimal values are converted to exact two-decimal cents. Amount direction is expressed by line type; both earning and deduction amounts must be positive.

Existing payroll calculation rounds Basic/Leave/Overtime/Public Holiday results to cents at the existing line boundary. P4B does not add a second rounding algorithm.

## Q. Proration Matrix

| Scenario | Current support | P4B rule |
| --- | --- | --- |
| Full-month Monthly Salary | YES | Canonical monthly rate through existing policy |
| Mid-month Join | NO | `MID_PERIOD_PRORATION_NOT_READY`; no silent approximation |
| Mid-month Termination | NO | `MID_PERIOD_PRORATION_NOT_READY`; no silent approximation |
| Mid-month Salary Change | NO | Compensation/recurring effective month remains month-start |
| Daily Employee | YES, existing calculation | Locked existing day inputs; no new Attendance semantics |
| Hourly Employee | YES, existing calculation | Locked existing minute inputs; no new Attendance semantics |
| Attendance-driven Hours | LIMITED EXISTING | Current locked Timesheet bridge retained; P5 refinement deferred |
| Unpaid Leave | LIMITED EXISTING | Existing approved-leave behavior retained; policy refinement deferred |

The existing Monthly implementation divides by the configured working-days basis for unpaid leave. P4B records that fact but does not claim it as a new statutory Malaysia proration policy.

## R. Migration Safety

The migration is additive: new enums, `calculationRevision`, component table, indexes, composite foreign keys, validation guards and reconciliation triggers. It has no drop, rename, historical rewrite or Production backfill.

Old Payroll Runs are not modified. New Drafts and explicitly refreshed Drafts use component lines. A legacy Draft must be refreshed before it can pass P4B submission reconciliation.

## S. Tests

Targeted coverage includes:

- Basic Salary and recurring line materialisation;
- deterministic ordering and exact provenance;
- manual earning/deduction create, edit, removal rules and mandatory reason;
- manual preservation during recalculation;
- aggregate reconciliation and forced mismatch failure;
- zero-line and Decimal precision behavior;
- generation idempotency;
- optimistic revision conflict;
- cross-business denial;
- Review/Finalized immutability;
- migration rebuild from an empty embedded PostgreSQL database.

## T. Deferred Scope

Deferred without implementation:

- richer approval/adjustment/retroactive workflows and dynamic commission (P4C);
- full Payroll UX (P4D);
- Attendance exception/resolution semantics (Attendance P2);
- refined Attendance/Leave/OT import and proration (Payroll P5);
- new EPF/SOCSO/EIS/PCB engine and statutory component lines (Statutory P2);
- Public Bank adapter and payment result reconciliation.

## U. Known Risks

- Existing statutory and employer contribution columns remain named snapshots rather than P4B component lines; their current behavior is retained until Statutory P2.
- Existing Daily/Hourly calculations depend on the current locked Timesheet bridge, not the future Attendance P2/P5 policy.
- Controlled reopen returns a previously Finalized run to Draft under the existing audited workflow; external artifacts can block it.
- Legacy runs are not backfilled with lines.
- Currency is schema-extensible but P4B commands and constraints currently support MYR only.

## V. P4B Completion Gate

P4B is complete only when component materialisation, manual line auditability, reconciliation, determinism, idempotency, state immutability, permissions, tenant isolation, money precision, clean migration rebuild, tests, typecheck, lint, build and `git diff --check` all pass.

After this gate, stop. Do not automatically enter P4C.
