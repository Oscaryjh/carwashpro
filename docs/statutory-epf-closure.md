# STATUTORY EPF CLOSURE — OFFICIAL SCHEDULE VERIFICATION & PAYROLL INTEGRATION

## A. Objective

Close the engineering evidence chain for Malaysia EPF/KWSP without treating technical verification as legal approval. The supported outcome is a deterministic, fail-closed payroll path backed by the retained official Third Schedule, ready for an authorized human classification sign-off. This work does not activate an ordinary EPF rule.

## B. Existing EPF Audit

- **CANONICAL:** `StatutoryRuleSet`, retained artifact manifest, normalized dataset, independent review, golden certification, controlled lifecycle, frozen payroll components, statutory snapshots, employee deduction, employer liability, export and payslip paths.
- **LEGACY:** `src/lib/payroll/statutory.ts` contains a percentage approximation. It is not used by the forward P2 statutory materialization path.
- **UNVERIFIED (closed):** the previous EPF placeholder lacked a retained official binary and a complete category-aware schedule. The retained artifact and full dataset now close this evidence gap.
- **UNSAFE (excluded):** a flat percentage cannot reproduce the official fixed contribution table through RM20,000 and must not be used as a fallback.
- **BLOCKED:** ordinary rule activation remains blocked until genuine human classification approval is recorded.

## C. Official Artifact

The retained source is the KWSP Third Schedule effective 1 October 2025:

`statutory/official/artifacts/kwsp-third-schedule-2025-10.pdf`

Official landing page: https://www.kwsp.gov.my/en/epf-act-1991-third-schedule

## D. Artifact Integrity

- Bytes: `761109`
- Pages: `55`
- SHA-256: `c4904e44f0cb15a251a59e4f34c11a1ededa0868b962b2ebd9b81270285358b1`
- Parser: `2.0.0`
- Manifest state: `PARSED / VERIFIED`
- Retention policy: verified official bytes and normalized datasets are retained.

## E. Effective Period

The rule candidate starts on `2025-10-01` and has no fabricated end date. Payroll calculation selects rules by the payroll period/effective-date contract; no current website content is fetched during calculation.

## F. Category Matrix

| Frozen employee facts | Schedule category |
| --- | --- |
| Malaysian, age 14–59 | Part A |
| Malaysian, age 60–74 | Part E |
| Permanent resident, age 14–59 | Part A |
| Permanent resident, age 60–74 | Part C |
| Non-Malaysian who elected before 1 August 1998, age 14–59 | Part A |
| Same pre-1998 election, age 60–74 | Part C |
| Other non-Malaysian, age 14–74 | Part F |
| Below 14 or age 75 and above | Not applicable |

Missing date of birth, nationality or required election evidence fails closed as an incomplete statutory profile.

## G. Complete Dataset

`statutory/official/datasets/kwsp-third-schedule-2025-10.json` contains 401 contiguous wage boundaries shared by Parts A, C and E, with category-specific employee and employer amounts. Part F is formula-only. Expected/parsed counts are 1,203 category rows, representing 401 rows for each table category; gaps and overlaps are zero.

Dataset digest: `17c6787a8b28fb0e1b30f9c350a70491a0f882e833b7cf17a3d1251acc45a4b3`.

## H. Independent Review

All 55 pages were rendered and visually reviewed as an AI-assisted second path. Parts A, C and E were reconciled independently against extracted boundaries and amounts. Expected rows: 1,203; reviewed rows: 1,203; mismatches: 0. This is a technical review, not legal or government certification.

Review digest: `6d2edcf0deaa0af863715d33d95b1c6f252abb23d20624265e977e5c81bab541`.

## I. Golden Fixtures

The immutable golden set contains 21 cases spanning low wages, ordinary wages, table boundaries, just-below/at/just-above transitions, above-RM20,000 formulas and all four categories. Fixture digest: `c087a139b15eed9eadcba55ad99c3131eb67230acb81712744ee9f4c99487860`. Certification digest: `313a5094a6ff36301668ecc26093ff329ae4a80d820194f6f3b87aa25061ef72`.

## J. Boundary Rules

For Parts A, C and E, wages up to RM20,000 select the exact official table interval. Selection uses integer sen and inclusive lower/upper bounds from the retained dataset. No contribution is reconstructed from a nominal rate inside the table range.

## K. High-Wage Rules

Above RM20,000, the schedule formulas apply by category: Part A employee 11% and employer 12%; Part C employee 5.5% and employer 6%; Part E employee 0% and employer 4%. Part F is employee 2% and employer 2% for its whole range. Each side is independently rounded upward to the next ringgit using exact integer arithmetic.

## L. EPF Component Classification

The candidate covers 30 production component codes. Safe entries are explicitly `INCLUDED` or `EXCLUDED`; ten ambiguous codes remain `UNKNOWN`. The machine-readable candidate is `statutory/official/classifications/malaysia-epf-2025-10-signoff-candidate-v1.json`, revision `MALAYSIA_EPF_2025_10_SIGNOFF_CANDIDATE_1`.

