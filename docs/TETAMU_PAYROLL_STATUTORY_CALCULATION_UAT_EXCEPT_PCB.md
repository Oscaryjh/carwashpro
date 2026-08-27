# TETAMU Payroll Statutory Calculation UAT — Except PCB

## 1. Executive Summary

Verdict: **READY EXCEPT PCB** for Payroll calculation correctness. At a statutory wage base of RM3,000.00, the retained official tables and canonical calculators agree exactly for EPF, SOCSO and EIS. The baseline LINDUNG 24 persona is a Malaysian employee with explicit synthetic Act 4 coverage and `VOLUNTARY_OPT_OUT`; its canonical resolution is `NO_CONTRIBUTION`, not a hard-coded zero.

Employee deductions excluding PCB are RM350.65, net pay excluding PCB is RM2,649.35, and employer statutory cost is RM447.55. PCB remains `BLOCKED / PCB_PROFILE_INCOMPLETE`, is excluded from net pay, and appears as pending rather than `RM0.00`.

This is a calculation, reconciliation, readiness and Payslip-presentation certification. The already Finalized and Published August 2026 Testing Payroll was not reopened or edited. No new payment, export, submission or Production action occurred.

## 2. Scope

Included: EPF, SOCSO, EIS, LINDUNG 24, statutory component mapping, employee/employer reconciliation, PCB-deferred readiness semantics, Payslip rendering, synthetic export denial, official-table boundaries and disposable automated scenarios.

Excluded: PCB calculation certification, real payment, bank export, mark paid, official statutory export/submission, Production deployment and Release Drill.

Target context: `Payroll UAT Business`, employee `UAT-PAYROLL-001`, August 2026, monthly basic salary RM3,000.00. The historical finalized run remained immutable; the new calculation evidence was produced through retained datasets and disposable/unit automation.

## 3. PCB Deferred Boundary

PCB is not guessed. No TIN, tax profile, YTD balance, TP1/TP3 data or RM0 PCB result was fabricated. The canonical representation is:

- snapshot status: `BLOCKED`;
- blocker: `PCB_PROFILE_INCOMPLETE`;
- readiness: `REVIEW`, only for an exact non-production synthetic UAT snapshot;
- Payslip: `Pending configuration (not included in net pay)`;
- net inclusion: no;
- certification: explicitly excluded.

The exception is fail-closed. It is allowed only when PCB is the sole blocked statutory scheme, all EPF/SOCSO/EIS/LINDUNG24/PCB snapshots exist, the PCB snapshot is `SYNTHETIC_TESTING`, its environment is LOCAL/TESTING, purpose is `PAYROLL_PAYSLIP_UAT`, and `officialExportEligible` is false. Production, real evidence, missing snapshots or an additional statutory blocker cannot use the exception.

## 4. Official Evidence Pack

| Scheme | Official version | Effective from | Artifact SHA-256 | Dataset SHA-256 | Verification |
| --- | --- | --- | --- | --- | --- |
| EPF | `KWSP_THIRD_SCHEDULE_2025_10` | 2025-10-01 | `c4904e44f0cb15a251a59e4f34c11a1ededa0868b962b2ebd9b81270285358b1` | `17c6787a8b28fb0e1b30f9c350a70491a0f882e833b7cf17a3d1251acc45a4b3` | VERIFIED |
| SOCSO | `PERKESO_ACT4_SKBBK_2026_06` | 2026-06-01 | `e76b2a03740f6da4a305919c677d4935a05e9166502e5f06afe1030b7407caa1` | `1e1b17a332e2b596b1efa85c075428c54b16d059730726e3f67cef710f334460` | VERIFIED |
| EIS | `PERKESO_ACT800_2024_10` | 2024-10-01 | `3499fec4271b45ae3e3055b2071075f96f65dc451775ed23adf39f9deec5376a` | `ca14f3decb605af4df4c837f281666a6816699947d1658614bbd336f809ae08e` | VERIFIED |
| LINDUNG 24 | `PERKESO_LINDUNG24_PHASE1_2026_06` | 2026-06-01 | `e76b2a03740f6da4a305919c677d4935a05e9166502e5f06afe1030b7407caa1` | `1e1b17a332e2b596b1efa85c075428c54b16d059730726e3f67cef710f334460` | VERIFIED |

