import assert from "node:assert/strict";
import test from "node:test";
import {
  employeeTimesheetMonthRange,
  projectEmployeeTimesheetDays,
  type EmployeeTimesheetExceptionInput,
  type EmployeeTimesheetFinalInput,
  type EmployeeTimesheetLockedDayInput,
} from "@/lib/attendance/employee-timesheet";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const BRANCH_ID = "00000000-0000-4000-8000-000000000002";
const MEMBERSHIP_ID = "00000000-0000-4000-8000-000000000003";
const WORK_DATE = new Date("2026-08-30T00:00:00.000Z");

test("completed Clock In and Clock Out projects one final Timesheet day", () => {
  const days = projectEmployeeTimesheetDays({
    finalResults: [finalResult()],
    exceptions: [],
    timesheetStatus: "DRAFT",
  });

  assert.equal(days.length, 1);
  assert.equal(days[0]?.status, "FINAL");
  assert.equal(days[0]?.outcome, "PRESENT");
  assert.equal(days[0]?.actualClockInAt?.toISOString(), "2026-08-30T08:47:00.000Z");
  assert.equal(days[0]?.actualClockOutAt?.toISOString(), "2026-08-30T08:49:00.000Z");
});

test("completed day has no missing-time employee action", () => {
  const [day] = projectEmployeeTimesheetDays({
    finalResults: [finalResult()],
    exceptions: [],
    timesheetStatus: "DRAFT",
  });

  assert.equal(day?.actionableException, null);
  assert.deepEqual(day?.issues, []);
});

test("stale active exception does not duplicate a later canonical final", () => {
  const [day] = projectEmployeeTimesheetDays({
    finalResults: [finalResult({ createdAt: new Date("2026-08-30T10:00:00.000Z") })],
    exceptions: [exception({
      id: "stale",
      type: "MISSING_CLOCK_OUT",
      updatedAt: new Date("2026-08-30T09:00:00.000Z"),
    })],
    timesheetStatus: "DRAFT",
  });

  assert.equal(day?.status, "FINAL");
  assert.equal(day?.issues.length, 0);
});

test("unresolved missing Clock Out projects one actionable day", () => {
  const days = projectEmployeeTimesheetDays({
    finalResults: [],
    exceptions: [exception({ type: "MISSING_CLOCK_OUT" })],
    timesheetStatus: "DRAFT",
  });

  assert.equal(days.length, 1);
  assert.equal(days[0]?.status, "ACTION_NEEDED");
  assert.equal(days[0]?.actionableException?.type, "MISSING_CLOCK_OUT");
});

test("pending correction projects one Waiting for manager day", () => {
  const days = projectEmployeeTimesheetDays({
    finalResults: [],
    exceptions: [exception({ type: "MISSING_CLOCK_OUT", status: "PENDING_MANAGER" })],
    timesheetStatus: "DRAFT",
  });

  assert.equal(days.length, 1);
  assert.equal(days[0]?.status, "WAITING_FOR_MANAGER");
  assert.equal(days[0]?.actionableException, null);
});

test("approved correction is represented by the updated immutable final", () => {
  const days = projectEmployeeTimesheetDays({
    finalResults: [finalResult({ version: 2, outcome: "PRESENT_LATE_AUTHORIZED" })],
    exceptions: [],
    timesheetStatus: "DRAFT",
  });

  assert.equal(days.length, 1);
  assert.equal(days[0]?.status, "FINAL");
  assert.equal(days[0]?.outcome, "PRESENT_LATE_AUTHORIZED");
});

test("multiple records for one work date produce one primary employee card", () => {
  const days = projectEmployeeTimesheetDays({
    finalResults: [
      finalResult({ id: "v1", version: 1, createdAt: new Date("2026-08-30T08:39:00.000Z") }),
      finalResult({ id: "v2", version: 2, createdAt: new Date("2026-08-30T08:40:00.000Z") }),
    ],
    exceptions: [
      exception({ id: "late-1", type: "LATE_ARRIVAL", exceptionMinutes: 528 }),
      exception({ id: "late-duplicate", type: "LATE_ARRIVAL", exceptionMinutes: 528 }),
      exception({ id: "early", type: "EARLY_DEPARTURE", exceptionMinutes: 371 }),
    ],
    timesheetStatus: "DRAFT",
  });

  assert.equal(days.length, 1);
  assert.equal(days[0]?.status, "WAITING_FOR_MANAGER");
  assert.deepEqual(
    days[0]?.issues.map((issue) => issue.type).sort(),
    ["EARLY_DEPARTURE", "LATE_ARRIVAL"],
  );
  assert.equal(days[0]?.actionableException, null);
});

