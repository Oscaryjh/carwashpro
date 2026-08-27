# TETAMU HR & Payroll — Testing Real Device UAT Fixture Preparation

Prepared: 26 August 2026  
Environment: **Testing only**  
Verdict: **CONDITIONAL READY**

## 1. Environment boundary

| Item | Result | Evidence |
| --- | --- | --- |
| Railway environment | PASS | Both services report `testing` |
| Testing Staff App | PASS | `https://tetamu-staff-app-testing.up.railway.app/staff/login` returned HTTP 200 |
| Testing Desktop | PASS | `https://tetamu-pos-web-testing.up.railway.app/login` returned HTTP 200 |
| Shared Testing database | PASS | Staff and Desktop resolve to the same Testing PostgreSQL service |
| Production isolation | PASS | Production is a separate Railway environment and database; it was not accessed or changed |

No OTP was sent. No real clock event, request, approval, payment, bank export, statutory submission, Testing deployment, or Production deployment was performed.

## 2. Accounts

### Employee

| Field | Value |
| --- | --- |
| Name | Twilio OTP QA Staff |
| Phone | `+601112212259` |
| Employee ID | `TWILIO-OTP-QA` |
| Account ID | `d7f69dcc-fb85-41a7-a989-59c2f21ac984` |
| Membership ID | `8a32ee4a-bdef-451e-8a0d-09fc082190dc` |
| Staff user ID | `93e0fc78-6282-4fdf-936e-87ef4ddeba2a` |
| Business | Royal Salon |
| Branch | salon online |
| Status | ACTIVE |
| OTP | Real SMS OTP through SMS123 Testing; no fixed or mock code |

The previously terminated duplicate test record was retained for history and its employee code was changed to `ARCHIVED-TWILIO-OTP-QA`. The active membership above now owns the canonical `TWILIO-OTP-QA` code.

### Manager / Supervisor

| Field | Value |
| --- | --- |
| Name | Real Device UAT Manager |
| Phone | `+601151300932` |
| Employee ID | `EMP-005` |
| Account ID | `f0db56e5-79a8-4521-b1c5-12cc25c3863c` |
| Membership ID | `3ed1909b-f624-49cb-9457-efecec9e776a` |
| Staff user ID | `5840c06f-fd53-4d8f-8983-e70d0011f876` |
| Role profile | Real Device UAT Manager (`4fca6a13-b3e5-4cdb-9c92-e7549f2d2c0c`) |
| Business | Royal Salon |
| Branch scope | salon online only |
| Status | ACTIVE |
| OTP | Real SMS OTP through SMS123 Testing |

Canonical permissions are limited to:

- `APPROVE_LEAVE`
- `REVIEW_CLAIM`
- `ATTENDANCE_EMPLOYEE_READ`
- `ATTENDANCE_EMPLOYEE_MANAGE`
- `ROSTER_VIEW`

The Manager and Employee use different memberships and Staff users, so the Manager is not approving their own request. The Manager has no `ALL_BRANCHES` or Platform Admin permission.

### HR Desktop

| Field | Value |
| --- | --- |
| Name | Real Device UAT HR |
| Login | `real-device-uat.hr@tetamu.local` |
| User ID | `83769a69-cb6a-4cab-a722-79acaf17ebc9` |
| Role | STAFF with Real Device UAT HR role profile |
| Role profile ID | `3b733e55-a102-4e02-a43f-4943c9eb7731` |
| Business | Royal Salon |
| Authentication | Email + password |
| Credential location | `.tmp/REAL_DEVICE_UAT_CREDENTIALS.txt` (gitignored, untracked) |

The password is intentionally excluded from this tracked report. HR permissions cover Attendance read/manage, Roster view, Leave/Claims review, Timesheet visibility through Attendance scope, Payroll run creation/edit/review/approval, and Payslip read/publish. The account is not Platform Admin.

## 3. Business and branch relationship