`statutory:verify-evidence-packs` and `statutory:verify-p2c` passed. The generic live-refetch command still reports `SOURCE_DRIFT_DETECTED` for EPF because the KWSP endpoint returns HTTP 403 HTML to automation. The retained official PDF itself passed local byte/hash verification: 761,109 bytes and the exact manifest SHA-256. The reviewed resolution `kwsp-third-schedule-2025-10-source-drift-resolution-2026-08-21.json` also records a browser-downloaded official artifact as byte-identical with no semantic rule change.

## 5. Statutory Persona

The automated persona is explicitly Malaysian, full-time, under 60, Act 4 covered, synthetic Testing evidence, purpose `PAYROLL_PAYSLIP_UAT`, and officially non-exportable. EPF uses the standard Malaysian under-60 category, SOCSO First Category applies, and EIS applies. No real member number or official submission identity was invented.

Baseline LINDUNG 24 participation is `VOLUNTARY_OPT_OUT`, single employer, current business selected. Additional automated personas cover local opt-in, foreign mandatory coverage and another selected employer.

## 6. EPF

For RM3,000.00, `calculateEpf()` selects official row `EPF-151` in Part A:

- employee: RM330.00;
- employer: RM390.00;
- comparison: PASS.

The calculator uses the retained Third Schedule table. It does not approximate the amount by applying a percentage to the salary.

## 7. EPF Boundaries

| Wage | Row/method | Employee | Employer | Result |
| ---: | --- | ---: | ---: | --- |
| RM2,999.99 | `EPF-151` | RM330.00 | RM390.00 | PASS |
| RM3,000.00 | `EPF-151` | RM330.00 | RM390.00 | PASS |
| RM3,000.01 | `EPF-152` | RM333.00 | RM393.00 | PASS |
| RM20,000.00 | `EPF-401` | RM2,200.00 | RM2,400.00 | PASS |
| RM20,000.01 | `EPF-PART_A-FORMULA` | RM2,201.00 | RM2,401.00 | PASS |

The full unit suite also retains the Malaysian age-60 Part E and non-Malaysian Part F coverage. Unsupported or incomplete categories continue to fail closed rather than being guessed.

## 8. SOCSO

For RM3,000.00, `calculateSocso()` selects `ACT4-34`, First Category:

- employee: RM14.75;
- employer: RM51.65;
- comparison: PASS.

## 9. SOCSO Boundaries

| Wage | Row | Employee | Employer | Result |
| ---: | --- | ---: | ---: | --- |
| RM2,999.99 | `ACT4-34` | RM14.75 | RM51.65 | PASS |
| RM3,000.00 | `ACT4-34` | RM14.75 | RM51.65 | PASS |
| RM3,000.01 | `ACT4-35` | RM15.25 | RM53.35 | PASS |
| RM6,000.00 | `ACT4-64` | RM29.75 | RM104.15 | PASS |
| RM6,000.01 | `ACT4-65` ceiling | RM29.75 | RM104.15 | PASS |
| RM9,000.00 | `ACT4-65` ceiling | RM29.75 | RM104.15 | PASS |

## 10. EIS

For RM3,000.00, `calculateEis()` selects `ACT800-34`:

- employee: RM5.90;
- employer: RM5.90;
- comparison: PASS.

## 11. EIS Boundaries

