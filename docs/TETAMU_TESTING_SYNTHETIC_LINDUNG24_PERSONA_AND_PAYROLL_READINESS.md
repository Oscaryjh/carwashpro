# TETAMU Testing Synthetic LINDUNG 24 Persona and Payroll Readiness

## 1. Executive Summary

The non-production statutory fixture facility was deployed to Railway **Testing**. One canonical `SYNTHETIC_TESTING` LINDUNG 24 participation version was created for `UAT-PAYROLL-001`, the existing August 2026 Draft Payroll Run was refreshed in place, and canonical Payroll readiness now reports `canProceed: true`.

No Payroll submission, finalization, Payslip publication, payment, OTP, official statutory export, or official statutory submission occurred.

Final verdict: **READY FOR PAYROLL FINALIZATION STEP** (the next workflow action is Submit for Review; this report does not perform it).

## 2. Testing Boundary

- Railway project: `Tetamu-POS`
- Railway environment: `testing`
- Testing Web: `https://tetamu-pos-web-testing.up.railway.app`
- Testing Staff App: `https://tetamu-staff-app-testing.up.railway.app`
- Target database: Railway Testing PostgreSQL only
- Target Business: `Payroll UAT Business` (`b87aaa12-b41d-44b5-908e-72d04e6a08a0`)
- Target Membership: `091ba7be-ced0-418b-8cf9-526921f10866`
- Production touched: **NO**

The execution guard required `RAILWAY_ENVIRONMENT_NAME=testing`, `RAILWAY_SERVICE_NAME=tetamu-pos-web`, and an approved Railway Testing database hostname before any write.

## 3. Deployment

- Service deployed: `tetamu-pos-web`
- Deployment ID: `8995f633-9cfa-4fa8-a934-59dcede97c1d`
- Release commit: `ae81b36da09f6d3dbda1442a7684c909b408d4dd`
- Deployment result: **SUCCESS**
- Build result: Next.js build and TypeScript checks passed; 142 pages were generated.

The standalone Staff App was inspected. Its login returned HTTP 200. It does not perform the canonical statutory write/readiness workflow and no Payslip was published in this task, so no Staff App redeployment was required.

## 4. Migration

- Migration: `20260826173000_non_production_statutory_fixture_evidence_facility`
- Applied through canonical pre-deploy command: `npx prisma migrate deploy`
- Testing migrations found: 209
- Post-deployment `prisma migrate status`: **Database schema is up to date**

Before migration, a Testing-only PostgreSQL custom-format recovery dump was created and validated:

- Backup: `C:\Users\oscar\AppData\Local\Temp\tetamu-testing-recovery\pre-stat-fixture-20260826-225157.dump`
- Size: 3,192,948 bytes
- SHA-256: `0D469F6E1D0D7114C2EA3D17ED5F201166A23DCEFC90C8E3265FBE8CA2771FE6`
- Restore catalog entries: 3,085

The temporary public database proxy was removed after verification.

## 5. Health Checks

- Testing Web `/api/health`: HTTP 200
- Health `ok`: `true`
- Database: `ready`
- Reported environment: `testing`
- Reported deployment: `8995f633-9cfa-4fa8-a934-59dcede97c1d`
- Testing Staff App `/staff/login`: HTTP 200

## 6. Production Guard

Result: **PASS**.

The production guard rejects `SYNTHETIC_TESTING` evidence before database access with `SYNTHETIC_STATUTORY_EVIDENCE_FORBIDDEN_IN_PRODUCTION`. The Production Payslip renderer also denied the synthetic document using the same production-only boundary. These contracts were verified by unit tests and a renderer negative precheck.

## 7. Export Guard

Result: **PASS**.

`assertPayrollRunOfficialStatutoryExportEligible()` denied the refreshed run with:

`SYNTHETIC_STATUTORY_EVIDENCE_NOT_EXPORTABLE`

The same central guard is used by official statutory export and submission actions.

## 8. Employee

