# TETAMU PAYROLL PAYSLIP PDF UI/UX V2 - MALAYSIA IMPLEMENTATION REPORT

## 1. FINAL VERDICT

**READY FOR OWNER REVIEW**

- Runtime: Staff 3000 only.
- Environment: **TESTING ONLY**.
- Railway Testing deployment: `173165e0-1a2c-4b98-8e04-6bd02caf75be` - SUCCESS.
- Exact release SHA: `2fe99bece9c97bd947e2cadffb2659e6e53c91b3`.
- Source digest: `6cbbefa4b6c15f689e5266af8b18beaed4fcc7324eacd08e39713fa9060db2d8`.
- Production was not accessed, modified, or deployed.

## 2. CURRENT PAYSLIP PROBLEMS

The previous generator emitted a plain 9 pt text stream with weak hierarchy, no financial tables, no strong Net Pay treatment, and little use of the A4 page. It also displayed low-value statutory rule metadata and raw notes. The supplied visual reference contained issues that were deliberately not copied: duplicate Basic Salary/Gross rows, an employer total inconsistent with its rows, `LENDING 24 jam`, and an internal UAT note.

The publication query also omitted canonical `claimReimbursementSnapshots`, although the admin preview reader already loaded them. This could make newly published immutable PDFs omit a canonical reimbursement section. The release now loads only the existing READY/SETTLED snapshots before publication; no reimbursement calculation changed.

## 3. DESIGN DIRECTION

The new presentation is a restrained corporate Malaysian payroll document: white/light canvas, Tetamu dark teal, subtle borders, clear tables, compact spacing, printable contrast, and a strong Net Pay bar. It follows the reference hierarchy without copying its data or phone-screen dimensions.

## 4. MALAYSIAN PAYSLIP STRUCTURE

Order implemented:

1. Company header and lifecycle status
2. PAYSLIP title and pay period
3. Gross Pay / Total Deductions / Net Pay summary
4. Company/Payslip information and Employee information
5. Attendance summary
6. Earnings
7. Employee Deductions
8. Employer Contributions
9. Reimbursements when present
10. Final Net Pay bar
11. Employee-safe notes

## 5. COMPANY HEADER

Shows company name, company registration number when available, document status, and finalized/submitted lifecycle time. No broken logo is possible because the current payroll document DTO does not expose a publication-bound logo snapshot; a clean company monogram is used as a safe fallback. Long company names wrap safely inside the reserved header area.

## 6. PAY PERIOD

The employee-facing title uses `PAYSLIP` and a localized month/year such as `August 2026`. Internal PayrollRun terminology and IDs are absent.

## 7. PAY SUMMARY

Gross Pay, authoritative Total Deductions, and Net Pay appear near the top. Net Pay has the strongest visual emphasis. Total Deductions remains the sum of the same canonical deduction fields used by the previous generator; it is never derived from Gross minus Net.

## 8. EMPLOYEE INFO

Shows employee name, employee code, and pay basis only. Long employee names/codes wrap within the information panel. Membership IDs, EmployeeAccount IDs, role names, permissions, and database identifiers are not rendered.

## 9. ATTENDANCE

Shows canonical snapshot fields only: days worked, regular hours, overtime hours, and public-holiday hours. No attendance, rest-day, or schedule inference was introduced.

## 10. EARNINGS

Uses frozen PayrollEntry component names and amounts where present, with description-left/amount-right table alignment. Gross Pay is the authoritative total, not a duplicate earning row. Fallback rows use existing basic, OT, public-holiday, and allowance fields only.

## 11. EMPLOYEE DEDUCTIONS

Employee deductions are visually separate from employer contributions. Labels are normalized to EPF Employee, SOCSO Employee, EIS Employee, PCB, CP38, and LINDUNG24. EPF/SOCSO/EIS/PCB remain visible at zero for payroll transparency; optional CP38/LINDUNG24 rows are omitted when zero. Non-zero miscellaneous deductions remain visible.

## 12. EMPLOYER CONTRIBUTIONS

Employer EPF, SOCSO, and EIS have a separate blue-tinted section and an explicit message that employer-funded contributions do not reduce Net Pay. The total is the sum of the existing employer contribution fields.

## 13. REIMBURSEMENTS

