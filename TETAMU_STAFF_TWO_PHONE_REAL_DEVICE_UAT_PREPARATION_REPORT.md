# TETAMU STAFF TWO-PHONE REAL DEVICE UAT PREPARATION REPORT

Prepared on: 29 August 2026  
Canonical workspace: `C:\CodexTetamuP0`  
Environment: Railway `testing` only

## 1. FINAL VERDICT

**REVIEW REQUIRED**

The two-phone physical UAT environment is operational and may be used for the owner-led Staff workflows described below. Staff 3000 is deployed on the Testing HTTPS URL, the two personas share the same Business and Branch, permissions are capability-based, and the required Attendance, Leave, Claims, OT and Appointment fixtures are ready.

Two limitations prevent a clean final sign-off:

1. Testing Prisma migration history differs from the current workspace. No migration was applied because this preparation explicitly prohibits schema/migration changes.
2. The iPhone employee has no canonical published Payslip or Commission statement in Royal Salon. These views must be recorded as **NOT AVAILABLE**; no payroll evidence was fabricated.

Production was not accessed or modified.

## 2. TESTING URL

**https://tetamu-staff-app-testing.up.railway.app/staff**

- HTTPS resolves successfully.
- Railway service: `tetamu-staff-app`
- Active environment: `testing`
- Active deployment: `aad0ca3d-bf80-47c2-8f4b-6902b437c7ad`
- Deployment message: `Canonical Staff 3000 two-phone real-device UAT`
- Runtime listens on port **3000**.
- Public domain target port is **3000**.
- `/api/health`, `/staff`, and `/staff/login` return HTTP 200.
- Staff manifest uses `id`, `start_url`, and `scope` `/staff`.
- `/sw.js` returns HTTP 200.

## 3. IPHONE EMPLOYEE

| Item | Prepared state |
|---|---|
| Phone | `01112212259` / canonical `+601112212259` |
| Employee | Real Device UAT Employee |
| Business | Royal Salon |
| Branch | salon online |
| Branch timezone | Asia/Kuala_Lumpur (existing canonical Branch setting; not overwritten) |
| Persona | Normal Staff |
| Capabilities | No manager/approval permissions |
| Approval Center | Denied/hidden by capability resolver |
| OTP mode | Real Testing SMS through SMS123; no OTP was sent during preparation |
| Physical device | Existing active iPhone / Safari record; `canView=true`, `canPunch=true` |
| Schedule | Mobile UAT Shift, 29 Aug–2 Sep 2026, 08:00–23:00, 30-minute break |
| Attendance evidence | Published roster plus expected Attendance evidence for today |
| Leave | 3 units available; Annual, Medical and Unpaid policies available |
| Claims | General, Meals, Mileage and Travel categories available |
| Attendance correction | Prior-date incomplete Attendance on 24 Aug 2026; employee submits the request live |
| Pay | No canonical pay summary fixture prepared |
| Payslip | No published Royal Salon payslip; **NOT AVAILABLE** |
| Commission | No published statement; **NOT AVAILABLE** |
| Appointments | SALON enabled; 2 appointments visible today and assigned exactly to this employee |
| Appointment privacy | Projection checked; no unnecessary phone or private notes exposed |

## 4. ANDROID MANAGER

| Item | Prepared state |
|---|---|
| Phone | `0128793848` / canonical `+60128793848` |
| Employee | Real Device UAT Manager |
| Business for this UAT | Royal Salon |
| Branch for this UAT | salon online |
| Persona | Branch-limited Manager / Approver |
| OTP mode | Real Testing SMS through SMS123; no OTP was sent during preparation |
| Physical device | Existing active Android / Chrome record; `canView=true`, `canPunch=true` |
| `APPROVE_LEAVE` | Granted |
| `REVIEW_CLAIM` | Granted |
| `ATTENDANCE_EMPLOYEE_READ` | Granted |
| `ATTENDANCE_EMPLOYEE_MANAGE` | Granted; current canonical Attendance/OT review capability |
| `ROSTER_VIEW` | Granted |
| `ALL_BRANCHES` | Not granted |
| Self-review | Canonical self-review exclusion verified |

This phone also has a separate historical membership in **Payroll UAT Business**. For this two-phone flow the owner must select **Royal Salon** after login. That separate fixture was left untouched.

## 5. LEAVE E2E READY

**READY**

- The iPhone employee has 3 available units and active policies.
- There is no pre-created pending Leave request for this run.
- The iPhone submits the request live.
- The Android manager can review it using `APPROVE_LEAVE` within the same Business/Branch scope.
- The employee and manager are different memberships; self-review remains impossible.

## 6. CLAIM E2E READY

**READY**