| Entity | ID |
| --- | --- |
| Royal Salon | `611b0c19-ebf7-4548-8a48-a3b6a7af8a81` |
| salon online | `41575966-238f-46ab-a114-22bbee4949c5` |

- Employee → Manager approval scope: **PASS**
- Manager → salon online branch scope: **PASS**
- HR → Royal Salon visibility: **PASS**
- Manager self-approval protection: **PASS** because Manager and Employee identities are distinct
- Other business access: **DENY** by the user business binding
- Other branch access: **DENY where applicable** because the Manager is branch-scoped and lacks `ALL_BRANCHES`

## 4. Roster fixture

| Field | Value |
| --- | --- |
| Shift name | Real Device UAT Shift |
| Shift template ID | `ed9d9a44-1dd7-4a72-9f84-7c9758c5b8ef` |
| Roster period ID | `d27b4a99-c996-4259-8938-4a5689b79a90` |
| Assignment ID | `ebe766b9-9930-4376-9c1d-5fddae8ffb52` |
| Publication ID | `53782556-1147-4a29-9207-6d20755fd281` |
| Week | 24–30 August 2026 |
| UAT work date | 26 August 2026 |
| Shift | 09:00–18:00, 60-minute unpaid break |
| Timezone | `Asia/Kuala_Lumpur` (branch canonical timezone) |
| Publication revision | 1 (published) |

The roster was created and published through the canonical Roster service. No clock-in/out was created.

## 5. GPS prerequisites

The branch Attendance setting is enabled and contains coordinates, a 100-metre radius, accuracy settings, and a canonical timezone. `requireGeofence` is currently `false`, so geofence containment is not a hard login/clock gate for this fixture. The real device must still grant the browser location permission when testing GPS capture.

## 6. Leave readiness

The company-policy Leave starters are active. The Employee has 2026 entitlement records and a canonical audited `MANUAL_ADJUSTMENT` of **5 days** for Annual Leave, created only for Testing Real Device UAT.

| Evidence | ID / value |
| --- | --- |
| Annual Leave entitlement | `6fcca72b-7776-412e-9bba-ac719e833b8b` |
| UAT balance ledger entry | `b51ed16b-744d-4189-a77b-96386e2a3d5f` |
| UAT balance | +5 days |
| Approval permission | Manager has `APPROVE_LEAVE` |

No Leave request was submitted or approved during preparation.

## 7. Claims readiness

Four Testing categories are installed. For Real Device UAT, use Meals, Mileage, or Travel because their latest policy revisions are `VERIFIED_NON_WAGE`.

| Category | Category ID | Policy revision | Treatment |
| --- | --- | --- | --- |
| General | `ab94dad9-93ac-4a1a-8515-fac82c55b7db` | `807fd85c-1198-402c-8178-b341f21fef1a` | REVIEW_REQUIRED |
| Meals | `061594bb-2d61-4775-83f2-ce3ef6acc71d` | `5d2182d0-fe4b-4b6b-9ee5-d1cea73d366a` | VERIFIED_NON_WAGE |
| Mileage | `8362f9fc-a713-49b9-87b3-ae127d16874e` | `c64cf903-74cf-40a0-a803-d99a72ea9b26` | VERIFIED_NON_WAGE |
| Travel | `03273013-25f1-4123-b200-852723a8e7fa` | `98b9d0be-bacb-48ff-9027-66dcd784b870` | VERIFIED_NON_WAGE |

The Employee can submit a claim and receipt through Staff App. The Manager has `REVIEW_CLAIM`. No claim or reimbursement was created.

## 8. Attendance Correction and OT readiness

Attendance is enabled for the Employee and branch. The Employee has a published expected shift, while the Manager has branch-scoped Attendance read/manage permissions. This provides the prerequisites for Missing Punch / Attendance Correction review without inserting a pre-approved resolution.

