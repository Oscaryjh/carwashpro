# SOCSO / EIS Classification Human Sign-off

## A. Purpose

This is the human sign-off package for Tetamu's SOCSO and EIS production component classifications. It prepares evidence and decisions for an authorized platform/business/legal reviewer. It is not an approval record and does not authorize rule activation.

Candidate revision: `MALAYSIA_STATUTORY_CLASSIFICATION_2026_SOCSO_EIS_SIGNOFF_CANDIDATE_1`

Candidate state: `TECHNICAL_REVIEW_COMPLETE / READY_FOR_HUMAN_SIGN_OFF / NOT_SIGNED_OFF`

## B. Technical State

- Official SOCSO and EIS artifacts: verified retained artifacts.
- Normalized contribution datasets: 65/65 rows verified for each scheme.
- Independent dataset reviews: pass.
- Golden fixtures: verified (SOCSO 20; EIS 11).
- Calculators and all table boundaries: verified.
- Production-like Payroll integration dry run: verified.
- Controlled activation mechanism: verified only with isolated test evidence and automatic retirement.
- Production activation: not performed.
- Normal ACTIVE SOCSO/EIS rule: none.

## C. Official Sources

Abbreviations used in the matrix:

- `A4`: Employees' Social Security Act 1969 [Act 4], section 2(24), wages. Retained reviewed PDF page 13; reviewed PDF SHA-256 `c2b96c7d29cc3cde3fcb77c036866ecfc724baab657193dc593f76b97953beb7`. Official URL: https://perkeso.gov.my/images/imej/akta_dan_peraturan/Act%204-As%20at%201_Feb_2019.pdf
- `A800`: Employment Insurance System Act 2017 [Act 800], section 2, wages. Retained reviewed PDF page 9; reviewed PDF SHA-256 `d1477fa725e489fde9904b530aaba354ae53c061ae97e5e18b648a9d03b058f2`. Official URL: https://perkeso.gov.my/images/imej/akta_dan_peraturan/EMPLOYMENT_INSURANCE_SYSTEM_ACT_2017_Act_800.pdf
- `WG`: PERKESO Employer Registration - Definition of Wages: https://www.perkeso.gov.my/en/our-services/employer-employee/employer-registration.html
- `FAQ`: PERKESO Frequently Asked Questions - contribution wages: https://www.perkeso.gov.my/en/contact-us/pejabat-perkeso-new/frequently-asked-question.html
- `B25`: PERKESO 2025 Guidelines on Social Security Protection, Definition of Wages: https://www.perkeso.gov.my/images/dokumen/risalah/2025-BOOKLET_PERKESO_BI.pdf

The Acts include monetary remuneration, leave, holidays, overtime and extra work on holidays. They exclude travelling allowance/concession, special employment expenses, discharge/retirement gratuity and annual bonus. PERKESO guidance expressly includes salary, overtime, commission/service charge, paid leave, incentive, shift, meal, cost-of-living and housing allowances, while describing mileage/travelling claims as excluded.

## D. Classification Matrix

SOCSO and EIS decisions remain separate fields even where the technical recommendation is currently identical.

