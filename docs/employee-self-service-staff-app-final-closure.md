# Tetamu Employee Self-Service / Staff App Final Closure

## Environment and scope

This closure was executed only against the canonical Local workspace and the Local embedded PostgreSQL database.

```text
LOCAL / TESTING ONLY
PRODUCTION NOT ACCESSED
PRODUCTION NOT VALIDATED
```

Inventory, Expense, Roster, PCB, Statutory Human Review, Public Bank, Payroll Payment, AI and Production work are outside this closure.

## Final audit

| Area | Before closure | Final | Evidence |
| --- | --- | --- | --- |
| Staff OTP login | READY | READY | Existing one-time challenge, replay, expiry and rate-limit architecture retained. Local mock OTP was used only for browser QA. |
| Staff session | READY | READY | Existing account, membership, business, primary branch, device, expiry and revocation binding retained. |
| Home | PARTIAL | READY | Unified module-aware self-service summary now sits beside Today Attendance. POS-only businesses receive Profile/Account, not an empty HR shell. |
| Navigation | PARTIAL | READY | Mobile bottom bar is bounded to five items and a module-aware More sheet. Live entitlement is refreshed after authentication and route changes. |
| Clock In / Clock Out | READY | READY | Existing Attendance service remains canonical; browser QA completed a real Local clock-in and clock-out. |
| GPS | READY | READY | Existing geofence policy remains canonical. QA used an explicit geofence-disabled Local branch and did not bypass a required location policy. |
| Expected attendance | PARTIAL | READY | Today reads the latest CURRENT `AttendanceExpectedDay`. Missing evidence displays `No published schedule available` and never means Off Day. |
| My Attendance | READY | READY | Own-only history and correction workflow retained; all Attendance mutations now recheck the HR module server-side. |
| My Leave | READY | READY | Existing Leave overview and submission service retained as source-of-truth. |
| My Claims | READY | READY | Existing Claims overview and submission service retained as source-of-truth. |
| My Commission | READY | READY | Existing self-scoped Commission statement reader retained as source-of-truth. |
| My Timesheets | PARTIAL | READY | Page now delegates to a dedicated own-only Attendance read service instead of reading Prisma directly. |
| My Payslips | READY | READY | Existing published, own-only Payslip reader and download controls retained. |
| My Profile | READY | READY | Self-service auth is checked server-side before the profile client loads. |
| Module entitlement | UNSAFE/PARTIAL | READY | UI visibility and page access follow live business modules; APIs continue to deny disabled modules. |
| HR-only without POS | PARTIAL | READY | Browser QA passed with `CORE + HR` and no POS entitlement. |
| POS-only Staff | PARTIAL | READY | Browser QA passed with only Home/Profile and an explicit HR `MODULE_NOT_ENABLED` result. |
| Mobile responsiveness | PARTIAL | READY | At 390 px there was no horizontal overflow; all five bottom navigation controls remained visible. |
| Loading / error / empty states | PARTIAL | READY | Shared Staff loading/error boundaries added; domain-specific empty states remain explicit and do not fabricate data. |

## Architecture decision

The Staff App remains a presentation and orchestration layer. No second HR backend was introduced.

```text
Staff App Home / Pages
  -> existing Attendance readers and commands
  -> existing Leave service
  -> existing Claims service
  -> existing Commission reader
  -> existing Payslip publication reader
```

The home summary isolates reader failures. A failed reader displays `Temporarily unavailable`; it is never converted into a false zero or empty result.

## Entitlement matrix

| Enabled business modules | Staff App visibility |
| --- | --- |
| `CORE + HR` | Home, Attendance, Leave, Timesheets, Profile |
| `CORE + HR + CLAIMS` | Adds Claims |
| `CORE + COMMISSION` | Adds Commission without requiring POS or HR |
| `CORE + HR + PAYROLL` | Adds published Payslips |
| `CORE + POS` | Home and Profile only; no empty HR workspace |

Every corresponding page keeps its server-side module gate. Attendance Clock In, Clock Out, Break Start, Break End, exception, P2 correction and resolution mutation routes now explicitly recheck `HR` after authenticating the employee session.

## No roster guessing

Roster is not implemented by this closure. Staff Today uses only an explicit current `AttendanceExpectedDay` for the selected business, branch, membership and work date.

```text
No expected-attendance record
  -> No published schedule available
  -> never Off Day
```

Explicit Workday, Not Scheduled, Rest Day and Public Holiday evidence may be displayed using the evidence snapshot, timezone, grace and revision already stored by Attendance P2.

## Local browser acceptance

Three isolated Local QA businesses were created by `scripts/prepare-staff-app-browser-fixture.ts`:

- Full workforce: `CORE + HR + CLAIMS + COMMISSION + PAYROLL`
- HR-only: `CORE + HR`
- POS-only: `CORE + POS`

The browser acceptance verified:

- Local mock OTP login and device registration
- business, membership and branch identity shown in Profile
- full module navigation plus bounded More menu
- real Local Clock In and Clock Out
- no-schedule wording without Off Day inference
- Attendance, Leave, Claims, Commission, Timesheet, Payslip and Profile pages
- HR-only Claims page denial with `MODULE_NOT_ENABLED`
- POS-only Home/Profile experience and direct HR page denial
- 390 px mobile layout without horizontal overflow
- no browser runtime errors; only pre-existing global autoprefixer warnings

The temporary mock OTP environment file and Local QA server were removed/stopped after browser validation. The mock provider is not a Production provider.

## Automated acceptance

```text
Targeted Unit                  62 / 62 PASS
Targeted Integration           19 / 19 PASS
Staff PWA Unit                 17 / 17 PASS
Full Unit                     794 / 794 PASS
Full Integration              119 / 119 PASS
TypeScript                              PASS
Lint                                    PASS (one existing WhatsApp image warning)
Local production-mode build             PASS
git diff --check                        PASS
```

## Deferred

- Production OTP provider integration
- Roster and published shift authoring
- Inventory and Expense
- PCB and Statutory human decisions
- Public Bank adapter and Payroll Payment
- Production deployment and Production validation

## Final status

```text
STAFF AUTHENTICATION                  READY
STAFF SESSION                         READY
STAFF HOME                            READY
STAFF ATTENDANCE                      READY
STAFF LEAVE                           READY
STAFF CLAIMS                          READY
STAFF COMMISSION                      READY
STAFF TIMESHEETS                      READY
STAFF PAYSLIPS                        READY
STAFF PROFILE                         READY
MODULE ENTITLEMENT                    READY
HR-ONLY BUSINESS                      READY
POS-ONLY STAFF                        READY
MOBILE STAFF APP                      READY

TETAMU EMPLOYEE SELF-SERVICE / STAFF APP
READY
```
