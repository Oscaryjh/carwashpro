# Tetamu Roster — Simple Scheduling Final Closure

Environment: **Local / Testing only**. Production was not accessed or validated.

## Previous implementation audit

| Decision | Result |
| --- | --- |
| KEEP | Shift Templates, weekly grid, Quick Assign, bulk/copy, Draft/Publish, revision audit, RBAC and Attendance evidence protection |
| ADAPT | Weekly Roster now stores exceptions over an effective employee schedule instead of materialising every inherited day |
| REMOVE / REWORK | Generic recurring work-pattern service, its management page and the unexecuted work-pattern migration |
| NOT IMPLEMENTED | AI scheduling, rotating-pattern engine, shift bidding and automatic labour-law decisions |

No destructive Git operation was used. Existing dirty changes were preserved. The removed migration had not been applied; the replacement migration was deployed normally.

## Canonical roster architecture

```text
Business / Branch
  -> Shift Templates
  -> Employee Effective Schedule
       -> optional Default Shift
       -> Fixed Rest Days or Variable Rest requirement
  -> Weekly Roster Exceptions
  -> Resolved Effective Schedule
  -> Published immutable schedule snapshots when weekly publication is required
  -> AttendanceExpectedDay
  -> Attendance and Resolution
  -> Locked Timesheet
  -> Payroll
```

Roster defines planned work. It does not record actual attendance, calculate salary or decide payroll deductions.

## Shift templates

- Business-wide or branch-specific scope remains tenant isolated.
- Name, optional short code, start/end, break duration, paid/unpaid break, colour, active state and display order are supported.
- `end < start` is an overnight shift ending on the next calendar day.
- Scheduled and paid minutes are calculated from time and break treatment.
- Assignments and publications snapshot template facts, so later template edits never rewrite historical roster evidence.

## Employee default schedule

- A schedule version belongs to the correct business membership and branch.
- Default Shift is optional for part-time, freelancer, on-call or fully variable staff.
- Versions are effective-dated. A future change does not rewrite earlier schedules or published evidence.
- The UI explains the three product concepts: Default Shift, Rest policy and Weekly exceptions.

## Rest Day policy

### Fixed

Zero or more weekdays may be configured as recurring Rest Days. Normal workdays inherit the Default Shift automatically, so the manager does not need to publish an unchanged week.

### Variable

A required weekly Rest Day count is configured. The manager selects the actual Rest Day dates in the weekly roster. If the requirement is not met, the week is marked as requiring attention and publication is blocked. The system never silently resolves the employee as working all seven days.

`REST_DAY`, approved Leave, Public Holiday, `NOT_SCHEDULED` and an unassigned day retain separate meanings.

## Weekly exceptions

- Normal cells are resolved from the effective employee schedule.
- Temporary shift changes, Rest Day moves, `NOT_SCHEDULED` days and custom shifts are exceptions for specific dates only.
- Reset deletes the weekly override and immediately returns the day to its inherited default; it does not create a redundant override.
- Copy Previous Week copies exceptions only. It never flattens inherited days into seven manual assignments.
- Bulk assignment reuses the same scope, overlap, Leave and historical validation.
- Source labels explain whether a day came from Default Shift, Fixed Rest, Variable Rest or a Weekly/Custom override.

## Draft, publish and history

- Draft exceptions do not affect official Attendance evidence or Staff App effective schedules.
- Publish re-reads canonical state in a serializable transaction, validates the expected revision and creates immutable snapshots.
- Retrying publish is idempotent and does not duplicate evidence.
- Retrospective changes require a reason and remain audited.
- Locked Timesheet history cannot be silently rewritten.
- Fixed schedules without exceptions are available as an automatic effective baseline; no weekly Save/Publish ritual is required.

## Attendance, Leave and Public Holiday

- Fixed baseline evidence is materialised safely when Attendance needs it and only where no weekly publication supersedes it.
- Variable-rest weeks cannot produce final workday evidence until the weekly Rest requirement is resolved.
- Approved Leave stays owned by the Leave domain and takes precedence in roster display.
- Public Holiday stays owned by the holiday domain; it does not automatically mean the employee cannot work.
- Expected start/end, break and timezone flow to Attendance. Late/no-show policy stays in Attendance.
- Payroll continues to consume locked Timesheet outcomes, not Roster hours.

## Staff App

- Employees can view only their own effective schedule in the selected workplace.
- The mobile page shows day cards, clear dates, shifts, times, Rest Day/Leave/PH states and scheduled planning hours.
- Draft manager changes remain private.
- If no effective schedule exists, the UI says so and explicitly does not infer an Off Day.
- Published weekly changes replace the inherited baseline without exposing another employee's roster.