- Name: `Real Device Payroll UAT Staff`
- Employee ID: `UAT-PAYROLL-001`
- Membership ID: `091ba7be-ced0-418b-8cf9-526921f10866`
- Membership status: `ACTIVE`
- Business: `Payroll UAT Business`
- Branch: `Payroll UAT Branch`

No existing employee, branch, compensation, Attendance, or Timesheet facts were changed.

## 9. Synthetic Persona

- Participation Version ID: `98b3e179-5e09-400e-a0ef-35f2abb9e8b3`
- Revision: 1
- Effective month: August 2026
- Evidence nature: `SYNTHETIC_TESTING`
- Evidence environment: `TESTING`
- Fixture purpose: `PAYROLL_PAYSLIP_UAT`
- Nationality snapshot: `MALAYSIAN`
- Act 4 covered: `true`
- Status: `VOLUNTARY_OPT_OUT`
- Employer context: `SINGLE_EMPLOYER`
- Selected employer: `CURRENT_BUSINESS`

## 10. Evidence Provenance

- Official export eligible: `false`
- Official reference: `null`
- Official submitted timestamp: `null`
- Source type: `null`
- Source reference: `null`
- Source digest: `4548ca4595c41c5b1d8387b7f571d84b12288dcdadec330ddddc7b6a09255b7b`

No official evidence, reference, timestamp, or approval was fabricated.

## 11. Canonical Write

The version was created through `recordEmployeeLindung24Participation()` using a `BUSINESS_OWNER` actor named `Payroll UAT Owner`, whole-business active branch scope, and explicit Testing environment input.

No direct Prisma create, raw SQL, schema push, or manual readiness override was used for the persona.

## 12. Audit

- Audit action: `STATUTORY_TEST_FIXTURE_CREATED`
- Entity type: `EmployeeLindung24ParticipationVersion`
- Entity ID: `98b3e179-5e09-400e-a0ef-35f2abb9e8b3`
- Matching audit rows: 1
- Actor role: `BUSINESS_OWNER`

## 13. Resolver

`resolveLindung24ParticipationForPeriod()` result:

- Status: `NO_CONTRIBUTION`
- Reason: `OFFICIAL_LOCAL_EMPLOYEE_OPT_OUT`
- Participation Version ID: `98b3e179-5e09-400e-a0ef-35f2abb9e8b3`

## 14. Participation Result

The employee is treated as a local Testing persona who is covered by Act 4 but has a synthetic Testing-only voluntary opt-out for August 2026. The result is no LINDUNG 24 employee or employer contribution for this fixture.

## 15. Draft Refresh

- Existing Payroll Run: `2972941a-8067-4076-bf3b-24ddf08b308a`
- Status before: `DRAFT`
- Status after: `DRAFT`
- Run reused: **YES**
- Draft refreshed through `generatePayrollRun()`: **YES**
- New Payroll Run created: **NO**

## 16. Locked Timesheet

- Locked Timesheet Revision ID: `44978f4c-e537-4148-8fcc-500710fa994f`
- Run snapshot revision: 1
- Payroll attendance snapshot still references the same revision: **YES**
- Timesheet still frozen: **PASS**

## 17. Payroll Population

- Payroll employee count: 1
- Target employee retained: **YES**
- Payroll Entry ID: `09a34a1a-fc19-40f6-bede-7ce2956b84eb`
- Other employees introduced: **NO**

## 18. Payroll Components

- Component count: 1
- Basic: RM 3,000.00
- Gross: RM 3,000.00
- Total deductions: RM 0.00
- Net: RM 3,000.00
- LINDUNG 24 employee contribution: RM 0.00

The existing Basic amount remained unchanged.

## 19. Synthetic Snapshot

- Snapshot ID: `78543361-4c2c-4ed0-b407-37cb636b653e`
- Scheme: `LINDUNG24`
- Status: `NOT_APPLICABLE`
- Blocker code: `null`
- Participation Version ID: `98b3e179-5e09-400e-a0ef-35f2abb9e8b3`
- Evidence nature: `SYNTHETIC_TESTING`
- Evidence environment: `TESTING`
- Fixture purpose: `PAYROLL_PAYSLIP_UAT`
- Official export eligible: `false`
- Employee contribution: RM 0.00
- Employer contribution: RM 0.00

