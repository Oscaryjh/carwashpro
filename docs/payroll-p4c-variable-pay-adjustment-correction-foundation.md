# Payroll P4C — Variable Pay, Adjustment & Correction Foundation

## A. Objective

P4C extends the P4A/P4B canonical payroll architecture so every non-recurring amount has a source, category, reason, earned period, payroll period, lifecycle, actor and immutable Payroll component. Historical payroll is never rewritten; corrections create future deltas.

## B. Existing Variable Pay Audit

Before P4C, Payroll had calculated Basic Salary, leave pay, overtime pay, public-holiday pay and unpaid-leave deduction fields. Those calculations use the current locked-timesheet bridge and are not a variable-pay input domain. P4B provided individually audited manual lines but all used `MANUAL_ADJUSTMENT` without reporting classification or independent approval.

`StaffLevel` contains service/product/package commission presets, but the repository has no completed sales-to-commission calculation, approval or Payroll provenance flow. No Payroll bonus, incentive, arrears, recovery or retroactive delta model existed. Loyalty `WELCOME_BONUS`, invoice corrections, attendance corrections, payment-batch corrections and statutory revisions are separate domains and are not Payroll variable pay.

## C. Scope

P4C implements frozen Bonus, Commission, Incentive, One-off Earning, One-off Deduction, Arrears and Recovery inputs; structured P4B manual categories; approval; cancellation; future-payroll correction deltas; P4B line materialisation; audit; optimistic concurrency and minimal Draft Entry UI.

It does not calculate commission percentages, query live POS sales, infer attendance effects, create a reimbursement tax treatment, calculate statutory contributions, build a loan ledger or change payment processing.

## D. Variable Pay Domain

`PayrollVariablePay` is a business/membership-scoped financial source record. It stores separate earned-period start/end and payroll-period start, fixed MYR amount, stable code/name, origin, optional source reference, mandatory reason, revision and lifecycle.

Lifecycle: `DRAFT → APPROVED → APPLIED`; `DRAFT` or `APPROVED` may become `CANCELLED`. Applied and cancelled records are immutable and cannot be deleted or truncated.

## E. One-off Earnings

`BONUS`, `INCENTIVE`, `ONE_OFF_EARNING` and `ARREARS` materialise as positive `EARNING` lines. Direction is never represented by a signed amount.

## F. One-off Deductions

`ONE_OFF_DEDUCTION` and `RECOVERY` materialise as positive `DEDUCTION` lines. EPF, SOCSO, EIS and PCB are not represented as one-off deductions.

## G. Commission Foundation

`COMMISSION` is an approved/frozen input with manual/imported/system provenance and an optional stable source reference. It materialises as `sourceType=VARIABLE_PAY`, `code=COMMISSION`.

No `sales × percentage` formula is implemented. Existing StaffLevel presets are configuration only. Future Sales/Commission engines must produce a reviewed source record; Payroll must never query mutable Work Orders, Appointments, Invoices or POS transactions while calculating a run.

## H. Adjustment Classification

P4B manual Payroll lines now use `PayrollAdjustmentCategory`: `ONE_OFF`, `CORRECTION`, `ARREARS`, `RECOVERY`, `BONUS`, or `OTHER`. Legacy manual rows remain compatible; all new normal-flow manual rows receive a category.

Manual Payroll adjustments remain a deliberately simpler Draft-only mechanism for payroll-specific changes. Variable pay and retro corrections use independent source records because they require approval, periods and application history.

## I. Correction Domain

`PayrollCorrection` references an original Payroll Entry in the same business/membership. The original run must be `FINALIZED`, and `applyToPeriodStart` must be a later month. It stores original amount, corrected amount, positive delta, delta direction, description, reference, mandatory reason, revision, submitter, approver and applied future entry.

## J. Delta Calculation

Integer cents are used:

- corrected > original: `EARNING`, delta = corrected − original.
- corrected < original: `DEDUCTION`, delta = original − corrected.
- corrected = original: rejected; no zero component is created.

No negative earning or deduction is stored.

## K. Original Payroll Immutability

Creating, approving or applying a correction never updates the original Payroll Entry, component lines, snapshots, compensation source, gross or net. Existing REVIEW/FINALIZED database guards remain authoritative.

## L. Correction Application

Only `APPROVED` corrections for the future run period are resolved. They materialise as `sourceType=CORRECTION`, stable `CORRECTION:{id}` line key, frozen source revision and `APPROVED_DELTA` basis. The source is then atomically marked `APPLIED` with its future Payroll Entry.

## M. Idempotency

Stable source IDs and P4B `(payrollEntryId, lineKey)` uniqueness prevent duplicate lines. A correction has one applied entry. Retrying Draft regeneration rebuilds the same SYSTEM line from the same frozen approved revision. Applying an already-applied source to another entry fails.