## Permissions and isolation

- Existing `VIEW_ROSTER`, `EDIT_ROSTER` and `PUBLISH_ROSTER` capabilities are reused; no duplicate permission family was added.
- Template and employee-schedule changes use the existing roster-management permission boundary.
- Server-side checks enforce business, branch, membership, employment status and own-roster scope.
- The same global employee may have different schedules in different businesses without data crossover.

## Notification decision

The repository currently has a WhatsApp-specific delivery queue, not a generic staff notification event bus. Roster publication remains fully audited, but no fake SMS, push or WhatsApp success is reported. Provider-neutral schedule-change delivery is deferred.

## Final simplified manager UX

The primary manager flow is now deliberately short:

```text
Open Roster
  -> Month / Week / Staff
  -> select a date or employee
  -> choose Rest Day, a saved Shift, Not Scheduled, or Custom time
  -> Save Draft
  -> Review changes
  -> Publish to Staff App and Attendance
```

- `Month` is the default overview. Normal schedules are expanded across the real calendar and a date opens the Day Roster drawer.
- Day Roster separates `Working` from `On Leave`; Leave remains read-only and owned by the Leave domain.
- `Week` is the team-by-day operating grid. `Staff` is a focused one-employee weekly view rather than another dense matrix.
- Month, Week and Staff reuse one shift picker. Managers do not need to learn separate assignment controls.
- The picker presents Rest Day, active Shift Templates and Not Scheduled first. `Custom time` remains a secondary advanced action.
- `Reset to normal schedule` removes the date override instead of writing a duplicate baseline assignment.
- Search is collapsed until needed. Previous/current/next controls match the active Month or Week context.
- Technical source names, materialisation terms and revision numbers are removed from normal manager and Staff App surfaces.
- Internal Employee Normal Schedules and Shift Coverage remain available under `More`; they are not part of the daily primary flow.
- Shift Template and Employee Schedule history, audit and immutable snapshots remain intact behind the simplified UI.
- Draft count represents actual unpublished exceptions, not inherited baseline days.
- Dates use unambiguous formats such as `10 Aug 2026` and `10–16 Aug 2026`.

## Product simplification audit

| Area | Final decision |
| --- | --- |
| Shift Templates, fixed/variable Rest policy, effective schedule versions | KEEP |
| Month, Week, Staff and Day Roster | REWORKED into the primary simple workflow |
| Weekly override picker | REWORKED into one shared picker |
| Employee Normal Schedules and Shift Coverage | KEEP under More |
| Technical materialisation/revision/source labels in daily UI | REMOVED from normal surfaces |
| Leave, Public Holiday, Attendance and Payroll ownership boundaries | KEEP |
| Custom/overnight shift editor | KEEP as advanced editing |
| AI scheduling, rotating patterns, shift bidding | DEFERRED |

## Verification

| Gate | Result |
| --- | --- |
| Roster targeted unit | 10/10 PASS |
| Roster targeted integration | 4/4 PASS |
| Full unit | 921/921 PASS |
| Full integration | 168/168 PASS |
| TypeScript | PASS |
| ESLint | PASS, 0 errors; 8 pre-existing non-Roster warnings |
| Prisma validate / generate | PASS |
| Migration status | 184 migrations, database up to date |
| Fresh migration rebuild | 184/184 PASS |
| Local production-mode build | PASS, 137 pages |
| Manager browser | Roster, Employee Schedules and Shift Templates accessible |
| Staff browser | Local QA login and own My Schedule accessible |
| 390px | Root/body horizontal overflow 0 |
| Browser runtime | Console errors 0, hydration errors 0, runtime error overlays 0 |

Two stale test expectations were aligned with already-existing behavior: the dev-supervisor WhatsApp configuration guard and the canonical seven payment-method reporting categories. No Roster business rule was weakened.

## Deferred

- AI auto scheduling and demand forecasting.
- Generic recurring/rotating work-pattern engine.
- Shift bidding and swap marketplace.
- Provider-neutral staff notification delivery.
- Malaysia labour-law automation.
- Roster-derived payroll amounts.

## Final status

```text
SIMPLE ROSTER UX
READY

MONTH / WEEK / STAFF / DAY ROSTER
READY

SHARED SHIFT PICKER
READY

DEFAULT SHIFT
READY

REST DAY POLICY
READY

WEEKLY EXCEPTIONS
READY

ROSTER -> ATTENDANCE EVIDENCE
READY

LOCAL / TESTING ONLY
PRODUCTION NOT ACCESSED
PRODUCTION NOT VALIDATED
```
