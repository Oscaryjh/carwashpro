import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  addDays,
  assertWeeklyPeriod,
  changedRosterAssignments,
  expectedKindForRoster,
  rosterAssignmentDigest,
  scheduledPaidMinutes,
  startOfIsoWeek,
  validateRosterAssignment,
} from "../../src/lib/roster/domain";

test("Roster Phase 1 normalizes Monday weeks and preserves blank-day semantics", () => {
  const day = new Date("2026-08-20T00:00:00.000Z");
  assert.equal(startOfIsoWeek(day).toISOString().slice(0, 10), "2026-08-17");
  assert.equal(addDays(startOfIsoWeek(day), 6).toISOString().slice(0, 10), "2026-08-23");
  assert.doesNotThrow(() => assertWeeklyPeriod(new Date("2026-08-17T00:00:00.000Z"), day));
  assert.throws(() => assertWeeklyPeriod(new Date("2026-08-18T00:00:00.000Z")), /Monday/);
  assert.equal(expectedKindForRoster("WORK_SHIFT"), "WORKDAY");
  assert.equal(expectedKindForRoster("REST_DAY"), "REST_DAY");
  assert.equal(expectedKindForRoster("NOT_SCHEDULED"), "NOT_SCHEDULED");
});

test("Shift-based roster calculates paid time for daytime and overnight templates", () => {
  assert.equal(scheduledPaidMinutes({ startMinute: 10 * 60 + 45, endMinute: 19 * 60 + 45, breakMinutes: 60 }), 480);
  assert.equal(scheduledPaidMinutes({ startMinute: 15 * 60, endMinute: 0, breakMinutes: 60 }), 480);
  assert.equal(scheduledPaidMinutes({ startMinute: 9 * 60, endMinute: 18 * 60, breakMinutes: 60, breakPaid: true }), 540);
});

test("Shift-based roster contract uses default schedules plus weekly exceptions", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const scheduleService = readFileSync("src/lib/roster/employee-schedule-service.ts", "utf8");
  const quickAssign = readFileSync("src/app/(business)/team/roster/roster-quick-assign.tsx", "utf8");
  const staffPage = readFileSync("src/app/staff/roster/page.tsx", "utf8");
  assert.match(schema, /model EmployeeRosterScheduleVersion/);
  assert.match(schema, /EmployeeRosterRestPolicy/);
  assert.match(schema, /RosterResolvedSource/);
  assert.match(scheduleService, /VARIABLE/);
  assert.match(scheduleService, /Roster requires attention|attention/);
  assert.match(quickAssign, /Reset to normal schedule/i);
  assert.match(scheduleService, /BEFORE_SCHEDULE_START/);
  assert.match(scheduleService, /NO_DEFAULT_SCHEDULE/);
  assert.match(scheduleService, /addEmployeeRecurringRestDay/);
  assert.match(scheduleService, /EMPLOYEE_RECURRING_REST_DAY_ADDED/);
  assert.match(staffPage, /Approved Leave/);
  assert.match(staffPage, /branchId: activeBranchId/);
});

test("Roster assignment validation supports overnight work but rejects unsafe duration and non-work times", () => {
  assert.deepEqual(validateRosterAssignment({
    membershipId: "employee",
    workDate: new Date("2026-08-17T00:00:00.000Z"),
    kind: "WORK_SHIFT",
    startAt: new Date("2026-08-17T14:00:00.000Z"),
    endAt: new Date("2026-08-17T22:00:00.000Z"),
    breakMinutes: 60,
  }), { breakMinutes: 60, durationMinutes: 480 });
  assert.throws(() => validateRosterAssignment({
    membershipId: "employee",
    workDate: new Date("2026-08-17T00:00:00.000Z"),
    kind: "REST_DAY",
    startAt: new Date("2026-08-17T01:00:00.000Z"),
  }), /cannot contain shift times/);
  assert.throws(() => validateRosterAssignment({
    membershipId: "employee",
    workDate: new Date("2026-08-17T00:00:00.000Z"),
    kind: "WORK_SHIFT",
    startAt: new Date("2026-08-17T01:00:00.000Z"),
    endAt: new Date("2026-08-18T02:00:00.000Z"),
  }), /24 hours/);
});

test("Roster publication digest is deterministic", () => {
  assert.equal(
    rosterAssignmentDigest([{ workDate: "2026-08-17", kind: "WORK_SHIFT" }]),
    rosterAssignmentDigest([{ kind: "WORK_SHIFT", workDate: "2026-08-17" }]),
  );
});

