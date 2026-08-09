# Payroll P4D — Unified Payroll Workflow & UX

### A. Objective

P4D makes payroll operable through one natural path: employee setup → readiness → draft → component review → Review → Finalized → published payslips. P4A compensation/recurring pay, P4B components/reconciliation/revision, P4C variable pay/corrections, and the existing run state machine remain the source of truth.

### B. Existing UX Audit

Before P4D, a normal payroll required at least five primary screens: Employee Payroll Profile, Payroll Workspace, Payroll Runs/create, Payroll Run detail, and Draft Entry detail. Bank and statutory setup increased this to seven screens; payment preparation made it eight. `/team/employees` and `/team/employees/[employeeId]` are compatibility surfaces, while `/team/people/[personId]` is canonical. `/team/payroll` previously redirected to `/team/payroll/workspace`; it now renders that operational workspace directly when no legacy month is supplied.

The main duplication was current salary displayed beside a separate monthly entry aggregate, and finalized PDF availability being confused with publication. Ownership was unclear between the landing page, run list, run detail and entry editor. Variable pay and corrections existed only inside the Draft Entry technical surface. P4D retains the routes but assigns ownership: profile owns long-term setup, workspace owns readiness/navigation, run owns workflow, and entry detail owns component explanation.

### C. User Roles

Business Owner, Payroll Admin and explicitly authorized HR users can operate only the capabilities they hold. HR Manager does not gain payroll automatically. Branch Manager and Group Manager remain denied unless the capability and whole-business scope gates both pass. Staff uses the employee-session self-service DTO only.

### D. Employee Profile Information Architecture

The canonical profile Payroll tab consolidates current compensation, scheduled compensation, prior versions, recurring earnings/deductions, masked bank/statutory setup, current readiness, recent run snapshots and secure destinations. It does not become a run editor.

### E. Compensation UX

Current pay shows basis, rate and effective month. Scheduled change and up to twelve prior effective-dated versions are shown. Recurring lines remain grouped into earnings and deductions and use P4A commands. `VIEW_COMPENSATION` protects reads and `EDIT_COMPENSATION` protects writes server-side.

### F. Payroll Workspace

`/team/payroll` is the primary entry. It shows current run, employee/gross/net totals, independent downstream states, canonical ready/attention counts, blocker/warning lists and the next valid destination. Pre-create readiness states the automatic inclusion rule and exposes missing compensation before generation.

### G. Payroll Run Workflow

The run header shows period, DRAFT/REVIEW/FINALIZED, employees, gross, total deductions and net. DRAFT exposes refresh/edit/submit where authorized; REVIEW is read-only and exposes return/finalize; FINALIZED is immutable and exposes payslip publication and existing downstream payment/statutory navigation. Invalid actions remain hidden and are also rejected server-side.

### H. Payroll Entry Detail

Run rows summarize Basic, Recurring, Variable, Adjustments, Gross, Deductions, Net and readiness issues from batched canonical data. Entry detail uses P4B component lines. REVIEW and FINALIZED use the same route as a read-only component explanation; DRAFT retains authorized editing.

### I. Readiness Model

`getPayrollPeriodReadiness()` is deterministic and tenant-scoped. It returns run/employee issues, `BLOCKER`/`WARNING`/`INFO`, per-code counts, ready/attention counts and `canProceed`. It batch-loads memberships, compensation, entries/components, bank versions, variable pay and corrections. Readiness errors fail the page/action; they never default to Ready.

### J. Blockers vs Warnings

Blockers are missing applicable compensation, unsupported monthly mid-period proration, component reconciliation failure, an approved/applied variable source missing from canonical lines, an approved/applied correction missing from canonical lines, and an empty run. Missing/unverified bank, incomplete statutory/tax profile and Draft variable pay are warnings. A future compensation change and approved pre-generation input are informational. Bank/statutory warnings do not block Review or Finalize.

### K. Review Workflow

Submit runs canonical readiness inside the serializable transaction, verifies the locked attendance revision, checks statutory review-required state, then moves DRAFT → REVIEW with audit. Error copy includes concrete employee/reason summaries.

