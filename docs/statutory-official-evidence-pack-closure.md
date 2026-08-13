# Statutory Official Evidence Pack Closure

## A. Objective

Determine whether EPF, SOCSO, EIS and LINDUNG24 each have a complete, retained, traceable, hash-verified and versioned official evidence package that an authorised human can review. This closure does not execute Human Sign-off or controlled activation.

## B. Environment

`LOCAL / TESTING ONLY`

`PRODUCTION NOT ACCESSED`

`PRODUCTION NOT VALIDATED`

No Production data, payroll, migration, deployment, statutory submission, sign-off or activation was accessed or performed.

## C. Previous Blockers

| Scheme | Engineering blocker before closure | Evidence blocker before closure | Human blocker | Activation blocker |
| --- | --- | --- | --- | --- |
| EPF | Status semantics mixed engineering with human approval | None after prior EPF closure | Authorised review not executed; 10 conditional component decisions | Human review/sign-off; canonical registration is now complete |
| SOCSO | None in calculator/dataset | Manifest retainedPath missing | Authorised review not executed; 10 conditional component decisions | Human review/sign-off; canonical registration is now complete |
| EIS | Official binary absent from repository | No retainedPath/original PDF | Authorised review not executed; 10 conditional component decisions | Human review/sign-off; canonical registration is now complete |
| LINDUNG24 | Status semantics did not reflect the completed Phase 1 engineering | No missing retained source after prior participation closure | Authorised review not executed; 10 conditional/unmaterialised component decisions | Human review/sign-off; canonical registration is now complete |

SOCSO retainedPath and EIS binary blockers are resolved in this closure. Missing Human Sign-off is kept separate from Engineering status.

## D. Evidence Standard

A complete pack contains publisher, document identity/version, effective period, official URL provenance, retained artifact/path, MIME, byte size, SHA-256, retrieval date, parser identity, verified dataset/digest, independent review, calculator version/test digest, fixture provenance, classification summary and known limitations.

Hash verifies retained bytes have not changed after retention. Hash alone does not prove the correct official source was selected. Publisher, document identity, effective period, official-domain provenance and document content were therefore checked separately.

The retained immutable artifact is the canonical Human review input. Live websites are provenance and bounded re-verification inputs only; Payroll runtime has no internet dependency.

## E. Artifact Registry

The single canonical artifact registry remains `statutory/official/manifest.json`. The evidence-pack registry references artifact IDs and evidence-chain paths without creating a second hash registry.

