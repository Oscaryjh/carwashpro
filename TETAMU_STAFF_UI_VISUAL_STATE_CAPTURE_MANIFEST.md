# TETAMU STAFF UI VISUAL STATE CAPTURE MANIFEST

> LOCAL / TESTING ONLY  
> Canonical Staff App: **3000 ONLY**  
> 3100: **REFERENCE ONLY / NOT USED**  
> Capture type: **BROWSER CAPTURE — not physical-device rendering**

## Capture baseline

- Captured: **110 PNG files** (55 at 390×844, 55 at 412×915).
- Dimensions validated: every PNG is exactly 390×844 or 412×915.
- Routes represented: **32 route/query variants**.
- Catalogued capture IDs: **56**.
- Personas: Public, Normal Staff, Manager / Approver.
- Optional Branch Manager / HR / Business Owner personas were not fabricated because the authenticated local UAT artifact did not expose separate deterministic Staff-surface fixtures for them.
- No OTP was sent, no form was submitted, no approval decision was made, and no canonical business data was intentionally changed.

## Quick review contact sheets

- [390×844 contact sheet](./artifacts/staff-ui-capture/contact-sheet/staff-ui-capture-390x844-contact-sheet.png)
- [412×915 contact sheet](./artifacts/staff-ui-capture/contact-sheet/staff-ui-capture-412x915-contact-sheet.png)

## Runtime provenance

- Most captures: current local Staff 3000 runtime on port 3000 with authenticated LOCAL UAT sessions.
- A01: public Railway Testing login page only; no login submission and no credential/OTP capture.
- IDs containing `V2`, plus P01–P11 and Q01–Q04: controlled Staff 3000 Approval Center V2 worktree served locally on port 3998 against LOCAL UAT data.
- No Production URL, database, secret or account was accessed.

## Visual findings (capture only; no product fix applied)

1. **Approval Center runtime divergence:** the main local runtime still exposes the older pending detail interaction, while the controlled V2 worktree contains permanent manager entry + Pending/History + read-only history details. Both are preserved and clearly named.
2. **Attendance rejection interaction:** `O06D` shows the current main local inline decision-note/rejection field, not the desired V2 bottom sheet. This is documented, not redesigned.
3. **Fixture coverage gap:** current manager data has one Attendance pending item and zero Leave/Claims/OT pending items. Domain empty states are genuine; mixed pending cards and corresponding reject sheets were not fabricated.
4. **Responsive baseline:** all recorded screens reported no horizontal overflow at both required viewports. Physical Safari/Chrome safe-area behavior still requires the two owner videos below.

## Capture inventory

Each row records the required stable filename, route, persona, viewport, fixture/state, expected meaning, notes and limitation.

### A. Auth / Login

| ID | Filename | Route | Persona | Viewport | Fixture/state | Expected meaning | Notes | Known limitation |
|---|---|---|---|---|---|---|---|---|
| A01 | [A01-login-phone-entry-390.png](./artifacts/staff-ui-capture/A01-login-phone-entry-390.png) | `/staff/login` | Public | 390x844 | login-phone-entry | Employee sign in · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| A01 | [A01-login-phone-entry-412.png](./artifacts/staff-ui-capture/A01-login-phone-entry-412.png) | `/staff/login` | Public | 412x915 | login-phone-entry | Employee sign in · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| A06 | [A06-module-not-enabled-390.png](./artifacts/staff-ui-capture/A06-module-not-enabled-390.png) | `/staff/module-not-enabled?module=PAYROLL` | Normal Staff | 390x844 | module-not-enabled | Module not enabled · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| A06 | [A06-module-not-enabled-412.png](./artifacts/staff-ui-capture/A06-module-not-enabled-412.png) | `/staff/module-not-enabled?module=PAYROLL` | Normal Staff | 412x915 | module-not-enabled | Module not enabled · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |

### B. Home — Normal Staff

| ID | Filename | Route | Persona | Viewport | Fixture/state | Expected meaning | Notes | Known limitation |
|---|---|---|---|---|---|---|---|---|
| B01 | [B01-home-current-normal-staff-390.png](./artifacts/staff-ui-capture/B01-home-current-normal-staff-390.png) | `/staff` | Normal Staff | 390x844 | home-current-normal-staff | Home | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| B01 | [B01-home-current-normal-staff-412.png](./artifacts/staff-ui-capture/B01-home-current-normal-staff-412.png) | `/staff` | Normal Staff | 412x915 | home-current-normal-staff | Home | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |

### C. Home — Manager