test("multiple raw shifts remain represented by their canonical daily aggregate", () => {
  const [day] = projectEmployeeTimesheetDays({
    finalResults: [finalResult({
      actualClockInAt: new Date("2026-08-30T01:00:00.000Z"),
      actualClockOutAt: new Date("2026-08-30T11:00:00.000Z"),
      totalBreakMinutes: 120,
      totalWorkedMinutes: 480,
    })],
    exceptions: [],
    timesheetStatus: "DRAFT",
  });

  assert.equal(day?.totalWorkedMinutes, 480);
  assert.equal(day?.totalBreakMinutes, 120);
  assert.equal(day?.actualClockInAt?.toISOString(), "2026-08-30T01:00:00.000Z");
  assert.equal(day?.actualClockOutAt?.toISOString(), "2026-08-30T11:00:00.000Z");
});

test("month range keeps the next month as an exclusive boundary", () => {
  const range = employeeTimesheetMonthRange(new Date("2026-08-30T12:00:00.000Z"));
  assert.equal(range.monthStart.toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal(range.monthEndExclusive.toISOString(), "2026-09-01T00:00:00.000Z");
});

test("locked monthly snapshot takes precedence over live finals and exceptions", () => {
  const days = projectEmployeeTimesheetDays({
    finalResults: [finalResult({ outcome: "PRESENT_LATE_UNAUTHORIZED" })],
    exceptions: [exception({ type: "MISSING_CLOCK_OUT" })],
    lockedDays: [lockedDay({ outcome: "PRESENT" })],
    timesheetStatus: "LOCKED",
  });

  assert.equal(days.length, 1);
  assert.equal(days[0]?.source, "LOCKED_SNAPSHOT");
  assert.equal(days[0]?.status, "FINAL");
  assert.equal(days[0]?.outcome, "PRESENT");
  assert.equal(days[0]?.actionableException, null);
});

test("completed punches with real schedule deviations produce one manager-review day, not missing-time action", () => {
  const days = projectEmployeeTimesheetDays({
    finalResults: [],
    exceptions: [
      exception({ id: "late", type: "LATE_ARRIVAL", exceptionMinutes: 528 }),
      exception({ id: "early", type: "EARLY_DEPARTURE", exceptionMinutes: 371 }),
    ],
    timesheetStatus: "DRAFT",
  });

  assert.equal(days.length, 1);
  assert.equal(days[0]?.status, "WAITING_FOR_MANAGER");
  assert.equal(days[0]?.actualClockInAt?.toISOString(), "2026-08-30T08:47:00.000Z");
  assert.equal(days[0]?.actualClockOutAt?.toISOString(), "2026-08-30T08:49:00.000Z");
  assert.equal(days[0]?.actionableException, null);
});

function finalResult(overrides: Partial<EmployeeTimesheetFinalInput> = {}): EmployeeTimesheetFinalInput {
  return {
    id: "final-1",
    businessId: BUSINESS_ID,
    branchId: BRANCH_ID,
    membershipId: MEMBERSHIP_ID,
    workDate: WORK_DATE,
    version: 1,
    outcome: "PRESENT",
    actualClockInAt: new Date("2026-08-30T08:47:00.000Z"),
    actualClockOutAt: new Date("2026-08-30T08:49:00.000Z"),
    totalBreakMinutes: 0,
    totalWorkedMinutes: 1,
    sourceDigest: "final-digest",
    createdAt: new Date("2026-08-30T08:50:00.000Z"),
    ...overrides,
  };
}

function exception(overrides: Partial<EmployeeTimesheetExceptionInput> = {}): EmployeeTimesheetExceptionInput {
  return {
    id: "exception-1",
    businessId: BUSINESS_ID,
    branchId: BRANCH_ID,
    membershipId: MEMBERSHIP_ID,
    workDate: WORK_DATE,
    type: "LATE_ARRIVAL",
    status: "OPEN",
    expectedDayId: "expected-1",
    attendanceSessionId: "attendance-1",
    actualClockInAt: new Date("2026-08-30T08:47:00.000Z"),
    actualClockOutAt: new Date("2026-08-30T08:49:00.000Z"),
    exceptionMinutes: 1,
    reasonCode: "TEST_EXCEPTION",
    sourceDigest: "exception-digest",
    detectedAt: new Date("2026-08-30T08:50:00.000Z"),
    updatedAt: new Date("2026-08-30T08:50:00.000Z"),
    ...overrides,
  };
}

function lockedDay(overrides: Partial<EmployeeTimesheetLockedDayInput> = {}): EmployeeTimesheetLockedDayInput {
  return {
    id: "snapshot-1",
    businessId: BUSINESS_ID,
    branchId: BRANCH_ID,
    membershipId: MEMBERSHIP_ID,
    workDate: WORK_DATE,
    finalResultId: "final-1",
    finalResultVersion: 1,
    outcome: "PRESENT",
    expectedDayKindSnapshot: "WORKDAY",
    actualClockInAt: new Date("2026-08-30T08:47:00.000Z"),
    actualClockOutAt: new Date("2026-08-30T08:49:00.000Z"),
    totalBreakMinutes: 0,
    totalWorkedMinutes: 1,
    sourceDigest: "locked-digest",
    potentialOtMinutes: 0,
    approvedOtMinutes: 0,
    otContext: null,
    otApprovalStatus: "NOT_APPLICABLE",
    ...overrides,
  };
}
