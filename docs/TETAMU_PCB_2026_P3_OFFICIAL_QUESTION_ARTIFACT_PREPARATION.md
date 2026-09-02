# TETAMU PCB 2026 P3 — OFFICIAL QUESTION ARTIFACT PREPARATION

## 1. Executive Summary

PCB 2026 P3 is **PARTIAL**. The isolated local certification package binds the READY P2 result and generates all Calculation Detail, canonical payslip, Q1/Q4 EA equivalent and cover-sheet artifacts without changing the PCB formula. Q1/Q3/Q4 CP39 and certification-ready Q2 PCB 2(II) are blocked because the retained official Testing Questions identify only Employee A–E and do not supply mandatory employer numbers, employee TINs or valid employee identities. Those values were not invented.

## 2. Scope

This phase converts certified P2 results into reproducible human and machine artifacts. It does not recalculate expected answers, alter tax logic, touch Testing business data, access Production, publish payslips to employees or submit anything to HASiL.

## 3. Official Artifact Matrix

The retained `hasil-mtd-testing-questions-2026.pdf` confirms: Q1 Calculation Detail July/October, payslip July/December, EA and October text file; Q2 Calculation Detail March/September, March payslip and PCB 2(II); Q3 Calculation Detail September/November, September payslip and November text file; Q4 Calculation Detail August/November, October/December payslips, EA and December text file; Q5 Calculation Detail January/February and January payslip.

## 4. Input Authority

Normative inputs are limited to the retained HASiL 2026 computerised specification, Testing Questions, TP1/TP3 materials, retained Q5 clarification and the certified P2 Q1–Q5 records. No third-party template or Production/Testing employee record was used.

## 5. P2 Certification Binding

Every question input manifest records the P2 manifest SHA-256, official-source SHA-256, fixture SHA-256, record input digest and P2 trace digest. Every selected record has P2 difference `RM0.00`. Calculator version remains `TETAMU_PCB_2026_1.2.0`; no PCB runtime file was changed by P3.

## 6. Calculation Detail Generator

Version `TETAMU_PCB_CALCULATION_DETAIL_1.0.0` emits structured JSON and selectable PDF directly from the certified P2 trace. It includes regime/category, current and prior remuneration, EPF, TP1/TP3 context, reliefs, chargeable income, bracket M/R/B, annual tax, rebates, normal/additional PCB and raw/truncated/5-sen/post-rebate rounding evidence. Ten required month pairs were generated and visually inspected.

## 7. Payslip Generator

Seven required payslips use the existing `buildPayslipPdf` canonical renderer in local synthetic-certification mode. Cash gross excludes non-cash BIK/VOLA; TP1 self-paid relief and TP3 prior-employer facts do not become current payroll deductions/earnings. PCB equals P2. Values absent from the official question (SOCSO/EIS/employer contributions) are shown as RM0.00 with an explicit non-certification note.

## 8. EA Generator

Q1 and Q4 receive `EA — Testing Question Evidence`, clearly labeled `SYSTEM-GENERATED EQUIVALENT`. It distinguishes current-employer cash remuneration, taxable BIK/VOLA, exempt allowances, PCB, EPF, zakat and employment period, and excludes previous-employer amounts. Exact generic EA compliance is not claimed because no exact machine EA template or statutory identities are retained.

## 9. PCB 2(II) Generator

The structured Q2 source and blocked PDF draft follow Exhibit 3 labels and preserve March/June/September/December PCB plus zero CP38. The certification-ready form is blocked: Exhibit 3 requires employee identity, TIN, employee number, employer number and employer identity/address, but Q2 provides none of these. No identifiers were fabricated.

## 10. CP39/Text Generator

The required target format is the existing `LHDN_CP39_EXHIBIT_4_2026` exporter: 57-character header, 136-character detail and CRLF. Q1 October, Q3 November and Q4 December retain blocker sources with the exact P2 PCB values. The exporter was intentionally not invoked because Exhibit 4 requires employer numbers, 11-digit TIN and valid employee IC/passport data that the official questions omit.

## 11. Q1 Package

Calculation Detail July/October: PASS. Payslips July/December: PASS. EA equivalent: PASS. October CP39: FAIL — mandatory statutory identity mapping required. Q1 verdict: PARTIAL.

## 12. Q2 Package

Calculation Detail March/September: PASS. March payslip: PASS. PCB 2(II): FAIL — mandatory employee/employer identity fields and receipt/transaction evidence are absent. Director fee, voluntary EPF relief, zakat and family facts remain bound to P2. Q2 verdict: PARTIAL.

## 13. Q3 Package

Calculation Detail September/November: PASS. September payslip: PASS. November CP39: FAIL — mandatory statutory identity mapping required. RM500 monthly BIK allocation is shown as non-cash and the RM25,000 transcription regression is absent. Q3 verdict: PARTIAL.

