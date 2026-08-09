import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildAttendancePayrollComponents,
  buildPayrollAttendanceInput,
  proposeAttendancePayrollCorrection,
} from "../../src/lib/payroll/attendance-integration";

const periodStart = new Date("2026-08-01T00:00:00.000Z");

test("P5 consumes frozen final outcomes and never turns no-punch states into unpaid leave", () => {
  const attendance = buildPayrollAttendanceInput({
    membershipId: "member-1",
    payBasis: "DAILY",
    days: [
      day("present", "PRESENT", 480, "WORKDAY"),
      day("paid", "APPROVED_PAID_LEAVE", 0, "WORKDAY", 0.5),
      day("unpaid", "APPROVED_UNPAID_LEAVE", 0, "WORKDAY", 1),
      day("off", "NOT_SCHEDULED", 0, "NOT_SCHEDULED"),
    ],
  });
  assert.equal(attendance.regularDayHundredths, 100);
  assert.equal(attendance.paidLeaveDayHundredths, 50);
  assert.equal(attendance.unpaidLeaveDayHundredths, 100);
  assert.equal(attendance.unauthorizedAbsenceDayHundredths, 0);
  assert.deepEqual(attendance.policyBlockers, []);

  const lines = buildAttendancePayrollComponents({
    snapshotId: "10000000-0000-4000-8000-000000000001",
    timesheetRevision: 5,
    periodStart,
    payBasis: "DAILY",
    baseRateCents: 10_000,
    attendance,
  });
  assert.deepEqual(
    lines.map((line) => [line.code, line.amountCents, line.sourceType]),
    [
      ["REGULAR_DAILY_PAY", 10_000, "ATTENDANCE"],
      ["PAID_LEAVE_PAY", 5_000, "ATTENDANCE"],
    ],
  );
  assert.ok(lines.every((line) => line.sourceRevision === 5));
});

test("P5 hourly pay uses approved integer minutes with deterministic rounding", () => {
  const attendance = buildPayrollAttendanceInput({
    membershipId: "member-2",
    payBasis: "HOURLY",
    days: [day("hourly", "PRESENT_LATE_UNAUTHORIZED", 91, "WORKDAY")],
  });
  const first = buildAttendancePayrollComponents({
    snapshotId: "10000000-0000-4000-8000-000000000002",
    timesheetRevision: 2,
    periodStart,
    payBasis: "HOURLY",
    baseRateCents: 1_500,
    attendance,
  });
  const second = buildAttendancePayrollComponents({
    snapshotId: "10000000-0000-4000-8000-000000000002",
    timesheetRevision: 2,
    periodStart,
    payBasis: "HOURLY",
    baseRateCents: 1_500,
    attendance,
  });
  assert.deepEqual(first, second);
  assert.equal(first[0]?.amountCents, 2_275);
  assert.equal(attendance.approvedOvertimeMinutes, 0);
});

test("P5 keeps Monthly base salary separate and fails closed for unsupported money policies", () => {
  const fullMonth = buildPayrollAttendanceInput({
    membershipId: "member-3",
    payBasis: "MONTHLY",
    days: [day("normal", "PRESENT", 600, "WORKDAY")],
  });
  assert.deepEqual(fullMonth.policyBlockers, []);
  assert.deepEqual(
    buildAttendancePayrollComponents({
      snapshotId: "10000000-0000-4000-8000-000000000003",
      timesheetRevision: 1,
      periodStart,
      payBasis: "MONTHLY",
      baseRateCents: 350_000,
      attendance: fullMonth,
    }),
    [],
  );
  assert.equal(fullMonth.approvedOvertimeMinutes, 0);

  const unsupported = buildPayrollAttendanceInput({
    membershipId: "member-3",
    payBasis: "MONTHLY",
    days: [
      day("unpaid", "APPROVED_UNPAID_LEAVE", 0, "WORKDAY", 1),
      day("absence", "UNAUTHORIZED_ABSENCE", 0, "WORKDAY"),
      day("rest", "REST_DAY", 240, "REST_DAY"),
      day("ph", "PUBLIC_HOLIDAY", 480, "PUBLIC_HOLIDAY"),
    ],
  });
  assert.equal(unsupported.unpaidLeaveDayHundredths, 100);
  assert.equal(unsupported.unauthorizedAbsenceDayHundredths, 100);
  assert.deepEqual(unsupported.policyBlockers, [
    "PAYROLL_ABSENCE_RATE_POLICY_NOT_READY",
    "PUBLIC_HOLIDAY_RATE_POLICY_NOT_READY",
    "REST_DAY_RATE_POLICY_NOT_READY",
  ]);
  assert.deepEqual(
    buildAttendancePayrollComponents({
      snapshotId: "10000000-0000-4000-8000-000000000003",
      timesheetRevision: 1,
      periodStart,
      payBasis: "MONTHLY",
      baseRateCents: 350_000,
      attendance: unsupported,
    }),
    [],
  );
});

