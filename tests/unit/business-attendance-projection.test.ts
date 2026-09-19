import assert from "node:assert/strict";
import test from "node:test";
import * as attendanceProjection from "../../src/lib/attendance/business-attendance-projection";

const { effectiveAttendanceStatusWhere } = attendanceProjection;

test("daily completed filter includes approved correction IDs before pagination", () => {
  assert.deepEqual(effectiveAttendanceStatusWhere("COMPLETED", ["corrected"]), {
    OR: [{ status: "COMPLETED" }, { id: { in: ["corrected"] } }],
  });
});
for (const status of ["INCOMPLETE", "OPEN", "ON_BREAK", "CANCELLED"] as const) {
  test(`daily ${status} filter excludes approved correction IDs`, () => {
    assert.deepEqual(effectiveAttendanceStatusWhere(status, ["corrected"]), {
      AND: [{ status }, { id: { notIn: ["corrected"] } }],
    });
  });
}
test("no correction preserves ordinary filters; ALL adds no restriction", () => {
  assert.deepEqual(effectiveAttendanceStatusWhere("ALL", ["corrected"]), {});
  assert.deepEqual(effectiveAttendanceStatusWhere("INCOMPLETE", []), { status: "INCOMPLETE" });
  assert.deepEqual(effectiveAttendanceStatusWhere("COMPLETED", []), { status: "COMPLETED" });
});

test("monthly manager summary does not show Clear for an active missing-clock-out exception without a raw session", () => {
  const buildSummary = Reflect.get(
    attendanceProjection,
    "buildManagerAttendanceMonthlySummary",
  );
  assert.equal(
    typeof buildSummary,
    "function",
    "manager monthly summary projection must exist",
  );

  const [summary] = buildSummary({
    members: [
      { id: "employee-a", employeeCode: "EMP-A", fullName: "Employee A" },
    ],
    sessions: [],
    p2Exceptions: [
      {
        id: "p2-a",
        membershipId: "employee-a",
        attendanceSessionId: null,
        type: "MISSING_CLOCK_OUT",
        status: "PENDING_MANAGER",
      },
    ],
    resolutionCases: [],
  });

  assert.equal(summary.attentionCount, 1);
  assert.equal(summary.attentionLabel, "Missing clock out");
});

test("monthly manager summary de-duplicates a raw session and its active resolution case", () => {
  const buildSummary = Reflect.get(
    attendanceProjection,
    "buildManagerAttendanceMonthlySummary",
  );
  assert.equal(typeof buildSummary, "function");

  const [summary] = buildSummary({
    members: [
      { id: "employee-a", employeeCode: "EMP-A", fullName: "Employee A" },
    ],
    sessions: [
      {
        id: "session-a",
        membershipId: "employee-a",
        workDate: new Date("2026-09-10T00:00:00.000Z"),
        status: "INCOMPLETE",
        totalBreakMinutes: 0,
        totalWorkedMinutes: 0,
        requiresApproval: false,
        approvalStatus: "NOT_REQUIRED",
      },
    ],
    p2Exceptions: [],
    resolutionCases: [
      {
        id: "case-a",
        employeeId: "employee-a",
        attendanceSessionId: "session-a",
        status: "OPEN",
      },
    ],
  });

  assert.equal(summary.attentionCount, 1);
  assert.equal(summary.attentionLabel, "Incomplete clock record");
});

test("monthly issue queries retain business, branch, member, and month scope", () => {
  const buildWhere = Reflect.get(
    attendanceProjection,
    "buildManagerAttendanceMonthlyIssueWhere",
  );
  assert.equal(typeof buildWhere, "function");

  const from = new Date("2026-09-01T00:00:00.000Z");
  const to = new Date("2026-10-01T00:00:00.000Z");
  const where = buildWhere({
    businessId: "business-a",
    allowedBranchIds: ["branch-a", "branch-b"],
    requestedBranchId: "branch-a",
    membershipIds: ["employee-a"],
    from,
    to,
  });

  assert.deepEqual(where.p2, {
    businessId: "business-a",
    branchId: "branch-a",
    membershipId: { in: ["employee-a"] },
    workDate: { gte: from, lt: to },
    status: { in: ["OPEN", "PENDING_EMPLOYEE", "PENDING_MANAGER"] },
  });
  assert.deepEqual(where.resolutionCases, {
    businessId: "business-a",
    branchId: "branch-a",
    employeeId: { in: ["employee-a"] },
    status: { in: ["OPEN", "UNDER_REVIEW", "RETURNED_FOR_CORRECTION"] },
    attendanceSession: { is: { workDate: { gte: from, lt: to } } },
  });
});
