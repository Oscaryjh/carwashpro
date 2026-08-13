# Statutory Authorised Human Review & Sign-off Execution

## A. Objective

Prepare EPF, SOCSO, EIS and LINDUNG24 for an authenticated authorised Human review in that order, validate every pre-review integrity and security gate, and stop without inventing Human decisions. No authenticated authorised reviewer participated in this execution, so no classification decision, checklist answer, MFA factor, Human sign-off or activation was recorded.

## B. Environment

`LOCAL / TESTING ONLY`

`PRODUCTION NOT ACCESSED`

`PRODUCTION NOT VALIDATED`

Workspace: `C:\CodexTetamuP0`; Git root: `C:/CodexTetamuP0`; branch: `codex/business-group-user-accounts`; HEAD: `42dffd1066b9a839cdcea275be136f74d1db0a62`. The canonical workspace guard and `git diff --check` passed. The pre-existing dirty worktree was preserved without reset, destructive checkout, commit or push.

## C. Reviewer Identity / Governance

Codex acted only as an evidence and integrity assistant. No authenticated product user was presented as the authorised reviewer, and the requester was not assumed to be one. No `SYSTEM`, `CODEX`, script, seed, test runner or QA fixture identity was used for a canonical decision. A future reviewer must be an active authenticated `PLATFORM_ADMIN` with `REVIEW_STATUTORY_CLASSIFICATION` and `SIGN_OFF_STATUTORY_RULESET`; the reviewer must personally make decisions, confirm the checklist and perform MFA.

On 2026-08-10 the Local review browser was opened at `/admin/statutory/rulesets` and correctly redirected to `/login` because no reviewer session existed. The visible login page was handed to the Human; Codex did not enter an email, password or any MFA factor. EPF review therefore has not started.

The Local account `admin@admin.com` was verified as an active, login-enabled `PLATFORM_ADMIN` with an existing password credential. Its Local permissions were narrowly configured as `REVIEW_STATUTORY_CLASSIFICATION` plus `SIGN_OFF_STATUTORY_RULESET`; `ACTIVATE_STATUTORY_RULESET` is absent. The non-sensitive email was filled into the Local login form, the password field was confirmed empty, and control stopped for Human password entry.

The Human later explicitly authorised Local credential submission. Login succeeded and the current session exposed the `Statutory Rules` and `Security` navigation entries, confirming the stored reviewer permissions are effective. On `/admin/statutory/rulesets`, EPF displayed `READY / COMPLETE / REGISTERED / PENDING / 0 decisions / 0 sign-offs / NOT ACTIVE`, but the matrix displayed `Step-up = BLOCKED` while the canonical readiness service/verifier returned `MFA Step-up = READY`. Review navigation stopped before the first Human decision because the UI/service status mismatch must be resolved or explicitly accepted before continuing.

## D. Pre-review Integrity

The retained evidence verifier, P2C verifier and a Local-database-only canonical readiness verifier were run before any Human action. For all four schemes they confirmed:

- the exact canonical RuleSet exists in `READY_FOR_HUMAN_SIGN_OFF` with calculation evidence verified;
- retained official artifact path/bytes/hash, dataset, independent review, fixtures, calculator and classification fields match the current repository pack;
- stored evidence-pack digest equals the recomputed digest;
- Human review is `PENDING`, revision `0`, with zero decisions and zero sign-offs;
- no active RuleSet exists for the scheme and MFA step-up policy is `READY`.

No stale state or stale digest was found. The former “not registered” lines in the four review-pack documents were corrected to the current Local RuleSet IDs before reviewer handoff.

## E. EPF Review

- RuleSet: `676640e4-8f0e-45f5-97da-d0c9d8d676ab`
- Version/effective date: `MALAYSIA_EPF_2025_10_SIGNOFF_CANDIDATE_1`, 2025-10-01 to open
- Publisher/artifact: KWSP Third Schedule 2025-10; retained PDF SHA-256 `c4904e44f0cb15a251a59e4f34c11a1ededa0868b962b2ebd9b81270285358b1`
- Dataset: 401 physical boundary rows; 1,203 independent category rows; zero mismatch
- Calculator: `statutory-p2c-epf-calculator/1.0.0`; 21 `OFFICIAL_BACKED` fixtures
- Evidence-pack digest: `b7679073dab4ebce9c08162b06c658c273a626e742b2260c1cd801d4f0958cee`
- Canonical evidence digest before Human decisions: `03fc13e3da1da9b964d4fe379680560b895c5376a2a3f373cfabe7f7823751e5`
- Review route: `/admin/statutory/review/epf`; canonical workflow route: `/admin/statutory/rulesets/676640e4-8f0e-45f5-97da-d0c9d8d676ab`