| ID | Filename | Route | Persona | Viewport | Fixture/state | Expected meaning | Notes | Known limitation |
|---|---|---|---|---|---|---|---|---|
| C02 | [C02-home-manager-current-pending-390.png](./artifacts/staff-ui-capture/C02-home-manager-current-pending-390.png) | `/staff` | Manager / Approver | 390x844 | home-manager-current-pending | Home | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| C02 | [C02-home-manager-current-pending-412.png](./artifacts/staff-ui-capture/C02-home-manager-current-pending-412.png) | `/staff` | Manager / Approver | 412x915 | home-manager-current-pending | Home | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| C03 | [C03-home-needs-my-approval-390.png](./artifacts/staff-ui-capture/C03-home-needs-my-approval-390.png) | `/staff` | Manager / Approver | 390x844 | home-needs-my-approval | Home | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| C03 | [C03-home-needs-my-approval-412.png](./artifacts/staff-ui-capture/C03-home-needs-my-approval-412.png) | `/staff` | Manager / Approver | 412x915 | home-needs-my-approval | Home | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |

### D. Time Hub

| ID | Filename | Route | Persona | Viewport | Fixture/state | Expected meaning | Notes | Known limitation |
|---|---|---|---|---|---|---|---|---|
| D01 | [D01-time-hub-current-390.png](./artifacts/staff-ui-capture/D01-time-hub-current-390.png) | `/staff/history` | Normal Staff | 390x844 | time-hub-current | My attendance · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| D01 | [D01-time-hub-current-412.png](./artifacts/staff-ui-capture/D01-time-hub-current-412.png) | `/staff/history` | Normal Staff | 412x915 | time-hub-current | My attendance · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |

### E. Schedule

| ID | Filename | Route | Persona | Viewport | Fixture/state | Expected meaning | Notes | Known limitation |
|---|---|---|---|---|---|---|---|---|
| E01 | [E01-schedule-current-week-390.png](./artifacts/staff-ui-capture/E01-schedule-current-week-390.png) | `/staff/roster` | Normal Staff | 390x844 | schedule-current-week | Schedule · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| E01 | [E01-schedule-current-week-412.png](./artifacts/staff-ui-capture/E01-schedule-current-week-412.png) | `/staff/roster` | Normal Staff | 412x915 | schedule-current-week | Schedule · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |

### F. Attendance History

| ID | Filename | Route | Persona | Viewport | Fixture/state | Expected meaning | Notes | Known limitation |
|---|---|---|---|---|---|---|---|---|
| F01 | [F01-attendance-history-current-390.png](./artifacts/staff-ui-capture/F01-attendance-history-current-390.png) | `/staff/history` | Normal Staff | 390x844 | attendance-history-current | My attendance · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| F01 | [F01-attendance-history-current-412.png](./artifacts/staff-ui-capture/F01-attendance-history-current-412.png) | `/staff/history` | Normal Staff | 412x915 | attendance-history-current | My attendance · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |

### G. Timesheet / OT

| ID | Filename | Route | Persona | Viewport | Fixture/state | Expected meaning | Notes | Known limitation |
|---|---|---|---|---|---|---|---|---|
| G01 | [G01-timesheet-current-390.png](./artifacts/staff-ui-capture/G01-timesheet-current-390.png) | `/staff/timesheet` | Normal Staff | 390x844 | timesheet-current | My timesheet · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| G01 | [G01-timesheet-current-412.png](./artifacts/staff-ui-capture/G01-timesheet-current-412.png) | `/staff/timesheet` | Normal Staff | 412x915 | timesheet-current | My timesheet · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |

### H. Requests

| ID | Filename | Route | Persona | Viewport | Fixture/state | Expected meaning | Notes | Known limitation |
|---|---|---|---|---|---|---|---|---|
| H01 | [H01-requests-normal-staff-390.png](./artifacts/staff-ui-capture/H01-requests-normal-staff-390.png) | `/staff/requests` | Normal Staff | 390x844 | requests-normal-staff | Requests · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| H01 | [H01-requests-normal-staff-412.png](./artifacts/staff-ui-capture/H01-requests-normal-staff-412.png) | `/staff/requests` | Normal Staff | 412x915 | requests-normal-staff | Requests · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| H03 | [H03-requests-manager-pending-390.png](./artifacts/staff-ui-capture/H03-requests-manager-pending-390.png) | `/staff/requests` | Manager / Approver | 390x844 | requests-manager-pending | Requests · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| H03 | [H03-requests-manager-pending-412.png](./artifacts/staff-ui-capture/H03-requests-manager-pending-412.png) | `/staff/requests` | Manager / Approver | 412x915 | requests-manager-pending | Requests · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| H03V2 | [H03V2-requests-manager-permanent-entry-pending-390.png](./artifacts/staff-ui-capture/H03V2-requests-manager-permanent-entry-pending-390.png) | `/staff/requests` | Manager / Approver | 390x844 | requests-manager-permanent-entry-pending | Requests · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| H03V2 | [H03V2-requests-manager-permanent-entry-pending-412.png](./artifacts/staff-ui-capture/H03V2-requests-manager-permanent-entry-pending-412.png) | `/staff/requests` | Manager / Approver | 412x915 | requests-manager-permanent-entry-pending | Requests · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |

### I. Leave