| Component | Business meaning | Domain | SOCSO | EIS | Basis | Technical recommendation | Human decision? | Status / risk / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `BASIC_SALARY` | Contractual monthly salary | Compensation | INCLUDED | INCLUDED | A4, A800, WG | Include | NO | Evidence pass; low risk |
| `REGULAR_DAILY_PAY` | Ordinary daily-rated remuneration | Attendance | INCLUDED | INCLUDED | A4, A800, WG | Include | NO | Evidence pass; low risk |
| `REGULAR_HOURLY_PAY` | Ordinary hourly-rated remuneration | Attendance | INCLUDED | INCLUDED | A4, A800, WG | Include | NO | Evidence pass; low risk |
| `PAID_LEAVE_PAY` | Remuneration for approved paid leave | Attendance | INCLUDED | INCLUDED | A4, A800, WG | Include | NO | Evidence pass; low risk |
| `LEAVE_PAY` | Legacy/future paid-leave alias | Payroll calculation | INCLUDED | INCLUDED | A4, A800 | Include only when paid leave | NO | Current path emits `PAID_LEAVE_PAY` |
| `OVERTIME_PAY` | Approved overtime remuneration | Payroll calculation | INCLUDED | INCLUDED | A4, A800, WG | Include | NO | Classification only; rate policy remains blocked |
| `REST_DAY_PAY` | Extra-work remuneration on rest day | Payroll calculation | INCLUDED | INCLUDED | A4, A800, WG | Include | NO | Classification only; rate policy remains blocked |
| `PUBLIC_HOLIDAY_PAY` | Remuneration for work on public holiday | Payroll calculation | INCLUDED | INCLUDED | A4, A800, WG | Include | NO | Classification only; rate policy remains blocked |
| `COMMISSION` | Approved frozen commission | Variable pay | INCLUDED | INCLUDED | A4, A800, WG, FAQ | Include | NO | Express official guidance; low risk |
| `INCENTIVE` | Approved frozen incentive remuneration | Variable pay | INCLUDED | INCLUDED | A4, A800, WG, FAQ | Include | NO | Express official guidance; low risk |
| `BONUS` | Generic bonus without subtype | Variable pay | UNKNOWN | UNKNOWN | A4, A800, WG | Block until subtype defined | YES | Annual bonus differs from performance incentive; high risk |
| `ONE_OFF_EARNING` | Generic one-off addition | Variable pay | UNKNOWN | UNKNOWN | A4, A800 | Block until statutory nature defined | YES | Could be remuneration, reimbursement, gratuity or bonus |
| `ONE_OFF_DEDUCTION` | Employee net-cash deduction | Variable pay | EXCLUDED | EXCLUDED | A4, A800 | Do not reduce wage base | NO | Explicit deduction, not remuneration payable |
| `ARREARS` | Underpayment without original earning type | Variable pay | UNKNOWN | UNKNOWN | A4, A800 | `ARREARS_STATUTORY_SOURCE_NATURE_REQUIRED` | YES | Original nature is not retained; high risk |
| `SALARY_ARREARS` | Correction underpayment without original component binding | Correction | UNKNOWN | UNKNOWN | A4, A800 | `ARREARS_STATUTORY_SOURCE_NATURE_REQUIRED` | YES | P4C delta does not prove original earning category |
| `RECOVERY` | Employee repayment/recovery deduction | Variable pay | EXCLUDED | EXCLUDED | A4, A800 | Do not reduce current wage base | NO | Net-cash deduction; separate historical correction may be needed if source facts were wrong |
| `PAYROLL_RECOVERY` | P4C correction recovery deduction | Correction | EXCLUDED | EXCLUDED | A4, A800 | Do not reduce current wage base | NO | Net-cash deduction; not negative current remuneration |
| `TRANSPORT_ALLOWANCE` | Configurable transport-related recurring earning | Recurring pay | UNKNOWN | UNKNOWN | A4, A800, WG, B25 | Semantic classification requires business definition | YES | Code does not prove reimbursement/mileage versus fixed remuneration; high risk |
| `MEAL_ALLOWANCE` | Recurring meal allowance remuneration | Recurring pay | INCLUDED | INCLUDED | A4, A800, WG, FAQ | Include | NO | Express official guidance; low risk |
| `HOUSING_ALLOWANCE` | Recurring housing allowance remuneration | Recurring pay | INCLUDED | INCLUDED | A4, A800, WG, FAQ | Include | NO | Express official guidance; low risk |
| `SHIFT_ALLOWANCE` | Recurring shift allowance remuneration | Recurring pay | INCLUDED | INCLUDED | A4, A800, WG | Include | NO | Express official guidance; low risk |
| `COST_OF_LIVING_ALLOWANCE` | Recurring cost-of-living allowance | Recurring pay | INCLUDED | INCLUDED | A4, A800, WG, FAQ | Include | NO | Express official guidance; low risk |
| `ATTENDANCE_ALLOWANCE` | Intended attendance incentive; canonical meaning not enforced | Recurring pay | INCLUDED | INCLUDED | A4, A800, WG, FAQ | Include only if confirmed as incentive | YES | Medium semantic risk; human confirmation required |
| `PHONE_ALLOWANCE` | Phone allowance or expense reimbursement | Recurring pay | UNKNOWN | UNKNOWN | A4, A800 | Block until subtype defined | YES | Fixed remuneration versus special-expense reimbursement unclear |
| `FIXED_ALLOWANCE` | Generic fixed recurring earning | Recurring pay | UNKNOWN | UNKNOWN | A4, A800 | Block until nature defined | YES | Fixed frequency is not statutory nature |
| `RECURRING_ALLOWANCE` | Generic/custom recurring earning | Recurring pay | UNKNOWN | UNKNOWN | A4, A800 | Block until exact code defined | YES | No safe wildcard treatment |
| `STAFF_LOAN` | Staff-loan repayment deduction | Recurring pay | EXCLUDED | EXCLUDED | A4, A800 | Do not reduce wage base | NO | Explicit repayment deduction |
| `UNIFORM_DEDUCTION` | Uniform-related employee deduction | Recurring pay | EXCLUDED | EXCLUDED | A4, A800 | Do not reduce wage base | NO | Explicit employee deduction |
| `MANUAL_ADJUSTMENT` | Generic manual earning or deduction | Manual adjustment | UNKNOWN | UNKNOWN | A4, A800 | Block until statutory subtype defined | YES | Manual origin proves no statutory nature; high risk |
| `CUSTOM_UNKNOWN_EARNING` | Unknown/custom earning sentinel | Any | UNKNOWN | UNKNOWN | A4, A800 | Block until exact code defined | YES | Deliberate fail-closed sentinel |

