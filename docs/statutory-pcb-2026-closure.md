# Malaysia PCB / MTD 2026 Closure

### A. Objective

Determine whether Tetamu can calculate Malaysia PCB for a supported employee and 2026 payroll period from frozen tax-profile, tax-year YTD, TP1/TP3, remuneration-classification and official-rule inputs, without a runtime network dependency. This engineering pass establishes a verified resident-standard calculation core but does not complete the production data and Payroll integration gates; closure therefore remains `PCB — PARTIAL`.

### B. Existing PCB Audit

Before this pass, PCB existed as a statutory scheme, a `PayrollEntry.pcb` amount, statutory component/snapshot plumbing, payslip/export output and CP39 submission output. The employee profile only held identity/TIN and a generic tax-profile revision. There was no canonical PCB tax profile, TP1/TP3 revision domain, Malaysia tax-year YTD ledger, 2026 calculator, PCB-specific snapshot provenance, or signed-off component classification. Legacy/manual PCB values are not re-labelled as calculated values.

### C. Official Sources

The canonical landing page is `https://www.hasil.gov.my/majikan/jadual-pcb-dan-spesifikasi-data/`. The retained official source set is:

- 2026 Computerised MTD Calculation Specification, including normal/additional formulas, the employer CP39 payroll-data format, conditions, and worked examples.
- PCB/TP1 (1/2026) and its explanatory notes.
- PCB/TP3 (1/2026) and its explanatory notes.
- 2026 MTD testing questions and software/employer evidence requirements.
- HASiL PCB Calculator 2026 at `https://calcpcbplus.hasil.gov.my/` as a verification source only.

The current HASiL page does not expose a separate 2026 employer-payroll data specification beyond the calculation specification's employer/CP39 exhibits. No non-official source was used as a calculation authority.

### D. Artifact Integrity

Six exact PDFs are retained under `statutory/official/artifacts`. All 88 pages were rendered and visually reviewed; secondary text extraction was used only to navigate the documents. Manifest byte sizes and SHA-256 values were reverified locally. A future same-URL byte change must create a new revision and `SOURCE_DRIFT_DETECTED`; it must not overwrite these bytes.

### E. 2026 Requirements Matrix

`statutory/official/pcb-2026-requirements.json` contains 28 machine-readable requirements with official section, required input, Tetamu source, availability, versioning, historical safety and status. Current coverage is 6 implemented, 1 available, 3 implemented with a blocker, 2 partial-classification and 16 blocked. The matrix deliberately fails the closure gate while production tax profiles, TP1/TP3, YTD persistence, special-regime approval evidence, non-resident exempt-income classification and PCB snapshots remain absent.

### F. Tax Profile

The official input inventory is complete, but no production `EmployeeTaxProfileVersion` equivalent was added in this pass. Required canonical facts include resident/special-regime status and approval evidence, employee category, spouse facts, disability facts and qualifying-child facts. Existing TIN/identity remains canonical and must not be duplicated. Any future model must be immutable, effective/revision dated, business/membership scoped, guarded by `VIEW_TAX_PROFILE`/`EDIT_TAX_PROFILE`, and masked in UI and audit metadata.

### G. Tax-Year YTD Ledger

`src/lib/payroll/pcb-tax-year-ledger.ts` provides a deterministic, pure YTD builder over immutable ledger records. It distinguishes finalized current-employer payroll, employee-authorized TP3 history, official imports and applied tax corrections; validates business, membership and tax year; rejects draft/review sources, duplicates and current-month circularity; resets explicitly in January; supports multiple previous employers; and emits a canonical digest. It is not yet backed by additive database tables or connected to Payroll finalization, so production YTD remains blocked.

### H. TP1

The exact 2026 form and notes are retained and the calculator accepts frozen accumulated/current allowable-deduction totals. A versioned employee submission/review domain, official coded relief catalog, duplicate protection, attachment provenance, self-service and stale-draft propagation are not yet implemented. Arbitrary named reliefs must never enter the official calculator.

### I. TP3 / Previous Employer

The exact 2026 form and notes are retained, and the YTD builder can aggregate multiple accepted previous-employer records without cross-tenant live payroll access. The employee declaration/revision/reviewer database domain, employment segments, evidence references, stale propagation and ownership workflow remain blocked. Payroll administrators must not create unproven previous-employer totals.

### J. Reliefs / Zakat

The core implements the official fixed individual, spouse, disability and child relief values and consumes frozen allowable-deduction, zakat and eligible current levy amounts. The TP1 official catalog and annual sublimits are not yet materialized as a versioned rule dataset, and zakat/levy provenance is not persisted. Therefore only already-validated frozen inputs are supported by the pure core; production entry remains blocked.

### K. Normal Remuneration

`calculatePcb2026` implements the resident-standard normal-remuneration formula using integer sen: accumulated/current/projected remuneration, annual EPF qualifying cap, K2 truncation, Category 1/2/3 reliefs, Table 1, accumulated PCB/zakat, current rebates, minimum amount and final rounding. It performs no database query, network request, clock read or UI access.

### L. Additional Remuneration

The resident-standard Steps 1–5 algorithm is implemented. Multiple additional lines must first be aggregated into one current-month additional-remuneration amount; they are not taxed independently. The official April worked example matches RM106.20 normal MTD plus RM727.50 additional MTD, total RM833.70. Production use is still blocked until current additional-remuneration EPF allocation and classification provenance are frozen.

