# LINDUNG24 Participation and Payroll Treatment Closure

### A. Objective

Tetamu must answer, for one employee and payroll month, whether LINDUNG24 applies, the official participation state, the selected-employer context, the verified rule, employee/employer money, and the immutable historical decision. This closure does not activate a production rule or perform any PERKESO submission, payment or refund.

### B. Existing LINDUNG24 Audit

The existing `StatutoryScheme.LINDUNG24`, statutory component key, amount dataset, artifact review, payroll amount column and snapshot framework were retained. The old `lindung24OptIn` boolean is classified as `LEGACY`: it remains stored for compatibility but is no longer a payroll source of truth or an editable checkbox. The former calculator stub and participation gap were `PARTIAL`; the amount data was already `VERIFIED`.

### C. Official Sources

The retained source register is `statutory/official/reviews/perkeso-lindung24-participation-source-register-v1.json`. It binds the official Phase 1 schedule, FAQ v2.1, Employer Circular No. 3 of 2026, participation/employer-selection form and Release of Liability Notice to byte size and SHA-256. Only PERKESO sources were used. Payroll runtime uses retained data and has no network dependency.

### D. Amount Dataset Status

The existing 65-row normalized dataset remains unchanged with dataset digest `1e1b17a332e2b596b1efa85c075428c54b16d059730726e3f67cef710f334460`. The independent amount review remains PASS, six LINDUNG24 boundary fixtures are now `VERIFIED`, and the dedicated golden certification digest is `f822ece0947a89f1f4d1b583b8453cdacd6a6099e370d0227873508d98d282e8`. Amount verification never implies participation.

### E. Eligibility

`resolveLindung24Eligibility` uses only employee-under-contract, Act 4 coverage evidence and statutory nationality. It returns `ELIGIBLE`, `NOT_ELIGIBLE` or `INSUFFICIENT_PROFILE`. It does not use phone, identity formatting, branch or salary to infer eligibility. Official evidence states there is no age limit while the person remains an employee. A missing Act 4 or nationality fact fails closed as `LINDUNG24_PROFILE_INCOMPLETE`.

### F. Participation Model

`EmployeeLindung24ParticipationVersion` is the canonical effective-dated model. Supported evidence-backed states are `MANDATORY`, `DEFAULT_PARTICIPATING`, `VOLUNTARY_OPT_IN` and `VOLUNTARY_OPT_OUT`. It also freezes Act 4 coverage, employer context, selected-employer result, source type/reference, exact official submission timestamp, reason, actor, revision and SHA-256 digest. `LEGACY_REVIEW` blocks payroll.

### G. Effective Dating

Payroll uses `[effectiveFromMonth, effectiveToMonth)` month ranges. A new revision first closes the open predecessor at the new month and then appends a successor. Database checks reject invalid or overlapping periods. June payroll therefore continues to see June evidence after a later July/August change.

### H. Selected Employer

Single-employer evidence requires `CURRENT_BUSINESS`. Multiple-employer evidence records `CURRENT_BUSINESS`, `OTHER_EMPLOYER` or `PERKESO_SELECTION_PENDING`. Tetamu never selects the current business merely because it is the current tenant. Pending evidence blocks with `LINDUNG24_SELECTED_EMPLOYER_REQUIRED`; an officially selected other employer generates no current-tenant deduction.

### I. Multiple Employment

The model is membership- and business-bound through a composite foreign key. It records whether this tenant is selected, but does not create a cross-tenant natural-person graph or expose another employer membership. PERKESO selection is ingested as evidence. Unknown selection is fail-closed.

### J. Opt-in / Opt-out

Local employees can have official opt-out or opt-in evidence. Both require `officialSubmittedAt`; opt-out requires the official employee notice source. Foreign employees cannot be represented as voluntary opt-out. An opt-in cannot later be silently reversed. The UI appends evidence with exact source/reference and does not expose a generic enable checkbox.

### K. Transition

June 2026 is mandatory for all eligible employees. From 8 July 2026 foreign employees remain mandatory and local participation is voluntary/default-in. The official transition opt-out window is recorded rather than inferred. For later local new hires, an opt-out is accepted only with evidence before the first generated contribution; once a prior contribution exists outside the transition window, `LINDUNG24_ONCE_IN_ALWAYS_IN` blocks reversal.

### L. Refund / Reversal

June mandatory contributions are not refundable. Eligible July-onward opt-out or non-selected-employer over-contributions are administrative PERKESO refund cases. `EmployeeLindung24RefundEvent` is an append-only boundary: the original payroll contribution remains immutable and each review/submission/refund/rejection state is a new event revision. Portal reconciliation, government API and payment settlement remain explicitly deferred.

