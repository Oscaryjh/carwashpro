# Payroll P4A — Recurring Pay Foundation

## A. Objective

P4A establishes an auditable, effective-month, tenant-safe source for predictable fixed payroll values:

```text
EmployeeBusinessMembership
  -> Basic salary versions
  -> Recurring pay component identities
  -> Immutable effective revisions
  -> Payroll Entry snapshots
```

P4A does not implement dynamic commission, attendance resolution, prorating, statutory classification, bank adapters, settlement, or reconciliation.

## B. Previous Payroll Architecture

Basic salary was already safer than a live-profile lookup. `EmployeeCompensationVersion` stores immutable monthly versions for `MONTHLY`, `DAILY`, and `HOURLY` pay bases. Payroll generation resolves the latest applicable version and copies its ID, effective month, source, pay basis, and base rate into `PayrollEntry`.

The legacy `EmployeeBusinessMembership.baseSalary` and `payBasis` fields remain compatibility projections. They are not the authoritative source used by new Payroll Entry generation.

Before P4A, `PayrollEntry.allowances` and `otherDeductions` were initialized to zero and could only be edited as manual aggregate values in a Draft. There was no recurring allowance/deduction domain and no component-level snapshot.

Changing an employee's salary today does not change a previously generated or finalized Payroll Entry. Existing salary snapshots and the payroll workflow already protect that history.

## C. New Recurring Pay Domain

P4A adds fixed `EARNING` and `DEDUCTION` components. Each component has a stable code and business-employment identity. Its facts are carried by immutable effective-month revisions.

Included examples are transport, meal, housing, phone, or other fixed allowances, and fixed staff-loan or uniform deductions. Component codes are business-defined uppercase identifiers, avoiding an expanding allowance enum.

Excluded:

- Basic salary, which remains in the existing compensation-version domain.
- EPF, SOCSO, EIS, and PCB, which remain statutory-engine concerns.
- Dynamic commission or sales-derived values, which belong to P4C.
- Loan amortisation schedules and variable adjustments.

## D. Data Model

`EmployeeRecurringPayComponent` is the stable identity:

- `businessId` and `membershipId` bind it to the business employment relationship, not a branch.
- `type` is `EARNING` or `DEDUCTION`.
- `code` is stable and unique for the employee within the business.
- The identity cannot be updated or deleted.

`EmployeeRecurringPayComponentVersion` is the immutable fact/event:

- Monotonic revision per component.
- First-of-month `effectiveFromMonth`.
- `ACTIVE` carries name, positive Decimal amount, currency, source, reason, and actor.
- `ENDED` is a zero-amount event that stops resolution from that month.
- `CURRENT` means it is the accepted fact for that effective month.
- A same-month correction creates a new revision and marks only the replaced row `SUPERSEDED`.

`PayrollEntryRecurringPaySnapshot` stores component type, code, description, amount, currency, source component ID, source version ID, source revision, effective month, and `FIXED_MONTHLY` calculation basis.

`PayrollEntry.recurringAllowancesSnapshot` and `recurringDeductionsSnapshot` preserve aggregate recurring totals independently from the existing manually editable aggregate fields.

## E. Effective Dating

All P4A salary and recurring pay changes take effect on the first day of a payroll month. The resolver normalizes the Payroll period to UTC month start and, for each stable component, selects the latest non-superseded revision on or before that month.

The effective end is derived from the next revision:

- An ACTIVE revision remains applicable until the next revision.
- An ENDED revision makes the component inapplicable from that month.
- A later ACTIVE revision can restart the same component.

This event model gives a single deterministic answer per component and avoids mutable `effectiveTo` history.

## F. Basic Salary Rules

Basic salary continues to use `EmployeeCompensationVersion` because it already provides the lower-risk effective-dated implementation:

- Exactly one active accepted version per employee/effective month, enforced by a partial unique index.
- Later effective months do not overwrite earlier salary facts.
- Same-month corrections retain a superseded version.
- Monthly, daily, and hourly pay bases are supported.
- Mid-month salary dates are rejected. P4A does not prorate.

This is intentionally a hybrid of the two evaluated approaches: the existing salary domain uses immutable effective rows, while recurring pay uses a stable parent identity plus immutable revisions. Replacing the working salary model would add migration risk without improving P4A safety.

## G. Allowance Rules

Multiple fixed earnings are allowed when they have different stable codes. The same code represents one logical component and resolves to at most one value for a payroll month. `BASIC_SALARY`, statutory codes, and commission-prefixed codes are reserved and rejected.

New Payroll Draft generation sums resolved `EARNING` amounts into the recurring allowance snapshot and the existing allowance aggregate. Each source component is also snapshotted separately.

## H. Deduction Rules

Multiple fixed deductions are allowed with different stable codes and follow the same effective/revision rules. New Payroll Draft generation sums resolved `DEDUCTION` amounts into the recurring deduction snapshot and the existing other-deduction aggregate.

Statutory deductions are explicitly excluded. A staff-loan component is a fixed monthly amount only; balance and amortisation are deferred.