| ID | Filename | Route | Persona | Viewport | Fixture/state | Expected meaning | Notes | Known limitation |
|---|---|---|---|---|---|---|---|---|
| I01 | [I01-leave-landing-390.png](./artifacts/staff-ui-capture/I01-leave-landing-390.png) | `/staff/leave` | Normal Staff | 390x844 | leave-landing | Leave · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| I01 | [I01-leave-landing-412.png](./artifacts/staff-ui-capture/I01-leave-landing-412.png) | `/staff/leave` | Normal Staff | 412x915 | leave-landing | Leave · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| I04 | [I04-leave-new-initial-390.png](./artifacts/staff-ui-capture/I04-leave-new-initial-390.png) | `/staff/leave/new` | Normal Staff | 390x844 | leave-new-initial | New leave request · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| I04 | [I04-leave-new-initial-412.png](./artifacts/staff-ui-capture/I04-leave-new-initial-412.png) | `/staff/leave/new` | Normal Staff | 412x915 | leave-new-initial | New leave request · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| I08 | [I08-leave-date-picker-open-390.png](./artifacts/staff-ui-capture/I08-leave-date-picker-open-390.png) | `/staff/leave/new` | Normal Staff | 390x844 | leave-date-picker-open | New leave request · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| I08 | [I08-leave-date-picker-open-412.png](./artifacts/staff-ui-capture/I08-leave-date-picker-open-412.png) | `/staff/leave/new` | Normal Staff | 412x915 | leave-date-picker-open | New leave request · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |

### J. Claims

| ID | Filename | Route | Persona | Viewport | Fixture/state | Expected meaning | Notes | Known limitation |
|---|---|---|---|---|---|---|---|---|
| J01 | [J01-claims-landing-history-390.png](./artifacts/staff-ui-capture/J01-claims-landing-history-390.png) | `/staff/claims` | Normal Staff | 390x844 | claims-landing-history | Claims · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| J01 | [J01-claims-landing-history-412.png](./artifacts/staff-ui-capture/J01-claims-landing-history-412.png) | `/staff/claims` | Normal Staff | 412x915 | claims-landing-history | Claims · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| J09 | [J09-claim-step-2-details-390.png](./artifacts/staff-ui-capture/J09-claim-step-2-details-390.png) | `/staff/claims` | Normal Staff | 390x844 | claim-step-2-details | Claims · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| J09 | [J09-claim-step-2-details-412.png](./artifacts/staff-ui-capture/J09-claim-step-2-details-412.png) | `/staff/claims` | Normal Staff | 412x915 | claim-step-2-details | Claims · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| J10 | [J10-claim-review-not-submitted-390.png](./artifacts/staff-ui-capture/J10-claim-review-not-submitted-390.png) | `/staff/claims` | Normal Staff | 390x844 | claim-review-not-submitted | Claims · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| J10 | [J10-claim-review-not-submitted-412.png](./artifacts/staff-ui-capture/J10-claim-review-not-submitted-412.png) | `/staff/claims` | Normal Staff | 412x915 | claim-review-not-submitted | Claims · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |

### K. Pay

| ID | Filename | Route | Persona | Viewport | Fixture/state | Expected meaning | Notes | Known limitation |
|---|---|---|---|---|---|---|---|---|
| K01 | [K01-pay-hub-current-390.png](./artifacts/staff-ui-capture/K01-pay-hub-current-390.png) | `/staff/pay` | Normal Staff | 390x844 | pay-hub-current | Pay · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| K01 | [K01-pay-hub-current-412.png](./artifacts/staff-ui-capture/K01-pay-hub-current-412.png) | `/staff/pay` | Normal Staff | 412x915 | pay-hub-current | Pay · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| K03 | [K03-payslip-list-current-390.png](./artifacts/staff-ui-capture/K03-payslip-list-current-390.png) | `/staff/payslips` | Normal Staff | 390x844 | payslip-list-current | My payslips · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| K03 | [K03-payslip-list-current-412.png](./artifacts/staff-ui-capture/K03-payslip-list-current-412.png) | `/staff/payslips` | Normal Staff | 412x915 | payslip-list-current | My payslips · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| K05 | [K05-commission-current-390.png](./artifacts/staff-ui-capture/K05-commission-current-390.png) | `/staff/commission` | Normal Staff | 390x844 | commission-current | My commission · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| K05 | [K05-commission-current-412.png](./artifacts/staff-ui-capture/K05-commission-current-412.png) | `/staff/commission` | Normal Staff | 412x915 | commission-current | My commission · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |

### L. Profile