test("P5 correction bridge proposes a P4C-governed future delta without rewriting history", () => {
  const oldAttendance = buildPayrollAttendanceInput({
    membershipId: "member-4",
    payBasis: "HOURLY",
    days: [day("old", "PRESENT", 60, "WORKDAY")],
  });
  const newAttendance = buildPayrollAttendanceInput({
    membershipId: "member-4",
    payBasis: "HOURLY",
    days: [day("new", "PRESENT", 120, "WORKDAY")],
  });
  assert.deepEqual(
    proposeAttendancePayrollCorrection({
      payBasis: "HOURLY",
      baseRateCents: 1_500,
      periodStart,
      oldRevision: 3,
      newRevision: 4,
      oldAttendance,
      newAttendance,
    }),
    {
      status: "PROPOSED",
      oldAmountCents: 1_500,
      newAmountCents: 3_000,
      deltaType: "EARNING",
      deltaAmountCents: 1_500,
    },
  );
});

test("P5 service and migration enforce the locked snapshot boundary", () => {
  const service = readFileSync("src/lib/payroll/service.ts", "utf8");
  const bridge = readFileSync("src/lib/payroll/timesheet-bridge.ts", "utf8");
  const readiness = readFileSync("src/lib/payroll/readiness.ts", "utf8");
  const migration = readFileSync(
    "prisma/migrations/20260808234000_payroll_p5_attendance_integration/migration.sql",
    "utf8",
  );
  assert.match(service, /timesheet\.p2Days/);
  assert.match(service, /payrollAttendanceInputSnapshot\.upsert/);
  assert.doesNotMatch(service, /employeeAttendance\.findMany|leaveRequestDay\.findMany|payrollHoliday\.findMany/);
  assert.doesNotMatch(service, /calculatePayroll\(/);
  assert.match(bridge, /attendanceTimesheetP2DaySnapshot\.findMany/);
  assert.match(readiness, /STALE_ATTENDANCE_SOURCE/);
  assert.match(readiness, /ATTENDANCE_PAY_POLICY_NOT_READY/);
  assert.match(migration, /Payroll Attendance snapshot provenance mismatch/);
  assert.match(migration, /Attendance Payroll component must reference its exact employee snapshot/);
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN)/i);
  assert.doesNotMatch(migration, /UPDATE\s+"payroll_(runs|entries)"/i);
});

test("P5 keeps Attendance and Payroll permission surfaces separated", () => {
  const payrollActions = readFileSync(
    "src/app/(business)/team/payroll/actions.ts",
    "utf8",
  );
  const attendanceActions = [
    "src/app/(business)/team/attendance/p2/actions.ts",
    "src/app/(business)/team/attendance/resolutions/actions.ts",
  ].map((path) => readFileSync(path, "utf8")).join("\n");
  assert.match(
    payrollActions,
    /generatePayrollRunAction[\s\S]*?requireWholeBusinessPayroll\("CREATE_PAYROLL_RUN"\)/,
  );
  assert.match(payrollActions, /requireWholeBusinessPayroll\("EDIT_PAYROLL_ENTRY"\)/);
  assert.match(attendanceActions, /MODIFY_ATTENDANCE_EMPLOYEES/);
  assert.doesNotMatch(
    attendanceActions,
    /payrollEntry|payrollRun|employeeCompensationVersion|baseSalary/,
  );
});

function day(
  id: string,
  outcome: Parameters<typeof buildPayrollAttendanceInput>[0]["days"][number]["outcome"],
  totalWorkedMinutes: number,
  expectedDayKindSnapshot: Parameters<typeof buildPayrollAttendanceInput>[0]["days"][number]["expectedDayKindSnapshot"],
  leaveDayFractionSnapshot: number | null = null,
) {
  return {
    id,
    workDate: new Date(`2026-08-${String(1 + id.length).padStart(2, "0")}T00:00:00.000Z`),
    outcome,
    expectedDayKindSnapshot,
    leaveDayFractionSnapshot,
    totalWorkedMinutes,
    sourceDigest: id.padEnd(64, "0").slice(0, 64),
  };
}
