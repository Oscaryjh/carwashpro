# Statutory P2 — Malaysia Statutory Calculation Foundation

## A. Objective

Statutory P2 inserts a fail-closed boundary between frozen Payroll components and Malaysia statutory results:

`Frozen components → scheme classification → employee profile revision → official rule version → statutory snapshot → P4B deduction reconciliation`.

It does not submit, pay, or regenerate any government artifact. Payment P3A remains `PUBLIC_BANK_SPEC_NOT_READY`.

## B. Existing Statutory Audit

- **CANONICAL:** granular statutory/tax/export capabilities; whole-business statutory routes; tenant-scoped employee profile commands; masked audit DTOs; immutable export artifacts; finalized Payroll and published Payslip immutability.
- **PARTIAL:** membership has DOB, statutory nationality, EPF/SOCSO/EIS flags and member identifiers, plus profile revision counters. It does not yet contain the complete PCB 2026 tax facts, TP1/TP3 inputs, previous-employer state, marital/spouse/children factors, reliefs, zakat or a canonical tax-year ledger.
- **LEGACY:** `src/lib/payroll/statutory.ts` contains hard-coded P1 EPF/PERKESO calculations and one comma-joined rule-version string. It remains for compatibility tests only and is no longer called by new Payroll generation.
- **MANUAL / UNSAFE:** the old entry editor allowed direct editing of employee and employer statutory amounts and labelled the result `MANUAL_OVERRIDE`. P2 makes these fields read-only and rejects amount changes server-side. A dedicated manual-official-PCB command has not been introduced, so PCB remains blocked.
- **UNSAFE fixed:** generation previously used Attendance gross as both EPF and PERKESO wage base before recurring, variable and correction components were materialised. New generation performs P2 materialisation only after frozen P4B/P5/P4C component creation.
- **BLOCKED:** existing code identified SOCSO as `PERKESO_ACT4_SKBBK_2026_06`, but the official contribution page records the RM6,000 Act 4/Act 800 ceiling as effective 1 October 2024. The 2026 document located during audit concerns a benefit-rate amendment, not the contribution schedule. That code constant cannot activate a P2 rule.

## C. Official Source Register

Recorded/retrieved: 2026-08-08. Only authority-owned sources may progress beyond metadata-only readiness.