READY/SETTLED publication-bound claim reimbursement snapshots are now loaded by the publication path and rendered in a separate non-wage section. The document explicitly states that reimbursements are excluded from Gross Pay. No live Claims data is read by the PDF template.

## 14. COMMISSION

Commission is shown only when it already exists as a frozen canonical PayrollEntry earning component. The generator does not query live Commission state and does not alter Commission calculation or settlement.

## 15. NET PAY

The final dark-teal Net Pay bar is the strongest financial element. It uses the canonical `PayrollEntry.netPay` value. It never claims Paid, Transferred, or Credited.

## 16. NOTES

The normal note is: `This is a computer-generated payslip. No signature is required.` Employee-appropriate notes can wrap in a low-priority section. Notes containing internal UAT/TEST/DEBUG/FIXTURE/TRACE/MIGRATION/INTERNAL namespace markers are suppressed from the employee PDF.

## 17. INTERNAL DATA REMOVED

The redesigned PDF does not render PayrollRun/PayrollEntry/publication/membership UUIDs, statutory rule version, source digests, calculation trace, migration names, system enums, or internal fixture namespaces.

## 18. A4 / PRINT

- MediaBox: `595.28 x 841.89 pt` - A4 portrait.
- Print-safe margin: 34 pt.
- Typical samples A-D fit one page.
- Long complex sample E uses two clean pages with a continuation header.
- Totals stay with their tables; text is not shrunk to unreadable debug-report sizing.

## 19. MOBILE PDF VIEWING

The PDF remains official A4 rather than a simulated phone screen. Strong top summary, compact tables, high-contrast Net Pay, and simple single-column financial sections remain legible when a mobile PDF viewer scales the page.

## 20. LONG CONTENT

Validated long company name, employee name, employee code, component labels, employee-safe note, large grouped MYR amounts, many earnings/deductions, and two-page overflow. Identity values wrap; financial amounts remain right-aligned and do not wrap into the description column.

## 21. PDF IMMUTABILITY

Existing `PayrollPayslipPublication.documentBytes` were not regenerated or mutated. The existing one-publication-per-entry behavior and database immutability guard remain unchanged. The V2 template applies only when a future finalized PayrollEntry is newly published.

## 22. SECURITY

The Staff download route is unchanged. It still requires employee self-service authentication, PAYROLL entitlement, exact business ID, exact membership ID, and publication UUID. Delivery remains `application/pdf`, `attachment`, and `Cache-Control: private, no-store`. Testing smoke confirmed an unauthenticated random publication returns 404, sets no cookie, and discloses no PDF.

## 23. FILES CHANGED

Release commit contains exactly five files:

- `src/lib/payroll/payslip-pdf-v2.ts` - new presentation-only A4 renderer.
- `src/lib/payroll/export.ts` - delegates Payslip output to the V2 renderer; CSV/XLSX exports unchanged.
- `src/lib/payroll/payslip-publication.ts` - loads existing READY/SETTLED claim reimbursement snapshots for new publications.
- `tests/unit/payslip-pdf-v2.test.ts` - PDF semantics, safety, A4, pagination, deterministic output, and route/publication guards.
- `scripts/generate-payslip-v2-visual-fixtures.ts` - safe Local/Testing A-E evidence generator.

No Staff Pay/Payslips page, route behavior, payroll formula, Prisma schema, or migration changed.

## 24. TEST RESULTS

- Focused Payslip/Payroll tests: **16/16 PASS**.
- TypeScript `tsc --noEmit`: PASS.
- ESLint: PASS with 0 errors; 7 pre-existing unrelated warnings.
- `git diff --check`: PASS.
- Production build: PASS; all 145 static pages generated.
- A-E PDF validity: PASS through Poppler and PyPDF.
- A4 dimensions: PASS for all five samples.
- Extracted complex PDF assertions: correct final Net Pay, reimbursement present, LINDUNG24 present, internal terms absent.

## 25. FULL UNIT RESULT

`npm test`: **1,407 passed / 0 failed**.

## 26. INTEGRATION RESULT

