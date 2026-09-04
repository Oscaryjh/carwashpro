import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { EmployeeTimesheetDay } from "@/lib/attendance/employee-timesheet";
import {
  buildStaffTimesheetV2Rows,
  parseStaffTimesheetMonth,
  staffTimesheetDuration,
  staffTimesheetMonthHref,
  staffTimesheetNextAction,
  staffTimesheetOvertimeLine,
  staffTimesheetSummaryItems,
  summarizeStaffTimesheetV2,
  type StaffTimesheetV2Overtime,
} from "@/lib/staff-pwa/timesheet-v2";

const page = readFileSync("src/app/staff/timesheet/page.tsx", "utf8");
const component = readFileSync("src/components/staff-pwa/staff-timesheet-v2.tsx", "utf8");
const css = readFileSync("src/components/staff-pwa/staff-timesheet-v2.module.css", "utf8");
const loading = readFileSync("src/app/staff/timesheet/loading.tsx", "utf8");
const error = readFileSync("src/app/staff/timesheet/error.tsx", "utf8");
const navigation = readFileSync("src/lib/staff-pwa/navigation.ts", "utf8");

test("/staff/timesheet renders Timesheet & OT V2 from the existing overview reader", () => {
  assert.match(page, /getEmployeeTimesheetOverview\(auth, \{ now: monthStart \}\)/);
  assert.match(page, /<StaffTimesheetV2/);
  assert.match(component, /title="Timesheet & overtime"/);
  assert.doesNotMatch(component, /TimesheetMegaCard|TimesheetDayCardV2|OvertimeCardWall/);
});

