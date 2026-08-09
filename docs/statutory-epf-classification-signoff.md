# EPF / KWSP Classification Human Sign-off

## A. Purpose

This package presents the EPF component-classification candidate for genuine authorized review. It is not an approval record and does not authorize activation.

- Candidate: `MALAYSIA_EPF_2025_10_SIGNOFF_CANDIDATE_1`
- State: `TECHNICAL_REVIEW_COMPLETE / READY_FOR_HUMAN_SIGN_OFF / NOT_SIGNED_OFF`
- Effective from: `2025-10-01`
- Automatic activation: prohibited

## B. Evidence Bound to This Candidate

| Evidence | Digest / identity |
| --- | --- |
| Retained official PDF | SHA-256 `c4904e44f0cb15a251a59e4f34c11a1ededa0868b962b2ebd9b81270285358b1` |
| Dataset | `17c6787a8b28fb0e1b30f9c350a70491a0f882e833b7cf17a3d1251acc45a4b3` |
| Independent review | `6d2edcf0deaa0af863715d33d95b1c6f252abb23d20624265e977e5c81bab541` |
| Golden fixtures | `c087a139b15eed9eadcba55ad99c3131eb67230acb81712744ee9f4c99487860` |
| Golden certification | `313a5094a6ff36301668ecc26093ff329ae4a80d820194f6f3b87aa25061ef72` |
| Calculator test | `7130f1f87b1a6879d50186a1c09456a3e9d1be9d0da4a81e52e886152151fa14` |
| Classification | `4c225701bb96f096516ec8f48a858672a890a8a264fc454252217fa08dfccafc` |
| Complete candidate | `b74b00797be8dd641e47ac685fc6ffbe96d2695498698a4224f79aaf5cf0a3af` |

Official references:

- Third Schedule: https://www.kwsp.gov.my/en/epf-act-1991-third-schedule
- Wage definition and liable/non-liable payments: https://www.kwsp.gov.my/en/what-you-need-to-know-1
- Employer contribution responsibilities: https://www.kwsp.gov.my/en/employer/responsibilities/mandatory-contribution
- Non-Malaysian employee rules: https://www.kwsp.gov.my/en/employer/responsibilities/non-malaysian-citizen-employees

## C. Category Matrix to Confirm

| Frozen facts | Candidate category |
| --- | --- |
| Malaysian, age 14–59 | `PART_A` |
| Malaysian, age 60–74 | `PART_E` |
| Permanent resident, age 14–59 | `PART_A` |
| Permanent resident, age 60–74 | `PART_C` |
| Non-Malaysian elected before 1 August 1998, age 14–59 | `PART_A` |
| Same pre-1998 election, age 60–74 | `PART_C` |
| Other non-Malaysian, age 14–74 | `PART_F` |
| Below 14 or age 75 and above | `NOT_APPLICABLE` |

## D. Component Classification Matrix

`UNKNOWN` is a deliberate blocker. `INCLUDED` and `EXCLUDED` below remain technical candidates until signed.

