# Statutory Human Sign-off & Controlled Activation Readiness

## A. Objective

Provide one controlled governance path for EPF, SOCSO, EIS and LINDUNG24 while preserving the distinction `ENGINEERING VERIFIED != HUMAN SIGNED OFF != GOVERNMENT CERTIFIED`. PCB is audited only as a boundary. Leave, Claims expansion, Commission, Public Bank, Payroll Payment, AI, SAVT and Production are excluded.

## B. Environment Boundary

`LOCAL / TESTING ONLY`

`PRODUCTION NOT ACCESSED`

`PRODUCTION NOT VALIDATED`

No government submission, statutory payment, official portal action or Production activation occurred.

## C. Existing Architecture Audit

| Area | Classification | Evidence |
| --- | --- | --- |
| `StatutoryRuleSet`, scheme enum, effective dating | READY | Existing canonical framework retained |
| Retained artifact manifest / SHA-256 | READY | EPF, SOCSO, EIS and LINDUNG24 retained paths and exact hashes verified; EIS official binary retained on 2026-08-10 |
| Normalized datasets / independent reviews / fixtures | READY | EPF 401 physical/1,203 reviewed; SOCSO/EIS/L24 65 each |
| Scheme calculators | READY | Separate EPF, SOCSO, EIS and LINDUNG24 paths; exact table/formula provenance |
| Component classification framework | READY | Scheme-specific candidates, explicit UNKNOWN inventories and fail-closed behavior are complete; the actual human decisions remain unexecuted |
| Employee statutory profile versions | READY for EPF/SOCSO/EIS facts | Effective revision and source digest are snapshot-bound |
| LINDUNG24 participation versions | READY | Effective-dated, tenant-bound, append-only, selected-employer aware |
| Payroll statutory snapshots | READY | Rule/profile/classification/calculator/wage/amount/trace provenance retained |
| Payroll rule resolution | READY | Only applicable `ACTIVE` rules are queried; no latest-created fallback |
| Legacy percentage helpers | LEGACY | Not used by the P2 materialization path |
| Prior lifecycle / activation service | UNSAFE, replaced | It had only DRAFT/ACTIVE/RETIRED and no durable human sign-off/two-person control |
| Durable human sign-off | READY | New immutable `StatutoryRuleSetSignOff` model |
| Controlled activation | READY as workflow | Separate capability, separate actor, stale digest/overlap checks, serializable transaction |
| Platform review UI | READY | `/admin/statutory/rulesets` and `/admin/statutory/rulesets/[id]` |
| Official canonical RuleSet registration | MISSING | Local has no non-test EPF/SOCSO/EIS/L24 RuleSet rows |
| Step-up / MFA | MISSING | No real reusable MFA/step-up framework exists; no fake MFA was invented |

No second statutory framework was created.

## D. Governance

The authenticated actor is verified against the current `users` row. `SYSTEM`, `SCRIPT`, `CODEX`, `TEST_RUNNER` and `AUTOMATION` actor types cannot sign. Session claims cannot spoof the stored role or capability. Sign-off and activation require real active Platform Admin users with different dedicated capabilities.

QA proved the workflow with isolated `TEST_*` RuleSets and dedicated QA users. It means:

`SIGN-OFF WORKFLOW TESTED`

`ACTUAL AUTHORISED HUMAN BUSINESS SIGN-OFF NOT EXECUTED`

## E. Rule Lifecycle

The lifecycle now distinguishes:

`DRAFT -> ENGINEERING_VERIFIED -> READY_FOR_HUMAN_SIGN_OFF -> HUMAN_SIGNED_OFF -> ACTIVE -> RETIRED`

Engineering verification moves a DRAFT/ENGINEERING_VERIFIED revision to `READY_FOR_HUMAN_SIGN_OFF`. Human approval moves the exact digest-bound revision to `HUMAN_SIGNED_OFF`. A separate activator may move it to `ACTIVE`. Payroll continues to select only `ACTIVE` rules by scheme and payroll effective date. Signed-but-inactive and latest-created rules are never selected.

## F. Human Sign-off Model

`StatutoryRuleSetSignOff` records ruleSetId, scheme, decision, authenticated actorUserId, role/capability snapshot, signedAt, deterministic evidenceDigest, checklist version, reason and createdAt. Updates are prohibited. Deletion is prohibited except for an explicit retired `TEST_ONLY/TEST_*` QA-cleanup boundary. Revocation appends a `REVOKED` record and returns an unused signed revision to `READY_FOR_HUMAN_SIGN_OFF`; active payroll history is never erased.

