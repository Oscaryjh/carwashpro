# TETAMU PCB 2026 P3A - OFFICIAL IDENTITY MAPPING CLOSURE

## 1. Executive Summary

P3A is **BLOCKED - HASiL CLARIFICATION REQUIRED**. The engineering path is ready: exact Exhibit 3/4 identity fields are modeled, a governed certification identity source exists, the P3 generator consumes it, the canonical CP39 exporter now blocks silent identifier normalization/truncation, field-level provenance is recorded, and the package validator hash-binds the input. Artifact generation cannot be certified because real applicant/employee inputs are absent and the retained official evidence does not include the HASiL country-code list referenced by Exhibit 4.

P3 remains **PARTIAL**. Q1/Q3/Q4 CP39 and Q2 PCB 2(II) remain blocked. The P2-certified PCB amounts and formula are unchanged. No Testing business data or Production system was accessed.

## 2. Original P3 Blocker

P3 correctly stopped before calling the canonical CP39 exporter or claiming PCB 2(II) readiness. It previously summarized the gap as missing official identities. P3A resolves that summary into 39 field-level findings across Q1-Q4 and separates:

1. Applicant/employer identity and officer evidence.
2. Employee A-D certification identity.
3. Internal Tetamu identifiers, which are never used as official submission identifiers.
4. Q2 receipt/bank-slip/transaction evidence required by the Exhibit 3 table.
5. The missing official passport country-code authority for Q4.

## 3. Exhibit 4 Identity Fields

Authority: HASiL 2026 Computerised Calculation Specification, Exhibit 4 printed page 43 and Exhibit 5 printed page 44.

| Official field | Position | Length | Type | Required / blank rule | Governed source |
| --- | ---: | ---: | --- | --- | --- |
| Employer No. (HQ) | 2-11 | 10 | Num | Required; exact 10 digits | Applicant |
| Employer No. | 12-21 | 10 | Num | Required; exact 10 digits | Applicant |
| Tax Identification Number | 2-12 | 11 | Num | Mandatory; zero-pad to 11 digits per Exhibit 5 | Employee certification identity |
| Employee's Name | 13-72 | 60 | Alphabet | Full name as IC/passport; left-space padded | Official question label plus applicant verification |
| Old IC No. | 73-84 | 12 | Alphanum | Valid value or blank if not applicable | Employee certification identity |
| New IC No. | 85-96 | 12 | Num | Valid 12 digits without hyphens or blank if not applicable | Employee certification identity |
| Passport No. | 97-108 | 12 | Alphanum | Valid value or blank if not applicable | Employee certification identity |
| Country Code | 109-110 | 2 | Alphabet | Foreign passport only; refer to HASiL country-code list | Employee identity plus official code-list authority |
| Employee No. or Salary No. | 127-136 | 10 | Alphanum | Required; left justified | Applicant-assigned employee code |

The record type, year/month, totals, record counts, PCB and CP38 fields are not identity fields but remain controlled by the canonical Exhibit 4 exporter. Header length is 57 characters; detail length is 136 characters; records use CRLF.

## 4. Exhibit 3 Identity Fields

Authority: HASiL 2026 Computerised Calculation Specification, Exhibit 3 printed page 42.

| Official label | Required | Source / format conclusion |
| --- | --- | --- |
| Cawangan | Yes | Applicant-supplied; Exhibit 3 states no width/code format |
| Tarikh | Yes | Applicant-supplied; Exhibit 3 states no date format |
| Potongan Cukai Yang Dibuat Dalam Tahun | Yes | Certified question year, 2026 |
| Nama Pekerja | Yes | Employee B label plus applicant verification |
| No. Kad Pengenalan/No. Passpot | Yes | Applicant-supplied valid IC/passport |
| No. Pengenalan Cukai Pekerja (IG) | Yes | Applicant-supplied employee TIN |
| No. Pekerja | Yes | Applicant-assigned employee number |
| No. Majikan (E) | Yes | Applicant employer number |
| Nama pegawai | Yes | Applicant officer evidence |
| Jawatan | Yes | Applicant officer evidence |
| No. Telefon | Yes | Applicant officer evidence |
| Nama Dan Alamat Majikan | Yes | Applicant employer name/address |