- Fresh disposable PostgreSQL: all **213 migrations** applied from zero.
- Broad repository integration: **190 passed / 3 failed**. The failures are pre-existing/date-sensitive: AI commercial quota and two recurring-pay tests now rejecting backdated August writes on 2 September. None touches the changed PDF/export/publication files. These were not weakened or modified.
- Direct task-relevant PostgreSQL gate: **13 passed / 0 failed** across Staff Pay ownership, P4D immutable publication, Claims reimbursement, Expense/Payroll bridge, and Commission.
- P4D publication test confirms immutable bytes and own-only self-service access.

## 27. NO BUSINESS LOGIC CHANGE

**NO PAYROLL BUSINESS LOGIC CHANGE.** Gross, Net, statutory, EPF, SOCSO, EIS, PCB, CP38, LINDUNG24, Commission, Claims, Attendance, OT, finalization, and publication ownership calculations/workflows were not changed.

## 28. NO MIGRATION

**NO PRISMA SCHEMA CHANGE. NO NEW MIGRATION.** `git diff --name-only -- prisma` returned empty.

## 29. BEFORE / AFTER VISUAL EVIDENCE

Before: plain single-font line list with weak hierarchy and raw low-value metadata.

After: A4 corporate header, high-priority pay summary, two-column identity information, compact Attendance, structured Earnings/Deductions/Employer Contributions/Reimbursements tables, and a strong final Net Pay bar.

Generated safe evidence:

- A - Basic salary only: 1 page.
- B - EPF + SOCSO + EIS + PCB: 1 page.
- C - Commission + OT: 1 page.
- D - reimbursement with Gross unchanged and Net increased: 1 page.
- E - long complex case: 2 pages.

Rendered previews were inspected at:

- `C:\CodexTetamuP0-first-prod-release\tmp\pdfs\rendered\final-1.png`
- `C:\CodexTetamuP0-first-prod-release\tmp\pdfs\rendered\final-2.png`
- `C:\CodexTetamuP0-first-prod-release\tmp\pdfs\rendered\final-top-summary.png`
- `C:\CodexTetamuP0-first-prod-release\tmp\pdfs\rendered\final-deductions.png`
- `C:\CodexTetamuP0-first-prod-release\tmp\pdfs\rendered\final-net-pay.png`

Final review PDF:
`C:\CodexTetamuP0-first-prod-release\output\pdf\tetamu-payslip-v2-malaysia-complex-sample.pdf`

Sample SHA-256: `D34295A2220162891FE24D07D4656C5194DD8E5576A7F06F163EB77F6F48D59D`.

This is an equivalent professional hierarchy, not a pixel-perfect copy of the supplied phone reference.

## 30. NEW RELEASE SHA

`2fe99bece9c97bd947e2cadffb2659e6e53c91b3`

Branch: `release/staff-v2-payslip-pdf-20260902`

The prior frozen SHA `ab432c36435fe1eae446bc8ca0f517468b0db694` is no longer the current Staff Testing candidate.

## 31. NEW SOURCE DIGEST

`6cbbefa4b6c15f689e5266af8b18beaed4fcc7324eacd08e39713fa9060db2d8`

This differs from the prior digest `5af339b9bc84d71b1a97faf26356c64e7a34eba272713b4aff1a9e3b422abdcc` as required.

## 32. RAILWAY TESTING DEPLOYMENT

- Project: Tetamu-POS.
- Environment: `testing`.
- Service: `tetamu-staff-app`.
- Deployment: `173165e0-1a2c-4b98-8e04-6bd02caf75be` - SUCCESS.
- Image digest: `sha256:a663266b52694df5ae86eeebe4495f5c494129598f658dfda07ceab82f6e3e73`.
- Region: Southeast Asia (`asia-southeast1-eqsg3a`).
- `/api/health`: HTTP 200, `ok=true`, `database=ready`, `environment=testing`, exact SHA/digest/deployment ID.
- Runtime startup: release environment contract valid; Next ready in 210 ms.
- `/staff/pay`: HTTP 200 login shell when unauthenticated; private no-store cache policy.
- Historical published PDFs were not regenerated. Owner should review the supplied new V2 sample now; the deployed template will be used by the next newly published Testing payslip.

## 33. PRODUCTION STATUS

**TESTING ONLY**

**PRODUCTION NOT ACCESSED**

**PRODUCTION NOT MODIFIED**

**NO PRODUCTION DEPLOYMENT**

Implementation stops here pending owner review.