### L. Finalize Workflow

Finalize repeats state, locked-timesheet, separation-of-duties and canonical readiness checks inside the transaction. Existing owner override reason governance remains. FINALIZED is calculation lock only; it is not payment and not payslip publication.

### M. Reopen Workflow

Reopen requires `REOPEN_PAYROLL`, FINALIZED state and a mandatory reason. Existing payment/statutory artifacts still block. Published payslips also block because their employee-visible documents are immutable. Accepted reopens and rejected attempts are audited.

### N. Variable Pay UX

Variable pay remains a frozen P4C source. Draft Entry provides create, status, approve/cancel and applied visibility. Workspace/Profile readiness surfaces pending and missing-materialization state without reading live POS sales or building a commission engine.

### O. Correction UX

Correction remains a future delta against a finalized original. Draft Entry states that the original is unchanged, displays prior payroll context, and server-calculates the positive delta. Run/Profile summaries expose the applied signed amount without raw source IDs.

### P. Manual Adjustment UX

Draft Entry uses explicit Add Earning/Add Deduction, category, description, amount and reason. Gross, net, allowance aggregate and deduction aggregate are not directly editable. P4B optimistic `calculationRevision` continues to reject stale writes.

### Q. Payslip UX

Finalization makes an admin preview possible; publication is a separate `PUBLISH_PAYSLIP` action. Publishing stores the exact generated PDF bytes plus SHA-256 for every remaining finalized entry. Component names come from frozen P4B/P4C lines rather than generic allowance buckets when available.

### R. Staff Self Service

`/staff/payslips` uses the employee session, lists only publication rows for that `businessId + membershipId`, and downloads stored bytes through an ownership-constrained route. Unpublished payroll entries do not exist in the self-service DTO. Guessed IDs, other employees and other businesses return not found.

### S. Permissions

Admin reads/writes remain capability-based and require whole-business payroll scope. `VIEW_PAYSLIP` and `PUBLISH_PAYSLIP` are separate. Staff self-service is an identity/ownership boundary, not a manager/admin role shortcut. No P4D server action uses `role !== STAFF` as authorization.

### T. Tenant Isolation

Every readiness, run, component, publication and download query includes active `businessId`. Entry/publication relations also bind membership and business through composite foreign keys. Business switching cannot reuse a run, entry or publication from the prior context.

### U. Historical Data Safety

Historical run/profile views read PayrollEntry snapshots and PayrollEntryComponent lines, never current compensation. Published PDFs are stored bytes, guarded against UPDATE/DELETE, and prevent run reopen. Later profile, compensation, recurring or source changes cannot alter the published file.

### V. Responsive / Accessibility

Existing card/table mobile breakpoints remain. New readiness and staff payslip layouts collapse to one column. New forms use text labels, state text is not color-only, notices use status/alert semantics, and interactive actions retain keyboard-native controls.

### W. Query / Performance

Readiness uses a bounded set of batch queries and one batched reconciliation read, not per-row queries. Run component summaries load with the paginated entry query. Profile summary loads six runs and their relevant components. Existing run pagination (20 entries), history pagination (12 runs) and bounded search remain.

### X. Tests

P4D tests cover deterministic severity/counts, warning non-blocking behavior, server readiness gates, canonical component detail, state-specific editing, publication capability, immutable publication schema, own-only self-service query, tenant binding and frozen component PDF display. Existing P4A–P4C, payroll authorization, workflow, tenant, concurrency and historical tests remain part of the full gate.

### Y. Deferred Scope

Attendance P2 and Payroll P5 attendance refinement, Statutory P2 calculation redesign, Payment P3B Public Bank adapter, Payment P4 result reconciliation, notifications, anomaly analytics and the commission engine are deferred. `PUBLIC_BANK_SPEC_NOT_READY` remains unchanged.

### Z. P4D Completion Gate

Completion requires unit/integration tests, TypeScript, lint, production build, additive migration rebuild, canonical guard and `git diff --check`. No commit, push, deploy or Production migration is part of P4D.