The current-year table also exposes PCB/CP38 amounts, receipt/bank-slip/transaction references and corresponding dates. The retained Q2 scenario supplies amounts through certified P2 results but not the transaction references or dates.

## 5. Employer Identity Mapping

The canonical Tetamu model has `lhdnEmployerNumberHq` and `lhdnEmployerNumber`, but P3A does not read Testing or Production business records. Certification uses the governed source `statutory/official/fixtures/pcb-2026-p3a-submission-identity.json`.

Both 10-digit employer numbers are missing. Exhibit 3 additionally requires the employer name/address, HASiL branch, statement date and responsible officer name, position and phone. All remain `MISSING_APPLICANT_INPUT`. No internal business UUID, company fixture name or sample employer number is substituted.

## 6. Employee Identity Mapping

The Testing Questions provide only scenario labels Employee A-E. They do not provide Employee A-D TINs, employee/salary numbers or valid IC/passport numbers.

- Employee A: TIN, employee number, identity type and identity number required.
- Employee B: TIN, employee number, identity type and identity number required.
- Employee C: TIN, employee number, identity type and identity number required.
- Employee D: the official question proves passport treatment because he is an Australian expatriate; passport number, TIN, employee number and official HASiL passport-country code are still required.
- Employee E: no P3 identity-bearing artifact is required; identity inputs are `NOT_REQUIRED` for this phase.

Internal fixture names, question IDs, UUIDs and synthetic payroll identifiers are not submission identities.

## 7. Applicant-Supplied Inputs

The exact applicant inputs still required are:

1. Applicant employer name and full address.
2. 10-digit LHDN employer number (HQ).
3. 10-digit LHDN employer number used for the applicant/branch.
4. Exhibit 3 HASiL branch and statement date.
5. Responsible officer name, position and telephone number.
6. Employee A-D 11-digit TINs.
7. Employee A-D employee/salary numbers; CP39 values must be 1-10 alphanumeric characters.
8. Employee A-C identity type plus valid New IC, Old IC or passport number.
9. Employee D passport number and official HASiL passport-country code.
10. Q2 March, June, September and December PCB receipt/bank-slip/transaction references and dates.

These values must be entered into the governed certification input with evidence and must not be hard-coded into generator source.

## 8. Allowed Blank/Default Rules

Exhibit 4 explicitly allows Old IC, New IC and Passport fields to be blank only when that identity type is not applicable. It does not permit a fake TIN, IC, passport, employer number or employee number. CP38 amount/count may be zero when the certified scenario contains no CP38. Country code is blank for IC identities and required for a foreign passport.

The retained specification refers to a HASiL country-code list but does not retain the list itself. ISO or guessed values cannot be treated as official. No zero-filled dummy identity, `TEST`, internal UUID or silent truncation is permitted.

## 9. CP39 Q1

Q1 October remains **BLOCKED**. Missing fields: 10-digit HQ employer number, 10-digit employer number, Employee A 11-digit TIN, employee/salary number, identity type and valid identity number. The canonical exporter is not invoked. The P2-certified October PCB remains unchanged and the blocker JSON now lists every field-level cause and provenance.

## 10. CP39 Q3

Q3 November remains **BLOCKED**. Missing fields: 10-digit HQ employer number, 10-digit employer number, Employee C 11-digit TIN, employee/salary number, identity type and valid identity number. The canonical exporter is not invoked. The P2-certified November PCB remains unchanged.

## 11. CP39 Q4