| ID | Filename | Route | Persona | Viewport | Fixture/state | Expected meaning | Notes | Known limitation |
|---|---|---|---|---|---|---|---|---|
| L01 | [L01-profile-current-390.png](./artifacts/staff-ui-capture/L01-profile-current-390.png) | `/staff/profile` | Normal Staff | 390x844 | profile-current | Profile · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| L01 | [L01-profile-current-412.png](./artifacts/staff-ui-capture/L01-profile-current-412.png) | `/staff/profile` | Normal Staff | 412x915 | profile-current | Profile · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| L01M | [L01M-profile-manager-current-390.png](./artifacts/staff-ui-capture/L01M-profile-manager-current-390.png) | `/staff/profile` | Manager / Approver | 390x844 | profile-manager-current | Profile · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| L01M | [L01M-profile-manager-current-412.png](./artifacts/staff-ui-capture/L01M-profile-manager-current-412.png) | `/staff/profile` | Manager / Approver | 412x915 | profile-manager-current | Profile · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| L05 | [L05-profile-device-activity-expanded-390.png](./artifacts/staff-ui-capture/L05-profile-device-activity-expanded-390.png) | `/staff/profile` | Normal Staff | 390x844 | profile-device-activity-expanded | Profile · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| L05 | [L05-profile-device-activity-expanded-412.png](./artifacts/staff-ui-capture/L05-profile-device-activity-expanded-412.png) | `/staff/profile` | Normal Staff | 412x915 | profile-device-activity-expanded | Profile · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |

### M. Appointments

| ID | Filename | Route | Persona | Viewport | Fixture/state | Expected meaning | Notes | Known limitation |
|---|---|---|---|---|---|---|---|---|
| M01 | [M01-appointments-day-current-390.png](./artifacts/staff-ui-capture/M01-appointments-day-current-390.png) | `/staff/appointments` | Normal Staff | 390x844 | appointments-day-current | My Appointments · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| M01 | [M01-appointments-day-current-412.png](./artifacts/staff-ui-capture/M01-appointments-day-current-412.png) | `/staff/appointments` | Normal Staff | 412x915 | appointments-day-current | My Appointments · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |

### N. Approval Center V2 — Pending

| ID | Filename | Route | Persona | Viewport | Fixture/state | Expected meaning | Notes | Known limitation |
|---|---|---|---|---|---|---|---|---|
| N02 | [N02-approval-pending-current-390.png](./artifacts/staff-ui-capture/N02-approval-pending-current-390.png) | `/staff/approvals` | Manager / Approver | 390x844 | approval-pending-current | Team Approvals · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| N02 | [N02-approval-pending-current-412.png](./artifacts/staff-ui-capture/N02-approval-pending-current-412.png) | `/staff/approvals` | Manager / Approver | 412x915 | approval-pending-current | Team Approvals · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| N05 | [N05-approval-filter-leave-empty-390.png](./artifacts/staff-ui-capture/N05-approval-filter-leave-empty-390.png) | `/staff/approvals?domain=LEAVE` | Manager / Approver | 390x844 | approval-filter-leave-empty | Team Approvals · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| N05 | [N05-approval-filter-leave-empty-412.png](./artifacts/staff-ui-capture/N05-approval-filter-leave-empty-412.png) | `/staff/approvals?domain=LEAVE` | Manager / Approver | 412x915 | approval-filter-leave-empty | Team Approvals · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| N06 | [N06-approval-filter-claims-empty-390.png](./artifacts/staff-ui-capture/N06-approval-filter-claims-empty-390.png) | `/staff/approvals?domain=CLAIMS` | Manager / Approver | 390x844 | approval-filter-claims-empty | Team Approvals · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| N06 | [N06-approval-filter-claims-empty-412.png](./artifacts/staff-ui-capture/N06-approval-filter-claims-empty-412.png) | `/staff/approvals?domain=CLAIMS` | Manager / Approver | 412x915 | approval-filter-claims-empty | Team Approvals · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| N07 | [N07-approval-filter-attendance-390.png](./artifacts/staff-ui-capture/N07-approval-filter-attendance-390.png) | `/staff/approvals?domain=ATTENDANCE` | Manager / Approver | 390x844 | approval-filter-attendance | Team Approvals · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| N07 | [N07-approval-filter-attendance-412.png](./artifacts/staff-ui-capture/N07-approval-filter-attendance-412.png) | `/staff/approvals?domain=ATTENDANCE` | Manager / Approver | 412x915 | approval-filter-attendance | Team Approvals · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| N08 | [N08-approval-filter-ot-empty-390.png](./artifacts/staff-ui-capture/N08-approval-filter-ot-empty-390.png) | `/staff/approvals?domain=OT` | Manager / Approver | 390x844 | approval-filter-ot-empty | Team Approvals · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| N08 | [N08-approval-filter-ot-empty-412.png](./artifacts/staff-ui-capture/N08-approval-filter-ot-empty-412.png) | `/staff/approvals?domain=OT` | Manager / Approver | 412x915 | approval-filter-ot-empty | Team Approvals · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| N02V2 | [N02V2-approval-v2-pending-all-390.png](./artifacts/staff-ui-capture/N02V2-approval-v2-pending-all-390.png) | `/staff/approvals` | Manager / Approver | 390x844 | approval-v2-pending-all | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| N02V2 | [N02V2-approval-v2-pending-all-412.png](./artifacts/staff-ui-capture/N02V2-approval-v2-pending-all-412.png) | `/staff/approvals` | Manager / Approver | 412x915 | approval-v2-pending-all | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| N05V2 | [N05V2-approval-v2-pending-leave-empty-390.png](./artifacts/staff-ui-capture/N05V2-approval-v2-pending-leave-empty-390.png) | `/staff/approvals?domain=LEAVE` | Manager / Approver | 390x844 | approval-v2-pending-leave-empty | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| N05V2 | [N05V2-approval-v2-pending-leave-empty-412.png](./artifacts/staff-ui-capture/N05V2-approval-v2-pending-leave-empty-412.png) | `/staff/approvals?domain=LEAVE` | Manager / Approver | 412x915 | approval-v2-pending-leave-empty | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| N06V2 | [N06V2-approval-v2-pending-claims-empty-390.png](./artifacts/staff-ui-capture/N06V2-approval-v2-pending-claims-empty-390.png) | `/staff/approvals?domain=CLAIMS` | Manager / Approver | 390x844 | approval-v2-pending-claims-empty | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| N06V2 | [N06V2-approval-v2-pending-claims-empty-412.png](./artifacts/staff-ui-capture/N06V2-approval-v2-pending-claims-empty-412.png) | `/staff/approvals?domain=CLAIMS` | Manager / Approver | 412x915 | approval-v2-pending-claims-empty | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| N07V2 | [N07V2-approval-v2-pending-attendance-390.png](./artifacts/staff-ui-capture/N07V2-approval-v2-pending-attendance-390.png) | `/staff/approvals?domain=ATTENDANCE` | Manager / Approver | 390x844 | approval-v2-pending-attendance | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| N07V2 | [N07V2-approval-v2-pending-attendance-412.png](./artifacts/staff-ui-capture/N07V2-approval-v2-pending-attendance-412.png) | `/staff/approvals?domain=ATTENDANCE` | Manager / Approver | 412x915 | approval-v2-pending-attendance | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| N08V2 | [N08V2-approval-v2-pending-ot-empty-390.png](./artifacts/staff-ui-capture/N08V2-approval-v2-pending-ot-empty-390.png) | `/staff/approvals?domain=OT` | Manager / Approver | 390x844 | approval-v2-pending-ot-empty | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| N08V2 | [N08V2-approval-v2-pending-ot-empty-412.png](./artifacts/staff-ui-capture/N08V2-approval-v2-pending-ot-empty-412.png) | `/staff/approvals?domain=OT` | Manager / Approver | 412x915 | approval-v2-pending-ot-empty | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |

### O. Approval Detail

| ID | Filename | Route | Persona | Viewport | Fixture/state | Expected meaning | Notes | Known limitation |
|---|---|---|---|---|---|---|---|---|
| O06 | [O06-attendance-correction-list-detail-entry-390.png](./artifacts/staff-ui-capture/O06-attendance-correction-list-detail-entry-390.png) | `/staff/requests/attendance-corrections` | Manager / Approver | 390x844 | attendance-correction-list-detail-entry | Attendance Review · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| O06 | [O06-attendance-correction-list-detail-entry-412.png](./artifacts/staff-ui-capture/O06-attendance-correction-list-detail-entry-412.png) | `/staff/requests/attendance-corrections` | Manager / Approver | 412x915 | attendance-correction-list-detail-entry | Attendance Review · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| O06D | [O06D-attendance-correction-expanded-detail-390.png](./artifacts/staff-ui-capture/O06D-attendance-correction-expanded-detail-390.png) | `/staff/requests/attendance-corrections` | Manager / Approver | 390x844 | attendance-correction-expanded-detail | Attendance Review · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| O06D | [O06D-attendance-correction-expanded-detail-412.png](./artifacts/staff-ui-capture/O06D-attendance-correction-expanded-detail-412.png) | `/staff/requests/attendance-corrections` | Manager / Approver | 412x915 | attendance-correction-expanded-detail | Attendance Review · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |

### P. Approval Center V2 — History

