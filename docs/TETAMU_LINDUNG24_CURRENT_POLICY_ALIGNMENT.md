# TETAMU LINDUNG 24 Current Policy Alignment

Date: 26 August 2026  
Environment boundary: Local engineering and Testing read-only verification only  
Production activation: **NOT ACTIVE**

## 1. Executive Summary

Tetamu's LINDUNG 24 resolver has been aligned to the latest retained PERKESO evidence without weakening fail-closed Payroll controls. The current official position is: local employees participate voluntarily; eligible foreign workers participate mandatorily; the employee bears the full contribution; and payroll must use the official contribution table rather than a percentage approximation.

The old implementation treated an eligible employee without a participation version as though one mandatory-era profile were merely incomplete. The aligned resolver separates applicability, local voluntary participation, foreign mandatory coverage, multiple-employer selection, and the July 2026 policy transition.

Engineering is ready for human legal sign-off. Production remains inactive because the initial employer circular and the later current-policy material conflict, and the exact monthly treatment of the 8 July 2026 change requires formal approval.

## 2. Official Evidence Pack

The machine-readable evidence manifest is `statutory/official/lindung24/current-policy-alignment-manifest-v1.json`. It records retrieval dates, URLs, SHA-256 hashes, retained artifact paths, effective-date interpretations, supersession notes, engineering status and activation status.

Primary official sources:

- PERKESO current scheme page: <https://www.perkeso.gov.my/skim-kemalangan-bukan-bencana-kerja-lindung-24-jam.html>
- PERKESO FAQ v2.1: <https://www.perkeso.gov.my/images/lindung/lindung-24-jam/faq-2.1.pdf>
- Employer Circular No. 3/2026: <https://www.perkeso.gov.my/images/arahan/PEKELILING%20MAJIKAN%20BILANGAN%203_%202026_PELAKSANAAN%20SKIM%20LINDUNG%2024%20JAM%20DAN%20PEMILIHAN%20MAJIKAN%20BAGI%20MAKSUD%20PEMBAYARAN%20CARUMAN.pdf>
- Official contribution schedule: <https://www.perkeso.gov.my/images/lindung/lindung-24-jam/JadualCarumanBaharuTermasukSKBBK.pdf>
- Official release-of-liability / opt-out notice: <https://www.perkeso.gov.my/images/lindung/lindung-24-jam/Notis%20Pelepasan%20Liabiliti%20LINDUNG%2024%20Jam_31Julai2026.pdf>
- Participation and employer-selection form: <https://www.perkeso.gov.my/images/lindung/lindung-24-jam/penyertaan.pdf>
- PERKESO foreign-worker page: <https://www.perkeso.gov.my/perkhidmatan-kami/perlindungan/pekerja-asing.html>

## 3. Source Chronology

| Date / period | Official evidence | Engineering interpretation |
|---|---|---|
| 1 Jun 2026 | Scheme commencement and initial Employer Circular | Initial mandatory-era rule |
| 8 Jul 2026 | FAQ v2.1 states local voluntary / foreign mandatory treatment | Current policy change stated effective inside a payroll month |
| 13 Jul 2026 | Transition opt-out begins | Official local opt-out evidence becomes available |
| 31 Aug 2026 | Transition opt-out window closes | Deadline retained; not converted into an automatic opt-out |
| 1 Aug 2026 monthly payroll | First unambiguous full monthly period after the change | Current local-voluntary / foreign-mandatory rule |

## 4. Initial 2026 Rule

The initial materials describe LINDUNG 24 as beginning on 1 June 2026 under a mandatory-era treatment for employees covered by Act 4. Tetamu retains this historical era. It is not globally overwritten by the later current policy.

## 5. Current Policy

The current PERKESO scheme page and FAQ v2.1 state:

- local employees: voluntary participation;
- foreign workers within the official protection scope: mandatory participation;
- the employee bears the entire contribution;
- phase rates are 0.75%, 1.00% and 1.25%; and
- contributions follow the official wage-band schedule.

Unknown data is not equivalent to participation, opt-out or non-applicability.

## 6. Effective-date Analysis

The current split is stated effective 8 July 2026, but Tetamu Payroll calculates by monthly statutory period. That date falls inside July. The initial circular and later FAQ/current page also differ in treatment. Engineering therefore applies:

- before 1 Jun 2026: `NOT_STARTED`;
- June 2026: `INITIAL_MANDATORY`;
- July 2026 local employees: `LOCAL_TRANSITION_REVIEW`;
- August 2026 onward: `CURRENT_LOCAL_VOLUNTARY_FOREIGN_MANDATORY`.

