# Statutory Human Governance Closure

### A. Objective

Close the engineering governance gap between verified statutory evidence and future human sign-off. This phase registers canonical candidates and provides an authenticated, auditable UNKNOWN review workflow. It does not make legal decisions, execute human sign-off, activate a RuleSet, or run payroll/statutory submission.

### B. Environment

`LOCAL / TESTING ONLY`. Production was not accessed, modified, migrated, deployed, or validated.

### C. Current Baseline

EPF, SOCSO, EIS and LINDUNG24 calculators and official evidence packs remain engineering-ready and evidence-complete. The 17-item human checklist and separate sign-off/activation capabilities already existed. Missing items were canonical database registration, per-component immutable human decisions and genuine step-up authentication.

### D. Governance Architecture

The layers are independent: Engineering → Evidence → Canonical RuleSet registration → UNKNOWN review → Human sign-off → Step-up → Activation. Registration writes `READY_FOR_HUMAN_SIGN_OFF`, never `ACTIVE`. Human review does not imply sign-off. Sign-off does not imply activation.

### E. UNKNOWN Inventory

Each candidate contains 10 actual UNKNOWN classifications. Their union is 12 components, derived from the current repository candidates:

| Component | EPF | SOCSO | EIS | LINDUNG24 | Decision needed |
| --- | --- | --- | --- | --- | --- |
| ARREARS | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | Source nature must remain explicit |
| BONUS | INCLUDED | UNKNOWN | UNKNOWN | UNKNOWN | Scheme-specific review |
| CUSTOM_UNKNOWN_EARNING | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | Scheme-specific review |
| FIXED_ALLOWANCE | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | Scheme-specific review |
| MANUAL_ADJUSTMENT | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | Scheme-specific review |
| ONE_OFF_EARNING | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | Scheme-specific review |
| PHONE_ALLOWANCE | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | Scheme-specific review |
| PUBLIC_HOLIDAY_PAY | UNKNOWN | INCLUDED | INCLUDED | INCLUDED | EPF review only |
| RECURRING_ALLOWANCE | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | Scheme-specific review |
| REST_DAY_PAY | UNKNOWN | INCLUDED | INCLUDED | INCLUDED | EPF review only |
| SALARY_ARREARS | INCLUDED | UNKNOWN | UNKNOWN | UNKNOWN | SOCSO/EIS/LINDUNG24 review |
| TRANSPORT_ALLOWANCE | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | Scheme-specific review |

The stored row includes its technical rationale and authority reference. No prompt-hardcoded treatment is applied.

### F. Classification Decision Model

`StatutoryComponentReviewDecision` is append-only and records the exact RuleSet/classification, base classification revision, previous treatment, `INCLUDED` / `EXCLUDED` / `KEEP_UNKNOWN`, evidence reference, reason, reviewer, timestamp, decision revision, evidence digest, decision digest and blocking scope. Server capability checks and database immutability triggers protect it.

### G. Activation-blocking vs Runtime-blocking

Central policy functions distinguish `GLOBAL_ACTIVATION_BLOCKER` from `CONDITIONAL_RUNTIME_BLOCKER`. An unreviewed UNKNOWN is global. Explicit `KEEP_UNKNOWN` on a non-core/future component may permit governance to proceed while the payroll path still fails closed if that component is used. A core wage kept UNKNOWN remains global. Runtime resolves explicit human INCLUDED/EXCLUDED decisions without mutating the base candidate row.

### H. Arrears

`ARREARS` cannot receive one generic INCLUDED or EXCLUDED decision. The server returns `ARREARS_STATUTORY_SOURCE_NATURE_REQUIRED`; the source component nature remains mandatory.

### I. Claim Reimbursements

Claim facts remain separate from scheme-specific legal treatment. The inventory recognises only `ACTUAL_EXPENSE_REIMBURSEMENT`, `ALLOWANCE`, `WAGE_EARNING` and `UNKNOWN`; it does not introduce a generic `STATUTORY_EXEMPT` flag. Existing `CLAIM_STATUTORY_TREATMENT_NOT_READY` behaviour remains fail-closed and does not change gross/net pay.

### J. Canonical RuleSet Registration

The local registration service idempotently registered these exact candidates:

| Scheme | Version | Effective period |
| --- | --- | --- |
| EPF | `MALAYSIA_EPF_2025_10_SIGNOFF_CANDIDATE_1` | 2025-10-01 → open |
| SOCSO | `MALAYSIA_STATUTORY_CLASSIFICATION_2026_SOCSO_EIS_SIGNOFF_CANDIDATE_1` | 2026-06-01 → open |
| EIS | `MALAYSIA_STATUTORY_CLASSIFICATION_2026_SOCSO_EIS_SIGNOFF_CANDIDATE_1` | 2024-10-01 → open |
| LINDUNG24 | `MALAYSIA_LINDUNG24_2026_SIGNOFF_CANDIDATE_1` | 2026-06-01 → 2028-06-01 exclusive |

Each row binds artifact identities/hashes, normalized dataset/digest, independent review, fixtures, calculator, eligibility revision, classification revision and evidence-pack digest. Re-registration returns the same RuleSet; changed evidence conflicts.

### K. RuleSet Immutability