test("Roster retrospective review only considers assignments changed by the current Draft", () => {
  const monday = new Date("2026-08-10T00:00:00.000Z");
  const saturday = new Date("2026-08-15T00:00:00.000Z");
  const unchangedPast = {
    membershipId: "employee",
    workDate: monday,
    kind: "WORK_SHIFT" as const,
    startAt: new Date("2026-08-10T01:00:00.000Z"),
    endAt: new Date("2026-08-10T09:00:00.000Z"),
    breakMinutes: 60,
  };
  const priorFuture = {
    ...unchangedPast,
    workDate: saturday,
    startAt: new Date("2026-08-15T01:00:00.000Z"),
    endAt: new Date("2026-08-15T09:00:00.000Z"),
  };
  const changedFuture = {
    ...priorFuture,
    startAt: new Date("2026-08-15T02:00:00.000Z"),
    endAt: new Date("2026-08-15T10:00:00.000Z"),
  };
  assert.deepEqual(
    changedRosterAssignments([unchangedPast, changedFuture], [unchangedPast, priorFuture]).map((item) => item.workDate),
    [saturday],
    "An unchanged earlier date must not make a future-only amendment retrospective",
  );
});

test("Roster contract keeps Draft, published history, Staff visibility and Attendance boundaries explicit", () => {
  const service = readFileSync("src/lib/roster/service.ts", "utf8");
  const staffPage = readFileSync("src/app/staff/roster/page.tsx", "utf8");
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  assert.match(service, /RETROSPECTIVE_REVIEW_REQUIRED/);
  assert.match(service, /TIMESHEET_REOPEN_REQUIRED/);
  assert.match(service, /source: "ROSTER"/);
  assert.match(service, /payrollEffect: "NONE"/);
  assert.match(service, /publicationRevision/);
  assert.match(staffPage, /No effective schedule available/);
  assert.match(staffPage, /Unspecified · not an Off Day/);
  assert.match(service, /ensureEffectiveRosterExpectedDayInTransaction/);
  assert.match(schema, /model RosterPublishedAssignment/);
  assert.match(schema, /evidenceDisposition\s+RosterEvidenceDisposition/);
});

test("Roster manager UX keeps normal schedules primary and weekly changes exceptional", () => {
  const managerPage = readFileSync("src/app/(business)/team/roster/page.tsx", "utf8");
  const assignmentFields = readFileSync(
    "src/app/(business)/team/roster/roster-assignment-fields.tsx",
    "utf8",
  );
  const toolDialog = readFileSync(
    "src/app/(business)/team/roster/roster-tool-dialog.tsx",
    "utf8",
  );

  assert.match(managerPage, /Normal schedules are already shown/);
  assert.match(managerPage, /Review the Draft, then publish it/);
  assert.match(managerPage, /Weekly changes take effect after publishing/);
  assert.match(managerPage, /unpublishedChanges \? <section aria-label="Draft and publishing"/);
  assert.match(managerPage, /Bulk assign/);
  assert.match(managerPage, /Choose one action/);
  assert.match(managerPage, /<RosterToolDialog/);
  assert.match(toolDialog, /showModal\(\)/);
  assert.match(toolDialog, /<dialog/);
  assert.match(toolDialog, /event\.target === event\.currentTarget/);
  assert.doesNotMatch(managerPage, /Manage shift templates/);
  assert.match(managerPage, /<input name="branchId" type="hidden" value=\{branchId\} \/>/);
  assert.doesNotMatch(managerPage, /<select defaultValue=\{branchId\} name="branchId">/);
  assert.match(assignmentFields, /Paid work target/);
  assert.match(assignmentFields, /kind === "WORK_SHIFT"/);
  assert.match(assignmentFields, /Explicit Rest Day/);
});

test("Day Roster opens and closes without moving the calendar scroll position", () => {
  const rosterViews = readFileSync("src/app/(business)/team/roster/roster-views.tsx", "utf8");
  const dayPanel = readFileSync("src/app/(business)/team/roster/day-roster-panel.tsx", "utf8");

  assert.match(rosterViews, /aria-label=\{`Open roster for \$\{dateLabel\}`\}[\s\S]*scroll=\{false\}/);
  assert.match(dayPanel, /aria-label="Close day roster"[\s\S]*scroll=\{false\}/);
});

