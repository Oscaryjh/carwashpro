# STATUTORY CLOSURE — SOCSO / EIS CLASSIFICATION APPROVAL & CONTROLLED ACTIVATION

## A. Objective

Answer whether Tetamu can safely calculate SOCSO and EIS for a real supported payroll using retained, verified official rules. The technical calculation path is now proven. Operational closure remains `PARTIAL` because the classification revision has not received genuine platform/business/legal approval and no normal local or Production rule was activated.

## B. P2C Baseline

The phase reuses the existing `StatutoryRuleSet`, artifact manifest, SHA-256 verification, normalized datasets, parser versions, independent review, golden fixtures, classification records, controlled lifecycle, payroll provenance, statutory snapshots and immutable history. No V2 framework was introduced.

Both retained PERKESO schedules contain 65 verified rows. Their independent reviews, golden certifications, calculators, boundary selection and activation evidence gates remain intact.

## C. Classification Matrix

The canonical machine-readable matrix is `statutory/official/classifications/malaysia-socso-eis-2026-technical-review-v1.json`. It contains no duplicate component codes and records scheme-specific treatment, source domain/type, evidence references, confidence, review status and notes.

| Component code | Source domain | SOCSO | EIS | Review status / note |
| --- | --- | --- | --- | --- |
| `BASIC_SALARY` | Compensation | INCLUDED | INCLUDED | High; salary |
| `REGULAR_DAILY_PAY` | Attendance | INCLUDED | INCLUDED | High; daily-rated remuneration |
| `REGULAR_HOURLY_PAY` | Attendance | INCLUDED | INCLUDED | High; hourly-rated remuneration |
| `PAID_LEAVE_PAY` | Attendance | INCLUDED | INCLUDED | High; leave remuneration |
| `LEAVE_PAY` | Payroll calculation | INCLUDED | INCLUDED | Metadata alias only |
| `OVERTIME_PAY` | Payroll calculation | INCLUDED | INCLUDED | Classification only; money policy remains blocked |
| `REST_DAY_PAY` | Payroll calculation | INCLUDED | INCLUDED | Classification only; money policy remains blocked |
| `PUBLIC_HOLIDAY_PAY` | Payroll calculation | INCLUDED | INCLUDED | Classification only; money policy remains blocked |
| `COMMISSION` | Variable pay | INCLUDED | INCLUDED | High; commission/service charge |
| `INCENTIVE` | Variable pay | INCLUDED | INCLUDED | High; incentive allowance |
| `BONUS` | Variable pay | UNKNOWN | UNKNOWN | Annual/non-annual subtype is not retained |
| `ONE_OFF_EARNING` | Variable pay | UNKNOWN | UNKNOWN | Statutory nature is not retained |
| `ONE_OFF_DEDUCTION` | Variable pay | EXCLUDED | EXCLUDED | Does not reduce wage base |
| `ARREARS` | Variable pay | UNKNOWN | UNKNOWN | Original earning nature required |
| `SALARY_ARREARS` | Correction | UNKNOWN | UNKNOWN | Original classified component required |
| `RECOVERY` | Variable pay | EXCLUDED | EXCLUDED | Net-cash deduction only |
| `PAYROLL_RECOVERY` | Correction | EXCLUDED | EXCLUDED | Net-cash deduction only |
| `TRANSPORT_ALLOWANCE` | Recurring pay | EXCLUDED | EXCLUDED | Travelling allowance exclusion |
| `MEAL_ALLOWANCE` | Recurring pay | INCLUDED | INCLUDED | High; expressly listed guidance |
| `HOUSING_ALLOWANCE` | Recurring pay | INCLUDED | INCLUDED | High; expressly listed guidance |
| `SHIFT_ALLOWANCE` | Recurring pay | INCLUDED | INCLUDED | High; expressly listed guidance |
| `COST_OF_LIVING_ALLOWANCE` | Recurring pay | INCLUDED | INCLUDED | High; expressly listed guidance |
| `ATTENDANCE_ALLOWANCE` | Recurring pay | INCLUDED | INCLUDED | Medium; canonical meaning needs platform confirmation |
| `PHONE_ALLOWANCE` | Recurring pay | UNKNOWN | UNKNOWN | Allowance/reimbursement subtype required |
| `FIXED_ALLOWANCE` | Recurring pay | UNKNOWN | UNKNOWN | Frequency alone is insufficient |
| `RECURRING_ALLOWANCE` | Recurring pay | UNKNOWN | UNKNOWN | Exact custom code required |
| `STAFF_LOAN` | Recurring pay | EXCLUDED | EXCLUDED | Net-cash deduction only |
| `UNIFORM_DEDUCTION` | Recurring pay | EXCLUDED | EXCLUDED | Net-cash deduction only |
| `MANUAL_ADJUSTMENT` | Manual adjustment | UNKNOWN | UNKNOWN | Statutory subtype required |
| `CUSTOM_UNKNOWN_EARNING` | Sentinel | UNKNOWN | UNKNOWN | Fail-closed proof case |

