# TETAMU PCB 2026 OFFICIAL SPECIFICATION & HASiL TESTING QUESTIONS GAP AUDIT

Audit date: 27 August 2026  
Scope: official-evidence freeze, current-code trace, gap analysis only  
Environment boundary: LOCAL / TESTING / read-only code inspection  
Production touched: **NO**  
PCB formula changed: **NO**  
HASiL submission made: **NO**

## 1. Executive Summary

**Final verdict: PCB 2026 ENGINEERING GAPS IDENTIFIED.**

Tetamu already contains a substantial, year-versioned PCB 2026 foundation: a sen-based pure calculator, resident and non-resident paths, normal and additional remuneration, a governed employee PCB profile, structured TP1/TP3 declarations, zakat and religious-travel levy inputs, a finalized tax-year ledger, frozen statutory snapshots, readiness/finalization gates, payslip distinction between calculated and blocked PCB, CP38 instructions, and a byte-stable CP39 Exhibit 4 exporter.

That foundation is not yet a complete HASiL Testing Questions 2026 solution. The official question pack requires scenarios that expose gaps in effective-dated tax status, approved special-regime evidence, TP3 exempt-income capture, BIK/VOLA and exempt-allowance semantics, director-fee/commission classification, and submission-document generation. Tetamu has no EA generator and no PCB 2(II) generator. Its calculation trace is useful but not yet a formal question-specific Calculation Detail worksheet. CP39 layout tests pass locally, but HASiL portal acceptance has not occurred.

The current engineering closure is explicitly LOCAL/TESTING only. `statutory/official/certifications/hasil-pcb-2026-technical-verification-v1.json` remains `PARTIAL`, its closure gate is `FAIL`, and HASiL verification is `PENDING`. No result in this audit should be read as HASiL approval.

## 2. HASiL Communication Context

The company reports receiving a HASiL email dated 27 August 2026 requiring answers to the PCB Testing Questions 2026 and the requested supporting documents before 1 October 2026. The stated submission address is `ask_payrollMTD@hasil.gov.my`.

The supplied legacy landing page, `https://www.hasil.gov.my/majikan/majikan-payroll-spesifikasi-data/`, now returns 404. The current official HASiL landing page is:

`https://www.hasil.gov.my/majikan/jadual-pcb-dan-spesifikasi-data/`

The current page was observed as updated on 29 July 2026 and links directly to all six retained YA 2026 PDFs. The email itself was not stored in this repository, so its PDF-only submission instruction is treated as company-supplied communication context rather than a downloaded normative artifact.

## 3. Official 2026 Sources

Only HASiL/LHDN sources were used as normative evidence.

| ID | Exact official title | Official URL | Year / effective period | Publisher | Retained path |
|---|---|---|---|---|---|
| `hasil-pcb-computerised-spec-2026` | Specification for Monthly Tax Deduction Calculations Using Computerised Calculation for 2026 | `https://www.hasil.gov.my/wp-content/uploads/spesifikasi-kaedah-pengiraan-berkomputer-pcb-2026.pdf` | YA 2026; 1 Jan–31 Dec 2026 | Lembaga Hasil Dalam Negeri Malaysia | `statutory/official/artifacts/hasil-pcb-computerised-spec-2026.pdf` |
| `hasil-mtd-testing-questions-2026` | Monthly Tax Deduction Testing Questions Using Computerised Calculation Method 2026 | `https://www.hasil.gov.my/wp-content/uploads/mtd-testing-question-2026.pdf` | 2026 | Lembaga Hasil Dalam Negeri Malaysia | `statutory/official/artifacts/hasil-mtd-testing-questions-2026.pdf` |
| `hasil-pcb-tp1-2026-bm` | Borang PCB/TP1 (1/2026) | `https://www.hasil.gov.my/wp-content/uploads/bm-borang-tp1-2026.pdf` | 2026 | Lembaga Hasil Dalam Negeri Malaysia | `statutory/official/artifacts/hasil-pcb-tp1-2026-bm.pdf` |
| `hasil-pcb-tp3-2026-bm` | Borang PCB/TP3 (1/2026) | `https://www.hasil.gov.my/wp-content/uploads/bm-borang-tp3-2026.pdf` | 2026 | Lembaga Hasil Dalam Negeri Malaysia | `statutory/official/artifacts/hasil-pcb-tp3-2026-bm.pdf` |
| `hasil-pcb-tp1-explanatory-notes-2026` | Nota Penerangan Borang PCB/TP1 Tahun 2026 | `https://www.hasil.gov.my/wp-content/uploads/nota-penerangan-tp1-2026.pdf` | 2026 | Lembaga Hasil Dalam Negeri Malaysia | `statutory/official/artifacts/hasil-pcb-tp1-explanatory-notes-2026.pdf` |
| `hasil-pcb-tp3-explanatory-notes-2026` | Nota Penerangan Borang PCB/TP3 Tahun 2026 | `https://www.hasil.gov.my/wp-content/uploads/nota-penerangan-tp3-2026.pdf` | 2026 | Lembaga Hasil Dalam Negeri Malaysia | `statutory/official/artifacts/hasil-pcb-tp3-explanatory-notes-2026.pdf` |

The calculation specification itself contains Exhibit 1 TP1, Exhibit 2 TP3, Exhibit 3 PCB 2(II), Exhibit 4 MTD text-file format, and Exhibit 5 worked examples. No separate official 2026 employer-payroll data specification was found in the retained package beyond these exhibits.

## 4. Evidence Hashes

Current official bytes were downloaded read-only on 27 August 2026 and compared with the repository artifacts originally retained on 9 August 2026.

| Artifact | Bytes | Pages | SHA-256 | Existing vs current |
|---|---:|---:|---|---|
| Computerised MTD Specification 2026 | 1,375,535 | 52 | `a1618051c858393d92d868c9975c183309d3d07e48f0e4f0cdef589f45f5800c` | **UNCHANGED** |
| MTD Testing Questions 2026 | 200,396 | 7 | `d6523266b8b23daca956be0f61ec52879eab364736a9feb5668d7f039ae33517` | **UNCHANGED** |
| TP1 (1/2026) | 477,379 | 2 | `28f84eea1ec9842ad3bce766215917cbc739ca7cbb1b8a5bd0b7438defa3166e` | **UNCHANGED** |
| TP3 (1/2026) | 596,081 | 3 | `c00c98072498284cbc97f777e038fa59c7720fcefa4909379f408f36f66683d2` | **UNCHANGED** |
| TP1 explanatory notes | 948,489 | 12 | `1c6ccb4e75cf605d47416405e5d0b341d267252b4f3ac4be960ec0aee9ec6cde` | **UNCHANGED** |
| TP3 explanatory notes | 946,868 | 12 | `9fb8fab9a083f00477448a21c5acc41b15702f336f63f3e6f6cdfeb86b29114a` | **UNCHANGED** |

