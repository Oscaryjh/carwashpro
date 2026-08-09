# Statutory P2B - Official Artifact Ingestion & Verification Pipeline

## A. Objective

P2B turns an authority URL into a controlled chain of evidence: official authority, exact artifact identity, SHA-256, parser version, normalized dataset, dataset digest, source-traceable fixtures, verification and explicit activation. It does not treat a URL, successful download or successful parse as proof that a calculation rule is correct.

Payment P3A remains `PUBLIC_BANK_SPEC_NOT_READY`. P2B does not implement PCB calculation, statutory submission, government payment, Payment P3B or Payment P4.

## B. Previous P2 State

P2 already provided versioned rule sets, scheme-specific component classifications, employee statutory profile versions, immutable per-entry snapshots, readiness blockers and finalized-Payroll immutability. No amount calculation was active because official bytes, checksums, datasets and golden verification had not been retained.

## C. Artifact Architecture

The canonical source files are under `statutory/official`:

- `manifest.json` records authority, URLs, version, effective dates, retrieval date, byte size, MIME type, SHA-256, parser identity and independent parsing/verification status.
- `datasets/` contains normalized, integer-sen contribution rows and canonical digests.
- `fixtures/` contains source-referenced boundary cases and fixture-set digests.
- `classification-review.json` keeps interpretation explicit and fail-closed.
- `pcb-2026-requirements.json` records the tax/YTD gap without creating a calculator.

The manual verifier downloads into memory or reads an operator-supplied local file. Payroll runtime never calls an authority website and never parses a PDF.

## D. Official Source Manifest