## G. Controlled Activation Model

Activation requires `ACTIVATE_STATUTORY_RULESET`, while sign-off requires `SIGN_OFF_STATUTORY_RULESET`. The activator cannot be the reviewer. Activation runs at Serializable isolation, checks exact identity/effective period, stored engineering evidence, latest sign-off decision, digest freshness, zero UNKNOWN records and overlapping ACTIVE periods, then writes the status change and immutable lifecycle audit atomically.

## H. Evidence Digest

The deterministic digest binds rule ID, scheme/version, effective period, publisher/source, official artifact hash, parser version, dataset ID/digest/row count, independent review, fixture digest/count, calculator version/test digest, classification version/digest, eligibility revision and sorted scheme-specific classification records. A different digest returns `SIGN_OFF_STALE`; signed/active material columns are also database-immutable.

## I. EPF

- Artifact: VERIFIED; retained PDF, 761,109 bytes, 55 pages, SHA-256 `c4904e44f0cb15a251a59e4f34c11a1ededa0868b962b2ebd9b81270285358b1`.
- Dataset: VERIFIED; parser 2.0.0; 401 physical rows, 1,203 independently reviewed Part A/C/E rows, 0 mismatches.
- Fixtures: 21 `OFFICIAL_BACKED`, pass.
- Calculator: VERIFIED; `statutory-p2c-epf-calculator/1.0.0`.
- Evidence pack / Engineering: COMPLETE / READY; 10 conditional component decisions remain explicitly listed and fail closed.
- Human sign-off: NOT EXECUTED.
- Controlled activation: `BLOCKED_HUMAN_SIGNOFF`.
- Pack: `docs/statutory-review-pack-epf.md`.

## J. SOCSO

- Artifact: VERIFIED; retainedPath resolved to the shared official Act 4/SKBBK/LINDUNG24 schedule bytes.
- Dataset/review: 65/65, 0 mismatches.
- Fixtures: 20 `OFFICIAL_BACKED`, pass.
- Calculator: VERIFIED; `statutory-p2c-calculators/1.0.0`.
- Evidence pack / Engineering: COMPLETE / READY; 10 conditional component decisions remain explicitly listed and fail closed.
- Human sign-off: NOT EXECUTED.
- Controlled activation: `BLOCKED_HUMAN_SIGNOFF`.
- Pack: `docs/statutory-review-pack-socso.md`.

## K. EIS

- Artifact: VERIFIED; official PERKESO PDF retained at `statutory/official/artifacts/perkeso-act800-contribution-schedule-2024-10.pdf`, 933,164 bytes, SHA-256 `3499fec4271b45ae3e3055b2071075f96f65dc451775ed23adf39f9deec5376a`.
- Dataset/review: 65/65, 0 mismatches.
- Fixtures: 11 `OFFICIAL_BACKED`, pass.
- Calculator: VERIFIED; `statutory-p2c-calculators/1.0.0`.
- Evidence pack / Engineering: COMPLETE / READY; 10 conditional component decisions remain explicitly listed and fail closed.
- Human sign-off: NOT EXECUTED.
- Controlled activation: `BLOCKED_HUMAN_SIGNOFF`.
- Pack: `docs/statutory-review-pack-eis.md`.

## L. LINDUNG24

- Source pack: retained amount schedule, FAQ v2.1, Employer Circular 3/2026, participation form and opt-out notice with verified SHA-256 values.
- Amount dataset/review: 65/65, 0 mismatches.
- Fixtures: 6 `OFFICIAL_BACKED`, pass.
- Eligibility/participation: effective-dated, selected-employer aware and tenant isolated; no inference from age, NRIC pattern or guessed nationality.
- Rule horizon: `2026-06-01` to `2028-06-01`; after the horizon no applicable ACTIVE rule exists and payroll fails closed pending a new official RuleSet.
- Evidence pack / Engineering: COMPLETE / READY for the Phase 1 horizon; broader unresolved inventory contains 10 fail-closed codes.
- Human sign-off: NOT EXECUTED.
- Controlled activation: `BLOCKED_HUMAN_SIGNOFF`.
- Pack: `docs/statutory-review-pack-lindung24.md`.

## M. PCB Boundary