Evidence status: **FROZEN AND REVALIDATED; NO SOURCE DRIFT**. The canonical metadata remains in `statutory/official/manifest.json`. Original PDF content was not modified or replaced.

`pnpm run statutory:verify-artifacts` independently returned `VERIFIED` for all six PCB/TP1/TP3 artifacts and reproduced the hashes above. The aggregate command still exited 1 because of a pre-existing, unrelated `kwsp-third-schedule-2025-10 SOURCE_DRIFT_DETECTED`; that KWSP condition is outside this PCB-only audit and was not changed or used to downgrade the already-certified EPF area.

## 5. PCB 2026 Specification Structure

The 52-page official specification is organized as follows:

1. Introduction and statutory basis.
2. HASiL computerized-calculation verification procedure.
3. YA 2026 amendments and relief changes.
4. Computerized MTD for non-resident employees.
5. Resident normal-remuneration formula.
6. Resident additional-remuneration formula.
7. Approved individual under the Returning Expert Programme (REP).
8. Knowledge Worker in the Specified Region.
9. Resident non-citizen holding a C-Suite position in an approved company.
10. Terms and conditions, including rounding, minimum deduction, TP1/TP3, BIK/VOLA, EPF, deductions and zakat.
11. Exhibits 1–5: TP1, TP3, PCB 2(II), MTD text file, worked examples.

The specification states that software providers/employers must answer all verification questions accurately; HASiL may arrange a system-verification appointment and issues the verification/approval letter only after compliance.

## 6. Testing Questions 2026 Structure

The seven-page question pack contains five scenarios. It provides inputs and required evidence, not official expected PCB answers.

### Question 1 — Employee A

- Category/status: C-Suite employee in an approved company effective June 2026; previously an engineer in Kuala Lumpur.
- Family: married; spouse not employed; children aged 12 and 19; the 19-year-old has autism and is pursuing a diploma at a local university.
- Previous employment, January–June: RM10,000 monthly remuneration; RM3,600 travelling allowance; EPF 11%; PCB already paid RM3,000.
- Current employment, July–December: RM20,000 monthly remuneration; RM500 monthly travelling allowance; EPF 11%.
- Monthly July–December: childcare/transit RM450, SOCSO RM50, zakat RM1,000.
- October: dental RM1,300 and books RM780.
- December: sports equipment RM1,350.
- Additional/special issues: mid-year approved C-Suite status, previous employment, allowance exemption/taxability, disabled higher-education child, relief timing.
- Required months: payslips July and December; Calculation Detail July and October; text file October; EA.

### Question 2 — Employee B

- Category/status: director; married; spouse employed.
- Children: four. Twenty-one-year-old twins in bachelor programmes at local universities are claimed by Employee B; children aged 13 and 10 are claimed by the spouse.
- Remuneration: director fees RM400,000 quarterly.
- EPF: no mandatory contribution ordinarily; Employee B opts for voluntary EPF.
- March: vaccination RM450, medical examination RM850, electronic business-journal subscription RM1,200, voluntary EPF RM1,000, zakat RM12,000.
- June: vaccination RM450, voluntary EPF RM1,000, zakat RM12,000.
- September: vaccination RM350, voluntary EPF RM1,000, zakat RM12,000.
- December: voluntary EPF RM1,000, zakat RM12,000.
- Additional/special issues: director-fee remuneration timing, quarterly additional/normal treatment, voluntary EPF and spouse/child claims.
- Required months: payslip March; Calculation Detail March and September; PCB 2(II).

### Question 3 — Employee C

- Category/status: approved under REP beginning September 2026; widow; legal adoptive parent of a 12-year-old child.
- Remuneration September–December: RM10,500 monthly.
- September BIK: household servant, annual value RM2,000.
- Monthly September–December: life insurance for self/child RM550; child taekwondo RM150; SOCSO RM28; EPF RM1,100.
- December: domestic Penang holiday — Entopia/Upside Down admission RM220 and hotel RM300.
- Additional/special issues: REP effective date, BIK annual/monthly allocation, adoptive child, sports and domestic-tourism relief.
- Required months: payslip September; Calculation Detail September and November; text file November.

### Question 4 — Employee D

- Category/status: Australian expatriate with an initial three-month contract from August; contract renewed from 1 November for 36 months.
- August–October: RM10,000 monthly remuneration plus RM1,000 VOLA; no EPF initially.
- November onward: RM15,000 monthly remuneration plus RM1,500 VOLA; EPF 11% from November.
- Family: spouse not employed; two children under 18.
- November: medical examination RM500, skills course RM2,500, medical insurance RM550.
- December: personal computer RM3,200 and medical insurance RM550.
- Additional/special issues: expatriate residence/tax-status transition, contract-duration change, VOLA, EPF commencement.
- Required months: payslips October and December; Calculation Detail August and November; text file December; EA.

### Question 5 — Employee E

- Category/status: single Knowledge Worker in the specified region effective 1 January 2026.
- Remuneration January–December: RM18,000 monthly; EPF 11%.
- Family/relief: supports elderly parents; medical examinations RM800 for each parent in March.
- First home: SPA dated 10 May 2025; purchase price RM480,000; housing-loan interest RM6,000.
- January: food-waste grinder RM1,500.
- Following month: CCTV RM700 for residence and RM700 for business premises.
- Monthly: celebrity-gym membership RM200 and internet RM120.
- Additional/special issues: Knowledge Worker approval, eligibility boundaries for green/security equipment, first-home interest, lifestyle/sports distinction.
- Required months: payslip January; Calculation Detail January and February.

## 7. Submission Artifact Matrix

