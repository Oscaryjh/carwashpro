import assert from "node:assert/strict";
import test from "node:test";
import { buildPendingAttendanceExceptionQueueWhere } from "../../src/lib/attendance/resolution-read-service";

test("pending Attendance exception queue is tenant, branch, status and self scoped", () => {
  const where = buildPendingAttendanceExceptionQueueWhere({
    scope: {
      businessId: "611b0c19-ebf7-4548-8a48-a3b6a7af8a81",
      allowedBranchIds: ["41575966-238f-46ab-a114-22bbee4949c5"],
    },
    excludedMembershipId: "3ed1909b-f624-49cb-9457-efecec9e776a",
  });

  assert.deepEqual(where, {
    businessId: "611b0c19-ebf7-4548-8a48-a3b6a7af8a81",
    branchId: { in: ["41575966-238f-46ab-a114-22bbee4949c5"] },
    status: "PENDING",
    employeeId: { not: "3ed1909b-f624-49cb-9457-efecec9e776a" },
    OR: [
      { attendanceSessionId: null },
      {
        attendanceSession: {
          is: { resolutionCase: { is: null } },
        },
      },
    ],
  });
});

test("pending Attendance exception queue remains valid when no self identity is supplied", () => {
  const where = buildPendingAttendanceExceptionQueueWhere({
    scope: { businessId: "business", allowedBranchIds: ["branch-a", "branch-b"] },
  });

  assert.equal(where.businessId, "business");
  assert.deepEqual(where.branchId, { in: ["branch-a", "branch-b"] });
  assert.equal(where.status, "PENDING");
  assert.equal("employeeId" in where, false);
});
