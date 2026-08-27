# TETAMU Real Device UAT — Published Payslip Preparation

## 1. Scope

This report records the Testing-only attempt to prepare one real published payslip for `Twilio OTP QA Staff` (`TWILIO-OTP-QA`) through the existing canonical workflow:

`Historical attendance → Monthly Timesheet → Lock → Payroll Run → Finalize → Publish Payslip → Staff projection`

The task reached a genuine fixture blocker before any mutation was permitted. No payroll fixture, finalized payroll, payslip publication, payment, statutory submission, bank export, deployment, or Production operation was performed.

## 2. Testing Environment

- Environment: **TESTING**
- Desktop: `https://tetamu-pos-web-testing.up.railway.app`
- Staff App: `https://tetamu-staff-app-testing.up.railway.app`
- Railway project: `Tetamu-POS`
- Railway environment: `testing`
- Testing services observed online: `tetamu-pos-web`, `tetamu-staff-app`, and Testing PostgreSQL
- Production touched: **NO**

The Testing boundary was confirmed before inspecting employee state. Local `localhost` URLs were not treated as the real-device Testing environment.

## 3. Employee

- Name: `Twilio OTP QA Staff`
- Employee ID: `TWILIO-OTP-QA`
- Phone: `+601112212259`
- Business: `Royal Salon`
- Expected branch: `salon online`
- Employee account ID: `d7f69dcc-fb85-41a7-a989-59c2f21ac984`
- Business membership ID: `8a32ee4a-bdef-451e-8a0d-09fc082190dc`
- Staff user ID: `93e0fc78-6282-4fdf-936e-87ef4ddeba2a`

Current Testing Desktop employee state observed during this task:

- Employment status: **Terminated**
- Joined date: **12 Aug 2026**
- Termination date / assignment end: **24 Aug 2026**
- Active branch assignments: **0**
- Primary branch: **none active**
- Attendance access: **disabled**

The audit activity displayed on the employee profile records that Attendance was disabled, employment was changed to `TERMINATED`, the branch assignment was ended, and the primary branch was cleared on 24 Aug 2026.

## 4. Payroll Period

No compliant payroll period could be selected.

| Candidate | Result | Reason |
| --- | --- | --- |
| July 2026 | Invalid | The employee joined on 12 Aug 2026, so July is outside valid employment. |
| August 2026 | Not permitted | It contains the current 26 Aug Real Device Attendance record that the task explicitly prohibits using as the payroll foundation. The employee was also terminated and unassigned on 24 Aug. |
| Earlier historical month | Invalid | Earlier months predate employment. |

- Payroll period: **NONE**
- Start: **N/A**
- End: **N/A**
- Timezone: `Asia/Singapore`
- Payroll Run ID: **NONE**

Changing the joined date, reactivating the employee, restoring the branch assignment, or enabling Attendance would be a separate material data change that this task did not authorize. The STOP condition therefore applies.

## 5. Employment / Compensation

Canonical payroll eligibility could not be established for an isolated historical period because no such valid employment period exists under the current employee record.

- Active employment in a safe historical period: **NO**
- Active branch assignment in a safe historical period: **NO**
- Payroll eligibility for a safe historical period: **NOT ESTABLISHED**
- Compensation Version ID: **NONE CREATED**
- Effective From: **N/A**
- Pay Type: **N/A**
- Basic Amount: **N/A**
- Currency: expected `MYR`, not materialized into a new payroll entry

No compensation version was created because compensation alone cannot make a pre-employment or prohibited period valid.

## 6. Attendance Fixture

No attendance fixture was created or changed.

- 26 Aug 2026 Real Device Attendance (`13:10 → 15:37`, adjusted): **READ-ONLY / UNTOUCHED**
- Approved Leave: **UNTOUCHED**
- Approved Claim: **UNTOUCHED**
- New roster or historical attendance: **NONE**

The task explicitly prohibits using or retrofitting the 26 Aug record as the payroll foundation. Creating July attendance would conflict with the employee's 12 Aug joined date.

## 7. Timesheet Readiness

- Timesheet readiness: **BLOCKED**
- Primary blocker: no isolated historical month with valid employment and branch assignment
- Secondary constraint: August contains current Real Device UAT attendance that must not be used or mutated

No business rule or readiness gate was changed or bypassed.

## 8. Timesheet Materialization

- Timesheet ID: **NONE**
- Employee: `TWILIO-OTP-QA`
- Period: **NONE**
- Revision: **NONE**
- Status: **NOT CREATED**

No direct `LOCKED` timesheet insert or database status mutation was performed.

## 9. Timesheet Lock

- Timesheet ID: **NONE**
- Revision: **NONE**
- Locked At: **N/A**
- Locked By: **N/A**
- Snapshot / digest: **N/A**
- Status: **NOT LOCKED**

The canonical `branch ready → approval → lock` workflow was inspected but not executed because the fixture cannot validly reach readiness.