| Question | Calculation Detail | Payslip | EA | PCB 2(II) | Text File | Other |
|---|---|---|---|---|---|---|
| 1 | July, October | July, December | Yes | No | October | Answers/calculations for all requested months |
| 2 | March, September | March | No | Yes | No | Answers/calculations for all requested months |
| 3 | September, November | September | No | No | November | Answers/calculations for all requested months |
| 4 | August, November | October, December | Yes | No | December | Answers/calculations for all requested months |
| 5 | January, February | January | No | No | No | Answers/calculations for all requested months |

The company-supplied email context says requested documents must be submitted in PDF, while the official question pack explicitly requests a **Text File** for Questions 1, 3 and 4. Classification: **SUBMISSION FORMAT CLARIFICATION REQUIRED**. Do not convert or replace the required text payload without written HASiL clarification.

## 8. Current Tetamu PCB Architecture

### Data model

- `prisma/schema.prisma`
  - `EmployeeBusinessMembership.pcbProfile` and `taxProfileRevision`
  - `EmployeeStatutoryProfileVersion.pcbProfileSnapshot`
  - `PayrollEntry.pcb`, `cp38`, statutory status/version
  - `PayrollEntryStatutorySnapshot`
  - `PayrollComponentStatutoryTreatmentSnapshot`
  - `EmployeeCp38Instruction`
  - `PayrollPayslipPublication`
  - `PayrollStatutorySubmission`
  - `PayrollStatutoryExportArtifact`
  - `StatutoryRuleSet`, `StatutoryComponentClassification`, review decisions
- Additive migrations include `20260821143000_employee_pcb_profile`, `20260821153000_additional_remuneration_review`, and `20260821170000_pcb_cp38_closure`.

### Formula/profile services

- `src/lib/payroll/pcb-2026.ts`: pure YA 2026 calculator and trace.
- `src/lib/payroll/pcb-profile.ts`: governed version-3 profile and readiness.
- `src/lib/payroll/pcb-declarations.ts`: structured TP1/TP3 categories and limits.
- `src/lib/payroll/pcb-tax-year-ledger.ts`: deterministic current-year YTD ledger.
- `src/lib/payroll/pcb-governance.ts`: LOCAL/TESTING/PRODUCTION readiness and activation boundary.
- `src/lib/payroll/statutory-p2.ts`: materialization, classification, frozen profile, PCB calculation and statutory snapshots.
- `src/lib/payroll/readiness.ts`: fail-closed readiness and stale-snapshot checks.
- `src/lib/payroll/service.ts`: Payroll Draft/Review/Finalize boundary.

### Output/UI/tests

- `src/lib/payroll/export.ts`: payslip lines and payroll/statutory tabular exports.
- `src/lib/payroll/payslip-publication.ts`: publication only from finalized payroll.
- `src/lib/payroll/statutory-submission.ts`: CP39 Exhibit 4 text.
- `src/components/employee-profile-payroll.tsx`: employee PCB profile editor.
- `src/app/(business)/team/people/[personId]/payroll/actions.ts`: profile/declaration actions.
- `src/app/(business)/team/payroll/runs/[runId]/entries/[entryId]/page.tsx`: frozen technical calculation detail.
- `src/app/(business)/team/payroll/statutory/page.tsx`: statutory export/submission workflow.
- `src/app/admin/statutory/rulesets/[ruleSetId]/page.tsx`: HASiL approval-evidence governance.
- PCB unit and integration files are listed in section 37.

### Actual entry point

The execution chain is:

`Payroll Draft entry/components`
→ `materializeStatutoryP2`
→ freeze `EmployeeStatutoryProfileVersion`
→ resolve the active PCB rule and payroll-component treatment
→ `calculatePcbForEntry`
→ build finalized-prior-month/TP3 tax-year ledger
→ `calculatePcb2026`
→ freeze `PayrollEntryStatutorySnapshot` and PCB deduction component
→ reconcile `PayrollEntry.pcb` and net pay
→ payroll readiness
→ finalize
→ publish immutable payslip
→ optional CP39 export.

## 9. Current PCB Blockers

`PCB_PROFILE_INCOMPLETE` remains the canonical employee-level blocker when no readable governed PCB profile exists, when the tax year is not 2026, or when only legacy profile versions exist. A governed profile must include:

- tax year and tax regime;
- employee category;
- disability flags;
- spouse/child claim facts;
- previous employer gross remuneration, EPF, PCB, deductions and zakat;
- current deductions, zakat and religious-travel levy;
- reviewed TP1 and TP3 declaration records or explicit not-applicable states;
- source references for confirmed declarations;
- profile revision and confirmation timestamp.

Other canonical blockers can supersede profile completeness: no verified/active PCB rule, unsupported tax regime, unresolved payroll-component classification, incomplete YTD source, ambiguous normal/additional EPF allocation, stale profile/rule/classification snapshot, or missing governance binding.

Field classification:

| Area | Status | Finding |
|---|---|---|
| Core v3 profile | IMPLEMENTED | Model, validation, UI and runtime wiring exist. |
| TP1 categories | IMPLEMENTED | Structured entries, source reference and limits exist. |
| TP3 C1/C3/C4-zakat/C5 equivalents | IMPLEMENTED/PARTIAL | Aggregate gross, EPF, PCB, zakat and deductions are wired. |
| TP3 C2 exempt amounts | MISSING MODEL | Official input is not represented; the closure file acknowledges this. |
| TP3 C4 religious-travel levy split | MISSING MODEL / NOT WIRED | Previous-employer levy cannot be separately represented and offset. |
| Previous months employed | MISSING MODEL | The official formula uses previous/current month context; no explicit TP3 employment-month field exists. |
| Effective-dated tax regime | MISSING MODEL | One mutable regime for the whole tax-year profile cannot model a mid-year transition safely. |
| Approved-regime provenance | PARTIAL | Rule activation can list supported regimes, but employee approval status lacks an effective-dated evidence entity. |
| BIK/VOLA annual allocation | MISSING FORMULA/MODEL PATH | Generic component classification cannot represent annual-value allocation and payslip/EA exclusion semantics. |
| Official expected answers | MISSING OFFICIAL EVIDENCE | The question pack publishes no answers; local fixtures are not government results. |

The non-production synthetic `PAYROLL_PAYSLIP_UAT` exception in `readiness.ts` may defer an incomplete PCB profile only for isolated LOCAL/TESTING fixtures that are ineligible for official export. It is not a production path and must not be used for official HASiL questions.

## 10. Formula Coverage

