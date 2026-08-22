import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildStaffTimesheetDayView,
  staffTimesheetAttention,
  summarizeStaffTimesheet,
  type StaffTimesheetDay,
} from "../../src/lib/staff-pwa/timesheet";

const serviceSource = readFileSync(
  new URL("../../src/lib/attendance/employee-timesheet.ts", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../../src/app/staff/timesheet/page.tsx", import.meta.url),
  "utf8",
);
const loadingSource = readFileSync(
  new URL("../../src/app/staff/timesheet/loading.tsx", import.meta.url),
  "utf8",
);
const errorSource = readFileSync(
  new URL("../../src/app/staff/timesheet/error.tsx", import.meta.url),
  "utf8",
);
const cssSource = readFileSync(
  new URL("../../src/app/staff/staff.css", import.meta.url),
  "utf8",
);

function day(overrides: Partial<StaffTimesheetDay> = {}): StaffTimesheetDay {
  return {
    id: "day-1",
    workDate: new Date("2026-10-16T00:00:00.000Z"),
    outcome: "PRESENT",
    expectedDayKind: "WORKDAY",
    leaveName: null,
    leaveDayFraction: null,
    expectedStartAt: new Date("2026-10-16T03:45:00.000Z"),
    expectedEndAt: new Date("2026-10-16T12:45:00.000Z"),
    actualClockInAt: new Date("2026-10-16T03:45:00.000Z"),
    actualClockOutAt: new Date("2026-10-16T12:45:00.000Z"),
    timezone: "Asia/Kuala_Lumpur",
    totalBreakMinutes: 60,
    totalWorkedMinutes: 480,
    potentialOtMinutes: 0,
    approvedOtMinutes: 0,
    otApprovalStatus: "NOT_APPLICABLE",
    version: 1,
    locked: false,
    ...overrides,
  };
}

test("Timesheet compact row renders a normal confirmed day", () => {
  const view = buildStaffTimesheetDayView(day());
  assert.equal(view.label, "Present");
  assert.equal(view.timeLabel, "11:45 – 20:45");
  assert.equal(view.approvedOtLabel, null);
});

test("Timesheet shows only approved OT from the canonical day", () => {
  const view = buildStaffTimesheetDayView(day({
    actualClockOutAt: new Date("2026-10-16T15:45:00.000Z"),
    totalWorkedMinutes: 660,
    potentialOtMinutes: 180,
    approvedOtMinutes: 180,
    otApprovalStatus: "APPROVED",
  }));
  assert.equal(view.timeLabel, "11:45 – 23:45");
  assert.equal(view.approvedOtLabel, "OT 3h");
});

test("Timesheet keeps rest day, approved leave and public holiday outcomes distinct", () => {
  assert.equal(buildStaffTimesheetDayView(day({ outcome: "REST_DAY", actualClockInAt: null, actualClockOutAt: null, totalWorkedMinutes: 0 })).label, "Rest Day");
  const leave = buildStaffTimesheetDayView(day({
    outcome: "APPROVED_PAID_LEAVE",
    leaveName: "Annual Leave",
    leaveDayFraction: 1,
    actualClockInAt: null,
    actualClockOutAt: null,
    totalWorkedMinutes: 0,
  }));
  assert.equal(leave.label, "Annual Leave");
  assert.equal(leave.supportingLabel, "Approved");
  assert.equal(buildStaffTimesheetDayView(day({ outcome: "PUBLIC_HOLIDAY", expectedDayKind: "PUBLIC_HOLIDAY", actualClockInAt: null, actualClockOutAt: null, totalWorkedMinutes: 0 })).label, "Public Holiday");
});

test("Unresolved missing attendance is review-required, never an absence verdict", () => {
  const copy = staffTimesheetAttention("SUSPECTED_NO_SHOW");
  assert.equal(copy.label, "Missing attendance");
  assert.doesNotMatch(JSON.stringify(copy), /Unauthorized absence|No-show/i);
});

test("Unauthorized absence is displayed only when supplied as a final outcome", () => {
  const view = buildStaffTimesheetDayView(day({
    outcome: "UNAUTHORIZED_ABSENCE",
    actualClockInAt: null,
    actualClockOutAt: null,
    totalWorkedMinutes: 0,
  }));
  assert.equal(view.label, "Unauthorized absence");
  assert.equal(view.supportingLabel, "Final result");
});

test("Monthly summary uses canonical worked and approved values", () => {
  const summary = summarizeStaffTimesheet([
    day({ totalWorkedMinutes: 660, approvedOtMinutes: 180 }),
    day({ id: "leave", outcome: "APPROVED_PAID_LEAVE", leaveName: "Annual Leave", leaveDayFraction: 1, actualClockInAt: null, actualClockOutAt: null, totalWorkedMinutes: 0 }),
    day({ id: "rest", expectedDayKind: "REST_DAY", totalWorkedMinutes: 240, approvedOtMinutes: 0 }),
  ]);
  assert.equal(summary.workedDays, 2);
  assert.equal(summary.regularMinutes, 720);
  assert.equal(summary.approvedOtMinutes, 180);
  assert.equal(summary.leaveDays, 1);
  assert.equal(summary.restDayWorked, 1);
});

test("Employee Timesheet read model is month-bounded and locked-snapshot first", () => {
  assert.match(serviceSource, /workDate: \{ gte: period\.periodStart, lt: period\.periodEndExclusive \}/);
  assert.match(serviceSource, /timesheet\?\.status === "LOCKED"/);
  assert.match(serviceSource, /attendanceTimesheetP2DaySnapshot\.findMany/);
  assert.match(serviceSource, /revisionId: timesheet\.currentRevisionId/);
  assert.match(serviceSource, /exceptions: \[\]/);
  const lockedBranch = serviceSource.slice(
    serviceSource.indexOf("if (timesheet?.status === \"LOCKED\"") ,
    serviceSource.indexOf("const [rows, exceptions, overtime]"),
  );
  assert.doesNotMatch(lockedBranch, /attendanceP2FinalResult\.findMany/);
});

test("Timesheet page is compact, navigable and has meaningful system states", () => {
  assert.match(pageSource, /Monthly work record/);
  assert.match(pageSource, /Needs attention/);
  assert.match(pageSource, /<details className=\{`staff-timesheet-day/);
  assert.match(pageSource, /No work records yet/);
  assert.match(pageSource, /IN PROGRESS/);
  assert.match(pageSource, /LOCKED/);
  assert.doesNotMatch(pageSource, /null.*Unauthorized absence|Unauthorized absence.*null/s);
  assert.match(loadingSource, /staff-timesheet-skeleton-summary/);
  assert.match(errorSource, /Unable to load work records/);
  assert.match(errorSource, /reset: \(\) => void/);
  assert.match(errorSource, /onClick=\{reset\}/);
  assert.match(serviceSource, /effectiveStatus === "APPROVED" \|\| overtimeItem\.effectiveStatus === "ADJUSTED"/);
  assert.match(cssSource, /\.staff-timesheet-page\s*\{[\s\S]*?overflow-x:\s*clip/);
  assert.match(cssSource, /\.staff-timesheet-day summary\s*\{[\s\S]*?min-height:\s*58px/);
  assert.match(cssSource, /@media \(max-width: 430px\)[\s\S]*?\.staff-timesheet-day summary/);
});