test("validated month query falls back safely and powers previous/next navigation", () => {
  const fallback = new Date("2026-08-22T10:00:00.000Z");
  assert.equal(parseStaffTimesheetMonth("2026-07", fallback).toISOString(), "2026-07-01T00:00:00.000Z");
  assert.equal(parseStaffTimesheetMonth("2026-13", fallback).toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal(parseStaffTimesheetMonth(["2026-07"], fallback).toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal(staffTimesheetMonthHref(fallback, -1), "/staff/timesheet?month=2026-07");
  assert.equal(staffTimesheetMonthHref(fallback, 1), "/staff/timesheet?month=2026-09");
  assert.match(component, /ariaLabel="Timesheet month"/);
});

test("Attendance day and OT safely presentation-merge by membership and date", () => {
  const rows = buildStaffTimesheetV2Rows({
    days: [day()],
    overtime: [ot({ status: "PENDING_REVIEW" })],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.day?.key, "day-1");
  assert.equal(rows[0]?.overtime?.key, "ot-1");
  assert.equal(rows[0]?.status, "WAITING_FOR_MANAGER");
});

test("employee action takes precedence over pending OT on the same date", () => {
  const rows = buildStaffTimesheetV2Rows({
    days: [day({ status: "ACTION_NEEDED", actionableException: { id: "ex-1", type: "MISSING_CLOCK_OUT" } })],
    overtime: [ot({ status: "PENDING_REVIEW" })],
  });
  assert.equal(rows[0]?.status, "ACTION_NEEDED");
});

test("unmatched OT remains one compact fallback row", () => {
  const rows = buildStaffTimesheetV2Rows({ days: [], overtime: [ot()] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.day, null);
  assert.equal(rows[0]?.overtime?.key, "ot-1");
});

test("summary counts unique presentation dates without double counting day and OT", () => {
  const rows = buildStaffTimesheetV2Rows({
    days: [day()],
    overtime: [ot({ status: "PENDING_REVIEW" })],
  });
  const summary = summarizeStaffTimesheetV2(rows, "DRAFT");
  assert.deepEqual(summary, { action: 0, waiting: 1, final: 0, rows: 1, state: "WAITING_FOR_MANAGER" });
});

test("draft month with no open actions is Up to date and locked month is Final", () => {
  const rows = buildStaffTimesheetV2Rows({ days: [day()], overtime: [] });
  assert.equal(summarizeStaffTimesheetV2(rows, "DRAFT").state, "UP_TO_DATE");
  assert.equal(summarizeStaffTimesheetV2(rows, "LOCKED").state, "FINAL");
});

test("normal month summary is one natural employee summary with singular/plural grammar", () => {
  assert.deepEqual(
    staffTimesheetSummaryItems({ action: 0, waiting: 0, final: 1, rows: 1, state: "FINAL" }),
    [{ label: "Final", value: "1 workday" }],
  );
  assert.deepEqual(
    staffTimesheetSummaryItems({ action: 0, waiting: 0, final: 2, rows: 2, state: "UP_TO_DATE" }),
    [{ label: "Up to date", value: "2 workdays" }],
  );
});

test("open-issue month keeps useful unique-date counters and natural grammar", () => {
  assert.deepEqual(
    staffTimesheetSummaryItems({ action: 1, waiting: 2, final: 3, rows: 6, state: "ACTION_NEEDED" }),
    [
      { label: "Attention", value: "1 item needs attention" },
      { label: "Manager review", value: "2 items awaiting manager review" },
      { label: "Final", value: "3 workdays" },
    ],
  );
  assert.deepEqual(
    staffTimesheetSummaryItems({ action: 2, waiting: 1, final: 0, rows: 3, state: "ACTION_NEEDED" }),
    [
      { label: "Attention", value: "2 items need attention" },
      { label: "Manager review", value: "1 item awaiting manager review" },
    ],
  );
});

test("collapsed Final remains visible while expanded Final detail does not repeat its badge", () => {
  assert.match(component, /<StaffV2StatusBadge tone=\{tone\}>\{statusLabel\}<\/StaffV2StatusBadge>/);
  assert.match(component, /row\.status !== "FINAL" \? \(/);
});

test("Next action appears only when it explains an exception or manager wait", () => {
  const finalRow = buildStaffTimesheetV2Rows({ days: [day()], overtime: [] })[0];
  const actionRow = buildStaffTimesheetV2Rows({
    days: [day({ status: "ACTION_NEEDED", actionableException: { id: "ex-1", type: "MISSING_CLOCK_OUT" } })],
    overtime: [],
  })[0];
  const waitingRow = buildStaffTimesheetV2Rows({
    days: [day({ status: "WAITING_FOR_MANAGER" })],
    overtime: [],
  })[0];
  const pendingOtRow = buildStaffTimesheetV2Rows({ days: [day()], overtime: [ot()] })[0];

  assert.equal(staffTimesheetNextAction(finalRow!), null);
  assert.equal(staffTimesheetNextAction(actionRow!), "Fix your missing clock out.");
  assert.equal(staffTimesheetNextAction(waitingRow!), "No action — your manager needs to review this day.");
  assert.equal(staffTimesheetNextAction(pendingOtRow!), "No action — your manager is reviewing the overtime.");
  assert.doesNotMatch(component, /No action needed\./);
  assert.match(component, /\{nextActionCopy \? \(/);
});

test("employee-actionable missing time links to canonical Attendance correction flow", () => {
  assert.match(component, /row\.status === "ACTION_NEEDED"/);
  assert.match(component, /row\.day\?\.actionableException \|\| row\.day\?\.resolutionCase/);
  assert.match(component, /row\.day\.resolutionCase/);
  assert.match(component, /"\/staff#attendance-issues"/);
  assert.match(component, /"\/staff\/history\/records#attendance-correction"/);
  assert.doesNotMatch(component, /StaffP2CorrectionForm|p2-corrections/);
});

test("non-self-correctable review gets no employee CTA", () => {
  const rows = buildStaffTimesheetV2Rows({
    days: [day({ status: "WAITING_FOR_MANAGER", actionableException: null })],
    overtime: [],
  });
  assert.equal(rows[0]?.status, "WAITING_FOR_MANAGER");
  assert.equal(
    staffTimesheetNextAction(rows[0]!),
    "No action — your manager needs to review this day.",
  );
});

test("pending, approved, adjusted and rejected OT use employee-safe copy", () => {
  assert.equal(staffTimesheetOvertimeLine(ot({ status: "PENDING_REVIEW" })), "OT · Potential 1 hr 30 min");
  assert.equal(staffTimesheetOvertimeLine(ot({ status: "APPROVED", approvedMinutes: 90 })), "OT · 1 hr 30 min approved");
  assert.equal(staffTimesheetOvertimeLine(ot({ status: "ADJUSTED", approvedMinutes: 60 })), "OT · 1 hr approved");
  assert.equal(staffTimesheetOvertimeLine(ot({ status: "REJECTED" })), "Overtime not approved");
  assert.match(component, /Manager reason/);
});

test("friendly duration formatting never exposes raw primary minute integers", () => {
  assert.equal(staffTimesheetDuration(45), "45 min");
  assert.equal(staffTimesheetDuration(60), "1 hr");
  assert.equal(staffTimesheetDuration(90), "1 hr 30 min");
});

test("employee never receives a Submit OT action", () => {
  assert.doesNotMatch(component, /Submit OT|Approve overtime|Adjust overtime/);
  assert.doesNotMatch(page, /decideAttendanceOvertime/);
});

test("Result Why and Next action are detail-only and paid leave has no dash metrics", () => {
  assert.match(component, /<details>/);
  assert.match(component, /StaffV2DetailSection title="Result"/);
  assert.match(component, /StaffV2DetailSection title="Why"/);
  assert.match(component, /StaffV2DetailSection title="Next action"/);
  assert.match(component, /APPROVED_PAID_LEAVE: "Approved paid leave"/);
  assert.doesNotMatch(component, />—</);
});

test("locked snapshot wording stays final and payroll-safe", () => {
  assert.match(page, /overview\.timesheetStatus === "LOCKED"/);
  assert.match(component, /This record will be used for payroll/);
  assert.match(component, /StaffV2DetailSection title="Payroll"/);
  assert.doesNotMatch(component, /snapshot|revision|digest|materialization/i);
});

test("loading and error states are stable and employee-safe", () => {
  assert.match(loading, /aria-busy="true"/);
  assert.equal((loading.match(/staffV2Styles\.skeleton/g) ?? []).length, 3);
  assert.match(loading, /Array\.from\(\{ length: 3 \}/);
  assert.match(error, /Timesheet couldn&apos;t load/);
  assert.match(error, /role="alert"/);
  assert.doesNotMatch(error, /Prisma|database|projector|enum/i);
});

test("360, 390 and 412 mobile geometry remains overflow-safe", () => {
  assert.match(css, /grid-template-columns:\s*58px minmax\(0, 1fr\) 18px/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media \(max-width: 380px\)/);
  assert.match(css, /@media \(min-width: 381px\) and \(max-width: 430px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("bottom navigation keeps Time separate from permission-gated Approvals", () => {
  for (const label of ["Home", "Time", "Approvals", "Pay", "Profile"]) {
    assert.match(navigation, new RegExp(`label: "${label}"`));
  }
});

function day(overrides: Partial<EmployeeTimesheetDay> = {}): EmployeeTimesheetDay {
  return {
    key: "day-1",
    source: "LIVE_FINAL",
    businessId: "business-1",
    branchId: "branch-1",
    membershipId: "membership-1",
    workDate: new Date("2026-08-30T00:00:00.000Z"),
    status: "FINAL",
    outcome: "PRESENT",
    actualClockInAt: new Date("2026-08-30T08:00:00.000Z"),
    actualClockOutAt: new Date("2026-08-30T17:00:00.000Z"),
    totalBreakMinutes: 60,
    totalWorkedMinutes: 480,
    issues: [],
    actionableException: null,
    ...overrides,
  };
}

function ot(overrides: Partial<StaffTimesheetV2Overtime> = {}): StaffTimesheetV2Overtime {
  return {
    key: "ot-1",
    membershipId: "membership-1",
    workDate: new Date("2026-08-30T00:00:00.000Z"),
    finalResultId: "final-1",
    status: "PENDING_REVIEW",
    potentialMinutes: 90,
    approvedMinutes: 0,
    managerReason: null,
    locked: false,
    ...overrides,
  };
}