| Scheme | Artifact ID / publisher / document version | Effective | Retained path | MIME / bytes | SHA-256 | Status |
| --- | --- | --- | --- | --- | --- | --- |
| EPF | `kwsp-third-schedule-2025-10` / KWSP / Third Schedule 2025-10 | 2025-10-01 - open | `statutory/official/artifacts/kwsp-third-schedule-2025-10.pdf` | PDF / 761,109 / 55 pages | `c4904e44f0cb15a251a59e4f34c11a1ededa0868b962b2ebd9b81270285358b1` | VERIFIED |
| SOCSO | `perkeso-act4-lindung24-2026-06` / PERKESO / Act 4 + SKBBK 2026-06 | 2026-06-01 - open | `statutory/official/artifacts/perkeso-lindung24-amount-schedule-2026-06.pdf` | PDF / 219,851 / 8 pages | `e76b2a03740f6da4a305919c677d4935a05e9166502e5f06afe1030b7407caa1` | VERIFIED / retainedPath RESOLVED |
| EIS | `perkeso-act800-2024-10` / PERKESO / Act 800 2024-10 | 2024-10-01 - open | `statutory/official/artifacts/perkeso-act800-contribution-schedule-2024-10.pdf` | PDF / 933,164 / 1 image-table page | `3499fec4271b45ae3e3055b2071075f96f65dc451775ed23adf39f9deec5376a` | VERIFIED / binary RETAINED |
| LINDUNG24 | `perkeso-lindung24-schedule-2026-06` / PERKESO / Phase 1 amount schedule | 2026-06-01 - 2028-06-01 | `statutory/official/artifacts/perkeso-lindung24-amount-schedule-2026-06.pdf` | PDF / 219,851 / 8 pages | `e76b2a03740f6da4a305919c677d4935a05e9166502e5f06afe1030b7407caa1` | VERIFIED |
| LINDUNG24 | `perkeso-lindung24-faq-2026-06-v2.1` / PERKESO / FAQ v2.1 | 2026-07-08 - open | `statutory/official/artifacts/perkeso-lindung24-faq-v2.1.pdf` | PDF / 284,830 / 19 pages | `a7b212187d5a66934e9dc5f0369d1bf45ff97d81adeac1031600358957b87fab` | VERIFIED |
| LINDUNG24 | `perkeso-lindung24-employer-circular-3-2026` / PERKESO / Circular 3/2026 | 2026-06-01 - open | `statutory/official/artifacts/perkeso-employer-circular-3-2026-lindung24.pdf` | PDF / 504,253 / 13 pages | `26e594d31266f79af14d7b69c6a7185f9e03bdfce2590435ac5a64df092cb6ab` | VERIFIED |
| LINDUNG24 | `perkeso-lindung24-participation-form-2026` / PERKESO / Participation form 2026 | 2026-06-01 - open | `statutory/official/artifacts/perkeso-lindung24-participation-form-2026.pdf` | PDF / 835,059 / 1 page | `67ba5f24eb9929f0a7c7aa626c30e224d0705766e6b3063bf10f4fcb83db121f` | VERIFIED |
| LINDUNG24 | `perkeso-lindung24-opt-out-notice-v2.1` / PERKESO / Opt-out notice v2.1 | 2026-07-08 - open | `statutory/official/artifacts/perkeso-lindung24-opt-out-notice-v2.1.pdf` | PDF / 759,497 / 1 page | `95a1ae1549eeca7ee24a9d61fb154f420fad52fdd2d5ffe88766bd3a404d303e` | VERIFIED |

## F. Source Provenance

All sources are on the official KWSP or PERKESO domains recorded in the manifest. A bounded live re-fetch on 2026-08-10 returned HTTP 200 and `application/pdf` for every unique EPF/SOCSO/EIS/LINDUNG24 source URL; byte sizes and SHA-256 values matched the manifest. The machine-readable log is `statutory/official/reviews/official-source-refetch-2026-08-10.json`, digest `753407e5a9be7bc81cb2c67d35a63912b21dd6bafae3b360cc29729b9360fd7a`.

This successful re-fetch is supporting provenance only. Future network failure is non-blocking while the retained artifact remains intact and identity-verified.

## G. EPF

- Official source provenance: COMPLETE.
- Retained artifact/hash/content: VERIFIED; readable 55-page KWSP Third Schedule effective 1 October 2025.
- Parser/dataset: `kwsp-third-schedule/2.0.0`; 401 physical boundary rows shared across Parts A/C/E.
- Independent cross-check: Part A 401 + Part C 401 + Part E 401 = 1,203 reviewed rows; mismatches 0.
- Dataset digest: `17c6787a8b28fb0e1b30f9c350a70491a0f882e833b7cf17a3d1251acc45a4b3`.
- RM20,000 formula provenance: retained PDF page 20 Part A (employee 11%, employer 12%), page 37 Part C (5.5%/6%), page 53 Part E (0%/4%); page 55 Part F is 2%/2%. Contributions containing cents round to the next ringgit.
- Calculator: `statutory-p2c-epf-calculator/1.0.0`; test digest `7130f1f87b1a6879d50186a1c09456a3e9d1be9d0da4a81e52e886152151fa14`.
- Fixtures: 21 `OFFICIAL_BACKED`; certification and calculation pass.
- Classification: complete fail-closed framework; 10 human-decision components explicitly listed.
- Evidence Pack: COMPLETE; Engineering: READY.

## H. SOCSO