`PAYMENT_FIXTURE` was observed only in tests and is explicitly not production-approved. No taxable flag, EPF treatment or cross-scheme inference is used. There is no manufactured SOCSO/EIS difference: the reviewed official wage definitions support the same treatment for this component set, while the engine still resolves each scheme independently.

## D. Official Basis

The technical review used primary PERKESO material:

- `PERKESO_ACT4_WAGES_2_24`: Employees’ Social Security Act 1969, Act 4, section 2(24), page 13. SHA-256 at review: `c2b96c7d29cc3cde3fcb77c036866ecfc724baab657193dc593f76b97953beb7`.
- `PERKESO_ACT800_WAGES_2`: Employment Insurance System Act 2017, Act 800, section 2, page 9. SHA-256 at review: `d1477fa725e489fde9904b530aaba354ae53c061ae97e5e18b648a9d03b058f2`.
- `PERKESO_EMPLOYER_WAGE_GUIDANCE`: PERKESO Employer Registration — Definition of Wages.
- `PERKESO_FAQ_CONTRIBUTION_WAGES`: PERKESO contribution-wage FAQ.

The Acts define monetary remuneration broadly, include leave/holiday and overtime remuneration, and list exclusions such as travelling allowance/concession, special employment expenses, gratuity and annual bonus. PERKESO’s employer guidance expressly lists salary, overtime, commission/service charge, paid leave, incentive, shift, meal, cost-of-living and housing allowances.

## E. Review Method

The review was performed as `AI_ASSISTED_REVIEW`. Official PDFs were retained, hashed, rendered and visually inspected at the cited pages; extracted text was used only for navigation. Every current, future/legacy or generic component family was reconciled against the two scheme definitions. Ambiguous semantic categories remain `UNKNOWN`.

This is a technical evidence review, not `LEGAL_APPROVED`, `GOVERNMENT_CERTIFIED` or `HUMAN_LEGAL_REVIEW`.

## F. Approved Classification Revision

No genuine approved revision was fabricated. The new immutable-on-activation candidate is:

`MALAYSIA_STATUTORY_CLASSIFICATION_2026_SOCSO_EIS_TECHNICAL_REVIEW_1`

It records the prior P2C draft, reviewer type, reason, timestamp, official references and digest `23fa2469355c5bd8733451b0b6807c37ee3ef6bcccf74949deb733dc525c8566`. Its status is `READY_FOR_PLATFORM_APPROVAL`; `platformApprovalStatus` remains `REQUIRED`.

## G. SOCSO Activation Preconditions

Artifact, SHA-256, retained 65-row dataset, dataset digest, independent review, golden certification, calculator, boundary/ceiling behavior and exact effective-period evidence pass. Technical classifications are available for the supported component set, and unknown entries fail closed.

The remaining precondition is authenticated platform approval of the classification candidate. Therefore no ordinary SOCSO rule activation was performed.

## H. EIS Activation Preconditions

The same evidence chain passes for EIS: official artifact, SHA-256, retained 65-row dataset, digest, independent review, golden certification, calculator, boundaries/ceiling and exact effective period. Authenticated platform approval remains outstanding, so no ordinary EIS rule activation was performed.

## I. Controlled Activation Result

An isolated integration fixture proved the existing platform-only controlled command independently for SOCSO and EIS. It required an explicit `PLATFORM_ADMIN` test actor, reason, exact scheme/version/effective date and complete digest-bound evidence, ran through the serializable audited lifecycle, then retired both test rules in `finally`.

Context: local test database only. This was an activation dry run, not Production activation, deployment, seed activation, migration activation or startup activation. No normal ACTIVE rule remains from the dry run.

## J. Payroll Dry Run

The integration test used the production-like domain path:

`Payroll Draft → frozen components → scheme classification → retained rule dataset → SOCSO/EIS calculator → statutory snapshot → employee deduction component → employer contribution → aggregate reconciliation`

Covered cases: monthly basic pay, monthly basic plus verified recurring meal allowance, daily pay, hourly pay, exact boundary, just below, just above, above RM6,000 ceiling, excluded transport/loan lines, unknown manual earning, and legitimately EIS-ineligible non-Malaysian profile.

## K. Boundary / Ceiling Validation

Through payroll integration, RM2,999.99 and RM3,000.00 selected Act 4/Act 800 row 34; RM3,000.01 selected row 35. Wages above RM6,000 selected row 65. The official table amounts were used directly in integer sen; no contribution amount was re-rounded.

## L. Statutory Snapshots