The existing UI contains the category/table/formula, rounding, boundary and representative fixture traces. They were verified by automation but not confirmed by a Human in this execution.

## F. SOCSO Review

- RuleSet: `cd7591b0-9c60-4241-8955-72bbc39b31eb`
- Version/effective date: `MALAYSIA_STATUTORY_CLASSIFICATION_2026_SOCSO_EIS_SIGNOFF_CANDIDATE_1`, 2026-06-01 to open
- Publisher/artifact: PERKESO Act 4/SKBBK schedule; retained PDF SHA-256 `e76b2a03740f6da4a305919c677d4935a05e9166502e5f06afe1030b7407caa1`
- Dataset/review: 65 rows / 65 rows / zero mismatch
- Calculator: `statutory-p2c-calculators/1.0.0`; 20 `OFFICIAL_BACKED` fixtures
- Evidence-pack digest: `aab60305d122387381bba6ade2e4586975600762258cd6f59c2348c93a09b1df`
- Canonical evidence digest before Human decisions: `e3ca00399da2e2283dc3d620ff210c8ceb772fedd5e71b0ecc2b1bbd630df95d`
- Review route: `/admin/statutory/review/socso`; canonical workflow route: `/admin/statutory/rulesets/cd7591b0-9c60-4241-8955-72bbc39b31eb`

## G. EIS Review

- RuleSet: `8995e03c-4928-4326-95d6-98d07fcc5d94`
- Version/effective date: `MALAYSIA_STATUTORY_CLASSIFICATION_2026_SOCSO_EIS_SIGNOFF_CANDIDATE_1`, 2024-10-01 to open
- Publisher/artifact: PERKESO Act 800 image-table schedule; retained official binary SHA-256 `3499fec4271b45ae3e3055b2071075f96f65dc451775ed23adf39f9deec5376a`
- Dataset/review: 65 rows / 65 independently rendered rows / zero mismatch
- Calculator: `statutory-p2c-calculators/1.0.0`; 11 `OFFICIAL_BACKED` fixtures
- Evidence-pack digest: `40beb12567fd72fb543a2a8fb95d13d4236dcb6fb9412a5380fd31abc70f86b5`
- Canonical evidence digest before Human decisions: `9e43fd2ccbed9cd9b2845f7d84eb1d2bd4d21f967b1a811ac52609927e97572d`
- Review route: `/admin/statutory/review/eis`; canonical workflow route: `/admin/statutory/rulesets/8995e03c-4928-4326-95d6-98d07fcc5d94`

## H. LINDUNG24 Review

- RuleSet: `f1c1e4a5-b77c-4cef-9663-8c0b87c43e49`
- Version/effective period: `MALAYSIA_LINDUNG24_2026_SIGNOFF_CANDIDATE_1`, 2026-06-01 to 2028-06-01 exclusive
- Publisher/artifacts: PERKESO; schedule, FAQ v2.1, Employer Circular 3/2026, participation form and opt-out notice; 5/5 retained and hash-verified
- Dataset/review: 65 rows / 65 rows / zero mismatch
- Calculator: `statutory-p2c-calculators/1.0.0`; 6 `OFFICIAL_BACKED` fixtures
- Evidence-pack digest: `bb24337c047a3650f6ad98166377dccd2ef66edb3dfa6b7365e1a9b9ed976b2b`
- Canonical evidence digest before Human decisions: `2e4c1cffac271d39f7cb1e77a879350c7f928f842628597c35112f743be04fb4`
- Review route: `/admin/statutory/review/lindung24`; canonical workflow route: `/admin/statutory/rulesets/f1c1e4a5-b77c-4cef-9663-8c0b87c43e49`

The reviewer must explicitly consider participation, once-in behaviour, multi-employer evidence and effective dating. A successor official schedule is required before 2028-06-01; the verified Phase 1 schedule must not silently continue beyond that horizon.

## I. UNKNOWN Inventory

The inventory below was loaded from the current repository and cross-checked against the canonical database. Each scheme has 10 base `UNKNOWN` rows and zero Human decisions.