- Four active categories are available, including General reimbursement and Mileage.
- The iPhone can attach a real phone photo/file and submit live.
- The Android manager can review using `REVIEW_CLAIM`.
- Approval remains separate from reimbursement/payment; the Claim must not become Paid automatically.

## 7. ATTENDANCE CORRECTION E2E READY

**READY**

- Dedicated source Attendance date: 24 Aug 2026.
- No pending request was pre-created.
- Expected count transition after iPhone submission: `0 → 1`.
- Approval Center count and Attendance child queue use the same canonical task.
- The Android manager has branch-scoped Attendance read/manage capabilities.

## 8. OT UAT READY

**READY**

- Three separate canonical Attendance-derived OT candidates were prepared for 20, 21 and 22 Aug 2026.
- They can be used for full approval, adjusted minutes and rejection with reason.
- These are not employee-submitted OT requests.
- The Android manager can review OT through the existing `ATTENDANCE_EMPLOYEE_MANAGE` capability.
- Manager self-review items are excluded.

## 9. PAY/PAYSLIP READY

**NOT AVAILABLE for this Royal Salon employee**

- Published payslips: 0.
- Commission statements: 0.
- No bank payment, payroll processing, statutory submission, fake payslip or fake commission statement was created.
- The owner may still open the Pay, Payslip and Commission views and record the result as **NOT AVAILABLE**.

## 10. DEVICE AUTH STATUS

- iPhone has an active real Safari device and active Testing session.
- Android has an active real Chrome device and active Testing session.
- No fake device was pre-bound.
- No active physical device was revoked during preparation.
- A fresh proper login can establish/refresh the canonical device/session normally.
- Clock actions remain subject to the real device authorization and HTTPS/GPS rules; no authorization checks were disabled.

## 11. TEST DATA CREATED OR UPDATED

- Normal Staff display identity for `01112212259`.
- Branch-limited manager Staff User and role profile for `0128793848`.
- Exact manager capability set listed above.
- Mobile UAT Shift and five scheduled days from 29 Aug to 2 Sep 2026.
- Current expected Attendance evidence.
- Prior-date correction source on 24 Aug 2026.
- Three Attendance-derived OT candidates.
- Two employee-scoped appointments for 29 Aug 2026.

All fixture work was Testing-only, guarded, idempotent and performed without a new migration.

## 12. TEST DATA REUSED

- Existing Royal Salon Business.
- Existing salon online Branch.
- Existing employee accounts and memberships for both phone numbers.
- Existing physical device/session records.
- Existing Leave policies, Leave ledger balance and Claim categories.
- Existing canonical capability names and approval services.
- Existing SMS123 Testing configuration.

No duplicate Business or duplicate Employee Account was created.

## 13. TEST RESULTS

| Validation | Result |
|---|---|
| Staff/auth focused unit tests | PASS — 79/79 |
| Attendance/auth/workflow/payroll/tenant integration tests | PASS — 13/13 |
| TypeScript `tsc --noEmit` | PASS |
| Local Next production build | PASS — 144 static/dynamic route entries generated |
| Railway Testing production-mode build | PASS |
| Prisma schema validate | PASS |
| Testing runtime smoke | PASS |
| Staff HTTPS login | PASS — HTTP 200 |
| Staff PWA manifest | PASS — `/staff` scope/start URL |
| Staff service worker | PASS — HTTP 200 |
| Local Staff 3000 | PASS — HTTPS 200 |
| Local port 3100 | PASS — not listening |
| Employee Approval Center access | PASS — denied |
| Manager branch scope | PASS — branch-limited |
| Manager Leave/Claim/Attendance/OT capability resolution | PASS |
| Manager self-review exclusion | PASS |
| Appointments privacy projection | PASS |
| Production access/modification | PASS — none |

### Prisma migration review

`prisma migrate status` against Railway Testing is **not clean**:

- Local migrations not recorded in Testing:
  - `20260827153000_pcb_2026_p1_correctness_foundation`
  - `20260827170000_effective_dated_statutory_participation`
  - `20260829110000_canonical_staff_app_appearance`
- Testing migration records not present in the local migration folder:
  - `20260822010000_staff_app_appearance`
  - `20260822023000_development_concurrent_otp_challenges`
  - `20260824130000_staff_app_sms123_otp`

The deployed app and prepared fixtures are currently operational, but this history drift must be reconciled through a separate reviewed migration task. This preparation did not apply, delete, rename or repair any migration.

## 14. 3100 STATUS

**REFERENCE ONLY / READY TO RETIRE**

- Local port 3100 is not listening.
- Railway Testing Staff runtime and public domain now use port 3000.
- 3100 was not started, developed or reintroduced.

## 15. PRODUCTION STATUS

**LOCAL / TESTING ONLY**  
**PRODUCTION NOT ACCESSED**  
**PRODUCTION NOT MODIFIED**

No Production credentials, customer/member data, deployment or database were used.

