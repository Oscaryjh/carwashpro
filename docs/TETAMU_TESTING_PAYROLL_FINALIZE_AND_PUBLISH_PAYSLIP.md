# TETAMU Testing Payroll Finalize and Publish Payslip

Prepared: 26 August 2026  
Environment: **Railway Testing only**  
Final verdict: **PUBLISHED PAYSLIP READY**  
Human third-phone retest: **REQUIRED**

## 1. Executive Summary

The isolated August 2026 payroll for `UAT-PAYROLL-001` was processed through the existing canonical workflow:

```text
DRAFT
→ Submit for Review
→ Business Owner separation-of-duties override
→ canonical high-risk authorization
→ FINALIZED
→ one immutable published payslip
```

The payroll amounts remained Basic RM3,000.00, Gross RM3,000.00, Deductions RM0.00 and Net RM3,000.00. No payment instruction, payment batch, bank export, statutory artifact, statutory submission, OTP or Production operation was created.

## 2. Testing Boundary

| Boundary | Result |
| --- | --- |
| Railway environment | `testing` — PASS |
| Desktop service | `tetamu-pos-web` — PASS |
| Desktop URL | `https://tetamu-pos-web-testing.up.railway.app` |
| Staff URL | `https://tetamu-staff-app-testing.up.railway.app` |
| Testing database | `Postgres-Singapore` through a temporary Railway proxy — PASS |
| Business | `Payroll UAT Business` (`b87aaa12-b41d-44b5-908e-72d04e6a08a0`) |
| Production access or mutation | **NONE** |

The execution harness fails closed unless the Railway environment, desktop service, application environment and approved Testing database hostname all match the Testing contract.

## 3. Starting Payroll State

| Field | Starting value |
| --- | --- |
| Payroll Run | `2972941a-8067-4076-bf3b-24ddf08b308a` |
| Payroll Entry | `09a34a1a-fc19-40f6-bede-7ce2956b84eb` |
| Employee | `UAT-PAYROLL-001` |
| Employee membership | `091ba7be-ced0-418b-8cf9-526921f10866` |
| Status | `DRAFT` |
| Employee count | 1 |
| Basic | RM3,000.00 |
| Gross | RM3,000.00 |
| Deductions | RM0.00 |
| Net | RM3,000.00 |
| Locked timesheet revision | `44978f4c-e537-4148-8fcc-500710fa994f` |

The starting duplicate/safety counts were one Run, one Entry and zero publications, payments, payment batches, statutory artifacts and statutory submissions.

## 4. Readiness

The canonical readiness service returned:

| Field | Result |
| --- | --- |
| Status | `REVIEW_REQUIRED` |
| `canProceed` | `true` |
| Blocking issues | 0 |
| Warning | `MISSING_BANK_ACCOUNT` |
| Warning | `STATUTORY_PROFILE_INCOMPLETE` |

The warnings did not block the canonical Review/Finalize transition. They were not modified or suppressed.

## 5. Submit for Review

`submitPayrollRunForReview()` was used. No direct Prisma status update was used.

| Field | Result |
| --- | --- |
| Transition | `DRAFT → REVIEW` |
| Submitted at | `2026-08-26T15:25:18.044Z` (`23:25:18` MYT) |
| Submitted by | `Payroll UAT Owner` |
| Submitted user ID | `74589e3d-bd90-49a9-8ecb-1d1b2ffe422c` |
| Audit action | `PAYROLL_RUN_SUBMITTED_FOR_REVIEW` |
| Audit created at | `2026-08-26T15:25:18.132Z` |

`PayrollRun` has no canonical revision column in the current schema, so no revision number is invented. The transition timestamps and AuditLog are the authoritative record.

## 6. SoD

The same `BUSINESS_OWNER` submitted and finalized the Run. The existing canonical owner-override contract was used, rather than inventing a second actor or disabling separation of duties.

Result: **PASS**.

## 7. Owner Override

| Field | Result |
| --- | --- |
| Override used | YES |
| Authorized by | `Payroll UAT Owner` |
| Reason | `Testing-only Payroll/Payslip Real Device UAT. No payment or statutory submission will be executed.` |
| Audit action | `PAYROLL_RUN_FINALIZED_WITH_OWNER_OVERRIDE` |