- Official source provenance: COMPLETE.
- retainedPath: RESOLVED to the retained official Act 4/SKBBK schedule; path opens and exact hash passes.
- Parser/dataset: `perkeso-act4-skbbk-table/1.0.0`; 65 official bands, 65 independent-review rows, mismatches 0.
- Dataset digest: `1e1b17a332e2b596b1efa85c075428c54b16d059730726e3f67cef710f334460`.
- Calculator: `statutory-p2c-calculators/1.0.0`; test digest `acd13f53032c299fee02ee5a9e9b11bae87d8ac5ce0a313fce05655ea79a53b3`.
- Fixtures: 20 `OFFICIAL_BACKED`; certification and calculation pass.
- Classification: complete fail-closed framework; 10 human-decision components explicitly listed.
- Evidence Pack: COMPLETE; Engineering: READY.

## I. EIS

- Official source provenance: COMPLETE.
- Official retained binary: VERIFIED. The exact one-page image-only PERKESO “Kadar Caruman Sistem Insurans Pekerjaan (Akta 800)” schedule was fetched from the registered official URL, retained additively and matched the pre-existing manifest SHA-256.
- Parser/dataset: `perkeso-act800-image-table/1.0.0`; 65 official bands, 65 independently rendered/reviewed rows, mismatches 0.
- Dataset digest: `ca14f3decb605af4df4c837f281666a6816699947d1658614bbd336f809ae08e`.
- Calculator: `statutory-p2c-calculators/1.0.0`; test digest `3dbed2c04746e0863d00473f8a281cee401cda574fb19d4882fa07c689742c9b`.
- Fixtures: 11 `OFFICIAL_BACKED`; certification and calculation pass.
- Classification: complete fail-closed framework; 10 human-decision components explicitly listed.
- Evidence Pack: COMPLETE; Engineering: READY.

## J. LINDUNG24

The five-artifact source pack is complete: amount schedule, FAQ v2.1, Employer Circular 3/2026, participation form and opt-out notice. All paths open, all PDFs are readable/renderable, and all hashes match. The circular’s 13 image-heavy pages were rendered and visually checked, including the PERKESO identity, June 2026 implementation and employer-selection guidance.

- Dataset/review: 65 amount rows / 65 reviewed / 0 mismatch.
- Calculator: `statutory-p2c-calculators/1.0.0`; six-fixture calculation digest `ef6aebfdbfdb4d0d28c87da6b03cd756ffa14f60a029b944da21e5735bcd35f2`.
- Fixtures: 6 `OFFICIAL_BACKED`; certification passes.
- Participation, once-in and multi-employer controls: implemented and regression-tested.
- Verified Phase 1 horizon: 2026-06-01 to 2028-06-01 exclusive. From 2028-06-01, `NEW_OFFICIAL_RULESET_REQUIRED`; the old schedule cannot continue indefinitely.
- Classification: complete fail-closed framework; 10 conditional/unmaterialised component meanings listed.
- Evidence Pack: COMPLETE; Engineering: READY.

## K. Dataset Traceability

| Scheme | Dataset -> artifact | Review -> dataset | Result |
| --- | --- | --- | --- |
| EPF | `kwsp...normalized-v1` -> `kwsp-third-schedule-2025-10` -> retained KWSP PDF | 1,203 rows / digest-bound | VERIFIED |
| SOCSO | `perkeso-act4...v1` -> `perkeso-act4-lindung24-2026-06` -> retained PERKESO PDF | 65 rows / digest-bound | VERIFIED |
| EIS | `perkeso-act800...review-v1` -> `perkeso-act800-2024-10` -> retained image-only PERKESO PDF | 65 rows / digest-bound visual second path | VERIFIED |
| LINDUNG24 | shared Act 4 amount dataset -> registered shared artifact SHA -> retained Phase 1 schedule | 65 amount rows / digest-bound | VERIFIED |

Wrong artifact ID/hash, dataset digest, scheme or review link returns `DATASET_ARTIFACT_TRACE_MISMATCH` or another incomplete-pack blocker.

## L. Calculator Traceability

