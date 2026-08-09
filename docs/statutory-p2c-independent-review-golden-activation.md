# Statutory P2C - Independent Dataset Review, Official Golden Certification & Controlled Scheme Activation

## A. Canonical Workspace

- Workspace / Git root: `C:\CodexTetamuP0`
- Branch: `codex/business-group-user-accounts`
- Baseline HEAD: `6db4e3dfa9aa5ebedf7977c01118bb423ef3ef6a`
- Canonical guard: passed before P2C work
- Existing Payment, Payroll, Attendance and WhatsApp dirty work was preserved.
- Payment P3A remains `PUBLIC_BANK_SPEC_NOT_READY`.

## B. P2B Baseline

P2B supplied source integrity, normalized datasets, fixture scaffolding and fail-closed activation guards. At the P2C start, EPF had no retained exact bytes or dataset; SOCSO had 65 parsed rows; EIS had 65 manually transcribed rows; LINDUNG24 had an amount schedule but unresolved participation history; PCB remained blocked.

P2B infrastructure readiness was not treated as scheme calculation verification.

## C. EPF Artifact

The current [KWSP Third Schedule page](https://www.kwsp.gov.my/en/epf-act-1991-third-schedule) confirms that the latest schedule is effective from 1 October 2025. The authority CDN still prevents deterministic retention of the exact 55-page PDF bytes in this workflow. No third-party mirror was substituted.

EPF artifact status remains `FETCH_REVIEW_REQUIRED`. The existing verifier supports a controlled operator-supplied local artifact path with exact byte length, MIME and SHA-256 verification; the artifact must be imported and reviewed by a platform operator before any dataset can be certified.

## D. EPF Dataset / Review

No EPF dataset was generated from snippets or unofficial tables. Contribution parts, age/citizenship categories, elections, high-wage rules and all official boundaries remain unverified. Independent review is therefore missing.

## E. EPF Golden

No EPF golden fixture is claimed. The EPF calculator is a fail-closed entry point that returns `STATUTORY_RULE_NOT_AVAILABLE`.

## F. SOCSO Dataset Review

The exact official [Act 4 / SKBBK schedule](https://www.perkeso.gov.my/images/lindung/lindung-24-jam/NewContributionRateIncludingSKBBK.pdf) was rendered page by page. A second visual path checked all 65 rows without reusing the P2B text parser. It compared row order, inclusive bounds, first-category employer/employee shares, second-category employer share, the separate non-employment-injury column, the RM6,000 ceiling and the above-ceiling row.

- Artifact SHA-256: `e76b2a03740f6da4a305919c677d4935a05e9166502e5f06afe1030b7407caa1`
- P2B baseline dataset digest: `e9cd3fdd50b5851572e51a2c8f6a3c0ce3c17b383b20c463c107d99390c82700`
- Certified dataset digest: `1e1b17a332e2b596b1efa85c075428c54b16d059730726e3f67cef710f334460`
- Review digest: `57c10c6042fbd539e36279bafbd9f20eabb4d140a984eb1db052c287ee14209c`
- Mismatches: zero

The changed dataset digest is caused by the controlled status transition from `PARSED` to `VERIFIED`; contribution rows were not silently replaced.

## G. SOCSO Golden

Twenty official schedule-row fixtures are `VERIFIED`. They cover the lowest positive wage, exact upper bounds, next-cent crossings, representative middle rows, both contribution categories, RM6,000 and above ceiling.

- Fixture digest: `d5108d72795b60067d2f1e1e408715f27c2b87f1290e79edccb3db561e5bfca5`
- Certification digest: `098b2f145516aaa3f0e21779dae3362ff1b480f5bf9a2f415c16e1b1a0c1d0ba`

## H. EIS Dual Review

The exact official [Act 800 table](https://www.perkeso.gov.my/images/dokumen/101024%20-%20Kadar%20Caruman%20Akta%20800.pdf) is image-only. Transcription A was compared against a separately rendered visual table. All 65 bounds, employer/employee amounts, totals, share equality, ceiling and above-ceiling treatment matched.

- Artifact SHA-256: `3499fec4271b45ae3e3055b2071075f96f65dc451775ed23adf39f9deec5376a`
- P2B baseline dataset digest: `9cf8bc62e7a0abe1b7dba14326725632fac5a687256af23333c3fe5fb25537ea`
- Certified dataset digest: `ca14f3decb605af4df4c837f281666a6816699947d1658614bbd336f809ae08e`
- Review digest: `19c788ec2019853fa99a49e173f234f3a71be9732eee65f36bf042b2f271e565`
- Mismatches: zero

## I. EIS Golden

Eleven official image-table fixtures are `VERIFIED`, including low wage, exact bounds, next-cent crossings, middle rows, equal shares, ceiling and above ceiling.

- Fixture digest: `1f021e40a3da7db41f16b2ad9a1e175f790b5b458d12e2e878994586fc7f7086`
- Certification digest: `fb8a33c405d865009b266dfee649d25dcb0002589b4bc16f380b79280329b117`

## J. LINDUNG24 Participation

The official [PERKESO scheme page](https://www.perkeso.gov.my/?Itemid=2019&id=990&option=com_content&view=article) and retained FAQ v2.1 establish the following:

- June 2026 is mandatory for all eligible workers.
- From 8 July 2026, foreign workers remain mandatory and local workers are voluntary/default-in with an opt-out path.
- The local opt-out window runs through 31 August 2026; opt-in/continued participation invokes the official once-in-always-in treatment.
- A worker with multiple employers requires one selected employer for deduction/remittance.

The current `lindung24OptIn` boolean cannot prove effective-dated election, category, selected employer, official submission time or historical revision. `lindung24-participation-design.json` therefore requires an immutable `EmployeeLindung24ParticipationVersion`-equivalent model. The design is complete; implementation is deliberately deferred while the scheme remains blocked.

## K. LINDUNG24 Calculation

All 65 employee-borne amount cells in the shared Act 4 schedule passed visual review:

- Amount-review digest: `0f5b274c3e8b6bd13688cd319d652ebfa9435d000bae2c69b568f3d10a9a5cfa`
- Participation-design digest: `d6e335dc07bef54e6fc5f2513016ae16d828f59c86fe4baac959a4064cad31f3`

Amount-table verification is not full scheme verification. LINDUNG24 golden remains `REVIEW_REQUIRED`, and its production calculator always fails with `LINDUNG24_PARTICIPATION_EVIDENCE_REQUIRED`.

## L. Component Classification

`classification-review.json` is scheme-specific and now includes LINDUNG24 explicitly. It retains `INCLUDED`, `EXCLUDED`, `ADDITIONAL_REMUNERATION` and `UNKNOWN` decisions. Custom allowances, some bonus/arrears cases and other ambiguous components remain `UNKNOWN`; all LINDUNG24 components remain `UNKNOWN`.

Any unknown component returns `STATUTORY_CLASSIFICATION_REQUIRED`; it is never inferred from a generic taxable flag.

## M. Classification Versioning

- Version: `MALAYSIA_STATUTORY_CLASSIFICATION_2026_P2C_DRAFT_1`
- Status: `REVIEW_REQUIRED`
- Digest: `1d0c5d9aec18b66dd15dce7959ac80f019909bd78f2a5002be06e345b40f8bc1`
- Effective start: 1 June 2026
- Active versions are designed to be immutable.

A Draft Payroll whose rule/classification/calculator identity changes becomes `STATUTORY_RULE_CHANGED / REFRESH_REQUIRED`. Review/Finalized history remains locked and is never automatically recalculated.

## N. Calculator Architecture

`calculateSocso()` and `calculateEis()` are separate integer-sen table calculators. They require a verified dataset, exact row selection and a strictly positive integer wage. They save matched-row, calculation-input and provenance digests. The calculator version is `statutory-p2c-calculators/1.0.0`.

`calculateEpf()` and `calculateLindung24()` are explicit fail-closed entry points. No PCB calculator was added.

## O. Rule Selection

Rule selection remains exact by scheme, effective payroll period and active verified rule. It has no latest/nearest/fallback behavior. Missing or overlapping rules fail with `STATUTORY_RULE_NOT_AVAILABLE` or `STATUTORY_RULE_EFFECTIVE_DATE_OVERLAP`.

## P. Activation Preconditions

The activation policy now requires all of the following: verified artifact and dataset, independent review pass, verified golden fixture, verified classification, verified calculator and boundary tests, exact effective period, parser/calculator identities, positive row/fixture counts, all provenance digests and zero unresolved blockers.

## Q. Controlled Activation

The schema and service add platform-only, serializable lifecycle operations for calculation verification, activation and retirement. They require explicit scheme, version, effective date, actor and a meaningful reason. Lifecycle records retain evidence digests. Business Owner UI has no activation route.

ACTIVE provenance is immutable, overlaps are rejected, and an erroneous version is retired/superseded instead of deleted.

## R. Payroll Integration

Snapshot provenance now includes artifact, dataset, fixture, classification, parser, calculator, matched row and calculation-input digests. Runtime does not fetch authority websites or parse PDFs. Existing Drafts are not silently recalculated after a rule change.

No scheme was activated, so production Draft generation continues to use the current blocked/manual product boundary.

## S. Historical Integrity

The migration is additive. It does not drop, truncate or rewrite Payroll Entry, Payslip, Statutory Artifact, Submission, Payment Batch, Payment Instruction or Attendance Timesheet data. Finalized history continues to rely on immutable snapshots.

## T. PCB Boundary

PCB remains `BLOCKED` and outside P2C calculation development. No monthly tax engine, YTD ledger, additional remuneration workflow, TP1/TP3, relief, zakat, prior-employer or residency logic was added.

## U. Review Records

Machine-readable review records live in `statutory/official/reviews/`. They retain artifact/dataset identity, review method, reviewer identity/type, rows/pages checked, mismatches, notes, status and SHA-256 review digest. The reviewer type is explicitly `AI_ASSISTED_SECOND_PATH`; it is not represented as a human or authority endorsement.

## V. Golden Certification Records

Machine-readable certification records live in `statutory/official/certifications/`. Each record binds effective period, official reference, artifact/dataset/fixture digests, fixture count, reviewer and certification digest. Only `VERIFIED` sets can satisfy the activation guard.

## W. Determinism / Rounding

SOCSO/EIS use exact table amounts, not a generic percentage or shared rounding rule. All 65 lower/upper boundaries are tested. The same dataset, wage, category and calculator version produce identical matched-row, amount and provenance digests. Zero, negative, fractional and unsafe-integer wages are rejected rather than mapped to a zero or fallback contribution.

## X. Tests

P2C tests cover review/certification digest mutation, all certified fixtures, every table boundary, EIS equality, ceiling/above-ceiling behavior, invalid wage, fail-closed EPF/LINDUNG24, classification blockers, Draft stale behavior, platform-only activation, lifecycle audit and additive migration safety.

## Y. Local Gate

The final local gate passed: canonical guard; Prisma format/validate/generate; local migration deploy/status; disposable rebuild of all 138 migrations; P2C verifier; 21/21 targeted unit tests; 5/5 targeted integration tests; 656/656 full unit tests; 77/77 full integration tests; TypeScript; lint; production build; `git diff --check`; and changed-file sensitive scan. Lint/build retained only 10 existing non-P2C lint warnings and two existing non-P2C Autoprefixer warnings.

## Z. Per-scheme Final Status

| Scheme | Artifact | Dataset | Independent Review | Golden | Classification | Calculator | Activation | Final Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| EPF | `FETCH_REVIEW_REQUIRED` | Missing | Missing | Missing | `REVIEW_REQUIRED` | Blocked | Blocked | `PARTIAL` |
| SOCSO | `VERIFIED` | `VERIFIED` | `PASS` | `VERIFIED` | `REVIEW_REQUIRED` | `VERIFIED` | Blocked | `PARTIAL` |
| EIS | `VERIFIED` | `VERIFIED` | `PASS` | `VERIFIED` | `REVIEW_REQUIRED` | `VERIFIED` | Blocked | `PARTIAL` |
| LINDUNG24 | `VERIFIED` | Amount schedule verified | Amount review pass | `REVIEW_REQUIRED` | `REVIEW_REQUIRED` | Blocked | Blocked | `PARTIAL` |
| PCB | `SOURCE_DRIFT_DETECTED` | Missing | Out of scope | Missing | `REVIEW_REQUIRED` | Out of scope | Blocked | `BLOCKED` |

No scheme is `READY_FOR_ACTIVATION` or `ACTIVE`.

## AA. Remaining Blockers

- EPF exact official PDF bytes, full dataset, independent review and golden fixtures.
- SOCSO/EIS formal component-classification completion for every production component path.
- LINDUNG24 versioned participation/selected-employer model, July transition/refund handling, classification and participation-aware golden fixtures.
- PCB remains on the separate P3A-P3F roadmap.

## AB. Recommended Next Step

Complete a formal human/legal classification review for SOCSO/EIS and bind the approved classification version to the existing verified datasets and calculators. Separately, recover EPF through controlled official artifact import and implement LINDUNG24 participation history before reconsidering either scheme. Activation must remain a separate, explicit platform action after user approval.

## AC. Production Safety

P2C performs local development and local migration verification only. It does not commit, push, deploy, activate a scheme, modify Production, develop PCB, resume Payment P3 or create statutory/payment submissions.

Final phase status: `STATUTORY P2C — PARTIAL`.