## 10. Payroll Input Trace

No Payroll Entry was generated, so no frozen input trace exists for this attempt.

| Component | Source | Source ID | Value |
| --- | --- | --- | --- |
| Basic | Compensation Version | NONE | N/A |
| Attendance | Locked Timesheet | NONE | N/A |
| OT | None | NONE | RM 0.00 not materialized |
| Leave | Existing current UAT record not used | NONE | N/A |
| Claim | Existing current UAT record not used | NONE | N/A |
| Commission | None | NONE | RM 0.00 not materialized |

## 11. Payroll Readiness

- Employee readiness: **BLOCKED**
- Payroll Run readiness: **NOT RUN — no canonical Payroll Run could be created**
- Reason: no eligible locked historical timesheet for the target employee

No readiness or statutory gate was bypassed.

## 12. Reconciliation

No payroll figures were calculated or reconciled.

- Basic: **N/A**
- OT: **N/A**
- Claims: **N/A**
- Commission: **N/A**
- Other earnings: **N/A**
- Deductions: **N/A**
- Gross: **N/A**
- Net: **N/A**

No totals were manually inserted or adjusted.

## 13. Payroll Finalize

- Payroll Run ID: **NONE**
- Payroll Entry ID: **NONE**
- Revision: **NONE**
- Finalized At: **N/A**
- Finalized By: **N/A**
- Status: **NOT FINALIZED**

The canonical finalize action was not called.

## 14. Payslip Publish

- Payslip ID: **NONE**
- Payroll Entry ID: **NONE**
- Employee ID: `TWILIO-OTP-QA`
- Period: **NONE**
- Published At: **N/A**
- Published By: **N/A**
- Status: **NOT PUBLISHED**

No manual publication status, direct database insert, or fake PDF was created.

## 15. Staff App Projection

No new payslip is available for projection.

- Expected current Staff App state: `Payslips → No published payslips yet`
- Published payslip count prepared in this task: **0**
- Staff App can see the requested payslip: **NO**

This is consistent with the initial Testing data and no mutation was performed during this task.

## 16. Payslip Ownership

Ownership validation could not run because no publication exists.

- Own published payslip access: **NOT RUN**
- Cross-employee access denial: **NOT RUN**

The existing automated P4D regression verifies that self-service payslip queries bind publication, business, and membership. This is code-level evidence only; it is not a substitute for a target Testing publication.

## 17. Document Validation

- Document exists: **NO**
- Non-empty PDF: **NOT APPLICABLE**
- Belongs to `TWILIO-OTP-QA`: **NOT APPLICABLE**
- Matches finalized payroll: **NOT APPLICABLE**

No fake document was generated.

## 18. Immutability

No target publication was available for a live immutability comparison.

Relevant local regression evidence completed during this task:

- `tests/unit/payroll-release.test.ts`
- `tests/unit/payroll-p4d-unified-workflow.test.ts`
- `tests/unit/payroll-runs-foundation.test.ts`
- `tests/unit/hr-payroll-product-integrity.test.ts`

Result: **33 tests passed, 0 failed**.

Covered behavior includes review-before-finalization, finalized-only payslip access, tenant/membership-bound self-service access, frozen canonical component rendering, immutable publication wiring, PDF identity/filename, and granular payslip authorization.

No Testing payroll transaction was executed by these local unit tests.

## 19. Payment Safety

- Payment executed: **NO**
- Payment batch created: **NO**
- Marked paid: **NO**
- DuitNow or other payment execution: **NO**
- Bank export: **NO**

## 20. Statutory Safety

- Statutory rule activation changed: **NO**
- EPF submission: **NO**
- SOCSO submission: **NO**
- EIS submission: **NO**
- PCB submission: **NO**
- Statutory export: **NO**
- Readiness bypass: **NO**

## 21. Production Safety

- Production accessed: **NO**
- Production database accessed: **NO**
- Production deployment: **NO**
- Testing deployment: **NO**
- Business code changed: **NO**
- Payroll architecture changed: **NO**

## 22. Human iPhone Retest

Human iPhone payslip retest is **BLOCKED** because there is no published payslip for the target employee.

No claim is made that the iPhone can view, open, or download a payslip. A human retest is required only after a legitimate canonical Testing payslip can be prepared under an authorized, isolated employment period.

## 23. Final Verdict

**BLOCKED**

The target employee has no permissible isolated historical payroll period:

1. July 2026 is before the 12 Aug 2026 joined date.
2. August 2026 contains the protected 26 Aug Real Device Attendance record and must not be used as this fixture's payroll foundation.
3. The employee was terminated, unassigned from the branch, and had Attendance disabled on 24 Aug 2026.
4. Reactivating employment, changing dates, restoring assignments, or manufacturing historical attendance was outside this task's authorization.

The workflow stopped before data mutation, exactly as required by the task's STOP condition. The existing canonical Timesheet, Payroll, Finalize, and Payslip publication architecture remains unchanged.