| PCB area | Current state |
| --- | --- |
| PCB ENGINE | PARTIAL; pure 2026 calculator `TETAMU_PCB_2026_1.1.0` passes supported official examples |
| PCB OFFICIAL VALIDATION | PARTIAL; five official-backed results pass, HASiL software verification pending |
| PCB EMPLOYEE TAX PROFILE | BLOCKED; canonical production profile/TP1/TP3 workflow incomplete |
| PCB YTD LEDGER | PARTIAL; deterministic builder exists, persistent finalization integration incomplete |
| PCB PAYROLL SNAPSHOT | BLOCKED; full PCB-specific provenance snapshot not integrated |
| PCB ACTIVATION | BLOCKED |

No PCB Final Closure work was performed.

## N. Component Classification

`UNLISTED` below is not a treatment; runtime treats missing classification as UNKNOWN/fail-closed. Evidence and detailed rationale remain in the four machine-readable sign-off candidates.

| Component | EPF | SOCSO | EIS | LINDUNG24 | Human decision? |
| --- | --- | --- | --- | --- | --- |
| ARREARS | UNKNOWN | UNKNOWN | UNKNOWN | UNLISTED | YES |
| ATTENDANCE_ALLOWANCE | INCLUDED | INCLUDED | INCLUDED | UNLISTED | YES |
| BASIC_SALARY | INCLUDED | INCLUDED | INCLUDED | INCLUDED | REVIEW |
| BONUS | INCLUDED | UNKNOWN | UNKNOWN | UNKNOWN | YES |
| COMMISSION | INCLUDED | INCLUDED | INCLUDED | INCLUDED | REVIEW |
| COST_OF_LIVING_ALLOWANCE | INCLUDED | INCLUDED | INCLUDED | UNLISTED | YES |
| CUSTOM_UNKNOWN_EARNING | UNKNOWN | UNKNOWN | UNKNOWN | UNLISTED | YES |
| FIXED_ALLOWANCE | UNKNOWN | UNKNOWN | UNKNOWN | UNLISTED | YES |
| HOUSING_ALLOWANCE | INCLUDED | INCLUDED | INCLUDED | UNLISTED | YES |
| INCENTIVE | INCLUDED | INCLUDED | INCLUDED | INCLUDED | REVIEW |
| LEAVE_PAY | INCLUDED | INCLUDED | INCLUDED | UNLISTED | YES |
| MANUAL_ADJUSTMENT | UNKNOWN | UNKNOWN | UNKNOWN | UNLISTED | YES |
| MEAL_ALLOWANCE | INCLUDED | INCLUDED | INCLUDED | UNLISTED | YES |
| ONE_OFF_DEDUCTION | EXCLUDED | EXCLUDED | EXCLUDED | UNLISTED | YES |
| ONE_OFF_EARNING | UNKNOWN | UNKNOWN | UNKNOWN | UNLISTED | YES |
| OVERTIME_PAY | EXCLUDED | INCLUDED | INCLUDED | INCLUDED | REVIEW |
| PAID_LEAVE_PAY | INCLUDED | INCLUDED | INCLUDED | INCLUDED | REVIEW |
| PAYROLL_RECOVERY | EXCLUDED | EXCLUDED | EXCLUDED | UNLISTED | YES |
| PHONE_ALLOWANCE | UNKNOWN | UNKNOWN | UNKNOWN | UNLISTED | YES |
| PUBLIC_HOLIDAY_PAY | UNKNOWN | INCLUDED | INCLUDED | INCLUDED | YES |
| RECOVERY | EXCLUDED | EXCLUDED | EXCLUDED | UNLISTED | YES |
| RECURRING_ALLOWANCE | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | YES |
| REGULAR_DAILY_PAY | INCLUDED | INCLUDED | INCLUDED | INCLUDED | REVIEW |
| REGULAR_HOURLY_PAY | INCLUDED | INCLUDED | INCLUDED | INCLUDED | REVIEW |
| REST_DAY_PAY | UNKNOWN | INCLUDED | INCLUDED | INCLUDED | YES |
| SALARY_ARREARS | INCLUDED | UNKNOWN | UNKNOWN | UNKNOWN | YES |
| SHIFT_ALLOWANCE | INCLUDED | INCLUDED | INCLUDED | UNLISTED | YES |
| STAFF_LOAN | EXCLUDED | EXCLUDED | EXCLUDED | UNLISTED | YES |
| TRANSPORT_ALLOWANCE | UNKNOWN | UNKNOWN | UNKNOWN | UNLISTED | YES |
| UNIFORM_DEDUCTION | EXCLUDED | EXCLUDED | EXCLUDED | UNLISTED | YES |