Registered classification rows are database-immutable unless the parent is still DRAFT. Signed evidence fields remain immutable. Any official evidence, calculator, classification or effective-period change requires a new RuleSet version.

### L. Human Review

Dedicated capability: `REVIEW_STATUTORY_CLASSIFICATION`. Review lifecycle is `PENDING → IN_PROGRESS → COMPLETED`. Every base UNKNOWN needs an explicit latest decision before completion. Forms bind to exact RuleSet ID, evidence digest and optimistic review revision. Stale tabs fail with `STATUTORY_HUMAN_REVIEW_STALE`.

### M. Human Sign-off

Sign-off still requires `SIGN_OFF_STATUTORY_RULESET`, the complete 17-item server-validated checklist, completed human review, no global classification blocker, unchanged evidence digest and genuine step-up. A successful future record has immutable checklist answers, human classification revision/digest and step-up reference. No canonical human sign-off was executed.

### N. Step-up / MFA

True TOTP/recovery-code MFA step-up is now implemented for statutory sign-off and activation. It requires a current password plus a personal active factor, then issues a user/session/action/RuleSet/digest-bound, short-lived and one-time authorization. No fake MFA flag, mock employee OTP or URL/localStorage token is accepted. Canonical Human review and sign-off remain unexecuted.

### O. Reviewer Role

Only an authenticated active Platform Admin carrying `REVIEW_STATUTORY_CLASSIFICATION` can record/complete classification review. Business Owner, Payroll Admin, HR Manager, Branch Manager, Group Manager and Staff receive no implicit statutory reviewer authority.

### P. Activator Role

Activation remains separately protected by `ACTIVATE_STATUTORY_RULESET`. It does not imply reviewer or sign-off capability.

### Q. Two-person Control

The existing reviewer/activator separation remains enforced: the approving reviewer cannot activate the same signed revision. Activation was not executed in this phase.

### R. Evidence Digest

The RuleSet evidence digest now includes human review status/revision, human classification digest and all immutable decision revisions. Each decision changes the digest; stale sign-offs naturally fail.

### S. Audit

Additive lifecycle events cover RuleSet registration, review start, component reviewed, component kept UNKNOWN and review completion. Actor, reason, exact revision and digest are retained. Registration also records calculation-verified and ready-for-review events.

### T. Concurrency / Idempotency

Decision writes run in serializable transactions with optimistic `humanReviewRevision`. Replay/stale submission is denied and cannot create a duplicate canonical state. RuleSet registration is unique on scheme/version and digest-idempotent.

### U. UI

The Platform statutory workspace displays Engineering, Evidence, Canonical RuleSet, UNKNOWN review, Human sign-off, Step-up and Activation independently. UNKNOWN items have individual decision/evidence/reason forms; there is no bulk auto-classify. Sign-off and activation controls remain disabled while real step-up is blocked.

### V. Security

Services derive the reviewer from the authenticated server session and re-check stored role, account status, login state and capability. No business/tenant input can grant platform authority. Browser security verification confirmed a Business Owner is redirected away from `/admin/statutory/rulesets`.

### W. Tests

Unit coverage verifies global/conditional policy, runtime fail-closed behaviour, INCLUDED/EXCLUDED effective treatment, arrears and step-up status. Integration coverage verifies four-candidate registration, immutable decisions, Keep UNKNOWN, explicit Excluded, stale revision, completion, conditional sign-off in TEST_ONLY, global blocker and real-authority step-up denial. Authenticated browser E2E recorded and completed only a disposable QA fixture decision; canonical candidates were inspection-only.

- Unit: 761/761 passed.
- Integration: 110/110 passed using the local embedded PostgreSQL wrapper.
- TypeScript: passed.
- Prisma validate: passed.
- Fresh migration rebuild: all 149 migrations passed.
- Lint: passed with one existing WhatsApp `<img>` warning.
- Local production-mode build: passed (108 pages), with existing lint/autoprefixer warnings only.
- Canonical workspace guard and `git diff --check`: passed.

### X. Remaining Human Actions

1. A real authorised statutory reviewer must inspect each scheme and make every canonical UNKNOWN decision in the authenticated product UI.
2. The reviewer must personally enroll/use TOTP MFA without exposing factors to Codex or logs.
3. After all required decisions and the 17-item checklist, the reviewer may personally execute the MFA-backed sign-off.
4. A different authorised activator may later consider controlled activation in a separately authorised phase.
5. LINDUNG24 requires a successor official schedule before 2028-06-01.

### Y. Activation Readiness

Engineering governance and genuine MFA step-up are ready, but controlled activation is blocked by pending canonical Human review/sign-off. All four canonical rows remain not active; Payroll selection therefore continues to ignore them.

### Z. Final Status

`STATUTORY HUMAN GOVERNANCE CLOSURE — READY_FOR_AUTHORISED_REVIEWER`

`MFA Step-up — READY`

`Human Sign-off — NOT EXECUTED`

`Controlled Activation — NOT ACTIVE`

PCB remains `PARTIAL`; no PCB Final Closure was performed. Claims Core and outside-Payroll reimbursement remain ready; Claims Payroll Bridge remains blocked and statutory treatment remains fail-closed.