| Scheme | Authority | Document / Dataset | Version | Effective Date | Source Type | Official | Field/table readiness | Golden Fixture | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| EPF | KWSP / EPF | [EPF Act 1991 Third Schedule](https://www.kwsp.gov.my/en/epf-act-1991-third-schedule) | Third Schedule effective 2025-10 | 2025-10-01 | Official schedule landing page and linked schedule | YES | Metadata verified; linked table file not checked into repository with SHA-256/row validation | Existing examples are legacy-only, not artifact-backed P2 fixtures | PARTIAL |
| SOCSO | PERKESO | [Contribution Rate — Act 4](https://www.perkeso.gov.my/en/rate-of-contribution.html) | Act 4, RM6,000 ceiling | 2024-10-01 | Official schedule page/link | YES | Metadata verified; table file not ingested/checksummed | No artifact-backed P2 golden set | PARTIAL |
| EIS | PERKESO | [Contribution Rate — Act 800](https://www.perkeso.gov.my/en/rate-of-contribution.html) | Act 800, RM6,000 ceiling | 2024-10-01 | Official schedule page/link | YES | Metadata verified; table file not ingested/checksummed | No artifact-backed P2 golden set | PARTIAL |
| PCB | HASiL / LHDN | [Computerized MTD Calculation Specification 2026](https://www.hasil.gov.my/media/arvlrzh5/spesifikasi-kaedah-pengiraan-berkomputer-pcb-2026.pdf) and [Employer guideline register](https://www.hasil.gov.my/en/employers/guideline/) | YA 2026 | 2026 tax year | Official algorithm specification | YES | Official specification available; required profile/YTD/additional-remuneration inputs are not complete | No complete official P2 fixture suite | BLOCKED |

No entry above is activated automatically by the migration. An official file must be retained, hashed, parsed and validated before `CALCULATION_VERIFIED` is permitted.

## D. Rule Versioning

`StatutoryRuleSet` stores scheme, immutable version identity, inclusive effective start, exclusive effective end, authority, source reference/document, SHA-256, row count, readiness and status. Rule selection uses the Payroll statutory period, never today. Service and database guards reject overlapping active periods; gaps produce `STATUTORY_RULE_NOT_AVAILABLE`. Future DRAFT rules are never selected.

## E. Statutory Classification

`StatutoryComponentClassification` is rule-set and scheme specific. `PayrollComponentStatutoryTreatmentSnapshot` freezes `INCLUDED`, `EXCLUDED`, `ADDITIONAL_REMUNERATION`, or `UNKNOWN` for every component and each of EPF/SOCSO/EIS/PCB. Exact source-type mapping wins over a generic code mapping. Missing mappings remain `UNKNOWN` and create `STATUTORY_CLASSIFICATION_REQUIRED`; they never default to included or excluded.

## F. Employee Statutory Profile

The current membership remains the authorized edit surface. At Payroll materialisation, `EmployeeStatutoryProfileVersion` appends the minimum required calculation facts and a deterministic digest. Reusing a revision with different facts fails closed. EPF, SOCSO and EIS applicability is based on the frozen profile; disabling a scheme is not treated as an automatic legal exemption outside the existing authorized profile workflow.

## G. Tax Profile

TIN/identity values remain behind `VIEW_TAX_PROFILE` / `EDIT_TAX_PROFILE` and are not duplicated in P2 snapshots. Snapshots contain only revision, presence flags and calculation metadata. The current domain is insufficient for auto PCB 2026, so `PCB_PROFILE_INCOMPLETE` applies where appropriate and auto PCB is unavailable.

## H. EPF

Status: **PARTIAL**. Official metadata is verified, rule/version/snapshot/classification architecture exists, and the unsafe generation shortcut is removed. Calculation remains blocked until the official linked schedule is retained with SHA-256, complete row/boundary validation, classifications and official golden fixtures.

## I. SOCSO

Status: **PARTIAL**. Act 4 schedule metadata and RM6,000 ceiling date are identified from PERKESO. The old `2026_06` contribution version is not trusted. No P2 calculation occurs until the official table artifact and category/eligibility fixtures are verified.

## J. EIS

Status: **PARTIAL**. Act 800 metadata is identified from PERKESO. Dataset ingestion, age/eligibility boundary fixtures and verified contribution rows remain required.

## K. PCB

Status: **BLOCKED**. HASiL 2026 specifies normal and additional remuneration handling, but the application lacks the complete tax profile, relief, TP1/TP3, prior-employer and deterministic YTD state. No monthly-salary percentage approximation is permitted.

## L. YTD Handling

No random summation of previous entries is used. A canonical Malaysia tax-year ledger has not yet been implemented. Until it handles finalized sources, corrections, reopen restrictions, prior employer amounts, prior PCB and manual official values, auto PCB remains blocked.

## M. Manual Official PCB

The legacy generic override is disabled. A future controlled command must record `MANUAL_OFFICIAL_PORTAL`, actor, period, amount, reason/reference and immutable source digest, with a dedicated capability and explicit recalc semantics. P2 does not disguise a manual value as calculated.

## N. Statutory Snapshot

`PayrollEntryStatutorySnapshot` stores one row per entry/scheme with rule/version, profile and tax revisions, wage base, employee/employer amounts, source, blocker, metadata and SHA-256 digest. Composite foreign keys enforce business/membership/run/entry consistency. Finalized-run snapshots are database-immutable.

## O. Employee Deduction Components

`STATUTORY` is a dedicated P4B source type. Stable keys are `STATUTORY:EPF_EMPLOYEE`, `STATUTORY:SOCSO_EMPLOYEE`, `STATUTORY:EIS_EMPLOYEE`, `STATUTORY:LINDUNG24_EMPLOYEE` and `STATUTORY:PCB`. Zero or blocked results create no money line. Non-statutory aggregation explicitly excludes this source, preventing double deduction.

## P. Employer Contributions

Employer EPF/SOCSO/EIS remain separate snapshot amounts and never enter employee deductions, gross or net. Run totals must eventually aggregate frozen snapshots only. No employer amount is currently produced because no rule is calculation-verified.

## Q. Payroll Reconciliation

P4B remains canonical: gross components minus non-statutory deduction components minus employee statutory snapshot amounts equals net. Statutory lines use stable keys and are idempotently rebuilt. Employer amounts reconcile separately and cannot alter employee net.

## R. Readiness

Canonical readiness now surfaces `PCB_PROFILE_INCOMPLETE`, `STATUTORY_RULE_NOT_AVAILABLE`, `STATUTORY_CLASSIFICATION_REQUIRED`, `STATUTORY_CALCULATION_FAILED`, and `STALE_STATUTORY_PROFILE`. A blocked scheme or changed profile/tax revision prevents review/finalization server-side.

## S. Permissions

The existing capability boundary is retained: `VIEW_STATUTORY_PROFILE`, `EDIT_STATUTORY_PROFILE`, `VIEW_TAX_PROFILE`, `EDIT_TAX_PROFILE`, `VIEW_STATUTORY_SUBMISSION`, `EXPORT_STATUTORY`, and `SUBMIT_STATUTORY`. Payroll or Attendance access does not grant tax/statutory access. Group Managers receive none by default. Export routes retain whole-business scope and dedicated capabilities.

## T. Tenant Isolation

Profile versions and entry snapshots bind `businessId + membershipId`; entry snapshots also bind `businessId + payrollRunId` and `businessId + payrollEntryId + membershipId`. Cross-business guessed identifiers fail the composite foreign keys and scoped services. Official rule sets are authority-level data, not tenant employee data.

## U. Audit / Concurrency

Existing profile edits and Payroll generation remain audited without raw identifiers. P2 runs inside the existing serializable generation transaction. Stable component keys, one scheme snapshot per entry and digest checks enforce idempotency. Profile revision reuse with different data, active-rule overlap and finalized snapshot mutation fail closed.

## V. Official Fixtures

P2 unit fixtures currently prove effective-date selection, overlap rejection, unknown-classification blocking, stable statutory component provenance and migration guards. They are architecture fixtures, not official contribution golden fixtures. No scheme may be promoted to READY until official artifact-backed boundary fixtures exist.

## W. Tests

Required verification includes unit, integration, TypeScript, lint, production build, Prisma validate/generate, clean local migration rebuild, canonical guard and `git diff --check`. Results are recorded in the phase handoff, not assumed by this design document.

## X. Deferred Scope

- Official PDF/Excel/CSV retention and deterministic ingestion tooling.
- Complete EPF, Act 4 and Act 800 verified table datasets and golden fixtures.
- PCB 2026 profile, TP1/TP3, relief, zakat, prior-employer, YTD ledger and additional-remuneration engine.
- Controlled manual-official-PCB/import workflow.
- Government portal submission, acknowledgements, payment and reconciliation.
- Payment P3B/P4 and all Public Bank artifacts.

## Y. Risks / Blockers

The immediate blocker is authoritative data readiness, not code percentage arithmetic. Activating metadata-only rules, trusting legacy constants, inferring unknown component treatment, or accepting direct manual overrides would reintroduce silent statutory errors. Production calculation must remain unavailable until artifact checksums, complete tables/formulas and official fixtures are reviewed.

## Z. Completion Gate

The P2 architecture is forward-enabled and unsafe calculation is stopped. Scheme results are:

- EPF: **PARTIAL**
- SOCSO: **PARTIAL**
- EIS: **PARTIAL**
- PCB: **BLOCKED**

Overall: **STATUTORY P2 — PARTIALLY READY**.

The recommended next action is a separate, reviewed official-rule ingestion task beginning with the exact KWSP Third Schedule and PERKESO Act 4/Act 800 files, their SHA-256 checksums, row counts, boundary validation and official golden fixtures; then complete the PCB data model before implementing the HASiL 2026 algorithm.