| Wage | Row | Employee | Employer | Result |
| ---: | --- | ---: | ---: | --- |
| RM2,999.99 | `ACT800-34` | RM5.90 | RM5.90 | PASS |
| RM3,000.00 | `ACT800-34` | RM5.90 | RM5.90 | PASS |
| RM3,000.01 | `ACT800-35` | RM6.10 | RM6.10 | PASS |
| RM6,000.00 | `ACT800-64` | RM11.90 | RM11.90 | PASS |
| RM6,000.01 | `ACT800-65` ceiling | RM11.90 | RM11.90 | PASS |
| RM9,000.00 | `ACT800-65` ceiling | RM11.90 | RM11.90 | PASS |

## 12. LINDUNG24

The baseline local employee has explicit synthetic `VOLUNTARY_OPT_OUT` evidence. The resolver returns `NO_CONTRIBUTION`, so employee and employer values are both RM0.00. This is an eligibility/participation result, not a calculator hard-code.

For an applicable RM3,000.00 opt-in/mandatory case, the official amount table selects `ACT4-34` and returns employee RM22.15, employer RM0.00.

## 13. LINDUNG24 Scenarios

| Scenario | Canonical result | Employee | Result |
| --- | --- | ---: | --- |
| Local + voluntary opt-out | `NO_CONTRIBUTION` | RM0.00 | PASS |
| Local + voluntary opt-in | `CONTRIBUTION_REQUIRED` | RM22.15 | PASS |
| Foreign + mandatory | `CONTRIBUTION_REQUIRED` | RM22.15 | PASS |
| Multiple employer + other employer selected | `NO_CONTRIBUTION` | RM0.00 in current business | PASS |

Boundary and ceiling behavior uses the same verified Act 4 amount schedule: RM44.65 at the RM6,000 ceiling and above.

## 14. Payroll Components

Employee statutory values are mapped to employee deduction components. Employer EPF/SOCSO/EIS remain employer contributions and do not reduce employee net pay. PCB has no deduction component because it was not calculated. The Payslip document loader and publication path now freeze snapshot status, blocker and employee/employer amounts alongside the entry.

## 15. Employee Deductions

| Deduction | Amount |
| --- | ---: |
| EPF employee | RM330.00 |
| SOCSO employee | RM14.75 |
| EIS employee | RM5.90 |
| LINDUNG 24 employee, baseline opt-out | RM0.00 |
| PCB | not included |
| Other deductions | RM0.00 |
| **Total excluding PCB** | **RM350.65** |

## 16. Employer Contributions

| Employer contribution | Amount |
| --- | ---: |
| EPF | RM390.00 |
| SOCSO | RM51.65 |
| EIS | RM5.90 |
| LINDUNG 24 baseline | RM0.00 |
| **Total** | **RM447.55** |

## 17. Gross

Basic salary is RM3,000.00. There is no OT, rest-day/public-holiday pay, leave adjustment, claim, commission or other earning in the baseline. Gross is therefore RM3,000.00.

## 18. Net

Net excluding PCB is RM2,649.35. PCB is not included and is not represented as a zero deduction.

## 19. Reconciliation

`RM3,000.00 gross - RM350.65 employee deductions = RM2,649.35 net` — PASS.

Employer cost is tracked separately: `RM390.00 + RM51.65 + RM5.90 = RM447.55` — PASS. It does not alter net pay.

## 20. PCB Presentation

Blocked PCB is rendered as `PCB: Pending configuration (not included in net pay)`. It is not rendered as `PCB: RM0.00`. This wording is used by the PDF path after the statutory snapshot status is frozen into the document DTO.

## 21. Payslip

Payslip regression verifies one coherent RM3,000 fixture containing:

- EPF employee RM330.00 and employer RM390.00;
- SOCSO employee RM14.75 and employer RM51.65;
- EIS employee RM5.90 and employer RM5.90;
- calculated LINDUNG 24 RM0.00 for the opt-out baseline;
- PCB pending configuration;
- total deductions RM350.65;
- net RM2,649.35;
- employer total RM447.55;
- non-production fixture watermark.

