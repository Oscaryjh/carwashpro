import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { effectiveAttendanceSession } from "../../src/lib/attendance/effective-session";
import { materializeAttendanceP2DayInTransaction } from "../../src/lib/attendance/p2-service";

const start = new Date("2026-09-08T01:00:00Z");
const end = new Date("2026-09-08T09:00:00Z");
const final = { attendanceSessionId: "session", source: "CORRECTION", disposition: "INCLUDED", clockInAt: start, clockOutAt: end, totalWorkedMinutes: 480, totalBreakMinutes: 0 };
const raw = { id: "session", clockInAt: start, clockOutAt: null, totalWorkedMinutes: 0, totalBreakMinutes: 0, status: "INCOMPLETE", resolutionCase: { status: "RESOLVED", currentFinalResult: final } };
test("current approved correction is a non-mutating effective projection", () => {
  assert.equal(effectiveAttendanceSession(raw).clockOutAt, end);
  assert.equal(effectiveAttendanceSession(raw).totalWorkedMinutes, 480);
  assert.equal(raw.clockOutAt, null);
  assert.equal(raw.status, "INCOMPLETE");
});
for (const status of ["UNDER_REVIEW", "RETURNED_FOR_CORRECTION", "SUPERSEDED", "OPEN"]) {
  test(`no unapproved projection for ${status}`, () => {
    const input = { ...raw, resolutionCase: { ...raw.resolutionCase, status } };
    assert.equal(effectiveAttendanceSession(input), input);
  });
}
for (const change of [{ disposition: "EXCLUDED" }, { source: "RAW_SESSION" }, { attendanceSessionId: "other" }, { clockOutAt: null }, { clockOutAt: start }]) {
  test(`unsafe or unrelated final is not projected: ${JSON.stringify(change)}`, () => {
    const input = { ...raw, resolutionCase: { ...raw.resolutionCase, currentFinalResult: { ...final, ...change } } };
    assert.equal(effectiveAttendanceSession(input), input);
  });
}
for (const status of ["APPROVED", "LOCKED"]) {
  test(`${status} stops projection before any write or final version`, async () => {
    const transaction = { attendanceMonthlyTimesheet: { findUnique: async () => ({ status }) } } as unknown as Prisma.TransactionClient;
    await assert.rejects(materializeAttendanceP2DayInTransaction({ context: { businessId: "b", allowedBranchIds: ["branch"], actor: { userId: "manager", name: "Manager", email: "manager@local.test" } }, membershipId: "employee", workDate: start }, transaction), /Reopen the approved or locked/);
  });
}