| Official area | Tetamu status | Evidence/finding |
|---|---|---|
| Normal remuneration | **PASS** for supported standard scenarios | Pure calculator, frozen inputs, official worked examples pass. |
| Additional remuneration | **PASS/PARTIAL** | Formula path exists and worked example passes; business component semantics remain incomplete. |
| Previous employment remuneration | **PASS/PARTIAL** | TP3 gross enters YTD; exempt remuneration C2 and months are missing. |
| Previous employment PCB | **PASS** | `priorEmployerPcbCents` enters YTD formula. |
| Previous employment EPF | **PASS** | `priorEmployerEpfCents` is capped/projected in the calculator. |
| Accumulated remuneration | **PASS** | Finalized immutable ledger only. |
| Accumulated PCB | **PASS** | Frozen prior PCB snapshots enter ledger. |
| Accumulated zakat | **PASS/PARTIAL** | Current-employer and TP3 zakat supported; previous religious levy split is absent. |
| Monthly zakat | **PASS** | Applied as PCB rebate, not generic deduction. |
| EPF handling | **PARTIAL** | Official annual cap and allocation exist; voluntary/no-mandatory combinations need question-level certification. |
| Current-month PCB | **PASS** within supported scope | Exact sen integer calculation and trace. |
| YTD calculation | **PASS** | Finalized/accepted records only; duplicates and scope mismatch fail closed. |
| Rounding | **PASS with one verification note** | Truncate to sen and round MTD upward to 5 sen; post-zakat stage should be explicitly frozen in certification detail. |
| Minimum PCB | **PASS** | Pre-zakat/current and additional amounts under RM10 resolve to zero; post-zakat amount below RM10 remains deductible. |
| Negative/zero treatment | **PASS** | Unsafe negatives block; calculated zero remains CALCULATED. |
| Resident | **PASS/PARTIAL** | Standard static-year profile works; transitions do not. |
| Non-resident | **PASS/PARTIAL** | 30% pure path exists; exempt-income and effective-status evidence/classification are incomplete. |

## 11. Resident / Non-Resident

Official terminology states that a non-resident or employee not known to be resident is calculated at 30% of remuneration; exempt allowances/benefits/perquisites are excluded. Resident calculation deducts allowable amounts under the Income Tax Act.

Tetamu supports `RESIDENT_STANDARD` and `NON_RESIDENT` and has tested 30% behavior. However, `pcbProfile.taxRegime` is a single tax-year value. It has no effective-from/effective-to period and cannot safely represent an employee who changes residence/treatment during 2026. The non-resident path also depends on upstream classification excluding exempt remuneration, but no official exempt-benefit subtype or TP3 C2 capture is present.

Result: **PARTIAL**. Static status is supported; historical transition and exempt-income provenance are not.

## 12. Special Employee Categories

| Official category | Official requirement | Tetamu support | Gap |
|---|---|---|---|
| Approved individual under REP | 15% on chargeable income for the specified period; applicable rebate conditions | PARTIAL | Calculator path/tests exist. Employee approval/effective-period evidence and question fixture are not complete. |
| Knowledge Worker in the Specified Region | 15% on qualifying employment with approved designated company/activity | PARTIAL | Calculator path/tests exist. Designated-company/activity and effective approval are not modeled as governed employee/business evidence. |
| Resident non-citizen holding C-Suite position in approved company | 15% on chargeable income | PARTIAL | Calculator path exists. Mid-year effective status and approved-company/position evidence are missing. |
| Director/director fees | Treatment depends on official remuneration timing/nature | PARTIAL | Generic normal/additional classification exists; no director-fee semantic policy/fixture. |
| Non-resident employee | 30% of taxable remuneration; specified exemptions excluded | PARTIAL | Formula exists; status transition and exempt-income semantics are missing. |
| Expatriate contract transition | Question 4 changes contract and EPF status mid-year | NONE end-to-end | One yearly regime cannot express the transition; VOLA semantics are incomplete. |

Special regimes are intentionally runtime-gated to regimes named by genuine activation evidence. This is correct fail-closed behavior.

## 13. TP1

`pcb-profile.ts` v3 stores TP1 status, official form version, reviewed entries, source reference and timestamps. `pcb-declarations.ts` defines C1–C17 plus D1 zakat and validates official limits. The employee profile UI exposes these categories.

| TP1 area | Current status |
|---|---|
| Entry/evidence/review revision | IMPLEMENTED |
| Effective tax year | IMPLEMENTED (literal 2026) |
| Effective month | PARTIAL — declaration timestamps exist, but no explicit month-effective ledger event per entry |
| YTD contribution | IMPLEMENTED as frozen profile totals for current calculation |
| Carry-forward/recalculation | PARTIAL — frozen payroll snapshots prevent historical mutation; declaration-level monthly history is not a first-class table |
| Official limits | IMPLEMENTED in code; source-bound certification should cover every category boundary |
| Print/save employee TP form and employer-approval fields | MISSING |

All current categories are source-derived, but question-level evidence must still demonstrate that each expense is assigned to the correct category and eligibility rule; a numeric field alone does not prove eligibility.

## 14. TP3

The official TP3 section C requires accumulated previous-employer information:

- C1 taxable gross monthly/additional remuneration and taxable benefits;
- C2 exempt allowances/perquisites/benefits, with subcategories;
- C3 approved-fund/EPF contributions;
- C4(i) zakat and C4(ii) religious-travel levy;
- C5 PCB excluding CP38;
- section D deductions D1–D17.

| Official field | Model | UI | Formula wired | Tested | Status |
|---|---|---|---|---|---|
| TP3 C1 taxable gross | Yes | Yes | Yes | Yes | MODEL EXISTS / WIRED |
| TP3 C2 exempt amounts/subcategories | No | No | N/A (must stay excluded) | No | **MISSING** |
| TP3 C3 EPF | Yes | Yes | Yes | Yes | MODEL EXISTS / WIRED |
| TP3 C4(i) zakat | Yes | Yes | Yes | Yes | MODEL EXISTS / WIRED |
| TP3 C4(ii) religious-travel levy | No separate previous field | No | No | No | **MISSING** |
| TP3 C5 PCB excluding CP38 | Yes | Yes | Yes | Yes | MODEL EXISTS / WIRED |
| TP3 D1–D17 deductions | Yes | Yes | Yes | Partial | MODEL EXISTS / WIRED; full boundaries not certified |
| Previous employment months | No | No | Indirect only | No | **MISSING** |