`PAYMENT_FIXTURE` is test-only and is not a production classification candidate.

## E. Safe Approved Candidates

These are technical candidates with direct official support. The word "candidate" does not mean human-approved.

Included candidates:

- `BASIC_SALARY`
- `REGULAR_DAILY_PAY`
- `REGULAR_HOURLY_PAY`
- `PAID_LEAVE_PAY` / paid-leave-only `LEAVE_PAY`
- `OVERTIME_PAY`
- `REST_DAY_PAY`
- `PUBLIC_HOLIDAY_PAY`
- `COMMISSION`
- `INCENTIVE`
- `MEAL_ALLOWANCE`
- `HOUSING_ALLOWANCE`
- `SHIFT_ALLOWANCE`
- `COST_OF_LIVING_ALLOWANCE`

Deduction candidates that must not reduce the contribution wage base:

- `ONE_OFF_DEDUCTION`
- `RECOVERY`
- `PAYROLL_RECOVERY`
- `STAFF_LOAN`
- `UNIFORM_DEDUCTION`

Conditional candidate requiring business confirmation:

- `ATTENDANCE_ALLOWANCE`: include only if the canonical meaning is an attendance incentive and cannot be reimbursement or another payment type.

## F. Ambiguous Components

The following remain `UNKNOWN` for both SOCSO and EIS:

- `TRANSPORT_ALLOWANCE`
- `BONUS`
- `ONE_OFF_EARNING`
- `ARREARS`
- `SALARY_ARREARS`
- `PHONE_ALLOWANCE`
- `FIXED_ALLOWANCE`
- `RECURRING_ALLOWANCE`
- `MANUAL_ADJUSTMENT`
- `CUSTOM_UNKNOWN_EARNING`

UNKNOWN is an intentional safe result. Any of these in a Payroll Entry must produce `STATUTORY_CLASSIFICATION_REQUIRED` and prevent statutory calculation/finalization for the affected scheme.

## G. Transport Allowance Review

Decision for this sign-off candidate: `UNKNOWN` for SOCSO and EIS.

The official exclusion covers travelling allowance/concession and PERKESO guidance describes mileage/travelling claims as excluded. Tetamu currently permits the configurable code `TRANSPORT_ALLOWANCE` without enforcing whether it means an expense reimbursement, mileage claim, travelling concession or fixed recurring remuneration. Classification based only on the display label is unsafe.

Required business question:

```text
TRANSPORT_ALLOWANCE is:
[ ] A. reimbursement / travel expense
[ ] B. mileage claim
[ ] C. fixed monthly transport allowance
[ ] D. other: ______________________________

Canonical business definition and supporting policy:
____________________________________________________
```

Semantic classification requires business definition. No new component code or rename is introduced by this preparation task.

## H. Bonus Review

Decision: generic `BONUS` remains `UNKNOWN`.

```text
BONUS is:
[ ] A. annual bonus
[ ] B. performance incentive
[ ] C. ad-hoc reward
[ ] D. other: ______________________________

Canonical subtype policy:
____________________________________________________
```