### M. Wage Base

FAQ v2.1 ties LINDUNG24 wages to Act 4 section 2(24). The dedicated classification candidate defines contractual salary, daily/hourly wages, paid leave, overtime, rest-day/public-holiday work, commission and incentive as included. Annual bonus is excluded by the official definition, so generic `BONUS` remains `UNKNOWN` because its annual/non-annual meaning is not frozen. Generic arrears/allowances/custom adjustments also remain `UNKNOWN` and block calculation. LINDUNG24 never copies a SOCSO runtime wage total.

### N. Payroll Treatment

The calculator can run only after eligibility, participation, selected employer, an exact `CALCULATION_VERIFIED` rule and scheme-specific component classifications resolve. It uses the verified table row; it does not calculate from `grossPay` and does not call PERKESO at runtime.

### O. Employee Contribution

LINDUNG24 is a statutory employee deduction. The existing `STATUTORY:LINDUNG24_EMPLOYEE` system component reduces net pay exactly once. Recalculation deletes and recreates only system statutory lines, preserving manual, variable and correction sources.

### P. Employer Contribution

Official evidence states the employee bears the full contribution and the employer deducts/remits it. LINDUNG24 employer contribution is always zero. The employer's remittance duty is not represented as an employer monetary share.

### Q. Snapshot Provenance

`PayrollEntryStatutorySnapshot` now freezes the LINDUNG24 participation version ID/revision, selected-employer result, profile revision, rule version, artifact/dataset/fixture/classification/calculator provenance, wage base, matched row, employee amount, zero employer amount, calculation input digest and source digest.

### R. Readiness

Readiness surfaces `LINDUNG24_PROFILE_INCOMPLETE`, `LINDUNG24_PARTICIPATION_REQUIRED`, `LINDUNG24_SELECTED_EMPLOYER_REQUIRED`, legacy review, classification/rule blockers and `STALE_LINDUNG24_PARTICIPATION`. Not eligible, official opt-out and another selected employer produce no false participation blocker and no contribution.

### S. Permissions

Reading and editing use `VIEW_STATUTORY_PROFILE` and `EDIT_STATUTORY_PROFILE`, require whole-business scope, and remain unavailable to attendance-only or branch-only staff. Staff self-service does not edit or approve participation. Production rule activation remains platform-only and is not performed here.

### T. Tenant Safety

Participation and refund records carry `businessId` and `membershipId`; composite tenant FKs reject mismatches. Payroll snapshot FKs require the participation version to belong to the same business and membership. Another employer is represented only as the official `OTHER_EMPLOYER` outcome.

### U. Historical Integrity

Participation facts are immutable. The database permits only the controlled one-time end-date/superseded timestamp needed to append a successor. Fact updates and deletion are rejected. Refund events and finalized statutory snapshots are append-only/immutable. Drafts become stale when participation or selected-employer evidence changes; review/finalized payroll is not silently rewritten.

### V. Tests

Tests cover eligibility, missing facts, local/foreign transition states, opt-out, once-in-always-in, multiple-employer outcomes, legacy fail-closed, overlap, digest changes, permission/scope, official low/normal/boundary/ceiling amounts, zero employer share, DB immutability, tenant FK, refund history and a real payroll materialisation dry run with frozen provenance. Final verification passed 676/676 unit tests and 85/85 integration tests (single file concurrency against the shared embedded PostgreSQL), TypeScript, lint with only pre-existing warnings, production build, Prisma validation, retained-artifact hashes, all 140 migrations on a disposable database, canonical workspace guard and `git diff --check`.

### W. Remaining Blockers

No engineering blocker remains for human review of this Phase 1 candidate. Operational blockers remain: human statutory/legal sign-off, explicit platform activation, official effective participation evidence per employee, resolution of any `UNKNOWN` component used by a payroll, and a new retained schedule before Phase 2 on 1 June 2028. Government refund/reconciliation is deferred by scope.

### X. Human Sign-off

The review package is `docs/statutory-lindung24-signoff.md`. It contains official rules, transition/refund boundaries, classification exceptions, test evidence, approval checklist and a blank approval record. Codex has not recorded legal, PERKESO or government approval.

### Y. Recommended Next Action

An authorized human reviewer should compare the retained official PDFs, source register, classification candidate and dry-run evidence, then complete the blank sign-off record. If approved, production activation must be a separate explicit platform action. Do not enter PCB or Payment from this closure.

### Z. Final Status

`LINDUNG24 — READY_FOR_HUMAN_SIGN_OFF`