Result: **PARTIAL**. The current closure document correctly notes TP3 C2 as unsupported. It must not be silently converted to taxable remuneration.

## 15. Zakat

Tetamu treats zakat as a PCB-specific rebate:

- previous/current-employer accumulated zakat enters the annual formula;
- current-month zakat reduces current PCB;
- TP1 D1 zakat is separate from allowable deductions;
- a net PCB below RM10 after zakat remains deductible, matching the official term.

The missing part is TP3 C4(ii) previous-employer religious-travel levy as a distinct value. Payslip semantics correctly show salary-deducted zakat when it is a payroll component, while TP1 self-paid zakat should not be presented as payroll-deducted zakat. Full output-document validation remains incomplete.

Result: **PASS/PARTIAL**.

## 16. EPF Interaction

The official PCB formula uses qualifying EPF/approved-fund inputs and annual limits; it is not simply a copy of the EPF statutory module result. The specification also distinguishes mandatory and voluntary EPF and describes RM4,000/RM7,000 combinations.

Tetamu correctly obtains the current payroll EPF contribution from frozen statutory/component results, allocates it between normal and additional remuneration, caps the projected qualifying amount in the PCB calculator, and fails closed if additional-pay EPF allocation is ambiguous. TP1 C11 can hold life-insurance/voluntary-EPF relief.

Gap: the current profile/UI does not explicitly separate all mandatory/voluntary/no-mandatory EPF subcases required by Question 2; correct categorization relies on the user and combined fields. Question-level certification is required before calling this full.

Result: **PARTIAL**.

## 17. Reliefs / Deductions

The retained TP1/TP3 forms provide these 2026 category ceilings. Amounts are shown in RM.

| Code | Official item represented in Tetamu | Limit | Current field/UI/calculation | Status |
|---|---|---:|---|---|
| C1/D1 | Parents/grandparents medical care | 8,000 | Structured entry / UI / sum | PARTIAL: eligibility sublimits need tests |
| C2/D2 | Basic support equipment | 6,000 | Structured entry / UI / sum | PASS foundation |
| C3/D3 | Education fees | 7,000 | Structured entry / UI / sum | PARTIAL: course eligibility evidence |
| C4/D4 | Medical and special-needs expenses | 10,000 | Structured entry / UI / sum | PARTIAL: sublimits/vaccination rules need tests |
| C5/D5 | Lifestyle expenses | 2,500 | Structured entry / UI / sum | PARTIAL: item eligibility tests |
| C6/D6 | Sports expenses | 1,000 | Structured entry / UI / sum | PARTIAL |
| C7/D7 | Breastfeeding equipment | 1,000 | Structured entry / UI / sum | PASS foundation |
| C8/D8 | Childcare fees | 3,000 | Structured entry / UI / sum | PARTIAL |
| C9/D9 | SSPN net savings | 8,000 | Structured entry / UI / sum | PARTIAL: net basis not modeled |
| C10/D10 | Alimony to former wife | 4,000 | Structured entry / UI / sum | PASS foundation |
| C11/D11 | Life insurance / voluntary EPF | 7,000 | Structured entry / UI / sum | PARTIAL: component sublimits not explicit |
| C12/D12 | Private retirement/deferred annuity | 3,000 | Structured entry / UI / sum | PASS foundation |
| C13/D13 | Education/medical insurance | 4,000 | Structured entry / UI / sum | PASS foundation |
| C14/D14 | SOCSO/EIS contribution | 350 | Structured entry / UI / sum | PARTIAL: payroll-derived vs declaration duplication guard |
| C15/D15 | Eligible EV charging/composting/security equipment | 2,500 | Structured entry / UI / sum | PARTIAL: subitem eligibility not modeled |
| C16/D16 | First-home loan interest | 7,000 | Structured entry / UI / sum | PARTIAL: property/SPA/price/date conditions not modeled |
| C17/D17 | Domestic tourism/cultural arts admission | 1,000 | Structured entry / UI / sum | PARTIAL: hotel is not automatically eligible |
| TP1 D1 | Zakat paid outside payroll | no ordinary category cap | Separate TP1 zakat entry | PASS foundation |

The code enforces category maxima but does not encode every official eligibility predicate or internal sublimit. Evidence review currently proves a reviewed number, not all legal facts. Result: **PARTIAL**.

## 18. Spouse / Child Inputs

The profile can represent employee Category 1/2/3, individual/spouse disability, spouse relief through category, and ten child-count buckets: under 18, studying 18+, diploma/degree, disabled, and disabled+studying, each full/half claim.

This covers the arithmetic categories used by the formula, including half claims. Gaps are semantic/UI evidence: marital status and spouse-working status are inferred via employee category rather than retained as explicit facts; there is no effective date for a family-status change; and the relationship/adoption/higher-education evidence is not a governed entity. Question fixtures must bind those facts.

Result: formula **PASS**, data provenance **PARTIAL**.

## 19. Normal Remuneration

`NORMAL_REMUNERATION` is an explicit PCB component treatment. The runtime aggregates frozen earning lines with that treatment, uses the current month and projected remaining months, applies qualifying EPF, YTD values, reliefs, bracket/rate and current rebates, and records the trace.

The official definition includes wages, salary and other recurring amounts. Tetamu is correct only when the component classification is supported by retained evidence. Unknown or unlisted components fail closed.

Result: **PASS** for classified supported components; **PARTIAL** across arbitrary business pay items.

## 20. Additional Remuneration

`ADDITIONAL_REMUNERATION` is distinct from normal remuneration. The engine implements the official additional-remuneration sequence, calculates the tax difference after projected normal MTD, applies the minimum rule, and combines it with current normal MTD. The official worked additional-remuneration example passes.

Gaps are classification rather than basic arithmetic: arrears must preserve original earning nature/period; commission may be normal or additional depending on payment pattern; director fees and allowances require official treatment; BIK/VOLA has special annual allocation. No question-specific branch exists, which is correct.

Result: formula **PASS**, semantic coverage **PARTIAL**.

## 21. Commission Interaction

Commission enters Payroll as a component, then PCB depends on its approved statutory classification. Tetamu can classify a commission component as normal, additional, excluded or unknown. It cannot infer correct official treatment from the label “Commission” alone.

Answer: **PARTIAL**. The architecture supports correct classification, but no complete official rule/evidence determines monthly versus non-monthly commission for every Commission-module payout. Unknown classification correctly blocks rather than guesses.