| ID | Filename | Route | Persona | Viewport | Fixture/state | Expected meaning | Notes | Known limitation |
|---|---|---|---|---|---|---|---|---|
| P01 | [P01-approval-history-all-390.png](./artifacts/staff-ui-capture/P01-approval-history-all-390.png) | `/staff/approvals?view=history` | Manager / Approver | 390x844 | approval-history-all | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| P01 | [P01-approval-history-all-412.png](./artifacts/staff-ui-capture/P01-approval-history-all-412.png) | `/staff/approvals?view=history` | Manager / Approver | 412x915 | approval-history-all | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| P02 | [P02-approval-history-leave-390.png](./artifacts/staff-ui-capture/P02-approval-history-leave-390.png) | `/staff/approvals?view=history&domain=LEAVE` | Manager / Approver | 390x844 | approval-history-leave | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| P02 | [P02-approval-history-leave-412.png](./artifacts/staff-ui-capture/P02-approval-history-leave-412.png) | `/staff/approvals?view=history&domain=LEAVE` | Manager / Approver | 412x915 | approval-history-leave | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| P03 | [P03-approval-history-claims-390.png](./artifacts/staff-ui-capture/P03-approval-history-claims-390.png) | `/staff/approvals?view=history&domain=CLAIMS` | Manager / Approver | 390x844 | approval-history-claims | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| P03 | [P03-approval-history-claims-412.png](./artifacts/staff-ui-capture/P03-approval-history-claims-412.png) | `/staff/approvals?view=history&domain=CLAIMS` | Manager / Approver | 412x915 | approval-history-claims | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| P04 | [P04-approval-history-attendance-390.png](./artifacts/staff-ui-capture/P04-approval-history-attendance-390.png) | `/staff/approvals?view=history&domain=ATTENDANCE` | Manager / Approver | 390x844 | approval-history-attendance | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| P04 | [P04-approval-history-attendance-412.png](./artifacts/staff-ui-capture/P04-approval-history-attendance-412.png) | `/staff/approvals?view=history&domain=ATTENDANCE` | Manager / Approver | 412x915 | approval-history-attendance | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| P05 | [P05-approval-history-ot-390.png](./artifacts/staff-ui-capture/P05-approval-history-ot-390.png) | `/staff/approvals?view=history&domain=OT` | Manager / Approver | 390x844 | approval-history-ot | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| P05 | [P05-approval-history-ot-412.png](./artifacts/staff-ui-capture/P05-approval-history-ot-412.png) | `/staff/approvals?view=history&domain=OT` | Manager / Approver | 412x915 | approval-history-ot | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| P09 | [P09-approval-history-approved-cards-390.png](./artifacts/staff-ui-capture/P09-approval-history-approved-cards-390.png) | `/staff/approvals?view=history` | Manager / Approver | 390x844 | approval-history-approved-cards | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| P09 | [P09-approval-history-approved-cards-412.png](./artifacts/staff-ui-capture/P09-approval-history-approved-cards-412.png) | `/staff/approvals?view=history` | Manager / Approver | 412x915 | approval-history-approved-cards | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| P10 | [P10-approval-history-rejected-card-390.png](./artifacts/staff-ui-capture/P10-approval-history-rejected-card-390.png) | `/staff/approvals?view=history&domain=OT` | Manager / Approver | 390x844 | approval-history-rejected-card | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| P10 | [P10-approval-history-rejected-card-412.png](./artifacts/staff-ui-capture/P10-approval-history-rejected-card-412.png) | `/staff/approvals?view=history&domain=OT` | Manager / Approver | 412x915 | approval-history-rejected-card | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| P11 | [P11-approval-history-adjusted-ot-card-390.png](./artifacts/staff-ui-capture/P11-approval-history-adjusted-ot-card-390.png) | `/staff/approvals?view=history&domain=OT` | Manager / Approver | 390x844 | approval-history-adjusted-ot-card | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| P11 | [P11-approval-history-adjusted-ot-card-412.png](./artifacts/staff-ui-capture/P11-approval-history-adjusted-ot-card-412.png) | `/staff/approvals?view=history&domain=OT` | Manager / Approver | 412x915 | approval-history-adjusted-ot-card | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| P06 | [P06-approval-history-month-july-390.png](./artifacts/staff-ui-capture/P06-approval-history-month-july-390.png) | `/staff/approvals?view=history&month=2026-07&employee=` | Manager / Approver | 390x844 | approval-history-month-july | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| P08 | [P08-approval-history-no-results-412.png](./artifacts/staff-ui-capture/P08-approval-history-no-results-412.png) | `/staff/approvals?view=history&month=2026-07&employee=` | Manager / Approver | 412x915 | approval-history-no-results | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| P07 | [P07-approval-history-employee-search-390.png](./artifacts/staff-ui-capture/P07-approval-history-employee-search-390.png) | `/staff/approvals?view=history&month=2026-08&employee=Core+B` | Manager / Approver | 390x844 | approval-history-employee-search | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| P07 | [P07-approval-history-employee-search-412.png](./artifacts/staff-ui-capture/P07-approval-history-employee-search-412.png) | `/staff/approvals?view=history&month=2026-08&employee=Core+B` | Manager / Approver | 412x915 | approval-history-employee-search | Approval Center · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |

### Q. History Detail