No new Testing Payslip publication was created because the existing August run and its published document are immutable. The renderer/publication code was certified without modifying historical output.

## 22. NOT_CONFIGURED vs Calculated Zero

The rendering rule is status-based:

- `CALCULATED` or `MANUAL`: show the frozen amount, including a genuine RM0.00;
- `NOT_APPLICABLE`: show `Not applicable`;
- PCB `BLOCKED`: show pending configuration and exclude it from net;
- another blocked scheme: show `Not calculated - review required` with blocker code.

Thus a calculation result of zero and a missing calculation are not conflated.

## 23. Payroll Readiness

Resolved EPF/SOCSO/EIS/LINDUNG24 plus an exact non-production deferred-PCB snapshot results in `REVIEW_REQUIRED` but proceedable for this controlled UAT. PCB remains visible as a review item. Any other blocked scheme keeps Payroll blocked. The submit-for-review service uses the same strict predicate and does not create a general readiness bypass.

This exception does not activate statutory rules. Evidence-pack output remains honest: engineering ready, human sign-off not executed, activation blocked by human sign-off where applicable. Runtime calculation still requires its normal selected/active rule in a real Payroll Draft.

## 24. Synthetic Evidence

The UAT contract is `SYNTHETIC_TESTING`, environment LOCAL/TESTING, purpose `PAYROLL_PAYSLIP_UAT`, `officialExportEligible = false`. Production rejects synthetic write/read/Payslip behavior. The run-level document projection becomes synthetic if any statutory snapshot is synthetic and becomes non-exportable if any snapshot is non-exportable.

## 25. Export Deny

Official statutory CSV/XLSX, artifact and submission paths reject a run that contains synthetic or non-exportable snapshots. Renderer tests assert `SYNTHETIC_STATUTORY_EVIDENCE_NOT_EXPORTABLE`. Result: **DENY**.

## 26. Payment Safety

No payment instruction, payment batch, mark-paid action, bank export or payment status transition was performed. Calculation readiness is not payment readiness.

## 27. Regression

- Full unit: 1,144/1,144 PASS.
- Disposable integration: 185/185 PASS.
- Employee-cookie end-to-end integration: 1/1 PASS.
- Total disposable/relevant integration: 186/186 PASS.
- Official evidence packs: PASS for EPF/SOCSO/EIS/LINDUNG24.
- P2C retained dataset/review/golden/calculator verification: PASS.
- TypeScript: PASS.
- ESLint: PASS, 0 errors; three pre-existing unrelated warnings in the normal non-quiet run.
- `git diff --check`: PASS.
- Generic live-refetch: EPF network/403 warning only; retained official artifact local hash verification PASS and source-drift resolution records byte-identical official bytes.

## 28. Official Certification Matrix

Machine-readable certification: `statutory/official/certifications/TETAMU_PAYROLL_STATUTORY_CALCULATION_UAT_2026.json`.

Human-readable certification: `statutory/official/certifications/TETAMU_PAYROLL_STATUTORY_CALCULATION_UAT_2026.md`.

The certification includes official source/version, artifact and dataset digests, RM3,000 expected-vs-actual values, boundaries, LINDUNG 24 scenarios, reconciliation and safety state.

## 29. Remaining PCB Blocker

The exact remaining blocker is PCB only: the employee PCB calculation profile/application remains incomplete. PCB needs its legitimate tax profile, governed inputs and application/configuration completion in a separate task. This UAT does not certify PCB and must not be described as `FULL STATUTORY READY`.

## 30. Final Verdict

**TETAMU PAYROLL CALCULATION → READY EXCEPT PCB**

EPF PASS. SOCSO PASS. EIS PASS. LINDUNG 24 PASS. Payroll component mapping, employee deductions, employer contributions, reconciliation and truthful Payslip presentation PASS. PCB is explicitly deferred and excluded from net. Synthetic official export is denied. Payment and statutory submission were not executed. Production was not touched.

Release Drill remains stopped until separately authorized.
