import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { EmployeeAuthContext } from "../../src/lib/attendance/employee-auth/session";
import type { AttendanceServiceContext } from "../../src/lib/attendance/employee-service";
import {
  applyManagerAttendanceResolution,
  submitEmployeeAttendanceResolution,
} from "../../src/lib/attendance/resolution-workflow-service";

const caseId = "b0c7c414-9068-4947-9d06-73d20f821606";
const proposal = {
  resolutionCaseId: caseId,
  reason: "I forgot to clock out.",
  proposedClockInLocal: "2026-09-02T10:00",
  proposedClockOutLocal: "2026-09-02T18:00",
};
const auth = {
  businessId: "business-1", membershipId: "employee-1", sessionId: "login-1",
} as EmployeeAuthContext;

function fixture(punches: Array<{ type: string; serverTimestamp: Date }> = []) {
  const events: Array<Record<string, unknown>> = [];
  const changes: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const resolutionCase = {
    id: caseId,
    businessId: auth.businessId,
    branchId: "branch-1",
    employeeId: auth.membershipId,
    attendanceSessionId: "attendance-1",
    status: "OPEN",
    updatedAt: new Date("2026-09-03T00:00:00Z"),
    currentFinalResult: null,
    attendanceSession: { punches, totalBreakMinutes: 0 },
    employee: { targetBreakMinutes: 60, staffUser: { id: "employee-user" } },
    branch: { attendanceSetting: { timezone: "Asia/Kuala_Lumpur", targetBreakMinutes: 60 } },
  };
  const transaction = {
    attendanceResolutionCase: {
      findFirst: async () => resolutionCase,
      update: async ({ data }: { data: Record<string, unknown> }) => { changes.push(data); },
    },
    attendanceResolutionEvent: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        events.push(data);
        return { ...data, id: "event-1", createdAt: new Date("2026-09-03T01:00:00Z") };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => { audits.push(data); },
    },
  };
  // No real database or payroll/session write methods are provided.
  const database = {
    $transaction: async (callback: (value: typeof transaction) => unknown) => callback(transaction),
  } as unknown as PrismaClient;
  return { database, events, changes, audits, resolutionCase };
}

test("clock-out-only proposal keeps undeclared break null and awaits manager review", async () => {
  for (const omittedBreak of [{}, { proposedBreakMinutes: null }]) {
    const state = fixture();
    const result = await submitEmployeeAttendanceResolution({ auth, input: { ...proposal, ...omittedBreak }, database: state.database });
    assert.equal(result.status, "UNDER_REVIEW");
    assert.equal(state.events[0].proposedBreakMinutes, null);
    assert.equal(state.events[0].finalResultId, null);
    assert.equal((state.events[0].proposedClockOutAt as Date).toISOString(), "2026-09-02T10:00:00.000Z");
    assert.equal(state.changes[0].status, "UNDER_REVIEW");
    assert.equal((state.audits[0].metadata as Record<string, unknown>).breakRequiresVerification, true);
  }
});

test("manual break accepts zero, sixty and ninety without extra confirmation and still awaits review", async () => {
  for (const minutes of [0, 60, 90]) {
    const accepted = fixture();
    const result = await submitEmployeeAttendanceResolution({
      auth, input: { ...proposal, proposedBreakMinutes: minutes }, database: accepted.database,
    });
    assert.equal(result.status, "UNDER_REVIEW");
    assert.equal(accepted.events[0].proposedBreakMinutes, minutes);
    assert.equal(accepted.events[0].finalResultId, null);
    assert.equal((accepted.audits[0].metadata as Record<string, unknown>).breakDeclarationProvided, true);
    assert.equal("actualBreakConfirmed" in (accepted.audits[0].metadata as Record<string, unknown>), false);
  }
});

test("optional declaration does not bypass shift validation or the break safety limit", async () => {
  for (const input of [
    { ...proposal, proposedClockOutLocal: "2026-09-02T09:00" },
    { ...proposal, proposedClockOutLocal: null },
    { ...proposal, proposedBreakMinutes: 181 },
  ]) {
    const state = fixture();
    await assert.rejects(submitEmployeeAttendanceResolution({ auth, input, database: state.database }));
    assert.equal(state.events.length, 0);
  }
});

test("recorded ninety-minute break stays locked even without a declaration", async () => {
  const punches = [
    { type: "BREAK_START", serverTimestamp: new Date("2026-09-02T04:00:00Z") },
    { type: "BREAK_END", serverTimestamp: new Date("2026-09-02T05:30:00Z") },
  ];
  const state = fixture(punches);
  await submitEmployeeAttendanceResolution({ auth, input: proposal, database: state.database });
  assert.equal(state.events[0].proposedBreakMinutes, 90);
  await assert.rejects(submitEmployeeAttendanceResolution({
    auth, input: { ...proposal, proposedBreakMinutes: 60 }, database: fixture(punches).database,
  }), /Recorded break minutes are locked/);
});

test("incomplete break evidence still requires the missing endpoint", async () => {
  const punches = [{ type: "BREAK_START", serverTimestamp: new Date("2026-09-02T04:00:00Z") }];
  await assert.rejects(submitEmployeeAttendanceResolution({ auth, input: proposal, database: fixture(punches).database }), /Provide the missing break start and end/);
  const state = fixture(punches);
  await submitEmployeeAttendanceResolution({
    auth,
    input: { ...proposal, proposedBreakStartLocal: "2026-09-02T12:00", proposedBreakEndLocal: "2026-09-02T13:30" },
    database: state.database,
  });
  assert.equal(state.events[0].proposedBreakMinutes, 90);
});

test("manager cannot finalize a correction without verified break minutes", async () => {
  const state = fixture();
  state.resolutionCase.status = "UNDER_REVIEW";
  await assert.rejects(applyManagerAttendanceResolution({
    context: { businessId: "business-1", allowedBranchIds: ["branch-1"], actor: { userId: "manager-1", name: "Manager", email: "manager@example.test" } } as AttendanceServiceContext,
    input: {
      resolutionCaseId: caseId, action: "APPLY_CORRECTION", reason: "Reviewed closing time.",
      correctedClockInLocal: proposal.proposedClockInLocal, correctedClockOutLocal: proposal.proposedClockOutLocal,
      correctedBreakMinutes: null, expectedUpdatedAt: state.resolutionCase.updatedAt.toISOString(),
    },
    database: state.database,
  }), /Provide clock-in, clock-out, and break minutes/);
  assert.equal(state.events.length, 0);
});