Partial unique indexes prevent duplicate active external/source references without blocking legitimate multiple records that use distinct or absent references.

## N. Provenance

Variable sources retain origin, type, earned period, payroll period, source reference, reason, revision, submitter, approver and timestamps. Correction sources additionally retain original entry and exact before/corrected/delta facts.

P4C SYSTEM lines use the additive `sourceReason` snapshot; P4B manual `reason` semantics and constraint remain unchanged. Sensitive amounts are redacted from ordinary audit metadata.

## O. Permissions

Create/edit/cancel requires `VIEW_COMPENSATION` plus `EDIT_PAYROLL_ENTRY`. Approval requires `VIEW_COMPENSATION` plus `APPROVE_PAYROLL`. The submitter cannot approve their own source. Existing whole-business Payroll scope is required by server actions; Group Manager, Branch Manager and Staff do not gain implicit access.

## P. Tenant Isolation

Service queries scope every operation by business and membership. Composite foreign keys enforce source membership, original entry and applied entry ownership. Original and future entries must belong to the same business employment. A branch transfer inside the business does not break employee/membership history; another business can never inherit the correction.

## Q. Money Safety

Database storage uses `Decimal(12,2)`. Parsing and delta calculation use safe integer cents. MYR has two decimals. Amounts must be positive for lines; correction original/corrected values may be zero, but their delta must be positive. No JavaScript floating-point accumulation is used.

## R. Concurrency

Source records carry an optimistic revision. Every edit, approval, cancellation and application advances the lifecycle revision exactly once. Writes use Serializable transactions. Stale revisions, concurrent approval/application and duplicate source references fail closed.

The frozen component `sourceRevision` records the approval/content revision; the later APPLIED lifecycle transition does not change the frozen calculation provenance.

## S. Audit

Sensitive, transaction-bound audit records cover variable create/edit/approve/cancel/apply and correction create/approve/cancel/apply. Existing P4B manual add/edit/remove audit remains active and manual classification is stored on the financial line. Audit failure rolls back the financial mutation.

## T. Payroll Component Integration

Approved sources are resolved in two batch queries for all eligible memberships, avoiding a per-employee source query. Variable and correction records materialise as P4B SYSTEM lines with stable identity, positive amount, source ID/revision, payroll month, calculation basis and source reason.

Aggregates continue to be derived from all EARNING/DEDUCTION lines and reconcile before REVIEW/FINALIZED.

## U. Recalculation Behaviour

Draft regeneration deletes/rebuilds SYSTEM lines, re-materialises approved/applied frozen P4C sources, preserves P4B MANUAL lines, re-derives aggregates and increments calculation revision. It does not duplicate corrections or variable pay.

An applied source itself is immutable even while the run is Draft. A later business correction must be represented by a new approved source, never a silent edit to an already-applied record.

## V. Statutory Future Compatibility

`VARIABLE_PAY`/`CORRECTION` source type plus stable component code and variable subtype provide future mapping inputs for Statutory P2. P4C does not decide whether bonus, commission or another variable item is EPF/SOCSO/EIS/PCB-applicable and does not alter the existing statutory engine.

`REIMBURSEMENT_TREATMENT_NOT_DEFINED`: reimbursement is excluded until product and statutory treatment are explicitly defined.

## W. Tests

Coverage includes commission and one-off materialisation, multiple legitimate sources, duplicate reference rejection, frozen revisions, independent approval, cross-business/unauthorized denial, positive/decimal money, underpayment earning delta, overpayment deduction delta, original Finalized immutability, single application, deterministic retry, manual-line preservation, reconciliation and migration constraints.

## X. Deferred Scope

- P4D unified Payroll/payslip experience and broader approval queues.
- Attendance P2 and Payroll P5: late, early leave, no-show, missing punch, OT/rest-day/PH/unpaid-leave automatic effects.
- Statutory P2 classification/calculation.
- Formal sales/service/product commission engine and its rounding policy.
- Reimbursement treatment.
- Staff loan/advance ledger and amortisation.
- Payment P3B/P4 and Public Bank artifacts.

## Y. Risks

- Existing StaffLevel commission presets must not be mistaken for an approved commission result.
- Applied Draft sources are intentionally immutable; future supersession UX may be added rather than editing financial history.
- Existing statutory calculations do not yet reclassify variable/correction components; this is explicitly deferred to Statutory P2.
- Historical Payroll Runs are not backfilled into P4C sources.

## Z. P4C Completion Gate

P4C is complete only when schema/migration, source approval, delta correction, immutable history, component materialisation, idempotent recalculation, permissions, tenant safety, Decimal safety, audit, tests, TypeScript, lint, build, migration rebuild, canonical guard and `git diff --check` all pass. Work stops after this gate and does not enter P4D.