## 20. Payroll Readiness

- Status: `REVIEW_REQUIRED`
- `canProceed`: `true`
- Employee count: 1
- Ready: 0
- Review required: 1
- Blocked: 0
- Blocking issues: none

`REVIEW_REQUIRED` is caused by warnings, not a calculation blocker. Canonical readiness permits the next Payroll workflow step.

## 21. LINDUNG 24 Result

- Previous blocker: `LINDUNG24_APPLICABILITY_INCOMPLETE`
- Blocker remaining: **NO**
- Resolver contribution requirement: none
- Payroll contribution: RM 0.00
- Snapshot provenance frozen: **YES**

## 22. Other Statutory Issues

One warning remains:

- `STATUTORY_PROFILE_INCOMPLETE` — statutory or tax profile is incomplete.

This warning does not make `canProceed` false for this controlled Testing Draft. It may still limit official statutory submission, which is separately prohibited by the synthetic evidence guard.

## 23. Bank Warning

One warning remains:

- `MISSING_BANK_ACCOUNT` — no active primary bank account is configured.

This is a payment-readiness warning, not a Payroll calculation/finalization blocker. No payment or bank export was attempted.

## 24. Export Negative Test

- Official export result: **DENIED**
- Error: `SYNTHETIC_STATUTORY_EVIDENCE_NOT_EXPORTABLE`
- Export artifacts before: 0
- Export artifacts after: 0

## 25. Submission Negative Test

- Official submission result: **DENIED**
- Central eligibility guard: **PASS**
- Submission rows before: 0
- Submission rows after: 0
- Payroll submitted: **NO**

## 26. Payslip Renderer Precheck

- Testing renderer: **SUPPORTED**
- Testing marker present: `TESTING / NON-PRODUCTION STATUTORY FIXTURE`
- Production renderer: **DENIED**
- Payslip publication rows before: 0
- Payslip publication rows after: 0
- Payslip published: **NO**

## 27. Tenant Isolation

- Participation is bound to the target Business and Membership composite identity.
- Cross-Business lookup for the created Participation Version ID returned 0.
- Database composite foreign-key and overlap integration tests passed.
- Result: **PASS**

## 28. Duplicate Audit

- Current matching synthetic persona count: 1
- Matching creation audit count: 1
- Duplicate participation created: **NO**
- Result: **PASS**

## 29. Regression

- Full unit suite: **1,138 / 1,138 passed**
- Targeted statutory/readiness unit suite: **29 / 29 passed**
- LINDUNG 24 closure integration suite against Testing DB: **7 / 7 passed**
- TypeScript: **PASS**
- ESLint for controlled script: **PASS**
- `git diff --check`: **PASS**
- Prisma schema: **up to date**

The integration suite validated canonical writes, audit, supersession, overlap protection, immutable participation facts, tenant foreign keys, immutable refund events, and frozen Payroll snapshots.

## 30. Production Safety

- Production deployment: **NO**
- Production database access: **NO**
- Official statutory export: **NO**
- Official statutory submission: **NO**
- Payroll submission: **NO**
- Payroll finalization: **NO**
- Payslip publication: **NO**
- Payment: **NO**
- Bank export: **NO**
- OTP: **NO**

## 31. Final Verdict

**READY FOR PAYROLL FINALIZATION STEP**

Canonical Payroll readiness reports `canProceed: true`. The LINDUNG 24 applicability blocker is removed. Remaining bank and statutory-profile findings are warnings and do not block the next controlled Payroll workflow step.

## 32. Exact Next Step

In a separate authorized task, execute only the canonical Testing workflow:

`Submit for Review → required segregation-of-duties/owner authorization → Finalize → Publish Testing Payslip → third-phone UAT`

Do not attempt official statutory export/submission for this run. Its synthetic statutory snapshot is intentionally and permanently non-exportable.
