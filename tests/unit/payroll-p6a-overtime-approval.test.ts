import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AttendanceExpectedDayKind,
  AttendanceP2Outcome,
  Prisma,
} from "@prisma/client";
import { deriveOvertimeCandidate } from "../../src/lib/attendance/overtime-service";
import {
  buildAttendancePayrollComponents,
  buildPayrollAttendanceInput,
  OVERTIME_APPROVAL_SOURCE_NOT_READY,
  OVERTIME_RATE_POLICY_NOT_READY,
} from "../../src/lib/payroll/attendance-integration";

const expectedStartAt = new Date("2026-08-18T01:00:00.000Z");
const expectedEndAt = new Date("2026-08-18T09:00:00.000Z");

test("P6A derives normal-day OT only outside the frozen expected interval", () => {
  const candidate = deriveOvertimeCandidate(
    finalResult({
      actualClockInAt: new Date("2026-08-18T00:30:00.000Z"),
      actualClockOutAt: new Date("2026-08-18T10:00:00.000Z"),
      totalWorkedMinutes: 510,
    }),
    "Asia/Kuala_Lumpur",
  );

  assert.equal(candidate.context, "NORMAL");
  assert.equal(candidate.potentialOtMinutes, 90);
  assert.equal(candidate.blockedReason, null);
});

test("P6A preserves Rest Day and Public Holiday context without calculating money", () => {
  for (const kind of ["REST_DAY", "PUBLIC_HOLIDAY"] as const) {
    const candidate = deriveOvertimeCandidate(
      finalResult({ expectedDayKindSnapshot: kind, totalWorkedMinutes: 240 }),
      "Asia/Kuala_Lumpur",
    );
    assert.equal(candidate.context, kind);
    assert.equal(candidate.potentialOtMinutes, 240);
  }
});

test("P6B permits cross-midnight OT candidates while Leave conflicts remain fail-closed", () => {
  const overnight = deriveOvertimeCandidate(
    finalResult({
      expectedDayKindSnapshot: "REST_DAY",
      actualClockInAt: new Date("2026-08-18T15:00:00.000Z"),
      actualClockOutAt: new Date("2026-08-18T18:00:00.000Z"),
      totalWorkedMinutes: 180,
    }),
    "Asia/Kuala_Lumpur",
  );
  assert.equal(overnight.blockedReason, null);
  assert.equal(overnight.potentialOtMinutes, 180);

  const fullLeave = deriveOvertimeCandidate(
    finalResult({ totalWorkedMinutes: 60, leaveDayFractionSnapshot: new Prisma.Decimal(1) }),
    "Asia/Kuala_Lumpur",
  );
  assert.equal(fullLeave.blockedReason, "FULL_DAY_LEAVE_CONFLICT");

  const halfLeave = deriveOvertimeCandidate(
    finalResult({ totalWorkedMinutes: 540, leaveDayFractionSnapshot: new Prisma.Decimal(0.5) }),
    "Asia/Kuala_Lumpur",
  );
  assert.equal(halfLeave.blockedReason, null);
});