## 22. Payroll Component Classification

The statutory classification domain and frozen treatment snapshot distinguish taxable inclusion, normal/additional remuneration and exclusion. This is stronger than a generic taxable boolean and is frozen per payroll entry.

Still missing are first-class official semantics for:

- taxable versus exempt allowance/perquisite/benefit;
- BIK and VOLA annual/monthly allocation;
- payslip/EA exclusion where an amount is used only for PCB calculation;
- director fees;
- arrears retaining original earning type and period;
- commission frequency;
- Question-specific special treatment evidence.

Result: **PARTIAL**; schema can carry the main decision but not all facts needed to make it safely.

## 23. YTD / Historical State

`buildPcbTaxYearYtd` accepts only finalized current-employer payroll, accepted TP3/import sources and applied corrections. It sorts deterministically, rejects duplicate revisions, tenant/member/year mismatch, draft/review sources and current-month circularity. Finalized payroll statutory snapshots and their digests are the source of prior-month facts.

`EmployeeStatutoryProfileVersion`, component-treatment snapshots and `PayrollEntryStatutorySnapshot` freeze the profile revision, rule/dataset/classification/calculator digests, inputs, YTD source digest and trace. Recalculating August cannot silently rewrite a finalized July snapshot; a new revision/source is required.

Result: **PASS** for historical immutability. Gap: TP1/TP3/status facts lack a fully effective-dated relational history before they are frozen into a payroll snapshot.

## 24. Rounding

### PCB 2026 Rounding Matrix

| Stage | Official rule | Current Tetamu | Match |
|---|---|---|---|
| Formula monetary precision | Limit calculation to two decimal points and omit subsequent figures | Integer sen; percentage division uses `Math.floor` | **MATCH** |
| MTD final cents 1–4 | Round upward to 5 sen | `Math.ceil(cents / 5) * 5` | **MATCH** |
| MTD final cents 6–9 | Round upward to next 10 sen | Same function | **MATCH** |
| Exact 0/5 sen | Preserve | Same function | **MATCH** |
| Current/pre-zakat MTD below RM10 | No deduction | `payablePart` returns zero | **MATCH** |
| Net MTD after zakat below RM10 | Still deduct calculated amount | Minimum is applied before current zakat/levy | **MATCH** |
| Additional-remuneration MTD below RM10 | No deduction | `payablePart` returns zero | **MATCH** |
| Human-readable intermediate trace | Must expose exact truncation/rounding stage for verification package | Trace has result fields but not every intermediate operation/worksheet line | **PARTIAL EVIDENCE GAP** |

No floating-point currency is stored: money inputs/results are safe integers in sen. Percentage multiplication/division still uses JavaScript Number but remains within validated safe-integer bounds.

## 25. Rate / Table Drift

Current constants are explicitly versioned as `HASIL_MTD_SPEC_2026` / `TETAMU_PCB_2026_1.1.0`:

- non-resident 30%;
- REP/Knowledge Worker/C-Suite 15% paths;
- RM35,000 special-regime rebate threshold where applicable;
- individual/spouse rebates RM400;
- resident bands from RM5,000 through above RM2,000,000 with 1%, 3%, 6%, 11%, 19%, 25%, 26%, 28% and 30%, and category-specific B values;
- individual/spouse/disability reliefs and child amounts;
- qualifying EPF annual cap used by the formula.

The current official specification SHA is unchanged and the five retained worked/calculator fixtures still pass. No constant drift was observed in the audited table. However, local fixture success is not external approval, and special-category eligibility is not proven by rate equality alone.

Classification: **MATCH within implemented table; certification coverage PARTIAL**.

## 26. Payroll Finalize Boundary

The normal architecture is correct:

`Draft → materialize profile/rule/classification → calculate PCB → freeze evidence/snapshot → readiness → Finalize → immutable published payslip`.

A blocked PCB snapshot is a `BLOCKING` readiness issue, and finalize fails closed. The runtime may temporarily set the numeric database column to `0.00` when no calculated result exists, but the snapshot is `BLOCKED` and normal finalization cannot interpret it as calculated zero. The one testing-fixture exception is explicitly synthetic, non-production and export-ineligible.

Result: **PASS** for the canonical production boundary. PCB still cannot activate in Production without genuine HASiL approval evidence and supported-regime governance.

## 27. Payslip

`statutoryPayslipLine` distinguishes:

- calculated/manual PCB: prints the amount, including a legitimate RM0.00;
- not applicable: prints “Not applicable”;
- blocked PCB: prints “Pending configuration (not included in net pay)”.

Payslips can only be published from a finalized payroll run and store document bytes/hash. TP3 previous-employer values, TP1 self-paid deductions and PCB-only BIK/VOLA should not appear as gross pay merely because they are formula inputs.

Result: **READY for current fields; PARTIAL for the exact Question 1–5 document content**.

## 28. EA

The official Testing Questions require EA output for Questions 1 and 4. Repository search found no canonical EA form generator or EA test fixture. Payroll/payslip/CP39 data are insufficient to claim all exact EA fields, especially exempt allowances, BIK/VOLA, previous-employer exclusion and special-regime facts.

Classification: **MISSING**.

## 29. PCB II

The official specification calls Exhibit 3 `Form PCB 2(II)` and requires a system to generate detail of MTD/CP38 deducted from the employee. Question 2 requests this output.

Tetamu stores PCB, CP38 instructions and frozen monthly snapshots, so some source data exists, but no PCB 2(II) document renderer or exact Exhibit 3 test was found.

Classification: **MISSING output; PARTIAL data**.

## 30. Text File

`src/lib/payroll/statutory-submission.ts` implements `LHDN_CP39_EXHIBIT_4_2026`:

- 57-character header;
- 136-character employee detail;
- CRLF line endings;
- fixed sen amounts for PCB/CP38;
- employee TIN, identity slots, passport country code and employee code;
- finalized-run and business/employee profile validation.

Unit tests verify byte stability. Database-backed integration coverage exists. Missing evidence: official portal acceptance, question-specific extraction package, and clarification about raw text versus the email’s PDF instruction.

Classification: **PARTIAL** rather than READY.

## 31. Calculation Detail

The frozen PCB trace records rule/calculator versions, tax regime/category, YTD source count/digest, relief totals, projected EPF, chargeable income, rate/bracket values, pre/post-rebate MTD, additional-remuneration result, rounding result and final PCB. The payroll-entry page exposes technical calculation details.

