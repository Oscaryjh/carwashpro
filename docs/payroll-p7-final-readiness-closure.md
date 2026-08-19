# Payroll P7 — Final Payroll Readiness & Closure

## Scope

P7 closes the payroll calculation and finalization gate. It does not activate a Sabah statutory rule pack, invent EPF/SOCSO/EIS/PCB formulas, submit statutory files, execute bank payments, deploy Production, or create a second payroll engine.

The canonical entry point is `getPayrollPeriodReadiness`. Payroll review pages and server actions consume the same result. Finalize re-runs it inside the final transaction; UI state is never trusted as authorization.

## Canonical readiness contract

Run and employee status use exactly three values:

- `READY`: no blocking or review issue.
- `REVIEW_REQUIRED`: a human follow-up exists, but payroll calculation/finalization is still permitted.
- `BLOCKED`: at least one invariant required for calculation/finalization is missing or stale.

Every issue is structured as:

```text
code
severity: BLOCKING | REVIEW | INFO
employeeId? (the tenant-scoped employee membership id)
membershipId?
employeeCode?
employeeName?
source
message
resolutionHint
```

`blockers`, `warnings`, `info`, `needsAttentionCount`, and `canProceed` remain as compatibility fields for P4–P6 consumers. `issues`, `status`, `readyCount`, `reviewRequiredCount`, and `blockedCount` are the P7 contract.

## Finalize server gate

Finalize is permitted only after all of the following succeed in one Serializable transaction:

1. Tenant-scoped payroll run exists and is in `REVIEW`.
2. The run is non-empty.
3. Canonical readiness is recalculated with the transaction client.
4. Compensation versions, payroll entries/components, recurring/variable/correction inputs, locked Attendance timesheet revision and digest, statutory state, and reconciliation invariants are current.
5. High-risk authorization/MFA is consumed for the exact payroll run action.
6. Separation-of-duties policy is enforced; self-approval requires the existing controlled override path.
7. The final state transition uses the run's previously read `updatedAt` plus `REVIEW` status as an optimistic concurrency predicate.
8. A concurrent mutation produces zero updated rows and fails closed. The user must reload and run readiness again.
9. Finalization and its audit record commit atomically.

Finalized payroll is immutable. Reopen/correction remains a separate high-risk, audited workflow rather than an in-place silent edit.

## Calculation readiness versus downstream readiness

Payroll calculation/finalization is intentionally separate from payment and statutory submission readiness.

- Missing bank account: `REVIEW`, not a payroll calculation blocker. It blocks or requires action before a payment batch.
- PCB manual verified amount: allowed when supported by the existing verified/manual architecture; P7 does not invent a PCB formula.
- Missing statutory calculation evidence required by the current run: blocking.
- Missing payment execution artifacts or statutory submission/export artifacts: deferred to those downstream workflows and must not silently prevent calculation finalization unless the existing canonical gate explicitly requires them.

## Sabah work-pay context rule

An inactive/not-ready Sabah work-pay rule blocks only when the frozen Attendance facts contain special work minutes: normal OT, Rest Day work/OT, or Public Holiday work/OT. A normal-pay-only employee is not blocked merely because an unused special-work rule is inactive.

P7 does not activate the Sabah rule pack and does not add legal formulas.

## Component trace and reconciliation

Each payroll component retains:

- tenant, run, entry, and employee membership scope;
- stable `lineKey` unique within the payroll entry;
- component type/code/name/amount/currency;
- `sourceType`, source id/version/revision where applicable;
- calculation basis, origin, adjustment category, reason, and ordering;
- creator and timestamps.

The unique `(payrollEntryId, lineKey)` constraint prevents duplicate materialization of the same canonical line. Reconciliation compares canonical aggregates and stored entry totals; mismatch is a blocking readiness issue. Gross, deduction, statutory and net totals therefore remain explainable from frozen component lines and snapshots.

## Resolution routing

Issue `source` and `resolutionHint` direct the operator to the owning workflow:

- Compensation — create/verify an effective compensation version.
- Attendance Timesheet — resolve Attendance, approve and lock the exact monthly revision, then refresh payroll.
- Payroll Components — rebuild/review canonical lines and reconciliation.
- Recurring/Variable/Correction/Approved Input — complete approval/materialization in the owning workflow.
- Sabah Work Pay — resolve the existing rule/snapshot only when special-work minutes exist.
- Payment Readiness — add bank/payment details before payment batch creation; payroll finalization may continue.
- Statutory Readiness — complete verified contribution/tax evidence without direct untracked overrides.

## P7 GAP matrix

| Area | Status | Closure evidence |
| --- | --- | --- |
| Run and employee readiness | READY | Canonical three-state result, counts, structured issues and employee drill-down. |
| Compensation version/readiness | READY | Effective verified compensation and version/snapshot checks are in the canonical gate. |
| Locked Attendance timesheet | READY | Exact revision, digest, locked-at snapshot and stale-source checks. |
| Leave/OT/cross-midnight inputs | READY | Frozen Attendance facts and approved-input/materialization checks from P5/P6. |
| Recurring/variable/corrections | READY | Approval, materialization and duplicate/conflict checks retained from P4. |
| Sabah special work pay | READY (contextual) | Blocks only when special-work minutes exist; no rule activation in P7. |
| EPF/SOCSO/EIS/PCB readiness | READY within existing architecture | Verified statutory state and component evidence are checked; no new formula introduced. |
| Component trace and totals | READY | Provenance fields, stable line key, uniqueness and reconciliation gate. |
| Finalize authorization | READY | Permission/SoD/MFA, transactional canonical re-check and audit. |
| Finalize concurrency | READY | `REVIEW + updatedAt` optimistic predicate inside Serializable transaction. |
| Finalized immutability/correction | READY | Final records are immutable; reopen/correction uses existing audited high-risk path. |
| Payroll review UI | READY | Ready/Review/Blocked totals, server-side pre-pagination filter and actionable issues. |
| Payslip publication | READY | Existing immutable finalized publication/self-service scope from P4D. |
| Payment execution | DEFERRED | Separate payment-readiness/batch workflow; missing bank is review-only here. |
| Statutory submission/export | DEFERRED | Separate controlled submission/export workflow; no new P7 exporter. |
| Production validation | DEFERRED | Local/testing closure only; Production was not accessed or validated. |

## Verification gate

P7 closure requires TypeScript, focused P4–P7 unit tests, lint on changed files, Prisma schema validation, build, and diff integrity checks. Any failure keeps the final status blocked and must be reported rather than bypassed.