This is a conservative engineering boundary, not a legal determination that the current policy began on 1 August. Exact July treatment and formal supersession remain `HUMAN_LEGAL_SIGN_OFF_REQUIRED`.

## 7. Local Employee Rules

For `statutoryNationality = MALAYSIAN`:

- Act 4 not covered: not applicable;
- Act 4 covered but no decision: block with `LINDUNG24_LOCAL_PARTICIPATION_DECISION_REQUIRED` and no deduction;
- `VOLUNTARY_OPT_IN` or accepted `DEFAULT_PARTICIPATING`: contribution required;
- `VOLUNTARY_OPT_OUT` with valid official evidence: no contribution;
- `MANDATORY` is rejected for current-policy months.

## 8. Foreign Worker Rules

For `statutoryNationality = NON_MALAYSIAN`, current eligible coverage is mandatory. The retained PERKESO foreign-worker page also refers to a valid passport and valid work permit/pass. Tetamu currently has canonical nationality and Act 4/SOCSO coverage facts but no dedicated governed passport/work-pass eligibility fact in this resolver. A missing or incomplete mandatory profile therefore blocks with `LINDUNG24_FOREIGN_MANDATORY_PROFILE_INCOMPLETE`; voluntary opt-out is denied.

## 9. Act 4 Coverage

`act4Covered` is an eligibility fact, not a participation decision. `src/lib/payroll/statutory-p2.ts` now supplies the governed SOCSO/Act 4 profile fact to the resolver when no LINDUNG 24 participation version exists. Act 4 coverage alone never auto-enrols a local employee.

## 10. Contribution Rate

| Phase | Effective period | Published rate |
|---|---|---:|
| 1 | 1 Jun 2026–31 May 2028 | 0.75% |
| 2 | 1 Jun 2028–31 May 2031 | 1.00% |
| 3 | From 1 Jun 2031 | 1.25% |

Future phases require their own verified, effective-dated table artifacts before activation.

## 11. Contribution Table / Ceiling / Rounding

Tetamu continues to use the verified normalized PERKESO contribution dataset at `statutory/official/datasets/perkeso-act4-lindung24-2026-06.json`. The model uses official wage bands and table amounts, a RM6,000 wage ceiling, and no `salary × 0.0075` approximation. The official Phase 1 table yields RM22.15 for wages above RM2,900 and up to RM3,000.

## 12. Employee-borne Treatment

The calculated employer contribution is zero. The business withholds and remits the employee amount. `PayrollEntry.lindung24Employee` and the statutory snapshot freeze the employee amount; LINDUNG 24 does not increase employer cost.

## 13. Opt-in

`VOLUNTARY_OPT_IN` is available only to a local employee under the current-policy era. It requires an official acknowledgement date and an evidence reference. A prior opt-in remains protected by the existing once-in governance.

## 14. Opt-out

`VOLUNTARY_OPT_OUT` is available only to a local employee and must use `EMPLOYEE_OPT_OUT`. It produces `NO_CONTRIBUTION`; it is never inferred from missing data. Foreign opt-out and current local `MANDATORY` are rejected.

## 15. Opt-out Evidence

The effective-dated version stores source type, source reference, official acknowledgement date, HR note/reason, recorded actor, revision, digest and superseded-version link. The UI describes the reference as a PERKESO record, notice or acknowledgement reference. No fabricated evidence was created.

## 16. Multiple Employers

`MULTIPLE_EMPLOYER` retains only a current-business, other-employer or PERKESO-selection-pending result. `CURRENT_BUSINESS` may deduct if participation requires it; `OTHER_EMPLOYER` produces no contribution here; pending selection blocks. This prevents duplicate deduction across employers.

## 17. Employer Selection

`LINDUNG24_MULTIPLE_EMPLOYER_SELECTION_REQUIRED` is emitted when selection remains pending or conflicts with a single-employer record. Evidence is business-bound and effective-dated. No other employer's name, salary or payroll is exposed.

## 18. Existing Tetamu Model

Reusable schema/model elements in `prisma/schema.prisma`:

- enums `Lindung24ParticipationStatus`, `Lindung24EmployerContext`, `Lindung24SelectedEmployer`, `Lindung24ParticipationSourceType`;
- `EmployeeLindung24ParticipationVersion` for immutable effective-dated evidence;
- `EmployeeLindung24RefundEvent` for append-only transition/refund review;
- `PayrollEntryStatutorySnapshot` for frozen participation revision and employer selection;
- `PayrollEntry.lindung24Employee` for the employee deduction.