## 8. High-Risk Authorization

The Testing fixture owner was authenticated through the canonical password-login service and a canonical AuthSession was persisted. The existing Testing disabled-MFA path then issued and consumed an exact `PAYROLL_FINALIZE` authorization for this Run.

| Field | Result |
| --- | --- |
| Authorization | PASS |
| Mode | `MFA_TEMPORARILY_DISABLED` |
| Assurance | `MFA` |
| Authorization ID | `327c7e0e-51f8-4664-91d0-db310dbbd43e` |
| Resource | Payroll Run `2972941a-8067-4076-bf3b-24ddf08b308a` |

No secret, OTP, raw token or credential was written to source, database fixture data or this report.

## 9. Finalize

`finalizePayrollRun()` was used with the owner override and consumed high-risk authorization. No direct status or Payroll Entry update was used.

| Field | Result |
| --- | --- |
| Status | `FINALIZED` |
| Finalized at | `2026-08-26T15:25:22.336Z` (`23:25:22` MYT) |
| Finalized by | `Payroll UAT Owner` |
| Audit created at | `2026-08-26T15:25:22.489Z` |

## 10. Finalized Payroll

| Field | Final value |
| --- | ---: |
| Basic | RM3,000.00 |
| Gross | RM3,000.00 |
| Total deductions | RM0.00 |
| Net | RM3,000.00 |
| LINDUNG 24 employee contribution | RM0.00 |

The values match the canonical Payroll Entry and the published document source.

## 11. Immutability

Post-finalization verification confirmed:

- the Run still references timesheet revision `44978f4c-e537-4148-8fcc-500710fa994f`;
- the monthly timesheet remains `LOCKED`;
- that revision remains the current timesheet revision;
- Payroll components and totals remained unchanged;
- the synthetic statutory snapshot remained attached to the frozen Entry;
- no live Attendance data was changed for this verification.

Result: **PASS**.

## 12. Payment Safety

| Item | Count / result |
| --- | --- |
| Payment instructions | 0 |
| Payment batches | 0 |
| Marked paid | NO |
| Bank export | NO |

Finalize and payslip publication did not enter the payment workflow.

## 13. Statutory Export Deny

The official statutory export eligibility guard was run before and after Finalize. Both times it denied the Run with:

```text
SYNTHETIC_STATUTORY_EVIDENCE_NOT_EXPORTABLE
```

Official statutory export artifacts created: **0**.

## 14. Statutory Submission Deny

The canonical statutory artifact/submission path uses the same mandatory eligibility guard before an official artifact or submission record can be created. Because the frozen Entry is synthetic and `officialExportEligible=false`, an official submission cannot progress.

| Item | Result |
| --- | --- |
| Official submission | DENIED |
| Submission records | 0 |
| Official artifacts | 0 |

No EPF, SOCSO, EIS, PCB or LINDUNG 24 submission was attempted.

## 15. Payslip Publish

`publishPayrollPayslips()` was called only after the Run reached `FINALIZED`.

| Field | Result |
| --- | --- |
| Newly published | 1 |
| Already published | 0 |
| Audit action | `PAYSLIPS_PUBLISHED` |
| Audit created at | `2026-08-26T15:25:23.120Z` |

No manual publication insert, flag patch, fake PDF or hardcoded HTML was used.

## 16. Payslip Publication

| Field | Value |
| --- | --- |
| Publication ID | `34993730-8dfb-4754-a32a-9594123f11a3` |
| Payroll Entry ID | `09a34a1a-fc19-40f6-bede-7ce2956b84eb` |
| Membership ID | `091ba7be-ced0-418b-8cf9-526921f10866` |
| Business ID | `b87aaa12-b41d-44b5-908e-72d04e6a08a0` |
| Period | August 2026 |
| Published at | `2026-08-26T15:25:23.041Z` (`23:25:23` MYT) |
| Published by | `Payroll UAT Owner` |
| Status | `PUBLISHED` (immutable publication row exists) |

## 17. Testing Marker

The stored PDF contains:

```text
TESTING / NON-PRODUCTION STATUTORY FIXTURE
Fixture environment: TESTING
Fixture purpose: PAYROLL_PAYSLIP_UAT
```