Gaps for a HASiL-ready Calculation Detail artifact:

- no official document renderer/template;
- no complete line-by-line formula variables and substituted equations for every path;
- no question/input evidence cross-reference per line;
- no explicit display of every truncation/rounding operation;
- no downloadable immutable PDF worksheet;
- no Question 1–5 artifact manifest.

Classification: **PARTIAL**.

## 32. Question 1 Readiness

**Current readiness: BLOCKED.**

- Supported: spouse/child arithmetic, disabled studying child bucket, TP3 gross/EPF/PCB/zakat, standard relief categories, C-Suite 15% calculator path.
- Missing model fields: effective-dated C-Suite approval/tax regime; TP3 C2 exempt travelling allowance; previous religious-travel levy split/month history; explicit approved-company/position evidence.
- Missing formula/semantic paths: mid-year regime transition; taxable/exempt travel-allowance evidence; exact childcare/transit treatment.
- Missing documents: EA, formal Calculation Detail, question-specific CP39 package.
- Can currently calculate end-to-end: **NO**. A manually assembled pure input could produce a number, but it would not prove the official scenario.

## 33. Question 2 Readiness

**Current readiness: PARTIAL.**

- Supported: employee category, spouse working through category, full child claims, TP1 relief entries, zakat, special EPF/deduction totals, additional-remuneration formula.
- Missing/weak: official director-fee normal/additional decision; quarterly-period semantics; explicit mandatory versus voluntary EPF split and its sublimits; evidence-backed business-journal/medical/vaccination eligibility.
- Missing documents: PCB 2(II) and formal Calculation Detail.
- Can currently calculate end-to-end: **NO** until classifications and exact inputs are certified.

## 34. Question 3 Readiness

**Current readiness: PARTIAL.**

- Supported: REP 15% pure path, child claim, TP1 sports/domestic-tourism categories, SOCSO/EPF inputs and YTD.
- Missing/weak: effective-dated REP approval evidence; BIK household-servant annual-to-month allocation; BIK exclusion from payslip/EA gross; exact treatment of life insurance for self/child and hotel versus eligible admission.
- Missing documents: formal Calculation Detail and question-specific text package.
- Can currently calculate end-to-end: **NO** without governed BIK/REP facts.

## 35. Question 4 Readiness

**Current readiness: BLOCKED.**

- Supported: resident/non-resident pure paths, spouse/children arithmetic, EPF and relief categories.
- Missing model fields: effective-dated residence/contract status, EPF commencement period, VOLA annual/current-month facts.
- Missing formula/semantic paths: transition from initial short contract to renewed contract; VOLA allocation and output exclusion.
- Missing documents: EA, formal Calculation Detail and question-specific text package.
- Can currently calculate end-to-end: **NO**.

## 36. Question 5 Readiness

**Current readiness: PARTIAL.**

- Supported: Knowledge Worker 15% pure path; parent medical, lifestyle, sports/security/green, first-home and domestic categories as numeric entries; monthly salary/EPF.
- Missing/weak: approved-region/company/activity evidence; exact eligibility/subitem facts for grinder/CCTV; first-home SPA/property/interest conditions; gym versus sport/lifestyle classification; business-premises CCTV exclusion.
- Missing documents: formal Calculation Detail.
- Can currently calculate end-to-end: **NO** until eligibility facts and certification fixture are resolved.

## 37. Existing Tests

Focused audit command on 27 August 2026:

`pnpm exec tsx --test tests/unit/payroll-pcb-2026.test.ts tests/unit/payroll-pcb-profile.test.ts tests/unit/payroll-pcb-runtime.test.ts tests/unit/payroll-pcb-tax-year-ledger.test.ts tests/unit/payroll-pcb-engineering-closure.test.ts tests/unit/payroll-cp38-instruction.test.ts tests/unit/payroll-statutory-submission.test.ts`

Result: **54/54 PASS**.

Coverage includes:

- official specification worked examples for January–April;
- one retained official-calculator cross-check;
- zero/minimum/5-sen rounding;
- resident, non-resident, REP, Knowledge Worker and C-Suite pure paths;
- normal/additional component aggregation and unknown fail-closed;
- governed profile, TP1/TP3 numbering and evidence validation;
- runtime EPF allocation and YTD ledger integrity;
- CP38 instruction behavior;
- CP39 layout and byte stability;
- engineering closure cannot claim HASiL verification/Production activation.

`tests/integration/payroll-pcb-vc1-disposable-e2e.test.ts` covers the database-backed chain through payroll, frozen snapshots, payslip and CP39 in a disposable environment. It was inspected but not rerun in this audit because the task does not authorize data setup/mutation.

The file `statutory/official/fixtures/hasil-pcb-2026-official-golden-v1.json` contains four official-specification worked examples and one official-calculator observation. Its name must not be interpreted as official expected answers for Testing Questions 1–5.

## 38. Missing Tests

| Test area | Assessment |
|---|---|
| Official Question 1–5 full inputs | **MISSING** |
| Independently derived/reconciled expected answers | **MISSING** |
| Mid-year regime/residence transition | **MISSING** |
| TP3 C2 exempt-income retention/exclusion | **MISSING** |
| Previous religious-travel levy | **MISSING** |
| BIK/VOLA annual allocation and payslip/EA exclusion | **MISSING** |
| Director-fee quarterly treatment | **MISSING** |
| Commission monthly/non-monthly treatment | **WEAK** |
| Every TP1/TP3 limit/sub-limit boundary | **WEAK** |
| EA output for Q1/Q4 | **MISSING** |
| PCB 2(II) output for Q2 | **MISSING** |
| Formal Calculation Detail renderer | **MISSING** |
| Question-specific CP39 bytes | **MISSING** |
| HASiL portal acceptance | **MISSING EXTERNAL EVIDENCE** |
| Tax-year rejection/2027 rollover | Existing unsupported-year check; full next-year migration **MISSING** |

## 39. P0/P1/P2/P3 Gap Matrix