Q4 December remains **BLOCKED**. Missing fields: 10-digit HQ employer number, 10-digit employer number, Employee D 11-digit TIN, employee/salary number, passport number and official HASiL passport-country code. The retained question establishes passport treatment but not the passport identity. The retained specification does not include the country-code list it references.

## 12. PCB 2(II) Q2

Q2 remains **BLOCKED**. The generator now maps the exact Exhibit 3 labels and retains all four P2-certified current-year deduction rows. It requires the applicant branch/date/employer/officer fields, Employee B TIN/employee number/identity, and March/June/September/December PCB transaction reference/date evidence. CP38 remains RM0.00 and its reference/date fields remain blank because P2 certifies no CP38.

The generated structured source and blocked draft disclose these gaps; neither claims certification readiness.

## 13. Reconciliation

All generated Calculation Detail, Payslip and EA-equivalent PCB values remain bound to P2 with RM0.00 difference. P3A changes no PCB, CP38, EPF, zakat, TP1/TP3, gross or net amount. The future ready branches of CP39 and PCB 2(II) consume the same P2 records; there is no question-specific hard-coded PCB amount.

## 14. Manifest Provenance

The master manifest hash-binds the governed identity input and records `identitySource`, `identityStatus`, `requiredIdentityFields` and `unresolvedIdentityInputs`. Each question manifest records its own identity status and field-level findings. `manifest/identity-source-matrix.json` separates official labels, applicant inputs and certification fixture fields. `manifest/identity-validation.json` contains all 39 findings and its input SHA-256.

Allowed provenance values are `OFFICIAL_QUESTION`, `APPLICANT_SUPPLIED`, `OFFICIAL_FORMAT_DEFAULT` and `ALLOWED_BLANK`. No unexplained identity value is accepted.

## 15. Validation

The canonical CP39 validator now blocks:

- employer numbers containing separators instead of exact 10 digits;
- TIN normalization from punctuated input;
- unsupported `OTHER` identity types;
- Old IC/passport values outside 1-12 alphanumeric characters;
- employee codes containing stripped characters or exceeding 10 characters;
- employee names exceeding 60 characters rather than truncating them.

The P3 package validator reports 94/94 checks passed with recorded blockers. This means hashes, manifests, prior artifacts and blocker truthfulness pass; it does not mean CP39 or PCB 2(II) is ready. Raw CP39 validation and PCB 2(II) validation remain waiting for governed inputs.

## 16. Tests

- P3A identity-mapping tests: 10/10 PASS.
- Combined P3A, P3 and canonical statutory-submission tests: 28/28 PASS.
- Full PCB-focused regression: 114/114 PASS.
- P3 package validator: 94/94 PASS with three recorded blocker groups.
- TypeScript: PASS.
- ESLint: PASS.
- Build is not required because no Next.js renderer, route, schema or database behavior changed.

## 17. Remaining Clarifications

Two clarification/input classes remain:

1. **Applicant input:** all values listed in Section 7 must be supplied with evidence.
2. **HASiL authority:** retain the official country-code list used by Exhibit 4 and identify the valid code for an Australian-issued passport. Do not substitute ISO `AU` without that authority.

The existing submission-format ambiguity also remains: the email wording asks for PDF documents while the Testing Questions require raw Text Files for Q1/Q3/Q4. Once identities resolve, P3 will preserve both raw CP39 bytes and PDF previews.

## 18. Final Verdict

`PCB 2026 P3A -> BLOCKED - HASiL CLARIFICATION REQUIRED`.

Engineering readiness is complete, but official artifact readiness is not. Employer identity is `APPLICANT INPUT REQUIRED`; Employee A-D identities are `INPUT REQUIRED`; Employee E is `NOT REQUIRED`. Q1/Q3/Q4 CP39 and Q2 PCB 2(II) remain blocked, Text File Validation and PCB 2(II) Validation remain FAIL, P3 remains PARTIAL, P4 cannot start, HASiL submission remains NO, and HASiL approval remains PENDING.