## 14. Q4 Package

Calculation Detail August/November: PASS. Payslips October/December: PASS. EA equivalent: PASS. December CP39: FAIL — mandatory statutory identity mapping required. EPF OFF through October, EPF ON from November, VOLA transition and salary transition remain consistent with P2. Q4 verdict: PARTIAL.

## 15. Q5 Package

Calculation Detail January/February: PASS. January payslip: PASS. Retained clarification is bound through P2: RM6,000 annual housing-loan interest allocated RM500 every month; January and February each include RM500. Q5 verdict: READY.

## 16. Cross-Artifact Reconciliation

Calculation Detail and payslip PCB values originate from the same question/month P2 record and reconcile at `RM0.00`. EA uses the sum of the corresponding current-employer P2 months. PCB 2(II) draft rows also use the P2 monthly amounts. No PDF or JSON was manually patched.

## 17. PDF Validation

Twenty-one PDFs (38 pages) were opened, rendered and visually inspected. All pages are non-empty, text-selectable and free from clipping, horizontal overflow, broken fonts and missing currency values. The Q2 blocked PCB 2(II) draft intentionally displays `NOT SUPPLIED`; it is not represented as certification-ready.

## 18. Text Validation

No raw CP39 text is claimed as generated or valid. Text validation is `BLOCKED_MISSING_OFFICIAL_IDENTITIES`. This is safer than passing invented identifiers through the canonical exporter. Once governed identity mappings are supplied, validation must cover 57/136 character lengths, CRLF, order, sen values, identities, PCB, CP38 and foreign passport/country slots.

## 19. Artifact Hashes

Every generated artifact and question manifest records filename, repository path, bytes and SHA-256. The package validator recomputes all retained hashes and reports no mismatch. The authoritative list is in `statutory/official/certifications/pcb-2026-p3/manifest.json`.

## 20. Manifest

The master manifest includes the official matrix, P2 digest, source hashes, generator versions, question-level manifest paths, artifact hashes, environment, Production/Testing mutation flags, open clarifications and `NOT_SUBMITTED` status. Question manifests include required/generated artifacts and per-file provenance.

## 21. Submission Format Ambiguity

`SUBMISSION FORMAT CLARIFICATION STILL REQUIRED`: retained email wording asks for PDF documents while Testing Questions require a text file for Q1/Q3/Q4. After valid identity mappings exist, P3 must preserve both raw CP39 bytes and a PDF preview. This ambiguity alone would not block readiness if both existed; the current identity gap does.

## 22. Tests

P3 artifact tests: 10/10 PASS. Package validator: 89/89 checks PASS with two recorded artifact blockers. P2 certification and PCB-focused regressions remain part of closure evidence. TypeScript, ESLint and diff validation are recorded in the final handoff after execution. Build is not required because P3 adds certification scripts/tests/documents only and does not change runtime renderer or schema.

## 23. Remaining Gaps

1. Governed 10-digit employer HQ/branch numbers.
2. Governed 11-digit TIN and valid employee IC/passport identity for Employee A, B, C and D as applicable.
3. Q2 PCB 2(II) officer/employer details plus receipt or transaction evidence.
4. Raw CP39 and PDF previews after identity mapping.
5. Written confirmation of PDF-versus-text submission packaging.

These are official artifact-input/submission gaps, not PCB formula gaps.

## 24. Final Verdict

`PCB 2026 P3 → PARTIAL`. The P2 formula remains frozen, Q1–Q5 calculations remain certified, all currently supportable PDFs/JSONs are generated and hash-valid, and no Production or Testing business data was touched. P4 cannot start until certification-ready PCB 2(II) and CP39 artifacts exist with governed statutory identities.

## P3A Addendum - Official Identity Mapping Closure

P3A extracted the exact identity-bearing fields from Exhibits 3-5, introduced a governed certification identity input, connected field-level validation to the P3 generator, strengthened the canonical CP39 exporter against silent identifier stripping/truncation, and bound identity provenance into question and master manifests. No official identities were invented.

The retained Testing Questions identify only Employee A-E. They do not provide the applicant's 10-digit HQ/employer numbers, Employee A-D TINs, Employee A-D employee/salary numbers, valid IC/passport numbers, or Q2 PCB receipt/transaction references and dates. Q4 is explicitly an Australian expatriate, but the retained specification refers to a separate HASiL country-code list that is not present in retained evidence. Consequently Q1/Q3/Q4 CP39 and Q2 PCB 2(II) remain blocked, P3 remains PARTIAL, and P4 remains closed.

P3A evidence is retained in `manifest/identity-source-matrix.json`, `manifest/identity-validation.json`, and `docs/TETAMU_PCB_2026_P3A_OFFICIAL_IDENTITY_MAPPING_CLOSURE.md`.