Calculators bind scheme, effective rule version, verified dataset, calculator version and test digest. Runtime never resolves “latest dataset” and never downloads official content. EPF table/formula selection and SOCSO/EIS/LINDUNG24 table selection remain deterministic integer-money calculations.

## M. Fixture Provenance

| Scheme | OFFICIAL_BACKED | INDEPENDENT_DERIVED | ENGINEERING_REGRESSION | Missing provenance |
| --- | ---: | ---: | ---: | ---: |
| EPF | 21 | 0 | 0 | 0 |
| SOCSO | 20 | 0 | 0 | 0 |
| EIS | 11 | 0 | 0 | 0 |
| LINDUNG24 | 6 | 0 | 0 | 0 |

Every counted fixture has a source reference, artifact ID/hash, rule version and certified fixture-set digest. A fixture without source reference cannot count as official-backed.

## N. Component Classification

Each scheme has explicit INCLUDED/EXCLUDED/UNKNOWN entries or an explicit unresolved inventory. UNKNOWN never becomes silent EXCLUDED or zero.

The 10 unresolved meanings for each pack are present in the scheme review pack. They are `CONDITIONAL_RUNTIME_BLOCKER` when a payroll actually uses that ambiguous component. Under the existing general canonical activation policy they are also `ACTIVATION_BLOCKING_UNKNOWN` until an authorised human decision produces a new immutable classification revision. Their presence does not make the official evidence pack incomplete and does not change Engineering READY to PARTIAL.

## O. Network Verification

`LIVE OFFICIAL SOURCE RE-FETCH -> AVAILABLE / PASS (2026-08-10)`

`RETAINED OFFICIAL ARTIFACT -> VERIFIED`

Previous Node `fetch failed` results were a client/network-path limitation and did not alter retained evidence. The bounded curl-based verification succeeded for every unique official source with exact byte/hash matches. Deterministic tests use retained files only and continue to pass when the network is unavailable.

## P. Evidence Digest

| Scheme | Evidence-pack digest |
| --- | --- |
| EPF | `b7679073dab4ebce9c08162b06c658c273a626e742b2260c1cd801d4f0958cee` |
| SOCSO | `aab60305d122387381bba6ade2e4586975600762258cd6f59c2348c93a09b1df` |
| EIS | `40beb12567fd72fb543a2a8fb95d13d4236dcb6fb9412a5380fd31abc70f86b5` |
| LINDUNG24 | `bb24337c047a3650f6ad98166377dccd2ef66edb3dfa6b7365e1a9b9ed976b2b` |

The digest binds retained artifact identities, dataset/parser, independent review, fixtures/certification, classification/unresolved inventory, calculator evidence and known limitations. It is not a human signature.

## Q. Sign-off Pack

The four stable review inputs are `docs/statutory-review-pack-epf.md`, `docs/statutory-review-pack-socso.md`, `docs/statutory-review-pack-eis.md` and `docs/statutory-review-pack-lindung24.md`. The Admin Statutory Rules page displays evidence completeness, artifact paths/hashes, Engineering status, Human status, activation blocker and evidence digest. It does not auto-check the Human checklist.

## R. Engineering Status Semantics

`Engineering READY` means implementation, official evidence pack, verified dataset/calculator/fixtures, fail-closed classification framework and sign-off workflow are ready. It does not require a Human signature.

`Engineering PARTIAL` is reserved for a real software/evidence gap such as missing original official bytes, broken traceability or unverifiable retained content. No such blocker remains for these four packs.

## S. Human Status

All four schemes: `NOT_EXECUTED`.

No checklist was ticked, no approval record was generated, no Human identity was impersonated and no canonical candidate was signed.

## T. Activation Status

All four schemes: `BLOCKED_HUMAN_SIGNOFF`.

No rule was activated. Canonical registration is complete. After authorised Human decisions/sign-off, stale-digest checks, two-person activation and effective-period conflict checks remain separate controlled actions.

## U. PCB Boundary

`PCB -> PARTIAL`

No PCB Final Closure was performed. Current blockers remain canonical employee tax profile/TP1/TP3 workflow, persistent YTD finalisation, full payroll snapshot integration and HASiL software verification.