## I. Payroll Snapshot Rules

Payroll generation resolves all employees' recurring components in one tenant-scoped batch. It creates the Payroll Entry and component snapshots in the same Serializable transaction.

Snapshot idempotency is enforced by:

- Draft regeneration deleting and recreating that Draft's entries and snapshots in one transaction.
- `PayrollEntry` uniqueness per run and employee.
- Snapshot uniqueness per Payroll Entry and source component.
- Serializable retry handling already used by payroll generation.

The component aggregate affects Draft gross/net totals using the existing integer-cents calculation boundary. Statutory wage-base treatment is intentionally unchanged until authoritative component-classification rules exist.

## J. Immutability

- Component identities cannot be updated or deleted.
- Version facts cannot be updated or deleted; only CURRENT-to-SUPERSEDED same-month correction metadata is allowed.
- Recurring snapshots cannot be updated.
- Snapshot deletion is allowed only while the parent Payroll Run is Draft, supporting deterministic regeneration.
- Reviewed and Finalized Payroll Entries remain protected by the existing database guard; P4A adds a compatible non-Draft guard as defence in depth.

Therefore later employee configuration changes cannot mutate a historical Payroll Entry or its source snapshot.

## K. Permissions

Recurring pay reuses the granular compensation capabilities:

- Read requires `VIEW_COMPENSATION` and whole-business branch scope.
- Write requires both `VIEW_COMPENSATION` and `EDIT_COMPENSATION`, enforced in the canonical server-side command service.
- Group Managers have neither capability by default.
- Staff cannot edit recurring pay; even an ALL_BRANCHES staff scope fails the edit capability check.
- Branch-limited access does not receive compensation values.

The Employee Profile continues to load compensation through an independent permission-aware DTO. Generic employee loaders do not gain salary or recurring-pay fields.

## L. Tenant Isolation

Every read/write resolver includes both `businessId` and membership/component identity. Composite foreign keys prevent a recurring version, Payroll snapshot, or employee membership from crossing businesses.

Recurring pay belongs to `EmployeeBusinessMembership`, not `Branch`. Branch transfers do not move or discard compensation history. Business Group context does not bypass business or capability checks.

## M. Migration Strategy

The P4A migration is additive:

- Adds enums, the recurring revision counter, recurring snapshot totals, and three new tables.
- Adds checks, unique indexes, tenant composite foreign keys, and immutability triggers.
- Does not drop, rename, rewrite, or backfill existing production rows.
- Does not change existing salary versions or Payroll Entry monetary history.

## N. Legacy Compatibility

Existing employees retain salary through the existing compensation-version baseline and legacy projection. P4A does not duplicate basic salary into recurring components.

Existing Payroll Entries receive zero defaults for the two new recurring aggregate snapshot fields. Existing `allowances` and `otherDeductions` remain compatible manual aggregates. New recurring component snapshots are created only when a Draft is newly generated or explicitly regenerated.

There is no recurring-pay production backfill because no authoritative recurring component source previously existed. No `P4B DATA MIGRATION REQUIRED` is needed for basic salary; importing externally held allowance/deduction records would require a separately reviewed data-migration plan.

## O. Tests

Targeted unit and integration tests cover:

- Existing initial, future, same-month correction, overlap constraint, and historical Basic Salary behavior.
- Multiple earnings and deductions.
- Future start and ending resolution.
- Tenant-scoped resolution and cross-business denial.
- Exact Decimal aggregation such as `0.10 + 0.20 = 0.30`.
- Component snapshot creation and recurring aggregate totals.
- Later configuration correction not mutating a Finalized Payroll Entry.
- Idempotent command replay.
- Immutable component identity and non-Draft Payroll Entry guards.
- Authorized owner path plus Group Manager and Staff denial.

## P. Deferred to P4B

- Mid-month proration. P4A rejects non-month-start changes.
- Statutory/tax applicability classification and statutory wage-base integration.
- Rich earning/deduction calculation bases beyond `FIXED_MONTHLY`.
- Retroactive payroll correction or adjustment workflow.
- Full recurring-pay history UX and bulk administration.
- External recurring-pay data import.

Dynamic commission remains P4C, not P4B recurring fixed pay.

## Q. Risks

- A Draft generated before a recurring-pay change remains unchanged until an authorized user explicitly regenerates it; the UI and audit message state this.
- The existing manual allowance/deduction editor can override aggregate totals in a Draft. Dedicated recurring snapshot totals and line snapshots preserve provenance, but a future entry UX should distinguish recurring and manual amounts visually.
- Statutory wage bases intentionally do not infer legal treatment for new components. This avoids an unsafe Malaysia statutory assumption but requires later rule-backed integration.
- Currency is stored as a field but constrained to MYR for P4A. Multi-currency payroll is not implied.

## R. P4A Completion Gate

P4A is complete only when schema/migration validation, targeted and regression tests, TypeScript, lint, production build, canonical workspace guard, and `git diff --check` pass. No Payment P3A file, Public Bank adapter, production database, bank file, deployment, commit, or push is part of this phase.