| Scheme | Current UNKNOWN components |
| --- | --- |
| EPF | `ARREARS`, `CUSTOM_UNKNOWN_EARNING`, `FIXED_ALLOWANCE`, `MANUAL_ADJUSTMENT`, `ONE_OFF_EARNING`, `PHONE_ALLOWANCE`, `PUBLIC_HOLIDAY_PAY`, `RECURRING_ALLOWANCE`, `REST_DAY_PAY`, `TRANSPORT_ALLOWANCE` |
| SOCSO | `ARREARS`, `BONUS`, `CUSTOM_UNKNOWN_EARNING`, `FIXED_ALLOWANCE`, `MANUAL_ADJUSTMENT`, `ONE_OFF_EARNING`, `PHONE_ALLOWANCE`, `RECURRING_ALLOWANCE`, `SALARY_ARREARS`, `TRANSPORT_ALLOWANCE` |
| EIS | `ARREARS`, `BONUS`, `CUSTOM_UNKNOWN_EARNING`, `FIXED_ALLOWANCE`, `MANUAL_ADJUSTMENT`, `ONE_OFF_EARNING`, `PHONE_ALLOWANCE`, `RECURRING_ALLOWANCE`, `SALARY_ARREARS`, `TRANSPORT_ALLOWANCE` |
| LINDUNG24 | `ARREARS`, `BONUS`, `CUSTOM_UNKNOWN_EARNING`, `FIXED_ALLOWANCE`, `MANUAL_ADJUSTMENT`, `ONE_OFF_EARNING`, `PHONE_ALLOWANCE`, `RECURRING_ALLOWANCE`, `SALARY_ARREARS`, `TRANSPORT_ALLOWANCE` |

The centralized policy determines `GLOBAL_ACTIVATION_BLOCKER` versus `CONDITIONAL_RUNTIME_BLOCKER`. `ARREARS` continues to inherit its source component nature and fails closed as `ARREARS_STATUTORY_SOURCE_NATURE_REQUIRED` when that nature is unresolved.

## J. Human Decisions

No Human chose `INCLUDED`, `EXCLUDED` or `KEEP_UNKNOWN`. No evidence reference or legal reason was entered on another person's behalf. The actual decision count is 0 for EPF, SOCSO, EIS and LINDUNG24.

## K. Evidence References

Canonical source material remains `statutory/official/manifest.json`, the retained artifacts under `statutory/official/artifacts`, the normalized/review/certification records referenced by the evidence-pack registry, and the four scheme review-pack documents. Fixture provenance is explicitly `OFFICIAL_BACKED`; no engineering-only fixture was relabelled as official golden evidence.

## L. Classification Revisions

The stored base classification digests match the current candidates: EPF `4c225701bb96f096516ec8f48a858672a890a8a264fc454252217fa08dfccafc`; SOCSO/EIS `d59d280d59880810f55f88117fbd103b16cceaf83cb63db2454eb58acae12d3a`; LINDUNG24 `1e46def37c60e320a56351b309a2be4e496e228175c87c14c9a2075378ff847a`. Human review revision remains 0 for every scheme. No row was overwritten and no immutable decision revision was created.

## M. Checklist

Checklist version `statutory-human-review/2.0.0` still requires all 17 server-validated confirmations. Codex did not tick any box and no client or server checklist state was submitted.

## N. MFA Step-up

True TOTP/recovery-code statutory step-up is `READY`. No reviewer enrollment, password, TOTP secret, `otpauth` URI, TOTP value, recovery code or encryption key was requested, exposed, entered or logged. A future reviewer must personally enroll and satisfy the fresh RuleSet/action/resource-bound challenge.

Current reviewer account state: `TOTP NOT_ENROLLED`, zero active MFA credentials. After login the Human must personally complete the Security/MFA enrollment flow; Codex will stop again at password and authenticator-code inputs and will not read or retain recovery codes.

### UI step-up state mismatch resolution

The Statutory Rules candidate matrix previously rendered a literal `Step-up = BLOCKED`. That label was not loaded from the canonical readiness service and incorrectly merged infrastructure readiness with the current reviewer's personal enrollment state. The backend source of truth remains `statutoryStepUpReadiness()`, which verifies that the statutory sign-off sensitive action is registered with `requiredAssurance = MFA` and that the True MFA capability is available.

The UI now loads and displays three independent values:

- `MFA Step-up Infrastructure`, sourced from the canonical statutory readiness service;
- `Reviewer MFA Enrollment`, sourced from the current authenticated session's MFA security state;
- `Human Sign-off Readiness`, a presentation mapping that exposes the first actual blocker without changing enforcement.

For the current reviewer, the correct interpretation is `READY / NOT ENROLLED / BLOCKED_REVIEWER_MFA_ENROLLMENT`. An enrolled reviewer with an unfinished classification review sees `BLOCKED_HUMAN_REVIEW_PENDING`; unavailable MFA infrastructure sees `BLOCKED_STEP_UP_INFRASTRUCTURE`. No assurance requirement, enrollment flag, credential or sensitive authorization was bypassed or fabricated.

## O. Human Sign-off

No Human sign-off was performed. All four sign-off counts are 0 and all lifecycle states remain `READY_FOR_HUMAN_SIGN_OFF`.

## P. Sign-off Digest

Not applicable because there is no sign-off record. The canonical evidence digests listed in E-H are the exact current pre-decision values, not signed digests. Any future Human decision changes the governed digest and stale tabs/sign-offs must fail.

## Q. Audit