OT is derived from the latest canonical Final Attendance Result. For the 09:00–18:00 shift, clocking out after 18:00 creates potential normal-day OT equal to the verified time beyond 18:00. For an obvious UAT result, clock out at least 30 minutes after 18:00; the Manager then reviews the generated candidate. No OT request or approval was pre-created.

## 9. Published Payslip fixture

Status: **PAYSLIP_FIXTURE_BLOCKED**

The Employee currently has no `PayrollPayslipPublication`. The Testing business also has no locked Attendance Monthly Timesheet available for a safe canonical Payroll run. Creating a fake PDF, direct database publication, or bypassing Payroll readiness was explicitly prohibited, so no Payslip was manufactured.

The blocker must be closed through the real sequence after device Attendance UAT:

1. Complete and resolve the Testing attendance period.
2. Review and lock the monthly Timesheet.
3. Create an isolated Testing Payroll Draft.
4. Finalize using the canonical Payroll workflow.
5. Publish the Employee Payslip.

No payment, bank export, or statutory submission is required or permitted.

Because no Published Payslip exists, positive ownership testing cannot yet be executed. Existing authorization was not changed.

## 10. Permissions summary

### Manager

Branch-only HR approval permissions for Leave, Claims, Attendance Correction, and Attendance-derived OT. No platform administration, cross-business, or all-branch permission.

### HR

Royal Salon HR/Payroll permissions for Attendance, Timesheet visibility, Payroll workflow, and Payslip publishing. The account is a business STAFF user with a dedicated role profile, not Platform Admin.

## 11. Real Device UAT pre-flight matrix

| Capability | Status | Evidence / ID |
| --- | --- | --- |
| Employee Staff login | PASS | ACTIVE membership `8a32ee4a-bdef-451e-8a0d-09fc082190dc`, linked Staff user, SMS123 Testing configured |
| Manager Staff login | PASS | ACTIVE membership `3ed1909b-f624-49cb-9457-efecec9e776a`, linked Staff user, SMS123 Testing configured |
| HR Desktop login | PASS | Active email/password user `83769a69-cb6a-4cab-a722-79acaf17ebc9`; credential is local and gitignored |
| Same Business | PASS | All three identities bind to Royal Salon |
| Branch approval scope | PASS | Employee and Manager are active in salon online; Manager is branch-scoped |
| Roster | PASS | Published roster period `d27b4a99-c996-4259-8938-4a5689b79a90` |
| GPS prerequisites | PASS | Attendance setting enabled; location/radius/timezone configured |
| Leave | PASS | 2026 entitlement plus audited +5-day UAT balance |
| Claims | PASS | Three usable verified non-wage categories; Manager has review permission |
| Attendance Correction | PASS | Published expected shift and Manager Attendance manage scope |
| OT | PASS | Published expected shift and canonical Manager Attendance/OT review scope |
| Published Payslip | BLOCKED | No locked Timesheet and no `PayrollPayslipPublication` |
| Payslip ownership | BLOCKED | Cannot positively verify without a Published Payslip |

## 12. Repeatability

The minimal idempotent Testing fixture is implemented at:

`scripts/prepare-testing-real-device-uat.ts`

It has hard guards for the Railway `testing` environment, the Testing Desktop service, and the approved Testing database host. It does not send OTP, create payments, submit statutory data, or publish a fake Payslip.

## 13. Known blockers and final verdict

### Blockers

1. `PAYSLIP_FIXTURE_BLOCKED`: no locked Attendance Monthly Timesheet exists for a safe canonical Payroll → Finalize → Publish flow.
2. Payslip ownership UAT remains blocked until a real Testing Published Payslip exists.

### Final verdict

**TETAMU HR & Payroll — REAL DEVICE UAT FIXTURE PREPARATION: CONDITIONAL READY**

Employee, Manager, HR, scope, Roster, GPS, Leave, Claims, Attendance Correction, and OT are ready. Pay/Payslip device testing must wait until the canonical Timesheet and Payroll workflow produces a real Testing Published Payslip.