### M. PCB Classification

`statutory/official/classifications/malaysia-pcb-2026-signoff-candidate-v1.json` is a PCB-only, non-active, non-approved candidate. It separates `NORMAL_REMUNERATION`, `ADDITIONAL_REMUNERATION`, `EXCLUDED` and `UNKNOWN`. It does not change the shared EPF/SOCSO/EIS/LINDUNG24 candidate data and has no activation effect.

### N. Calculator

The calculator version is `TETAMU_PCB_2026_1.1.0`, bound to `HASIL_MTD_SPEC_2026`. It supports resident-standard, REP, knowledge-worker, approved C-suite and non-resident formulas and returns a human-auditable trace including tax regime, P, M, R, B, K2, relief bases, normal/additional results and official section references. Production remains fail-closed because canonical approval/profile evidence and non-resident exempt-income classification are incomplete.

### O. Rounding

All monetary inputs and outputs are safe non-negative integer sen. K2 division and other fractional-sen results are truncated to sen. A payable normal or additional amount below RM10 is zero before current zakat treatment. Payable amounts round upward to the next five sen: 1–4 sen to 5, 6–9 sen to 10, while 0/5 remain unchanged. A valid zero is `CALCULATED` and is distinct from `BLOCKED`.

### P. PCB Snapshot

The required snapshot inventory is known: calculation source, status, amount, tax year/month, rule/calculator/classification versions, artifact/fixture digests, tax-profile revision, TP1/TP3 revisions, YTD digest, normal/additional bases and trace digest. The current generic statutory snapshot does not retain all PCB-specific provenance, so no production calculated PCB is written and finalized history is not altered.

### Q. Payroll Integration

Existing `PayrollEntry.pcb`, statutory deduction component, net reconciliation, payslip and CP39 output were audited but not switched to the new calculator. The correct future order is components → PCB classification → profile → prior YTD → TP1/TP3 → calculator → immutable snapshot → one PCB deduction → net reconciliation. Existing manual/legacy flows remain unchanged.

### R. Manual Official Portal Source

If a later product workflow records an official portal amount, its source must be `MANUAL_OFFICIAL_PORTAL`, with actor, reason, evidence reference, rule/tax period, revision and authorization. It must never be labelled `CALCULATED`. No portal value was written to production data in this pass.

### S. Readiness

Explicit remaining blockers include `PCB_TAX_PROFILE_INCOMPLETE`, `PCB_TP1_DOMAIN_NOT_AVAILABLE`, `PCB_TP3_DOMAIN_NOT_AVAILABLE`, `PCB_YTD_LEDGER_INCOMPLETE`, `PCB_CLASSIFICATION_REQUIRED`, `PCB_SNAPSHOT_NOT_AVAILABLE`, `PCB_SPECIAL_REGIME_PROFILE_REQUIRED`, `PCB_NON_RESIDENT_CLASSIFICATION_REQUIRED` and `HASIL_SOFTWARE_VERIFICATION_REQUIRED`.

### T. Historical Integrity

The new core is input/output only and cannot mutate historical payroll. The YTD builder requires immutable source revisions and applied/finalized status. Database no-hard-delete, supersession, finalized PCB snapshot immutability, reopen guards and future tax-correction persistence remain design requirements and closure blockers.

### U. Permissions / Sensitive Data

Existing dedicated `VIEW_TAX_PROFILE` and `EDIT_TAX_PROFILE` capabilities must remain the access gate. Attendance or generic payroll-summary access does not imply TP1/TP3 access. No sensitive payload logging was introduced. Staff self-service, reviewer separation and masked UI are not yet implemented.

### V. Tenant Safety

The pure YTD builder rejects business, membership and tax-year scope mismatches and never queries another employer. Production composite foreign keys, immutable triggers, declaration ownership and serializable revision checks require an additive migration that was not created in this partial pass.

### W. Official Golden Verification

`statutory/official/fixtures/hasil-pcb-2026-official-golden-v1.json` contains five expected-output fixtures independent of Tetamu: four worked results from the official specification and one result captured from the official 2026 calculator. Exact outputs pass, including January/February YTD, TP1 relief, additional remuneration, zero handling and rounding tests. The separate official applicant question pack contains inputs/evidence requirements but no published expected answers, so those scenarios are not misrepresented as passed goldens.

### X. HASiL Software Verification

HASiL's official material requires applicants to submit prescribed test answers and supporting payroll evidence; IRBM may arrange a verification appointment and issues a verification/approval letter only after compliance. Tetamu has not submitted the pack and has no approval letter. `HASiL SOFTWARE VERIFICATION — PENDING`. Local tests are not government approval.

### Y. Remaining Blockers

Production closure still requires additive persistent tax-profile, TP1, TP3, YTD and PCB-snapshot domains; official relief-catalog ingestion and sublimits; employee/reviewer UX and permissions; classification sign-off with all custom codes resolved; approved-profile and non-resident exempt-income evidence feeding the implemented special paths; Payroll integration and net/payslip reconciliation; stale/finalize concurrency guards; and the external HASiL software-verification procedure.

### Z. Final Status

`PCB — PARTIAL`

`HASiL SOFTWARE VERIFICATION — PENDING`

No statutory rule was activated, no government submission was made, and Payment P3A remains `PUBLIC_BANK_SPEC_NOT_READY`.