The canonical write functions are `recordEmployeeLindung24Participation` and `recordEmployeeLindung24ParticipationAndRefreshDrafts` in `src/lib/payroll/lindung24-participation-service.ts`. The server action is `recordEmployeeLindung24ParticipationAction` in `src/app/(business)/team/people/[personId]/payroll/actions.ts`.

## 19. Existing Resolver Defect/Gap

Previously, an eligible employee without a participation record fell into generic `PROFILE_INCOMPLETE` / `PARTICIPATION_REQUIRED` semantics inherited from the mandatory era. It did not distinguish local voluntary choice from foreign mandatory coverage, did not model July transition uncertainty, and produced misleading Payroll UI copy.

## 20. New Resolver

`src/lib/payroll/lindung24-participation.ts` now provides:

- `resolveLindung24PolicyEra`;
- `resolveLindung24Eligibility`;
- `resolveLindung24ParticipationForPeriod`; and
- `validateLindung24ParticipationChange`.

The resolver uses only canonical statutory nationality, Act 4 coverage, effective period, immutable participation evidence and business-bound employer selection. It never uses phone number, name, identity shape, salary, branch or language to infer nationality.

## 21. Readiness Semantics

`src/lib/payroll/readiness.ts` and the Payroll Run UI now distinguish:

- `LINDUNG24_APPLICABILITY_INCOMPLETE`;
- `LINDUNG24_LOCAL_PARTICIPATION_DECISION_REQUIRED`;
- `LINDUNG24_FOREIGN_MANDATORY_PROFILE_INCOMPLETE`;
- `LINDUNG24_MULTIPLE_EMPLOYER_SELECTION_REQUIRED`; and
- `LINDUNG24_POLICY_TRANSITION_REVIEW_REQUIRED`.

Legacy codes remain recognized for compatibility. Unknown remains blocking/review-required and never becomes an automatic zero deduction.

## 22. Payroll Component Treatment

`materializeStatutoryP2` in `src/lib/payroll/statutory-p2.ts` freezes the exact verified rule, wage base, participation version, revision and employer selection. `calculateLindung24` in `src/lib/payroll/statutory-p2c.ts` uses the verified table. `src/lib/payroll/component-calculation.ts` creates a deduction named `LINDUNG 24` only when the employee amount is positive.

## 23. Payslip Treatment

The payslip component is an employee deduction named `LINDUNG 24`. A valid opt-out or other-employer selection creates no RM0 line. The legacy export fallback is labeled `LINDUNG 24 (employee deduction)`, not employer contribution.

## 24. HR UI

Route: `/team/people/[personId]?section=statutory`. Component: `Lindung24ParticipationForm` in `src/components/employee-profile-payroll.tsx`.

The card now displays classification, participation requirement, status/effective month, Act 4 coverage, employer selection, source/reference and acknowledgement date. Local UI offers participating/opt-in/opt-out choices and states participation is voluntary. Foreign UI exposes mandatory coverage only. Missing nationality directs HR to set the statutory nationality first.

## 25. Permissions

Writes require `VIEW_STATUTORY_PROFILE`, `EDIT_STATUTORY_PROFILE` and whole-business scope. The service checks the membership belongs to the current business, versions changes in a serializable transaction and writes an audit log. The existing composite tenant foreign key and integration tests reject cross-business membership evidence.

## 26. Effective Dating

Participation changes create a new `EmployeeLindung24ParticipationVersion`, close the prior version at the new effective month, preserve the old row and store a revision/digest/supersedes link. Backward overlap and same-month replacement are rejected.

## 27. Historical Immutability

Finalized/published entries use frozen `PayrollEntryStatutorySnapshot` facts and are not recalculated by this change. Only eligible Draft runs may be refreshed after a canonical profile write. Database triggers reject mutation of participation and refund facts.

## 28. Rule Pack Versioning

Rule/evidence version: `PERKESO_LINDUNG24_CURRENT_POLICY_ALIGNMENT_2026_08_V1`. Engineering status: `READY_FOR_HUMAN_SIGN_OFF`. Legal status: `REQUIRED`. Testing activation performed: no. Production activation: `NOT_ACTIVE`. The initial era is retained; July is an explicit transition-review era; August onward uses the current policy only after the active statutory rule lifecycle permits calculation.

## 29. Local Test Matrix

Unit coverage verifies:

- Act 4 false -> not applicable;
- Act 4 true + no decision -> explicit local decision blocker and no deduction;
- opt-in -> contribution required;
- opt-out -> no contribution;
- current-business selection -> contribution when participating;
- other-employer selection -> no contribution here;
- current local mandatory state -> invalid.

## 30. Foreign Test Matrix

Unit coverage verifies:

- eligible complete mandatory profile -> contribution required;
- eligible profile incomplete -> foreign mandatory profile blocker;
- voluntary opt-out attempt -> rejected;
- Act 4 false -> not applicable.

The missing dedicated passport/work-pass mapping remains a human/legal and future model question, not an assumed fact.

## 31. Multi-employer Tests

Tests verify current employer, other employer and selection-pending behavior, tenant-bound database evidence, composite tenant foreign keys, immutable history and employee-only money. The model discloses no other-business payroll facts.

## 32. Effective-date Tests

Tests cover May (not started), June (initial mandatory), July local (transition review), August local voluntary/current policy, future phase dates, overlapping evidence rejection and frozen statutory snapshots. Finalized-history immutability remains enforced by existing snapshot/version architecture.

## 33. Regression

- targeted unit suites: 28/28 passed;
- full unit suite: 1,133/1,133 passed;
- disposable integration database: main integration 184/184 passed and the additional Employee Attendance route flow 1/1 passed;
- TypeScript: passed after removing the read-only diagnostic helper;
- ESLint: no errors (unrelated repository warnings remain);
- statutory evidence packs: LINDUNG 24 5/5 artifacts, complete, engineering ready, activation blocked by human sign-off;
- artifact verification: every LINDUNG 24 artifact passed; the command still reports an unrelated pre-existing KWSP source-drift failure;
- `git diff --check`: passed.

## 34. Current UAT Payroll Re-evaluation

Known Testing fixture (no mutation performed):

- Employee: `UAT-PAYROLL-001`;
- Business: `Payroll UAT Business`;
- Payroll Run: `2972941a-8067-4076-bf3b-24ddf08b308a`;
- Payroll Entry: `09a34a1a-fc19-40f6-bede-7ce2956b84eb`;
- August 2026, locked Timesheet, basic RM3,000;
- prior blocker: `LINDUNG24_PROFILE_INCOMPLETE`.

Under the aligned resolver, the same missing canonical nationality/applicability data maps to `LINDUNG24_APPLICABILITY_INCOMPLETE`. This remains blocking and produces no automatic contribution or opt-out. If a future canonical Testing-only profile establishes local + Act 4 covered but records no participation decision, readiness becomes `LINDUNG24_LOCAL_PARTICIPATION_DECISION_REQUIRED`.

Testing DB was not mutated. A fresh local CLI connection to Railway Testing could not be opened because the public Postgres TCP proxy is not configured; therefore this re-evaluation uses the already verified exact run/entry fixture facts and the deterministic aligned resolver rather than claiming a new database read.

## 35. Remaining Legal Questions

1. Does FAQ v2.1 legally supersede Employer Circular No. 3/2026 for all local employees from exactly 8 July 2026?
2. How must an employer calculate/report a monthly July 2026 payroll spanning the mid-month change?
3. Which governed Tetamu facts satisfy the official foreign-worker valid-passport and work-pass conditions?
4. Are later opt-in and once-in treatment represented exactly by the current acknowledgement/evidence workflow?
5. What verified tables must be registered for Phase 2 and Phase 3 before their effective dates?

## 36. Human Sign-off Requirements

Human legal/payroll sign-off must confirm the source conflict, July transition treatment, foreign-worker eligibility mapping, opt-in/opt-out evidence semantics and future phase pack plan. Statutory governance must then review, approve and explicitly activate the exact rule revision. Engineering readiness alone cannot activate Production.

## 37. Production Activation Status

Production activation: **NO**. Production touched: **NO**. No Payroll was finalized, no payslip was published, no synthetic statutory evidence was created, and no statutory data was submitted.

## 38. Final Verdict

**ENGINEERING READY — HUMAN LEGAL SIGN-OFF REQUIRED**

Exact next step for the current Payslip UAT is not a bypass: after sign-off, prepare one canonical Testing-only statutory persona for `UAT-PAYROLL-001` through the HR UI—either local + Act 4 covered + official voluntary participation evidence, or local + Act 4 covered + official opt-out evidence. Do not infer nationality or fabricate a reference. Recalculate the Draft only after that evidence exists and the approved rule lifecycle permits it.