test("Roster Phase 1 includes versioned Shift Templates and real Staff, Shift and Monthly views", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const templateService = readFileSync("src/lib/roster/shift-template-service.ts", "utf8");
  const templatePage = readFileSync("src/app/(business)/team/roster/templates/page.tsx", "utf8");
  const templateDialog = readFileSync("src/app/(business)/team/roster/templates/shift-template-create-dialog.tsx", "utf8");
  const defaultSchedulesDialog = readFileSync("src/app/(business)/team/roster/templates/default-schedules-dialog.tsx", "utf8");
  const employeeSchedulesPage = readFileSync("src/app/(business)/team/roster/employee-schedules/page.tsx", "utf8");
  const managerPage = readFileSync("src/app/(business)/team/roster/page.tsx", "utf8");
  const views = readFileSync("src/app/(business)/team/roster/roster-views.tsx", "utf8");

  assert.match(schema, /model RosterShiftTemplate/);
  assert.match(schema, /shiftNameSnapshot/);
  assert.match(templateService, /SHIFT_TEMPLATE_CREATED/);
  assert.match(templateService, /CONCURRENT_CHANGE/);
  assert.match(templateService, /historicalRosterSnapshotsChanged: false/);
  assert.match(templatePage, /branches\.length > 1/);
  assert.match(templatePage, /Change branch only when you need to manage another location/);
  assert.doesNotMatch(templatePage, /Switch branch/);
  assert.match(templatePage, /<ShiftTemplateCreateDialog>/);
  assert.match(templatePage, /ALL SHIFTS/);
  assert.match(templatePage, /It will be saved for/);
  assert.doesNotMatch(templatePage, /Available at/);
  assert.match(templateDialog, /showModal\(\)/);
  assert.match(templateDialog, />New shift</);
  assert.match(templatePage, /<DefaultSchedulesDialog/);
  assert.match(defaultSchedulesDialog, />Default schedules</);
  assert.match(defaultSchedulesDialog, /showModal\(\)/);
  assert.match(employeeSchedulesPage, /<h1>Default schedules<\/h1>/);
  assert.match(employeeSchedulesPage, />Back to shift settings</);
  assert.doesNotMatch(employeeSchedulesPage, /scheduleExplainer/);
  assert.match(employeeSchedulesPage, /branches\.length > 1/);
  assert.match(employeeSchedulesPage, /scheduleChangeLink/);
  assert.match(employeeSchedulesPage, /selectedEmployeeId/);
  assert.doesNotMatch(employeeSchedulesPage, />Set schedule</);
  assert.doesNotMatch(employeeSchedulesPage, /Change employee schedule/);
  assert.doesNotMatch(templatePage, /Save revision/);
  assert.match(templatePage, /<button type="submit">Save<\/button>/);
  assert.match(views, /export function StaffRosterView/);
  assert.match(views, /export function ShiftRosterView/);
  assert.match(views, /Who is scheduled for each shift\?/);
  assert.match(views, /Rest, availability and leave/);
  assert.match(views, /function CoveragePerson/);
  assert.match(views, /category: "SHIFT" \| "REST_DAY" \| "NOT_SCHEDULED" \| "LEAVE"/);
  assert.match(views, /export function MonthlyRosterView/);
  assert.match(views, /className=\{styles\.monthDayHitArea\}/);
  assert.match(views, /Open roster for \$\{dateLabel\}/);
  assert.match(managerPage, /resolvedMonthAssignments/);
  assert.match(managerPage, /monthWeekStarts\(range\.from, range\.to\)/);
  assert.match(managerPage, /weekStart: monthWeekStart/);
  assert.match(managerPage, /Publish \{monthName\}/);
  assert.match(managerPage, /Staff App and Attendance update together/);
  assert.match(managerPage, /Calendar edge weeks/);
  assert.match(views, /Approved Leave conflict/i);
  assert.match(views, /holidayBadge/);
});