Result: **PASS**.

## 18. Payslip Content

The canonical document source and stored PDF both contain the expected data:

| Content | Result |
| --- | --- |
| Business: Payroll UAT Business | PASS |
| Employee: Real Device Payroll UAT Staff | PASS |
| Employee code: UAT-PAYROLL-001 | PASS |
| Period: August 2026 | PASS |
| Basic Salary: RM3,000.00 | PASS |
| Gross pay: RM3,000.00 | PASS |
| Total deductions: RM0.00 | PASS |
| Net pay: RM3,000.00 | PASS |

The current canonical renderer displays explicit zero-value statutory lines, including `LINDUNG 24 (employee deduction): RM 0.00`. This is the existing zero-line convention and does not create a non-zero or misleading deduction.

## 19. Document Validation

| Check | Result |
| --- | --- |
| PDF exists | PASS |
| Non-empty | 2,458 bytes |
| Stored SHA-256 matches bytes | PASS |
| SHA-256 | `835ee677781f387d8bed985d5e2d41e7ed0225b8986a8254e60556883d89b29c` |
| Employee/business/period | PASS |
| Finalized amounts | PASS |
| Testing marker | PASS |

## 20. Staff App Projection

The canonical Staff App read path was invoked without OTP or a real-device session.

```text
+60128793848
→ Payroll UAT Business membership
→ Pay / Payslips
→ August 2026
→ one published payslip
```

Target projection count: **1**. Own publication read: **ALLOW**.

## 21. Multi-business Isolation

The employee phone also has a Royal Salon membership. Reading the Payroll UAT publication through that other Business and membership returned no document.

Result: **PASS**.

## 22. Ownership Security

| Server-side read | Result |
| --- | --- |
| Correct Business + own membership | ALLOW |
| Royal Salon Business + Royal Salon membership | DENY |
| Correct Business + wrong membership | DENY |

Result: **PASS**.

## 23. Duplicate Audit

| Record | Final count |
| --- | ---: |
| August Payroll Runs in isolated Business | 1 |
| Payroll Entries in Run | 1 |
| Payslip Publications | 1 |
| Canonical published documents | 1 |
| Duplicate publications | 0 |

## 24. Audit Trail

Verified actions:

- `PAYROLL_RUN_SUBMITTED_FOR_REVIEW`
- `PAYROLL_RUN_FINALIZED_WITH_OWNER_OVERRIDE`
- `PAYSLIPS_PUBLISHED`
- prior `STATUTORY_TEST_FIXTURE_CREATED` count: 1

The Finalize audit metadata includes the owner override reason, `MFA_TEMPORARILY_DISABLED` verification method and the consumed sensitive-action authorization ID.

## 25. Regression

No product business logic was changed for this execution. The added script is a fail-closed Testing-only execution and verification harness.

| Check | Result |
| --- | --- |
| Payroll authorization / synthetic fixture / payslip workflow unit tests | 19 / 19 PASS |
| Final Testing DB verification | PASS |
| Staff projection and ownership checks | PASS |
| Tenant isolation check | PASS |
| Statutory export deny check | PASS |
| TypeScript `tsc --noEmit` | PASS |
| ESLint for execution harness | PASS |

## 26. Production Safety

| Safety item | Result |
| --- | --- |
| Production database accessed | NO |
| Production deployment | NO |
| Payment executed | NO |
| Payment instruction | NO |
| Payment batch | NO |
| Bank export | NO |
| Marked paid | NO |
| Statutory export | DENIED |
| Statutory submission | DENIED |
| OTP sent | NO |

## 27. Human Third-Phone Retest

No OTP was sent and no third-phone login was performed. The published payslip is ready for the authorized human real-device test.

Exact next step:

```text
Login +60128793848
→ Select Payroll UAT Business
→ Pay
→ Payslip
→ View / Download
```

## 28. Final Verdict

```text
TETAMU TESTING PAYROLL UAT

PUBLISHED PAYSLIP READY

HUMAN THIRD-PHONE RETEST REQUIRED
```

All required canonical transitions and isolation checks passed. Synthetic statutory evidence remains non-official, payment remains untouched, statutory export/submission remains denied, and Production was not touched.