test("P6A never reclassifies potential OT as ordinary hourly pay", () => {
  const base = {
    id: "p6a-day",
    workDate: new Date("2026-08-18T00:00:00.000Z"),
    outcome: "PRESENT" as const,
    expectedDayKindSnapshot: "WORKDAY" as const,
    leaveDayFractionSnapshot: null,
    expectedStartAt,
    expectedEndAt,
    actualClockInAt: new Date("2026-08-18T01:00:00.000Z"),
    actualClockOutAt: new Date("2026-08-18T10:00:00.000Z"),
    timezoneSnapshot: "Asia/Kuala_Lumpur",
    crossMidnightSnapshot: false,
    potentialOtMinutes: 60,
    totalWorkedMinutes: 540,
    sourceDigest: "a".repeat(64),
  };

  const pending = buildPayrollAttendanceInput({
    membershipId: "member",
    payBasis: "HOURLY",
    days: [{ ...base, approvedOtMinutes: 0, otApprovalStatus: "PENDING_REVIEW" }],
  });
  assert.equal(pending.regularMinutes, 480);
  assert.equal(pending.approvedOvertimeMinutes, 0);
  assert.ok(pending.policyBlockers.includes(OVERTIME_APPROVAL_SOURCE_NOT_READY));

  const rejected = buildPayrollAttendanceInput({
    membershipId: "member",
    payBasis: "HOURLY",
    days: [{ ...base, approvedOtMinutes: 0, otApprovalStatus: "REJECTED" }],
  });
  assert.equal(rejected.regularMinutes, 480);
  assert.equal(rejected.approvedOvertimeMinutes, 0);
  assert.deepEqual(rejected.policyBlockers, []);

  const adjusted = buildPayrollAttendanceInput({
    membershipId: "member",
    payBasis: "HOURLY",
    days: [{ ...base, approvedOtMinutes: 30, otApprovalStatus: "ADJUSTED" }],
  });
  assert.equal(adjusted.regularMinutes, 480);
  assert.equal(adjusted.approvedOvertimeMinutes, 30);
  assert.ok(adjusted.policyBlockers.includes(OVERTIME_RATE_POLICY_NOT_READY));
  assert.deepEqual(
    buildAttendancePayrollComponents({
      snapshotId: "10000000-0000-4000-8000-000000000060",
      timesheetRevision: 1,
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      payBasis: "HOURLY",
      baseRateCents: 1_500,
      attendance: adjusted,
    }),
    [],
  );
});

test("P6A source contracts freeze OT truth and keep the rate engine deferred", () => {
  const migration = readFileSync(
    "prisma/migrations/20260818220000_attendance_overtime_approval/migration.sql",
    "utf8",
  );
  const timesheet = readFileSync("src/lib/attendance/timesheet-service.ts", "utf8");
  const payroll = readFileSync("src/lib/payroll/attendance-integration.ts", "utf8");
  const action = readFileSync(
    "src/app/(business)/team/attendance/timesheets/actions.ts",
    "utf8",
  );
  const overtime = readFileSync("src/lib/attendance/overtime-service.ts", "utf8");

  assert.match(timesheet, /potentialOtMinutes/);
  assert.match(timesheet, /approvedOtMinutes/);
  assert.match(timesheet, /otApprovalStatus/);
  assert.match(payroll, /OVERTIME_RATE_POLICY_NOT_READY/);
  assert.doesNotMatch(payroll, /1\.5|2\.0|3\.0/);
  assert.doesNotMatch(action, /role\s*!==\s*["']STAFF["']/);
  assert.match(overtime, /SELF_APPROVAL_NOT_ALLOWED/);
  assert.match(overtime, /TIMESHEET_LOCKED/);
  assert.match(overtime, /OT_REVIEW_CREATED/);
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN)/i);
});

function finalResult(overrides: Partial<Parameters<typeof deriveOvertimeCandidate>[0]> = {}) {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    businessId: "20000000-0000-4000-8000-000000000001",
    branchId: "30000000-0000-4000-8000-000000000001",
    membershipId: "40000000-0000-4000-8000-000000000001",
    workDate: new Date("2026-08-18T00:00:00.000Z"),
    version: 1,
    outcome: AttendanceP2Outcome.PRESENT,
    expectedDayKindSnapshot: AttendanceExpectedDayKind.WORKDAY,
    expectedDayId: "50000000-0000-4000-8000-000000000001",
    leaveDayFractionSnapshot: null,
    expectedStartAt,
    expectedEndAt,
    actualClockInAt: expectedStartAt,
    actualClockOutAt: expectedEndAt,
    totalWorkedMinutes: 480,
    sourceDigest: "a".repeat(64),
    resolutionDigest: "b".repeat(64),
    ...overrides,
  } as Parameters<typeof deriveOvertimeCandidate>[0];
}