test("Monthly roster publishing keeps weekly evidence versions behind one HR action", () => {
  const actions = readFileSync("src/app/(business)/team/roster/actions.ts", "utf8");
  const managerPage = readFileSync("src/app/(business)/team/roster/page.tsx", "utf8");

  assert.match(actions, /export async function publishRosterMonthAction/);
  assert.match(actions, /const weekStarts = monthWeekStarts\(month\)/);
  assert.match(actions, /await ensureRosterPeriod/);
  assert.match(actions, /if \(period\.publicationRevision > 0 && period\.status === "PUBLISHED"\) continue/);
  assert.match(actions, /Complete the Rest Days for the week of/);
  assert.match(actions, /confirmedEmptyWeeks\.has\(dateValue\(period\.weekStart\)\)/);
  assert.match(actions, /await assertRosterPublishDatesUnlocked\(/);
  assert.match(actions, /pending\.flatMap\(\(period\) => Array\.from\(\{ length: 7 \}/);
  assert.match(actions, /await publishRoster\(/);
  assert.match(managerPage, /action=\{publishRosterMonthAction\}/);
  assert.match(managerPage, /One action creates/);
  assert.match(managerPage, /weekly roster version/);
  assert.match(managerPage, /name="confirmEmptyWeek"/);
  assert.match(managerPage, /Confirm no employee shifts/);
  assert.match(managerPage, /weeks published; remaining weeks paused/);
  assert.match(managerPage, /Open monthly timesheet/);
});

test("Simple Roster UX uses one date-and-staff shift picker across Month, Week and Staff views", () => {
  const managerPage = readFileSync("src/app/(business)/team/roster/page.tsx", "utf8");
  const shiftSettingsPage = readFileSync("src/app/(business)/team/roster/templates/page.tsx", "utf8");
  const defaultSchedulesDialog = readFileSync("src/app/(business)/team/roster/templates/default-schedules-dialog.tsx", "utf8");
  const views = readFileSync("src/app/(business)/team/roster/roster-views.tsx", "utf8");
  const dayPanel = readFileSync("src/app/(business)/team/roster/day-roster-panel.tsx", "utf8");
  const quickAssign = readFileSync("src/app/(business)/team/roster/roster-quick-assign.tsx", "utf8");
  const staffPage = readFileSync("src/app/staff/roster/page.tsx", "utf8");

  assert.match(managerPage, />Month</);
  assert.match(managerPage, />Week</);
  assert.match(managerPage, />Staff</);
  assert.match(managerPage, />Coverage</);
  assert.match(managerPage, /Staff by shift/);
  assert.match(managerPage, />Coverage<[\s\S]*aria-label="Shift settings"/);
  assert.match(managerPage, /const query = view === "coverage" \? ""/);
  assert.match(managerPage, /view !== "coverage" \? <details className=\{styles\.rosterSearch\}/);
  assert.match(managerPage, /className=\{styles\.viewTabs\}/);
  assert.doesNotMatch(managerPage, /viewTabsMonth/);
  assert.match(managerPage, /aria-label="Roster publication details"/);
  assert.doesNotMatch(managerPage, /Last published \{formatDateTime/);
  assert.doesNotMatch(managerPage, />Audit details</);
  assert.doesNotMatch(managerPage, />Employee schedules</);
  assert.match(managerPage, />Shift settings</);
  assert.match(shiftSettingsPage, /aria-label="Roster views"/);
  assert.match(shiftSettingsPage, /aria-current="page" aria-label="Shift settings"/);
  assert.match(shiftSettingsPage, />Month</);
  assert.match(shiftSettingsPage, />Week</);
  assert.match(shiftSettingsPage, />Staff</);
  assert.match(shiftSettingsPage, />Coverage</);
  assert.doesNotMatch(shiftSettingsPage, />Back to roster</);
  assert.match(shiftSettingsPage, /<DefaultSchedulesDialog/);
  assert.match(defaultSchedulesDialog, />Default schedules</);
  assert.doesNotMatch(shiftSettingsPage, /<h1>Shift settings<\/h1>/);
  assert.doesNotMatch(shiftSettingsPage, /HR · SCHEDULING/);
  assert.match(shiftSettingsPage, /aria-label="Shift settings actions"/);
  assert.doesNotMatch(managerPage, /HR · SCHEDULING/);
  assert.doesNotMatch(managerPage, /className="page-header hr-module-header"/);
  assert.doesNotMatch(managerPage, /<details className={styles\.moreMenu}>/);
  assert.doesNotMatch(managerPage, /Week of/);
  assert.match(views, /dayHrefBase.*day=/s);
  assert.match(views, /export function EmployeeRosterView/);
  assert.match(views, /export function StaffScheduleGridView/);
  assert.match(views, /staffScheduleCellButton/);
  assert.match(views, /className=\{styles\.staffScheduleDate\}/);
  assert.doesNotMatch(views, /styles\.staffScheduleToday|styles\.monthDayToday|styles\.todayColumn/);
  assert.match(dayPanel, /Working/);
  assert.match(dayPanel, /On Leave/);
  assert.match(dayPanel, /className=\{styles\.dayDrawer\}/);
  assert.match(dayPanel, /className=\{styles\.dayRosterRow\}/);
  assert.match(dayPanel, /RosterQuickAssign/);
  assert.match(quickAssign, /Select schedule/i);
  assert.match(quickAssign, /Reset to normal schedule/);
  assert.match(quickAssign, /Custom time/);
  assert.match(quickAssign, /This date only · does not repeat/);
  assert.match(quickAssign, /addEmployeeRecurringRestDayAction/);
  assert.match(quickAssign, /role="switch"/);
  assert.match(quickAssign, /aria-label=\{`Repeat \$\{restWeekday\} as this employee's weekly Rest Day`\}/);
  assert.doesNotMatch(quickAssign, />Repeat every \{restWeekday\}</);
  assert.match(quickAssign, /dialogRef\.current\?\.showModal\(\)/);
  assert.match(quickAssign, /<dialog[\s\S]*className=\{styles\.quickAssignDialog\}/);
  assert.doesNotMatch(quickAssign, /className=\{styles\.drawerBackdrop\}/);
  assert.doesNotMatch(dayPanel, /MATERIALISED_DEFAULT|EFFECTIVE_DEFAULT|WEEKLY_SHIFT_OVERRIDE/);
  assert.doesNotMatch(staffPage, /Published revision|Effective default schedule/);
});