Arrears preserve `ARREARS_STATUTORY_SOURCE_NATURE_REQUIRED` semantics. Transport/phone/allowance labels never imply actual-expense reimbursement.

## O. Employee Statutory Profiles

| Scheme | Required facts | Current coverage | Missing behaviour |
| --- | --- | --- | --- |
| EPF | DOB, statutory nationality/PR, pre-1998 election, enabled status, effective date | Versioned profile + category resolver | `STATUTORY_PROFILE_INCOMPLETE` / `EPF_CATEGORY_REQUIRED` |
| SOCSO | DOB/material eligibility, enabled status, SOCSO category | Versioned profile | `STATUTORY_PROFILE_INCOMPLETE` |
| EIS | DOB/nationality eligibility, enabled/previous-contribution facts | Versioned profile | incomplete profile blocker; no guessed eligibility |
| LINDUNG24 | employment, Act 4 coverage, nationality, participation, employer selection | Versioned profile + append-only participation revision | profile/participation/selected-employer blocker |
| PCB | regime/category/spouse/disability/children/TP1/TP3/YTD facts | PARTIAL | PCB-specific blockers |

Finalized payroll snapshots retain the original profile revision.

## P. Claims Reimbursement Boundary

Claims Core and outside-payroll reimbursement remain READY. Claims factual nature stays separate from statutory legal treatment. Current starter/UI policies are `REVIEW_REQUIRED`; Payroll bridge records `CLAIM_STATUTORY_TREATMENT_NOT_READY`, changes neither gross nor net pay, and blocks finalization. No claim is automatically labelled EPF/SOCSO/EIS excluded or PCB exempt.

## Q. Payroll Integration

Statutory materialization resolves by scheme, payroll effective date and `ACTIVE` status. Missing ACTIVE rules fail closed with the existing `STATUTORY_RULE_NOT_AVAILABLE` equivalent. UNKNOWN/missing classifications block. Business module entitlement grants product access only; it never activates rules.

## R. Effective Dating

Active ranges use inclusive start/exclusive end. Database and service checks reject overlapping ACTIVE ranges. Future-dated ACTIVE rules do not affect earlier periods. LINDUNG24 stops at its documented horizon.

## S. Historical Integrity

Signed and ACTIVE rule evidence is immutable. Retirement does not delete rules. Finalized payroll retains rule, calculator, classification, profile, wage base, employee/employer amounts, matched row/formula and source/input digests. New revisions do not rewrite historical payroll.

## T. Permissions / Step-up

- Reviewer capability: `SIGN_OFF_STATUTORY_RULESET`
- Activator capability: `ACTIVATE_STATUTORY_RULESET`
- Ordinary Payroll, profile, export and submission permissions do not imply either capability.
- Same reviewer/activator: denied.
- Real MFA/step-up framework: not available; no fake control added. If governance later mandates step-up, report `STATUTORY_ACTIVATION_STEP_UP_AUTH_NOT_READY` until a real mechanism exists.

## U. Review / Activation UI

Platform pages list RuleSets and expose evidence, hashes, parser/calculator versions, classifications, UNKNOWN items, checklist, digest and blockers. Sign-off and activation are separate forms/actions. Buttons are capability gated, reasons are mandatory and the services revalidate all controls server-side.

## V. Audit / Concurrency

Lifecycle events now include calculation verification, ready-for-review, signed-off, stale/revoked, activated and retired equivalents. Sign-off rows are immutable. Activation and sign-off use Serializable transactions. Database guards enforce ACTIVE evidence, overlap protection and signed/active evidence immutability.

## W. Tests / Build / Migration