Calculated snapshots retain rule version, artifact digest, dataset digest, golden fixture digest, classification revision, calculator version, matched row, wage base, employee amount, employer amount, frozen profile version and calculation-input/source digests. Component treatment snapshots retain each scheme’s classification and rationale.

## M. Reconciliation

At RM3,000 monthly wage, the dry run produced SOCSO employee RM14.75/employer RM51.65 and EIS employee RM5.90/employer RM5.90. Net pay was RM2,979.35. Employer contributions remain separate and do not enter employee net deductions.

A minimal additive migration corrected the existing database reconciliation function so traceability-only `STATUTORY` component lines are not counted a second time as `otherDeductions`. No table, column or enum was added.

Repeated materialization increments `calculationRevision`, replaces system statutory lines idempotently, retains the same row/amount/provenance and never duplicates SOCSO/EIS deductions.

## N. Unknown Classification Behaviour

Any missing or `UNKNOWN` scheme classification produces `STATUTORY_CLASSIFICATION_REQUIRED`, stores a blocked snapshot and does not create a statutory deduction line for that scheme. Unknown earnings are never ignored or defaulted to included.

## O. Eligibility / Profile Behaviour

SOCSO requires an explicit frozen category. EIS distinguishes valid non-applicability (non-Malaysian, outside ages 18–59, or age 57+ without prior contribution) from missing date of birth or nationality. Genuine missing facts produce `STATUTORY_PROFILE_INCOMPLETE`; no category or eligibility fact is defaulted.

## P. Historical Immutability

Draft provenance comparison returns `STATUTORY_RULE_CHANGED` / refresh required when rule or classification identity changes. Finalized payroll remains historical and is not auto-recalculated. Active artifact provenance is database-immutable; a later rule/profile revision does not rewrite stored snapshots.

## Q. Permissions

Activation continues to require the internal platform role, explicit reason and exact evidence; Business Owner is denied. Payroll Admin can consume only an already active verified rule. This phase did not add a business-facing global classification editor and did not impersonate a human/legal approval.

## R. Tenant Safety

Payroll materialization scopes all reads/writes by trusted `businessId`, `membershipId`, `payrollRunId` and `payrollEntryId`. Existing composite provenance and tenant guards remain in force. Global rules/classifications contain no employee profile payload.

## S. Performance

The payroll-run service loads applicable active rules plus classifications once before the employee loop and passes the frozen collection to each materialization. It does not reload a 65-row PDF/dataset or classification file per employee. Runtime calculation performs no network access.

## T. Tests

Targeted unit coverage validates 65-row datasets, all boundaries, golden fixtures, activation denial/success gates, stale/finalized behavior, matrix coverage/digest/honesty, no-network runtime, batched rule loading and additive reconciliation migration. The integration dry run validates real database/domain behavior, provenance, employer totals, idempotent recalculation and test-rule retirement.

The final command results are recorded in the final task report rather than hard-coded here.

## U. Remaining EPF Blockers

EPF remains `PARTIAL`: exact official Third Schedule bytes, normalized dataset, independent review, golden fixtures and calculator activation are not complete. This phase generated no EPF contribution.

## V. Remaining LINDUNG24 Blockers

LINDUNG24 remains `PARTIAL / BLOCKED`: the amount table is verified, but versioned participation/selected-employer evidence, July 2026 transition/refund reconciliation, golden certification and classification approval remain incomplete. This phase made no LINDUNG24 implementation change.

## W. PCB Boundary

PCB remains `BLOCKED`. No MTD engine, YTD ledger, TP1/TP3, relief, zakat, previous-employer or additional-remuneration logic was added or changed.

## X. Risks

- The technical candidate still needs accountable platform/business/legal review before ordinary activation.
- `BONUS`, one-off earning, arrears/correction earnings, phone/fixed/custom allowances and generic manual adjustments lack enough semantic provenance and remain fail closed.
- Attendance allowance is technically included only under its documented incentive meaning and needs platform confirmation.
- Statutory classification metadata for overtime/rest-day/public-holiday pay does not remove Payroll P5 money-policy blockers.

## Y. Recommended Next Action

An authorized platform reviewer should verify the official references, confirm canonical component meanings (especially attendance allowance), explicitly approve or amend the candidate revision, record the approval, and then run separate controlled SOCSO and EIS local activation previews/commands. Production activation remains a separate authorized operation.

Payment P3A remains `PUBLIC_BANK_SPEC_NOT_READY`.

## Z. Closure Status

Technical supported-payroll calculation: **PASS in isolated local dry run**.

Operational activation approval: **NOT COMPLETE**.

```text
SOCSO — PARTIAL
EIS — PARTIAL
STATUTORY SOCSO/EIS CLOSURE — PARTIAL
```
