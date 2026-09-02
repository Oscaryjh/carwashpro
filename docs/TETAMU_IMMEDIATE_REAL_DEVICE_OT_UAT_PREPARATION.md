# TETAMU — Immediate Real-Device OT UAT Preparation

**Prepared:** 27 Aug 2026  
**Environment:** Railway Testing only  
**Final verdict:** **BLOCKED — APPROVED LEAVE CONFLICT**  
**Real Device OT UAT:** **NOT YET PASS — HUMAN ACTION REQUIRED**

## 1. Precheck

A read-only precheck was executed against the Railway **Testing** database selected through the Testing environment and its public database endpoint.

- Database server time: `2026-08-27T04:14:10.569Z`
- Malaysia time at inspection: approximately `12:14 MYT`
- Business: `Royal Salon`
- Branch: `salon online`
- Branch Attendance timezone: `Asia/Kuala_Lumpur` (UTC+08:00, equivalent to MYT used by the UAT)
- Attendance enabled: `YES`
- Production touched: `NO`

Target identity checks passed:

- Employee: `Twilio OTP QA Staff` / `TWILIO-OTP-QA` / `+601112212259`
- Manager: `Real Device UAT Manager` / `EMP-005` / `+601151300932`
- Both memberships are active and assigned to `salon online`.
- Both Staff App users are active with login enabled.

## 2. Existing Attendance

For `TWILIO-OTP-QA` on 27 Aug 2026:

- Attendance clock-in: `NO`
- Attendance clock-out: `NO`
- Attendance record: `NO`
- Attendance P2 final result: `NO`
- Potential OT: `NO`
- AttendanceOvertimeReview: `NO`
- Payroll attendance snapshot for August: `NO`

Therefore today's Attendance has not already been consumed. The specific blocker is not existing Attendance; it is the approved full-day Leave described below.

## 3. Existing Roster

The currently effective published roster revision contains:

- Date: `27 Aug 2026`
- Kind: `WORK_SHIFT`
- Shift: `09:00–18:00 MYT`
- Break: `60 minutes`
- Publication revision: `1`
- Publication reason: `Testing only Real Device UAT roster`
- Expected Day: `WORKDAY`
- Expected Day source: `ROSTER`
- Expected Day status: `CURRENT`

The published shift had already started by the inspection time. The canonical roster service treats a same-day assignment whose start time has passed as historical/retrospective.

## 4. Roster Revision

The canonical roster boundary is available through `upsertRosterAssignment` and `publishRoster` in `src/lib/roster/service.ts`.

A published roster amendment must:

1. pass branch scope and employee eligibility;
2. use the expected draft revision;
3. require published-roster amendment capability;
4. use a reason for retrospective changes;
5. pass Timesheet lock checks;
6. produce a new publication and Expected Day evidence.

No roster row was edited directly. No canonical roster revision was created because the required short shift would conflict with an approved full-day Leave.

## 5. Short Shift

**Not prepared.**

The employee has an approved full-day Leave covering:

- `27 Aug 2026`
- `28 Aug 2026`

Creating a 27 Aug short `WORKDAY` shift would violate the required `No conflicting leave` condition. It would also create a Leave-versus-Attendance conflict that the manager OT flow explicitly blocks until resolved.

Proposed shift: `N/A`  
Human Clock In time: `N/A`  
Human Clock Out target: `N/A`

## 6. Break Configuration

The existing published shift has a `60-minute` break.

The requested UAT fixture requires a zero-break short shift. Because the UAT is blocked before roster mutation, no break configuration was changed.

- Prepared break: `N/A`
- Required future UAT break: `0 minutes`

## 7. Expected OT

No Attendance or OT data was created.

When the test is rescheduled to a clean date, the intended canonical pattern remains:

- short published shift of approximately 30 minutes;
- human Clock In near scheduled start;
- human Clock Out approximately 15–20 minutes after scheduled end;
- Attendance derives approximately 15–20 minutes of potential OT;
- Manager reviews the derived OT;
- approved minutes become eligible only through the later locked Timesheet boundary.

Current expected potential OT: `N/A — test not prepared`

## 8. Employee Device Steps

Do **not** run the employee device test on 27 or 28 Aug 2026.

For the next clean test date:

1. rerun the read-only safety precheck immediately before preparing the roster;
2. create and publish a canonical zero-break short shift starting 20–30 minutes in the future;
3. log in at `https://tetamu-staff-app-testing.up.railway.app/staff/login` with `+601112212259`;
4. verify the shift at `/staff/roster`;
5. perform human Clock In and human Clock Out only at the instructed times;
6. check the employee result at `/staff/timesheet`.

## 9. Manager Device Steps

The manager's stored direct permission includes `ATTENDANCE_EMPLOYEE_MANAGE`, which maps to the `MODIFY_ATTENDANCE_EMPLOYEES` capability required by the Staff App OT approval surface.

- Manager login: `+601151300932`
- Manager route: `/staff/requests/overtime`
- Scope: same Testing business and branch as the employee
- Approval executed: `NO`

The OT queue is designed to show potential OT only after Attendance produces a final result. The manager must not approve, adjust, or reject anything until the future human Attendance test is complete.

## 10. Employee Final Check

The employee Staff App projection is active and login-enabled.

Available read surfaces confirmed in code:

- `/staff/roster`: published schedule and approved Leave
- `/staff/timesheet`: Attendance results and read-only `My overtime`

No employee device action was taken during this preparation.

## 11. Cleanup Recommendation

No cleanup is required because this preparation created no roster revision, Expected Day, Attendance, OT review, Timesheet, or Payroll data.

For a later successful test, retain the canonical audit trail. After UAT, revert only through a new canonical roster revision if operational cleanup is necessary; do not delete published evidence, Attendance, OT review, or Timesheet records directly.

## 12. Final Verdict

**BLOCKED — APPROVED LEAVE CONFLICT**

Today is unsuitable because `TWILIO-OTP-QA` has approved full-day Leave on 27–28 Aug 2026. The manager OT detail flow also rejects Leave/Attendance conflicts, so proceeding today would not provide a valid OT UAT result.

Next safest date recommendation:

- `31 Aug 2026` currently has no published assignment, no approved Leave, and no Attendance for this employee in the inspected Testing data.
- Rerun the full precheck on 31 Aug before any mutation.
- If still clean, prepare the short shift through the canonical roster workflow at that time.
- Do not pre-create Attendance, clock events, OT, Timesheet, Payroll, or Payslip.

## Preparation Summary

- Data created: `NONE`
- Code changed: `NO`
- Deployment: `NOT REQUIRED`
- Production touched: `NO`
- Real Device OT UAT: `NOT YET PASS — HUMAN ACTION REQUIRED`