- Evidence-pack negative/independence unit: 7/7 PASS.
- Targeted statutory/evidence/LINDUNG24 unit: 62/62 PASS.
- Targeted Claims/Payroll/HR unit: 86/86 PASS.
- Targeted statutory/Claims/Payroll integration: 29/29 PASS.
- Full unit suite: 746/746 PASS.
- Full integration suite (isolated embedded PostgreSQL): 105/105 PASS.
- EPF: all 401 boundaries for Parts A/C/E plus formula/category fixtures PASS.
- SOCSO/EIS: all 65 table boundaries and certified fixtures PASS.
- LINDUNG24: eligibility, participation, multi-employer, amount, effective dating and transition tests PASS.
- Human/System actor, capability, two-person, stale digest, signed immutability and overlap controls PASS.
- Retained local artifact bytes: all 14 manifest bindings passed exact byte-size and SHA-256 verification. SOCSO retainedPath is resolved; the official EIS binary is retained and verified.
- Bounded live official-source re-fetch: all 7 unique source URLs returned HTTP 200, `application/pdf`, exact size and exact SHA-256. Runtime remains offline/local and has no network dependency.
- `statutory:verify-evidence-packs` and `statutory:verify-p2c`: PASS; all four evidence packs are COMPLETE and Engineering READY, while Human sign-off remains NOT EXECUTED.
- Fresh migration rebuild: 148/148 PASS.
- Prisma generate/validate/status: PASS; 148 migrations, schema up to date.
- TypeScript: PASS.
- Lint: PASS with the pre-existing WhatsApp `<img>` performance warning only.
- Local production-mode build: PASS; only pre-existing CSS/autoprefixer and WhatsApp image warnings were emitted.
- Local admin UI smoke: PASS for list, evidence identity, readiness blockers, UNKNOWN table, unchecked human checklist, disabled sign-off and disabled controlled-activation controls. No form was submitted.
- Changed-file credential-shape scan: PASS.
- Canonical workspace guard and `git diff --check`: PASS.
- Official evidence-pack closure added: EPF/SOCSO/EIS/LINDUNG24 all `COMPLETE / Engineering READY`; Human status remains independent and unexecuted.
- SOCSO retainedPath resolved; EIS official one-page PERKESO binary retained and exact SHA-256 verified.
- Bounded live official-source re-fetch on 2026-08-10: HTTP 200 / `application/pdf` / exact hash match for every unique EPF/SOCSO/EIS/LINDUNG24 source. Runtime remains offline/local.
- Evidence-pack failure-mode tests: 7/7 PASS.

All human workflow tests used isolated QA actors/rules. No canonical official candidate was signed or activated.

## X. Activation Readiness Matrix

| Scheme | Artifact | Dataset/calculator/fixtures | Classification | Human sign-off | Controlled activation | Exact blockers |
| --- | --- | --- | --- | --- | --- | --- |
| EPF | VERIFIED | VERIFIED | READY_FOR_HUMAN_REVIEW | NOT EXECUTED | BLOCKED_HUMAN_SIGNOFF | 10 conditional human decisions; canonical registration after approval |
| SOCSO | VERIFIED / retainedPath resolved | VERIFIED | READY_FOR_HUMAN_REVIEW | NOT EXECUTED | BLOCKED_HUMAN_SIGNOFF | 10 conditional human decisions; canonical registration after approval |
| EIS | VERIFIED / official binary retained | VERIFIED | READY_FOR_HUMAN_REVIEW | NOT EXECUTED | BLOCKED_HUMAN_SIGNOFF | 10 conditional human decisions; canonical registration after approval |
| LINDUNG24 | 5/5 VERIFIED | VERIFIED | READY_FOR_HUMAN_REVIEW | NOT EXECUTED | BLOCKED_HUMAN_SIGNOFF | 10 conditional/unmaterialised decisions; canonical registration after approval; new schedule before 2028-06-01 |

## Y. Human Actions Required

1. Review each complete scheme pack, retained official source/hash, effective period, dataset, calculator, boundary and fixture provenance.
2. Resolve/accept every conditional production component decision in new immutable candidate revisions; preserve original-nature requirements for arrears and claims.
3. Register the human-approved candidate revisions as canonical platform RuleSets and rerun engineering verification to produce the exact evidence digest.
4. An authorised reviewer with `SIGN_OFF_STATUTORY_RULESET` performs real Human Sign-off.
5. A different authorised activator with `ACTIVATE_STATUTORY_RULESET` reviews conflicts/effective date and performs controlled activation in the authorised environment.

## Z. Final Status

EPF, SOCSO, EIS and LINDUNG24 official evidence packs and fail-closed engineering workflows are complete and ready for authorised Human review. Human component decisions/sign-off, canonical registration and controlled activation remain unexecuted.

`STATUTORY OFFICIAL EVIDENCE PACK CLOSURE -> READY_FOR_HUMAN_REVIEW`

`HUMAN SIGN-OFF -> NOT EXECUTED`

`CONTROLLED ACTIVATION -> BLOCKED_HUMAN_SIGNOFF`