| ID | Filename | Route | Persona | Viewport | Fixture/state | Expected meaning | Notes | Known limitation |
|---|---|---|---|---|---|---|---|---|
| Q01 | [Q01-leave-history-detail-read-only-390.png](./artifacts/staff-ui-capture/Q01-leave-history-detail-read-only-390.png) | `/staff/approvals/history/leave/29e07bc0-272a-4cb8-971d-287043b43d12` | Manager / Approver | 390x844 | leave-history-detail-read-only | Approval decision · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| Q01 | [Q01-leave-history-detail-read-only-412.png](./artifacts/staff-ui-capture/Q01-leave-history-detail-read-only-412.png) | `/staff/approvals/history/leave/29e07bc0-272a-4cb8-971d-287043b43d12` | Manager / Approver | 412x915 | leave-history-detail-read-only | Approval decision · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| Q02 | [Q02-claims-history-detail-read-only-390.png](./artifacts/staff-ui-capture/Q02-claims-history-detail-read-only-390.png) | `/staff/approvals/history/claims/6e7b1b7a-a157-4a9f-829f-009c6ea82df9` | Manager / Approver | 390x844 | claims-history-detail-read-only | Approval decision · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| Q02 | [Q02-claims-history-detail-read-only-412.png](./artifacts/staff-ui-capture/Q02-claims-history-detail-read-only-412.png) | `/staff/approvals/history/claims/6e7b1b7a-a157-4a9f-829f-009c6ea82df9` | Manager / Approver | 412x915 | claims-history-detail-read-only | Approval decision · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| Q03 | [Q03-attendance-history-detail-read-only-390.png](./artifacts/staff-ui-capture/Q03-attendance-history-detail-read-only-390.png) | `/staff/approvals/history/attendance/exception%3A79dbf557-5409-424d-b9b7-cc154c0c8abb` | Manager / Approver | 390x844 | attendance-history-detail-read-only | Approval decision · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| Q03 | [Q03-attendance-history-detail-read-only-412.png](./artifacts/staff-ui-capture/Q03-attendance-history-detail-read-only-412.png) | `/staff/approvals/history/attendance/exception%3A79dbf557-5409-424d-b9b7-cc154c0c8abb` | Manager / Approver | 412x915 | attendance-history-detail-read-only | Approval decision · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| Q04 | [Q04-ot-history-detail-read-only-390.png](./artifacts/staff-ui-capture/Q04-ot-history-detail-read-only-390.png) | `/staff/approvals/history/ot/dfcafc25-4687-41e5-80cc-81ac4526bc7a` | Manager / Approver | 390x844 | ot-history-detail-read-only | Approval decision · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |
| Q04 | [Q04-ot-history-detail-read-only-412.png](./artifacts/staff-ui-capture/Q04-ot-history-detail-read-only-412.png) | `/staff/approvals/history/ot/dfcafc25-4687-41e5-80cc-81ac4526bc7a` | Manager / Approver | 412x915 | ot-history-detail-read-only | Approval decision · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — local browser against deterministic UAT fixture; not physical-device rendering |

### R. Error / Empty / Loading

| ID | Filename | Route | Persona | Viewport | Fixture/state | Expected meaning | Notes | Known limitation |
|---|---|---|---|---|---|---|---|---|
| R04 | [R04-requests-empty-list-390.png](./artifacts/staff-ui-capture/R04-requests-empty-list-390.png) | `/staff/requests` | Normal Staff | 390x844 | requests-empty-list | Requests · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| R04 | [R04-requests-empty-list-412.png](./artifacts/staff-ui-capture/R04-requests-empty-list-412.png) | `/staff/requests` | Normal Staff | 412x915 | requests-empty-list | Requests · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |

### S. Mobile Edge Cases

| ID | Filename | Route | Persona | Viewport | Fixture/state | Expected meaning | Notes | Known limitation |
|---|---|---|---|---|---|---|---|---|
| S09A | [S09A-leave-form-bottom-navigation-390.png](./artifacts/staff-ui-capture/S09A-leave-form-bottom-navigation-390.png) | `/staff/leave/new` | Normal Staff | 390x844 | leave-form-bottom-navigation | New leave request · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| S09A | [S09A-leave-form-bottom-navigation-412.png](./artifacts/staff-ui-capture/S09A-leave-form-bottom-navigation-412.png) | `/staff/leave/new` | Normal Staff | 412x915 | leave-form-bottom-navigation | New leave request · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| S09B | [S09B-claims-bottom-navigation-390.png](./artifacts/staff-ui-capture/S09B-claims-bottom-navigation-390.png) | `/staff/claims` | Normal Staff | 390x844 | claims-bottom-navigation | Claims · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| S09B | [S09B-claims-bottom-navigation-412.png](./artifacts/staff-ui-capture/S09B-claims-bottom-navigation-412.png) | `/staff/claims` | Normal Staff | 412x915 | claims-bottom-navigation | Claims · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| S09C | [S09C-profile-bottom-navigation-390.png](./artifacts/staff-ui-capture/S09C-profile-bottom-navigation-390.png) | `/staff/profile` | Normal Staff | 390x844 | profile-bottom-navigation | Profile · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |
| S09C | [S09C-profile-bottom-navigation-412.png](./artifacts/staff-ui-capture/S09C-profile-bottom-navigation-412.png) | `/staff/profile` | Normal Staff | 412x915 | profile-bottom-navigation | Profile · Tetamu Staff App | No horizontal overflow detected | BROWSER CAPTURE — not physical-device rendering |

## Missing / unavailable requested states

The following states were deliberately not fabricated. Their absence is a fixture/capture limitation, not a claim that the product lacks the feature.