The Acts expressly exclude annual bonus. That does not justify treating every performance incentive or ad-hoc reward as an annual bonus.

## I. Arrears Review

Decision: `ARREARS` and `SALARY_ARREARS` remain `UNKNOWN` with blocker `ARREARS_STATUTORY_SOURCE_NATURE_REQUIRED`.

Current P4C retains a correction delta but does not bind the arrears line to the original statutory component category. Treatment may differ for arrears of basic salary, commission, annual bonus or reimbursement.

```text
What original earning type does this arrears/correction relate to?
____________________________________________________

How is the original classification revision referenced?
____________________________________________________
```

Future minimal task: retain an immutable original component/category reference and its statutory classification revision. Do not expand the entire correction engine for this purpose.

## J. Manual / Generic Earnings

`ONE_OFF_EARNING`, `PHONE_ALLOWANCE`, `FIXED_ALLOWANCE`, `RECURRING_ALLOWANCE`, `MANUAL_ADJUSTMENT` and custom earnings do not retain enough statutory meaning. Their frequency, display name, taxable flag or manual origin cannot establish SOCSO/EIS treatment.

Business reviewers must define an exact canonical meaning or intentionally leave these codes blocked. SOCSO and EIS decisions must be recorded independently.

## K. Sign-off Checklist

```text
[ ] Official sources reviewed
[ ] Component business meanings reviewed
[ ] UNKNOWN classifications resolved or intentionally blocked
[ ] Transport allowance meaning confirmed
[ ] Bonus subtype policy confirmed
[ ] Arrears source-nature rule confirmed
[ ] Attendance allowance incentive meaning confirmed
[ ] SOCSO classifications reviewed independently
[ ] EIS classifications reviewed independently
[ ] SOCSO classification approved
[ ] EIS classification approved
[ ] Approval recorded as a new immutable revision
```

## L. Approval Record

Leave blank until an authorized human actor completes the sign-off.

```text
Approved By:

Role:

Approval Date:

Classification Revision:

SOCSO Decision:

EIS Decision:

Reason / Notes:

Signature / Approval Reference:
```

This document must not be changed to `APPROVED`, `LEGAL_APPROVED` or `PLATFORM_APPROVED` by an automated process.

## M. Activation Preconditions

Controlled activation is allowed only after all of the following:

1. An authorized human reviewer completes the checklist and approval record.
2. A new immutable approved classification revision or approval record is created; this sign-off candidate is not overwritten.
3. The approval record has a stable digest, approving actor ID and timestamp.
4. The candidate's UNKNOWN components are resolved or remain intentionally fail-closed.
5. SOCSO and EIS each pass their own artifact, dataset, review, fixture, calculator, boundary and effective-period checks.
6. The platform-only command receives the same human approval evidence that was bound during calculation verification.
7. Activation remains explicit, reason-required, audited and serializable.

The database schema can retain classification version/digest and lifecycle evidence digests, but it does not currently provide a dedicated human classification approval entity. The activation gate therefore binds approval metadata into the verified evidence/audit digest. If a richer approval workflow is required, it should be a separate, narrowly scoped future task.

## N. Remaining Blocked Components

At candidate revision `...SIGNOFF_CANDIDATE_1`, unresolved count is 10:

`ARREARS`, `BONUS`, `CUSTOM_UNKNOWN_EARNING`, `FIXED_ALLOWANCE`, `MANUAL_ADJUSTMENT`, `ONE_OFF_EARNING`, `PHONE_ALLOWANCE`, `RECURRING_ALLOWANCE`, `SALARY_ARREARS`, `TRANSPORT_ALLOWANCE`.

`ATTENDANCE_ALLOWANCE` is not UNKNOWN in the technical recommendation, but it still requires explicit human confirmation before sign-off.

## O. Production Safety

- No Production migration was performed.
- No Production rule activation was performed.
- No normal local SOCSO or EIS rule was activated.
- A technical review or `READY_FOR_HUMAN_SIGN_OFF` candidate cannot satisfy the activation gate without human sign-off evidence.
- Payroll continues to fail closed for unknown classifications.
- SOCSO and EIS remain `PARTIAL` operationally until authorized sign-off and controlled activation occur.
- EPF, LINDUNG24, PCB and Payment were not changed by this preparation task.