Classification digest: `4c225701bb96f096516ec8f48a858672a890a8a264fc454252217fa08dfccafc`. Candidate digest: `b74b00797be8dd641e47ac685fc6ffbe96d2695498698a4224f79aaf5cf0a3af`.

## M. Wage Base

The EPF wage base is the sum of frozen payroll earning components whose EPF treatment is `INCLUDED`. Excluded deductions do not reduce the wage base. Any positive earning with a missing or `UNKNOWN` EPF classification blocks materialization; no wildcard, taxable flag or cross-scheme inference is allowed.

## N. Calculator

`calculateEpf` is category-aware and deterministic. It consumes only the retained normalized dataset, integer wage amount and selected category. It returns matched row/formula provenance, employee contribution, employer contribution, rule version and evidence digests. Calculator version: `statutory-p2c-epf-calculator/1.0.0`; verification digest: `7130f1f87b1a6879d50186a1c09456a3e9d1be9d0da4a81e52e886152151fa14`.

## O. Payroll Integration

The dry run exercised the real path:

`Payroll draft → frozen components/profile → EPF classification → retained dataset → category-aware calculator → immutable statutory snapshot → employee deduction → employer liability → reconciliation`

It covered monthly, daily, hourly, recurring allowance and commission earnings; table boundaries; high wages; unknown components; incomplete profiles; idempotent recalculation; and final retirement of the test-only rule.

## P. Employee Contribution

The employee amount is emitted as the `EPF_EMPLOYEE` deduction component and displayed as `EPF / KWSP`. It reduces net pay exactly once and retains calculation provenance in the statutory snapshot.

## Q. Employer Contribution

The employer amount is stored separately as an employer liability. It does not reduce employee net pay and is included in statutory employer totals and reconciliation.

## R. Reconciliation

Entry totals separately expose `epfEmployee` and `epfEmployer`. Repeated materialization replaces system statutory lines idempotently, increments calculation revision, and does not duplicate employee deductions or employer liabilities.

## S. Readiness

Artifact, dataset, independent review, golden fixtures, calculator and payroll integration are verified. Classification is `READY_FOR_HUMAN_SIGN_OFF`; activation is blocked. Calculation readiness also fails closed when the rule is missing/inactive, the employee profile is incomplete, evidence is stale, or a component is unknown.

## T. Historical Integrity

Frozen payroll components, employee profile versions, rule/evidence digests and statutory results are snapshot-bound. Later rule, profile or classification changes do not rewrite historical payroll entries. Activated revisions are immutable under the existing lifecycle controls.

## U. Permissions

Technical readiness does not confer approval authority. The existing platform-only controlled activation service requires an authenticated platform administrator, explicit reason, exact rule identity and a complete evidence chain. Employee self-approval is impossible.

## V. Tenant Safety

Payroll entry, business, employee, rule and snapshot access remains bound to trusted tenant scope. The calculator has no tenant lookup or cross-business fallback; orchestration supplies already-authorized frozen data.

## W. Tests

Automated coverage includes all 401 table boundaries for each of Parts A, C and E, Part F formulas, high-wage formulas, golden fixtures, digest tampering, category eligibility, missing profile facts, unknown classifications, real database materialization, reconciliation, idempotency and retirement. The final quality gate also covers full unit/integration suites, TypeScript, lint, production build, Prisma validation, fresh migration rebuild, artifact verification, canonical workspace guard and `git diff --check`.

## X. Remaining UNKNOWN / Blockers

The following ten codes remain fail-closed: `REST_DAY_PAY`, `PUBLIC_HOLIDAY_PAY`, `ONE_OFF_EARNING`, `ARREARS`, `TRANSPORT_ALLOWANCE`, `PHONE_ALLOWANCE`, `FIXED_ALLOWANCE`, `RECURRING_ALLOWANCE`, `MANUAL_ADJUSTMENT`, and `CUSTOM_UNKNOWN_EARNING`.

The only closure blocker is genuine authorized human review of these classifications and the complete candidate. No technical result in this package substitutes for that decision.

## Y. Human Sign-off Requirement

An authorized platform/business/legal reviewer must inspect the retained official evidence, confirm or revise every candidate classification, resolve all `UNKNOWN` entries, record identity, role, timestamp, reason and candidate digest, and then use the existing controlled activation mechanism. Until that occurs, approval remains `NOT_SIGNED_OFF` and automatic activation remains prohibited.

## Z. Final Status

**EPF — READY_FOR_HUMAN_SIGN_OFF**

**STATUTORY EPF CLOSURE — READY**

This means the engineering evidence and integration are ready for human sign-off. It does not mean `ACTIVE`, legally approved, government certified, deployed or enabled in Production. SOCSO/EIS states are unchanged. Payment P3A remains `PUBLIC_BANK_SPEC_NOT_READY`.