## V. Claims Boundary

`CLAIMS CORE -> READY`

`OUTSIDE-PAYROLL REIMBURSEMENT -> READY`

`PAYROLL REIMBURSEMENT BRIDGE -> BLOCKED`

`CLAIM STATUTORY TREATMENT -> FAIL-CLOSED`

No verified claim reimbursement statutory/tax source was introduced. `CLAIM_STATUTORY_TREATMENT_NOT_READY` remains correct.

## W. Tests

- Evidence-pack negative/independence unit: 7/7 PASS (missing artifact, hash mutation, metadata, wrong dataset trace, fixture provenance, network independence, Human-status independence).
- Automated evidence-pack verification: four schemes COMPLETE; all 14 manifest artifact bindings passed local byte-size and SHA-256 verification; all 7 unique official source URLs passed bounded re-fetch with HTTP 200, `application/pdf`, exact size and exact SHA-256.
- Targeted statutory/evidence/LINDUNG24 unit: 62/62 PASS.
- Targeted Claims/Payroll/HR unit: 86/86 PASS.
- Targeted statutory/Claims/Payroll integration: 29/29 PASS.
- Full unit suite: 746/746 PASS.
- Full integration suite (isolated embedded PostgreSQL): 105/105 PASS.
- `statutory:verify-evidence-packs` and `statutory:verify-p2c`: PASS.
- Fresh migration rebuild: 148/148 PASS. Prisma generate/validate/status: PASS; 148 migrations, schema up to date.
- TypeScript: PASS. Lint: PASS with the pre-existing WhatsApp `<img>` performance warning only.
- Local production-mode build: PASS; only pre-existing Attendance CSS/autoprefixer and WhatsApp image warnings were emitted.
- Local admin UI smoke: PASS; all four schemes displayed `COMPLETE / READY`, `NOT_EXECUTED` and `BLOCKED_HUMAN_SIGNOFF`. No Human sign-off or activation control was submitted.
- Changed-task-file credential-shape scan, canonical workspace guard and `git diff --check`: PASS.

## X. Remaining Engineering Blockers

Official evidence-pack blockers for EPF, SOCSO, EIS and LINDUNG24: none.

Remaining items are Human/activation actions, not evidence-pack engineering gaps. LINDUNG24 also requires a new official schedule before 2028-06-01 for any later period.

## Y. Human Actions Required

- EPF: Human reviewer may review the complete pack and decide the listed conditional component meanings.
- SOCSO: Human reviewer may review; retainedPath is resolved.
- EIS: Human reviewer may review the retained official image-table binary and linked evidence.
- LINDUNG24: Human reviewer may review the five-artifact Phase 1 pack, participation and horizon controls.

Only an authorised Human may create the next immutable decision/sign-off revision. Activation remains a later separate action by another authorised actor.

## Z. Final Status

| Scheme | Official provenance | Retained artifact | Dataset/calculator/fixtures | Evidence Pack | Engineering | Human Sign-off | Controlled Activation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EPF | COMPLETE | VERIFIED | VERIFIED | COMPLETE | READY | NOT EXECUTED | BLOCKED_HUMAN_SIGNOFF |
| SOCSO | COMPLETE | VERIFIED / retainedPath RESOLVED | VERIFIED | COMPLETE | READY | NOT EXECUTED | BLOCKED_HUMAN_SIGNOFF |
| EIS | COMPLETE | OFFICIAL BINARY VERIFIED | VERIFIED | COMPLETE | READY | NOT EXECUTED | BLOCKED_HUMAN_SIGNOFF |
| LINDUNG24 | COMPLETE | 5/5 VERIFIED | VERIFIED | COMPLETE | READY | NOT EXECUTED | BLOCKED_HUMAN_SIGNOFF |

`STATUTORY OFFICIAL EVIDENCE PACK CLOSURE -> READY_FOR_HUMAN_REVIEW`

This is not `HUMAN_SIGNED_OFF`, `ACTIVE`, legal advice or government certification.