| Scheme | Authority artifact | Effective | Artifact status | Dataset / fixture status | Activation |
| --- | --- | --- | --- | --- | --- |
| EPF | [KWSP Third Schedule](https://www.kwsp.gov.my/en/epf-act-1991-third-schedule) | 2025-10-01 | `FETCH_REVIEW_REQUIRED` | Missing | No |
| SOCSO | [PERKESO Act 4 + SKBBK schedule](https://www.perkeso.gov.my/images/lindung/lindung-24-jam/NewContributionRateIncludingSKBBK.pdf) | 2026-06-01 | `VERIFIED` bytes | 65 parsed rows; fixtures review-required | No |
| EIS | [PERKESO Act 800 schedule](https://www.perkeso.gov.my/images/dokumen/101024%20-%20Kadar%20Caruman%20Akta%20800.pdf) | 2024-10-01 | `VERIFIED` bytes | 65 manually-transcribed rows; review-required | No |
| LINDUNG24 | [PERKESO scheme page](https://www.perkeso.gov.my/?Itemid=2019&id=990&option=com_content&view=article), schedule and FAQ v2.1 | 2026-06 / 2026-07-08 | `VERIFIED` bytes | Amount rows parsed; eligibility transition review-required | No |
| PCB | [HASiL 2026 specification](https://www.hasil.gov.my/media/arvlrzh5/spesifikasi-kaedah-pengiraan-berkomputer-pcb-2026.pdf) | YA 2026 | `SOURCE_DRIFT_DETECTED` | Requirements inventory only | No |

## E. Binary Retention Policy

The repository has no Git LFS or convention for committing regulatory source binaries. Existing statutory binaries are encrypted tenant export artifacts, not platform rule sources. P2B therefore retains manifest identity, expected bytes/checksum when fetched, normalized datasets and deterministic verification tooling, but not the PDFs themselves. This avoids silent binary replacement and repository bloat while still permitting exact re-fetch verification.

Downloaded working copies live only under ignored `tmp/`. A changed official file must be registered as a new revision after review; it is never written over the recorded identity.

## F. SHA-256 Verification

`npm run statutory:verify-artifacts` performs deterministic fetch/read, byte-size, MIME and SHA-256 checks. A mismatch returns `OFFICIAL_ARTIFACT_CHECKSUM_MISMATCH`; an HTML/404/CDN response returns `SOURCE_DRIFT_DETECTED`. It does not update the manifest or activate anything.

Exact checksums obtained on 2026-08-08:

- Act 4/SKBBK: `e76b2a03740f6da4a305919c677d4935a05e9166502e5f06afe1030b7407caa1`, 219,851 bytes.
- Act 800: `3499fec4271b45ae3e3055b2071075f96f65dc451775ed23adf39f9deec5376a`, 933,164 bytes.
- LINDUNG24 FAQ v2.1: `a7b212187d5a66934e9dc5f0369d1bf45ff97d81adeac1031600358957b87fab`, 284,830 bytes.

KWSP currently challenges deterministic download, while the two former HASiL media URLs return the redesigned site's 404 response. Null checksums are intentional and cannot pass activation.

## G. Parser Versioning

Every manifest and dataset records `parserName` and `parserVersion`. `parse_perkeso_act4.py` verifies the artifact checksum before parsing and rejects missing/ambiguous rows or broken totals. The same artifact and parser version produce the same canonical dataset digest. Parser fixes require a new parser version and dataset comparison.

## H. Normalized Dataset

Normalized tables use integer sen and exact inclusive wage boundaries. They contain stable row keys, source references, employee/employer shares and an open-ended ceiling row where the authority table specifies one. Validation rejects wrong row count, duplicate keys, overlap, unintended gap, negative/malformed amounts and digest mismatch.

The table schema is contribution-table-specific; PCB requirements are not forced into it.

## I. EPF Artifact

The official landing page confirms the Third Schedule effective October 2025 and a 55-page official PDF. The current CDN prevents reproducible byte retrieval, so the artifact is not `VERIFIED`; no checksum, parsed dataset or activation is claimed.

## J. EPF Dataset / Fixtures

No EPF normalized table or fixture is produced from search text. Part/category handling, every band, high-wage rules, age/citizenship/election categories and boundary behavior remain required. EPF stays **PARTIAL**.

## K. SOCSO Artifact

The current official Act 4 schedule includes the Non-Employment Injury Security Scheme and 65 salary categories. Exact PDF bytes and SHA-256 are verified, and the parser independently checks table totals.

## L. SOCSO Dataset / Fixtures

The parser generated all 65 continuous rows including first/second categories and the above-RM6,000 ceiling row. Review fixtures cover low bands, transitions, ceiling and above-ceiling values for both categories. They deliberately remain `REVIEW_REQUIRED`, so the calculation rule is not active. SOCSO stays **PARTIAL**.

## M. EIS Artifact

The official Act 800 PDF is verified and visually confirms 65 rows, equal employee/employer shares and the RM6,000 ceiling. It is image-only and yields no reliable text extraction.

## N. EIS Dataset / Fixtures

The normalized 65 rows are marked `MANUALLY_TRANSCRIBED / REVIEW_REQUIRED`. They have deterministic digests and range tests but lack independent dual review. EIS stays **PARTIAL** and cannot activate.

## O. LINDUNG24 Audit

The official PERKESO rule makes LINDUNG 24 Jam an employee-funded payroll deduction remitted by the employer. Phase 1 is 0.75%; later phases are 1.00% and 1.25%. It is mandatory for foreign employees and voluntary for local employees effective 8 July 2026. Therefore the product decision is **E - depends on employee category and participation evidence**: employee-only money, employer remittance, no employer contribution.

The June-to-8-July transition and canonical opt-out/participation evidence require a dedicated reviewed rule revision. Until then `LINDUNG24_RULE_NOT_READY` applies and no money line is produced. Status: **PARTIAL**.

## P. PCB 2026 Artifact

The official 2026 computerized MTD specification was located and audited. Its former media URL currently returns source drift, so bytes/checksum are not registered as verified. The requirements inventory records normal/additional remuneration, YTD, TP1, TP3, zakat, reliefs, prior employment and rounding without implementing the engine.

## Q. PCB Official Testing Material

HASiL's `Monthly Tax Deduction Testing Questions Using Computerised Calculation Method 2026` was located at the official media URL. That URL also currently fails deterministic byte retrieval. The manifest reserves a testing-material artifact and future golden-import parser, but no expected answer is generated from Tetamu code.

## R. PCB Requirements Gap

Tetamu lacks canonical resident/marital/spouse/children facts, relief and zakat records, TP1/TP3, previous-employer income/PCB, a Malaysia tax-year YTD ledger and the additional-remuneration engine. PCB remains **BLOCKED** even if the PDFs later verify.

Recommended PCB roadmap:

1. PCB P3A - Tax Profile Completion.
2. PCB P3B - Malaysia Tax-Year YTD Ledger.
3. PCB P3C - TP1 / TP3 / Previous Employer.
4. PCB P3D - Normal + Additional Remuneration Engine.
5. PCB P3E - Official Golden Verification.
6. PCB P3F - Auto PCB Activation.

## S. Statutory Classification Review

The review covers basic salary, recurring allowance, bonus, commission, incentive, arrears, daily/hourly pay, paid leave, overtime and future rest-day/public-holiday pay. EPF expressly excludes overtime while PERKESO and PCB include it. PCB bonus/incentive/arrears are additional remuneration; commission/allowance treatment depends on payment frequency. Custom allowances and ambiguous holiday payments remain `UNKNOWN`, producing `STATUTORY_CLASSIFICATION_REQUIRED`.

## T. Activation Lifecycle

Manifest status moves through discovery/ingestion/parsing/verification independently of database rule status. Download or parse success never activates a rule. Database `ACTIVE` now requires `CALCULATION_VERIFIED`, artifact digest, dataset digest, fixture digest, parser identity and positive row count. Active provenance cannot be mutated; a changed authority file or parser creates a new version. Ordinary tenant users have no ingest/activation API.

## U. Rule Selection

Selection uses the Payroll statutory period and an exact `ACTIVE + CALCULATION_VERIFIED` rule. It never selects "latest" or the closest prior rule. Gaps return `STATUTORY_RULE_NOT_AVAILABLE`; overlaps are blocked both in code and PostgreSQL.

## V. Payroll Integration

`LINDUNG24` is now a separate statutory scheme and snapshot. Future calculated snapshots have dedicated artifact/dataset/parser/matched-row provenance fields. The P2 statutory deduction keys and net reconciliation remain canonical. No scheme is calculated in P2B because none passes every scheme-ready gate.

## W. Tests

P2B adds checksum mutation tests, dataset determinism and digest tests, 65-row range integrity, boundary lookup, activation rejection, exact period selection, fixture traceability, migration activation guard, active provenance immutability, LINDUNG24 separation and PCB-blocked assertions. Full unit, integration, TypeScript, lint, build, Prisma and migration results are recorded in the phase handoff.

## X. Remaining Blockers

- EPF exact bytes, complete category-aware dataset and official golden fixtures.
- Independent review of Act 4 normalized rows and boundary fixtures.
- Independent dual review of the image-derived Act 800 table.
- LINDUNG24 transition/participation evidence and future phase revisions.
- Current retrievable HASiL spec/testing artifact URLs.
- Scheme-specific production classification revisions and verified calculation engines.
- All PCB tax profile/YTD architecture.

## Y. Recommended Next Phase

Proceed only when a platform reviewer can independently verify the retained datasets against authority artifacts. The recommended phase is **Statutory P2C - Independent Dataset Review, Official Golden Certification & Scheme Activation**. PCB should follow its separate P3A-P3F roadmap, not be bundled into P2C.

## Z. Completion Gate

Infrastructure status: **STATUTORY P2B - READY**.

| Scheme | Artifact | Dataset | Golden fixtures | Calculation | Activation | Status |
| --- | --- | --- | --- | --- | --- | --- |
| EPF | Fetch review required | Missing | Missing | Inactive | No | **PARTIAL** |
| SOCSO | Verified | Parsed, 65 rows | Review required | Inactive | No | **PARTIAL** |
| EIS | Verified | Manual review required, 65 rows | Review required | Inactive | No | **PARTIAL** |
| LINDUNG24 | Rule/schedule/FAQ verified | Parsed amount rows; eligibility transition unresolved | Review required | Inactive | No | **PARTIAL** |
| PCB | Source drift | Requirements inventory only | Source located, bytes unavailable | Blocked | No | **BLOCKED** |

P2B is READY because the artifact/verification/activation infrastructure is complete and fail-closed. No statutory scheme is promoted to READY without independently verified official fixtures and calculation evidence.