| Component | EPF | Technical recommendation | Human decision | Risk | Rationale |
| --- | --- | --- | --- | --- | --- |
| `BASIC_SALARY` | INCLUDED | INCLUDE | No | Low | Salary is expressly liable. |
| `REGULAR_DAILY_PAY` | INCLUDED | INCLUDE | No | Daily-rated wages are covered. |
| `REGULAR_HOURLY_PAY` | INCLUDED | INCLUDE | No | Hourly-rated wages are covered. |
| `PAID_LEAVE_PAY` | INCLUDED | INCLUDE | No | Paid leave wages are expressly liable. |
| `LEAVE_PAY` | INCLUDED | INCLUDE_WHEN_PAID_LEAVE | No | Mapping is restricted to paid-leave remuneration. |
| `OVERTIME_PAY` | EXCLUDED | EXCLUDE | No | Overtime payment is expressly non-liable. |
| `REST_DAY_PAY` | UNKNOWN | SEMANTIC_REVIEW_REQUIRED | Yes | High | Current facts do not prove ordinary holiday wage versus overtime. |
| `PUBLIC_HOLIDAY_PAY` | UNKNOWN | SEMANTIC_REVIEW_REQUIRED | Yes | High | Liability depends on whether the payment is overtime. |
| `COMMISSION` | INCLUDED | INCLUDE | No | Commission is expressly liable. |
| `INCENTIVE` | INCLUDED | INCLUDE | No | Incentive is expressly liable. |
| `BONUS` | INCLUDED | INCLUDE | No | Bonus is expressly liable; the schedule has a RM5,000 employer-rate note. |
| `ONE_OFF_EARNING` | UNKNOWN | SOURCE_NATURE_REQUIRED | Yes | High | Generic label can represent liable or excluded payment. |
| `ONE_OFF_DEDUCTION` | EXCLUDED | EXCLUDE_FROM_WAGE_BASE | No | Deduction is not positive remuneration. |
| `ARREARS` | UNKNOWN | ARREARS_STATUTORY_SOURCE_NATURE_REQUIRED | Yes | High | Generic arrears do not prove the original earning nature. |
| `SALARY_ARREARS` | INCLUDED | INCLUDE | No | Salary/wage arrears are expressly liable. |
| `RECOVERY` | EXCLUDED | EXCLUDE_FROM_WAGE_BASE | No | Recovery is not current remuneration. |
| `PAYROLL_RECOVERY` | EXCLUDED | EXCLUDE_FROM_WAGE_BASE | No | Recovery is not current remuneration. |
| `TRANSPORT_ALLOWANCE` | UNKNOWN | SEMANTIC_CLASSIFICATION_REQUIRES_BUSINESS_DEFINITION | Yes | High | Fixed allowance versus excluded travel payment is not frozen. |
| `MEAL_ALLOWANCE` | INCLUDED | INCLUDE_WHEN_FIXED_CASH_ALLOWANCE | No | Fixed contractual cash allowance is liable. |
| `HOUSING_ALLOWANCE` | INCLUDED | INCLUDE_WHEN_FIXED_CASH_ALLOWANCE | No | Fixed contractual cash allowance is liable. |
| `SHIFT_ALLOWANCE` | INCLUDED | INCLUDE | No | Shift allowance is remuneration. |
| `COST_OF_LIVING_ALLOWANCE` | INCLUDED | INCLUDE | No | Fixed contractual cash allowance is liable. |
| `ATTENDANCE_ALLOWANCE` | INCLUDED | INCLUDE | No | Allowance/incentive categories are liable. |
| `PHONE_ALLOWANCE` | UNKNOWN | SEMANTIC_CLASSIFICATION_REQUIRES_BUSINESS_DEFINITION | Yes | High | Allowance versus expense reimbursement is unclear. |
| `FIXED_ALLOWANCE` | UNKNOWN | SEMANTIC_CLASSIFICATION_REQUIRES_BUSINESS_DEFINITION | Yes | High | Frequency does not establish statutory nature. |
| `RECURRING_ALLOWANCE` | UNKNOWN | SEMANTIC_CLASSIFICATION_REQUIRES_BUSINESS_DEFINITION | Yes | High | Exact custom meaning is absent. |
| `STAFF_LOAN` | EXCLUDED | EXCLUDE_FROM_WAGE_BASE | No | Loan deduction is not contribution wages. |
| `UNIFORM_DEDUCTION` | EXCLUDED | EXCLUDE_FROM_WAGE_BASE | No | Employee deduction is not contribution wages. |
| `MANUAL_ADJUSTMENT` | UNKNOWN | SOURCE_NATURE_REQUIRED | Yes | High | Generic adjustment may be wage or non-wage. |
| `CUSTOM_UNKNOWN_EARNING` | UNKNOWN | SOURCE_NATURE_REQUIRED | Yes | High | Deliberate fail-closed sentinel. |

## E. Required UNKNOWN Decisions

The reviewer must resolve all ten items before approval: `REST_DAY_PAY`, `PUBLIC_HOLIDAY_PAY`, `ONE_OFF_EARNING`, `ARREARS`, `TRANSPORT_ALLOWANCE`, `PHONE_ALLOWANCE`, `FIXED_ALLOWANCE`, `RECURRING_ALLOWANCE`, `MANUAL_ADJUSTMENT`, and `CUSTOM_UNKNOWN_EARNING`.

For each one, record a precise business definition, whether it is contribution wages, the official basis, any required component subtype/provenance, and whether historical entries require migration or remain blocked.

## F. Approval Checklist

- [ ] I reviewed the retained official Third Schedule and verified its effective date.
- [ ] I reviewed the official liable/non-liable wage guidance.
- [ ] I confirmed the category matrix and age/nationality/election rules.
- [ ] I confirmed every `INCLUDED` and `EXCLUDED` component.
- [ ] I resolved all ten `UNKNOWN` components without wildcard treatment.
- [ ] I confirmed employee and employer amounts remain separate.
- [ ] I confirmed no legacy flat-percentage fallback is permitted.
- [ ] I confirmed the candidate digest matches this package.
- [ ] I understand this sign-off is required before controlled activation.

## G. Approval Record — Intentionally Blank

| Field | Required value |
| --- | --- |
| Decision | `APPROVE` or `REJECT` |
| Candidate digest | |
| Reviewer name | |
| Reviewer identity / account ID | |
| Reviewer role and authority | |
| Business/legal capacity | |
| Decision timestamp with timezone | |
| Reason | |
| Resolved classification revision | |
| Evidence or advice references | |
| Signature / authenticated approval record ID | |

No field above has been pre-filled or inferred. Until an authorized reviewer completes the record through the controlled workflow, status remains `NOT_SIGNED_OFF`, no ordinary EPF rule may become `ACTIVE`, and payroll must fail closed where EPF evidence is unavailable or ambiguous.