| Priority | Gap | Why it matters |
|---|---|---|
| P0 | Effective-dated residence/special-regime profile and approval provenance | Questions 1 and 4 cannot be represented correctly; historical status must not be mutable. |
| P0 | TP3 C2 and C4(ii), plus previous-employment period facts | Official TP3 inputs are incomplete and could change taxable/offset values. |
| P0 | BIK/VOLA and exempt allowance/perquisite semantics | Questions 1, 3 and 4 require formula-only inputs and output exclusions. |
| P0 | Official component classification for director fees, commission, arrears and allowances | Correct normal/additional/excluded treatment cannot be guessed from names. |
| P0 | Independently validate all special-path formula stages and EPF/zakat/sub-limit handling | Correct calculation comes before document generation. |
| P1 | Deterministic Question 1–5 input fixtures with no expected-output fabrication | Required for official testing and repeatability. |
| P1 | Independent expected-answer derivation and reconciliation | Official pack contains no answers; local numbers need documented provenance. |
| P1 | Full boundary tests for TP1/TP3/EPF/zakat/special regimes | Prevent cents/eligibility failures in HASiL verification. |
| P1 | Genuine HASiL software verification evidence | Required before Production activation; local tests are insufficient. |
| P2 | EA renderer for Q1/Q4 | Official submission artifact. |
| P2 | PCB 2(II) renderer for Q2 | Official submission artifact. |
| P2 | Formal immutable Calculation Detail worksheet/PDF | Official submission artifact and auditability. |
| P2 | Question-specific payslip/CP39 package and manifest | Makes the submission reproducible. |
| P2 | Clarify PDF versus Text File and perform portal acceptance | Prevents wrong submission packaging. |
| P3 | Guided UI for effective dates, evidence and official labels | Reduces HR mistakes after the model is correct. |
| P3 | Submission dashboard/checklist | Convenience only; must not precede calculation correctness. |

## 40. Recommended Development Plan

Do not start automatically. Recommended order:

### PCB 2026 P1 — Correctness foundation closure

- Add effective-dated employee tax/residence/special-approval facts.
- Complete TP3 C2/C4(ii)/employment-period capture.
- Add governed BIK/VOLA/exempt-benefit semantics and output exclusions.
- Close director-fee/commission/allowance classification using retained official evidence.

### PCB 2026 P2 — Formula and profile certification

- Re-audit every special path, voluntary EPF combination, zakat/levy, sublimit and rounding stage.
- Add boundary tests without changing formulas unless a proven official mismatch exists.
- Preserve `HASIL_MTD_SPEC_2026` and immutable historical snapshots.

### PCB 2026 P3 — Official Question 1–5 fixtures

- Encode exact official inputs, source pages and evidence references.
- Independently derive expected outputs from the official formula.
- Reconcile results without question-specific production branches.

### PCB 2026 P4 — Question artifact generation

- Generate Calculation Detail, specified payslips, EA and PCB 2(II).
- Generate question-specific CP39 text bytes.
- Freeze each artifact hash and source/input digest.

### PCB 2026 P5 — Submission package

- Build the five-question directory/manifest structure.
- Resolve the PDF/Text File contradiction in writing with HASiL.
- Perform internal independent review.

### PCB 2026 P6 — External verification

- Submit only after explicit authorization.
- Record genuine HASiL correspondence/approval for the exact software/calculator version.
- Run CP39 portal acceptance separately.

### PCB 2026 P7 — Controlled activation

- Activate only the approved calculator version/regimes after evidence checks.
- Keep unsupported profiles/components fail-closed.
- Regression-test EPF, SOCSO, EIS, LINDUNG24, Attendance, OT, Timesheet, Leave, Claims, Finalize and Payslip.

## 41. Submission Clarifications

1. **PDF versus Text File:** company email says PDF; official questions request raw Text File for Q1/Q3/Q4. Obtain written clarification.
2. **Expected answers:** the official question pack does not publish them. Confirm whether HASiL returns corrections or only acceptance during review.
3. **Calculation Detail format:** specification requires accurate answer/calculation, but no standalone worksheet schema was found. Confirm acceptable layout.
4. **EA and PCB 2(II):** confirm whether scanned official visual forms or system-generated equivalent PDFs are required.
5. **CP39 delivery:** confirm whether the raw Exhibit 4 file must be included alongside a PDF rendering and whether portal validation is required before email submission.
6. **Software identity/version:** approval evidence must name the exact Tetamu PCB calculator version; do not reuse generic documents.

Suggested future package (not created in this audit):

```text
pcb-2026-hasil-submission/
  question-1/
  question-2/
  question-3/
  question-4/
  question-5/
  evidence/
  manifest/
```

Suggested evidence convention:

```text
statutory/official/pcb/2026/
  sources/
  fixtures/
  expected/
  certifications/
```

The existing central `statutory/official/artifacts` and `manifest.json` convention should remain canonical unless a migration is explicitly approved.

## 42. Final Verdict

**PCB 2026 ENGINEERING GAPS IDENTIFIED**

What is reusable now:

- frozen official evidence and hashes;
- sen-safe, year-versioned calculator and core normal/additional paths;
- governed employee PCB profile and structured declarations;
- deterministic finalized YTD ledger;
- frozen statutory evidence/snapshots and fail-closed finalize boundary;
- payslip blocked-versus-zero distinction;
- CP38 instruction and CP39 Exhibit 4 foundation;
- 54 passing focused unit tests.

What blocks official Questions 1–5:

- incomplete effective-dated tax/special-status model;
- missing TP3 C2/C4(ii)/employment-period facts;
- incomplete BIK/VOLA/exempt-benefit and pay-component semantics;
- missing EA, PCB 2(II) and formal Calculation Detail output;
- no independently reconciled expected answers for the five official scenarios;
- no genuine HASiL software approval or CP39 portal acceptance.

Tetamu must not be called HASiL-approved. Production remains untouched and PCB Production activation remains off.

## 43. P1 Correctness Foundation Follow-up

The historical findings above remain the audit record as originally assessed. The effective-dated tax-status, TP3 C2/C4(ii)/previous-employment-period, BIK/VOLA/exempt-benefit, component-classification, readiness and immutable-snapshot foundation identified for P1 has now been implemented and verified.

Closure evidence:

- [`TETAMU_PCB_2026_P1_CORRECTNESS_FOUNDATION_CLOSURE.md`](./TETAMU_PCB_2026_P1_CORRECTNESS_FOUNDATION_CLOSURE.md)

The follow-up does not change the remaining certification, formal-output, submission-package, HASiL approval or Production-activation gaps. Tetamu must still not be described as HASiL-approved.