No canonical `HUMAN_REVIEW_STARTED`, component-decision, `HUMAN_REVIEW_COMPLETED` or `RULESET_SIGNED_OFF` event was produced. Existing registration/calculation/readiness audit remains intact. Targeted integration tests verified immutable decisions, capability enforcement, genuine MFA preconditions and one-time authorization without writing to canonical candidates.

## R. Two-person Control

Reviewer and future Activator remain different authenticated actors. This phase did not grant activation authority to a reviewer and did not execute activation.

## S. Claims Boundary

Claims Core: `READY`. Outside Payroll reimbursement: `READY`. Claims Payroll Bridge: `BLOCKED` unless a separately verified readiness path later permits it. Claim statutory treatment remains fail-closed; no generic “claim equals statutory exempt” rule was introduced.

## T. PCB Boundary

PCB remains `PARTIAL`. No PCB review, final closure or sign-off was requested or performed.

## U. Security

Dedicated platform capabilities are enforced before review/sign-off. Business Owner, Payroll Admin without explicit platform reviewer capability, HR Manager, Branch Manager, Group Manager and Staff cannot perform canonical review/sign-off. The authorised reviewer may review/decide/complete and may sign only with fresh MFA, but cannot activate the same signed revision.

## V. Tests

- `statutory:verify-evidence-packs`: PASS; all four packs COMPLETE, all blockers NONE.
- `statutory:verify-p2c`: PASS; retained dataset/calculator/fixture traces verified.
- `statutory:verify-authorised-review-readiness`: PASS; four exact canonical rows and all stored/recomputed digests match.
- Targeted evidence/governance/review/step-up/TOTP unit: 28/28 PASS.
- Targeted statutory governance/step-up/TOTP integration: 11/11 PASS.
- Targeted UI readiness/Human review unit: 8/8 PASS.
- Targeted UI/statutory/auth/TOTP unit regression: 25/25 PASS.
- Full unit: 771/771 PASS.
- Full integration with the embedded Local PostgreSQL wrapper: 116/116 PASS.
- TypeScript: PASS.
- Lint: PASS with the pre-existing WhatsApp `<img>` warning only.
- Local production-mode build: PASS (110 generated pages) with the pre-existing WhatsApp image and Attendance autoprefixer warnings only.
- Prisma validate: PASS through the embedded Local PostgreSQL wrapper; no schema changed, so no fresh migration rebuild was required.
- Canonical guard, task-file credential-shape scan and `git diff --check`: PASS.

## W. Remaining Blockers

An authenticated authorised Local Reviewer session now exists. The UI/backend mismatch is resolved. The immediate sign-off blocker is the current reviewer's personal TOTP state: `NOT ENROLLED`, exposed as `BLOCKED_REVIEWER_MFA_ENROLLMENT`. Each scheme still needs 10 personal evidence-backed classification decisions, review completion, all 17 checklist confirmations and the reviewer's personal MFA-backed sign-off. LINDUNG24 additionally needs a successor official schedule before 2028-06-01 for later periods.

## X. Activation Readiness

Activation is `NOT_ACTIVE` and is intentionally out of scope. Even after future sign-off, stale-digest checks, effective-period checks, dedicated activation MFA and two-person control must be performed in a separately authorised phase.

## Y. Next Human Action

The authenticated reviewer should personally complete the Local/Testing TOTP enrollment at `/security/mfa`. Codex stops before the password/authenticator input and will not read, copy or store the secret, TOTP code or recovery codes. Only after Human enrollment should the reviewer begin EPF at `/admin/statutory/review/epf` and personally make each statutory decision.

## Z. Final Status

`STATUTORY UI STEP-UP STATE MISMATCH -> RESOLVED`

`STATUTORY HUMAN SIGN-OFF READINESS -> BLOCKED_REVIEWER_MFA_ENROLLMENT`

No canonical review decisions were recorded. No Human sign-off was performed. No RuleSet was activated.

| Scheme | Engineering | Evidence | Canonical RuleSet | Human Review | Canonical decisions | Remaining UNKNOWN | Human Sign-off | MFA step-up | Activation |
| --- | --- | --- | --- | --- | ---: | ---: | --- | --- | --- |
| EPF | READY | COMPLETE | REGISTERED | PENDING | 0 | 10 | NOT EXECUTED | READY | NOT ACTIVE |
| SOCSO | READY | COMPLETE | REGISTERED | PENDING | 0 | 10 | NOT EXECUTED | READY | NOT ACTIVE |
| EIS | READY | COMPLETE | REGISTERED | PENDING | 0 | 10 | NOT EXECUTED | READY | NOT ACTIVE |
| LINDUNG24 | READY | COMPLETE | REGISTERED | PENDING | 0 | 10 | NOT EXECUTED | READY | NOT ACTIVE |