| Section | Requested IDs not separately captured | Exact reason |
|---|---|---|
| A. Auth / Login | A02, A03, A04, A05, A07 | 本轮不发送 OTP、不建立/切换真实 workplace session，也不人为制造 auth/session 失败；避免副作用与凭证暴露。 |
| B. Home — Normal Staff | B02–B05, B07–B12 | 当前 Normal Staff fixture 只稳定提供 Before Clock In + No Schedule；不为截图改写 punch、appointment 或异常状态。 |
| C. Home — Manager | C01, C04–C06 | 当前 manager fixture 有 1 条 Attendance pending；无独立 0 pending、长文字及 schedule 组合 fixture。 |
| D. Time Hub | D02–D04 | 当前 Time hub 只有单一稳定读取状态。 |
| E. Schedule | E02–E11 | 当前 week fixture 未覆盖 rest day、holiday、approved leave、cross-midnight、multiple shifts 或多 branch 标签；未修改 roster 数据。 |
| F. Attendance History | F02–F10 | 员工 fixture 当前未提供可安全复现的 missing punch / correction lifecycle / multi-branch filter 组合。 |
| G. Timesheet / OT | G02–G12 | 当前 Normal Staff fixture 未提供完整 OT lifecycle，且本轮禁止修改 canonical Attendance/Timesheet 数据。 |
| H. Requests | H02, H04, H05 | H03 已覆盖 manager permanent entry + pending；当前 fixture 无独立 0 pending 与 recent-activity 组合。 |
| I. Leave | I02, I03, I05–I07, I09–I16 | 已捕获 landing、initial form 和 date picker；未提交 Leave 或制造 evidence/policy/status lifecycle。 |
| J. Claims | J02–J08, J11–J17 | 已捕获 details 与未提交 review；没有上传 receipt、提交 Claim 或制造付款/驳回状态。 |
| K. Pay | K02, K04, K06, K07 | 当前 pay fixture 只提供现况 hub/list/commission；没有独立 empty 与长金额 fixture。 |
| L. Profile | L02–L04, L06–L08 | Profile 主画面已包含 avatar/workplace/logout 可视区域，另捕获 device activity expanded；未强制 multi-employer/长 workplace。 |
| M. Appointments | M02–M11 | 当前 SALON appointment fixture 没有稳定的多预约、冲突、outside-shift 或 Home next-appointment 状态。 |
| N. Approval Center V2 — Pending | N01, N03, N09–N12 | 当前 V2 fixture 只有 1 条 Attendance pending；Leave/Claims/OT filters 为真实 empty，不伪造 mixed cards 或长文字。 |
| O. Approval Detail | O01–O05, O07–O12 | 当前 pending fixture 仅 Attendance。主 local runtime 的 Attendance detail 仍是 inline rejection UI；没有可安全触发 V2 reject sheet/OT editor 的 pending 数据。 |
| P. Approval Center V2 — History | P12, P13 | 当前 History fixture 未提供 current status later changed 或长名称/branch 的确定性记录。 |
| Q. History Detail | Q05, Q06 | 当前历史 fixture 无 status drift 与 protected attachment unavailable 状态；Q01–Q04 已确认 read-only。 |
| R. Error / Empty / Loading | R01–R03, R05–R11 | 只捕获真实 empty list。未通过网络阻断、CSS/JS 注入或无效提交人为制造 loading/error/unauthorized/upload/error states。 |
| S. Mobile Edge Cases | S01–S08, S10 | S09 已覆盖三个底部导航场景；S11/S12 由全套 390/412 截图覆盖。未伪造长文字、键盘高度或 sticky action 数据。 |

## Read-only history verification

Q01–Q04 were visually inspected as read-only historical decision evidence. The captures do not expose Approve, Reject or Adjust actions.

## Final summary

1. **Total screenshots captured:** 110.
2. **Pages covered:** 32 route/query variants across Auth, Home, Time, Schedule, Attendance, Timesheet, Requests, Leave, Claims, Pay, Profile, Appointments and Approval Center.
3. **States covered:** 56 catalogued IDs; every core current page plus real manager pending/history/read-only detail states available from deterministic fixtures.
4. **Missing/unavailable states:** lifecycle-heavy states requiring punch/leave/claim/OT mutations, unsupported optional personas, transient loading/error states, and pending domains absent from the current fixture; itemized above.
5. **Browser-only limitations:** screenshots do not prove iOS Safari or Android Chrome browser chrome, safe-area insets, keyboard resizing, PWA standalone behavior, camera/file picker behavior or physical touch ergonomics.
6. **Recommended owner physical recordings:** only the two videos below; no manual screenshot pack is required.

## Recommended owner physical recordings

### VIDEO A — iPhone Normal Staff

Login → Home → Time → Schedule → Attendance → Timesheet → Requests → Leave → Claims → Pay → Profile

### VIDEO B — Android Manager

Login → Home → Requests → Approval Center → Pending → Leave/Claims/Attendance/OT detail → History → History detail → Profile

## Production status

LOCAL / TESTING ONLY

PRODUCTION NOT ACCESSED

PRODUCTION NOT MODIFIED
