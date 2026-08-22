import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AppointmentStatus, PrismaClient } from "@prisma/client";
import {
  appointmentStatusView,
  getStaffAppointmentDay,
} from "../../src/lib/staff-pwa/appointments";

const auth = {
  sessionId: "session-1",
  employeeAccountId: "employee-account-1",
  membershipId: "membership-1",
  businessId: "business-1",
  primaryBranchId: "branch-1",
  attendanceBranchId: "branch-1",
  deviceId: "device-1",
};
const now = new Date("2026-08-22T03:30:00.000Z");

function appointment(overrides: Record<string, unknown> = {}) {
  return {
    id: "appointment-1",
    branchId: "branch-1",
    serviceId: null,
    serviceIds: ["service-1", "service-2"],
    scheduledAt: new Date("2026-08-22T03:45:00.000Z"),
    durationMinutes: 90,
    status: "CONFIRMED" as AppointmentStatus,
    createdAt: new Date("2026-08-20T00:00:00.000Z"),
    customer: { name: "Alicia Tan" },
    branch: { name: "Young Parlor TWU", attendanceSetting: { timezone: "Asia/Kuala_Lumpur" } },
    ...overrides,
  };
}

function database(input: {
  rows?: ReturnType<typeof appointment>[];
  userId?: string | null;
  expected?: Array<Record<string, unknown>>;
  leave?: Array<Record<string, unknown>>;
} = {}) {
  const captured: { appointmentWhere?: unknown; serviceWhere?: unknown } = {};
  const fake = {
    business: { findFirstOrThrow: async () => ({ timezone: "Asia/Kuala_Lumpur" }) },
    user: { findFirst: async ({ where }: { where: unknown }) => input.userId === null ? null : ({ id: input.userId ?? "staff-user-1", where }) },
    appointment: { findMany: async ({ where }: { where: unknown }) => { captured.appointmentWhere = where; return input.rows ?? [appointment()]; } },
    service: { findMany: async ({ where }: { where: unknown }) => {
      captured.serviceWhere = where;
      return [
        { id: "service-1", name: "Hair colour", durationMinutes: 60 },
        { id: "service-2", name: "Wash", durationMinutes: 30 },
      ];
    } },
    attendanceExpectedDay: { findMany: async () => input.expected ?? [{ branchId: "branch-1", kind: "WORKDAY", expectedStartAt: new Date("2026-08-22T03:00:00.000Z"), expectedEndAt: new Date("2026-08-22T13:00:00.000Z") }] },
    leaveRequestDay: { findMany: async () => input.leave ?? [] },
  };
  return { captured, fake: fake as unknown as PrismaClient };
}

test("Staff appointments preserve every canonical POS status with readable labels", () => {
  const values: AppointmentStatus[] = ["SCHEDULED", "CONFIRMED", "ARRIVED", "IN_SERVICE", "COMPLETED", "CONVERTED_TO_JOB", "CANCELLED", "NO_SHOW"];
  assert.deepEqual(values.map((status) => appointmentStatusView(status).label), ["Scheduled", "Confirmed", "Arrived", "In service", "Completed", "Converted to job", "Cancelled", "No show"]);
  assert.deepEqual(values.filter((status) => appointmentStatusView(status).terminal), ["COMPLETED", "CONVERTED_TO_JOB", "CANCELLED", "NO_SHOW"]);
});

test("A normal employee receives only appointments assigned through the exact membership-linked User", async () => {
  const { fake, captured } = database();
  const result = await getStaffAppointmentDay({ auth, date: "2026-08-22", now, database: fake });
  assert.equal(result.staffMapping, "LINKED");
  assert.equal(result.appointments[0]?.customerName, "Alicia Tan");
  assert.deepEqual(captured.appointmentWhere, {
    businessId: "business-1",
    assignedStaffId: "staff-user-1",
    scheduledAt: { gte: new Date("2026-08-20T16:00:00.000Z"), lt: new Date("2026-08-23T16:00:00.000Z") },
  });
});

test("Missing canonical Staff mapping fails closed instead of guessing by name, email or phone", async () => {
  const { fake } = database({ userId: null });
  const result = await getStaffAppointmentDay({ auth, date: "2026-08-22", now, database: fake });
  assert.equal(result.staffMapping, "MISSING");
  assert.equal(result.appointments.length, 0);
});

test("Multiple services retain canonical ordering and appointment total duration", async () => {
  const { fake } = database();
  const result = await getStaffAppointmentDay({ auth, date: "2026-08-22", now, database: fake });
  assert.equal(result.appointments[0]?.serviceSummary, "Hair colour · Wash");
  assert.equal(result.appointments[0]?.durationLabel, "1 hr 30 min");
});

test("Reassignment and rescheduling are reflected by the next canonical read", async () => {
  const { fake } = database({ rows: [appointment({ id: "rescheduled", scheduledAt: new Date("2026-08-22T05:00:00.000Z") })] });
  const result = await getStaffAppointmentDay({ auth, date: "2026-08-22", now, database: fake });
  assert.equal(result.appointments[0]?.id, "rescheduled");
  assert.equal(result.appointments[0]?.timeLabel, "13:00");
});

test("Branch timezone decides the visible local day at UTC boundaries", async () => {
  const { fake } = database({ rows: [
    appointment({
      id: "tokyo-visible",
      scheduledAt: new Date("2026-08-21T15:30:00.000Z"),
      branch: { name: "Tokyo branch", attendanceSetting: { timezone: "Asia/Tokyo" } },
    }),
    appointment({
      id: "tokyo-next-day",
      scheduledAt: new Date("2026-08-22T16:30:00.000Z"),
      branch: { name: "Tokyo branch", attendanceSetting: { timezone: "Asia/Tokyo" } },
    }),
  ] });
  const result = await getStaffAppointmentDay({ auth, date: "2026-08-22", now, database: fake });
  assert.deepEqual(result.appointments.map((item) => item.id), ["tokyo-visible"]);
  assert.equal(result.appointments[0]?.timeLabel, "00:30");
});

test("Next appointment excludes terminal states and follows business local time", async () => {
  const { fake } = database({ rows: [
    appointment({ id: "done", scheduledAt: new Date("2026-08-22T03:35:00.000Z"), status: "COMPLETED" }),
    appointment({ id: "next", scheduledAt: new Date("2026-08-22T04:00:00.000Z"), status: "SCHEDULED" }),
  ] });
  const result = await getStaffAppointmentDay({ auth, date: "2026-08-22", now, database: fake });
  assert.equal(result.nextAppointment?.id, "next");
  assert.equal(result.remainingCount, 1);
});

test("Shift, rest-day and approved-leave conflicts are warnings only", async () => {
  const outside = database({ expected: [{ branchId: "branch-1", kind: "WORKDAY", expectedStartAt: new Date("2026-08-22T04:00:00.000Z"), expectedEndAt: new Date("2026-08-22T12:00:00.000Z") }] });
  const outsideResult = await getStaffAppointmentDay({ auth, date: "2026-08-22", now, database: outside.fake });
  assert.deepEqual(outsideResult.appointments[0]?.conflicts.map((item) => item.code), ["OUTSIDE_SHIFT"]);

  const restAndLeave = database({ expected: [{ branchId: "branch-1", kind: "REST_DAY", expectedStartAt: null, expectedEndAt: null }], leave: [{ id: "leave-day-1" }] });
  const restResult = await getStaffAppointmentDay({ auth, date: "2026-08-22", now, database: restAndLeave.fake });
  assert.deepEqual(restResult.appointments[0]?.conflicts.map((item) => item.code), ["APPROVED_LEAVE", "REST_DAY"]);

  const anotherBranch = database({ expected: [{ branchId: "branch-2", kind: "REST_DAY", expectedStartAt: null, expectedEndAt: null }] });
  const anotherBranchResult = await getStaffAppointmentDay({ auth, date: "2026-08-22", now, database: anotherBranch.fake });
  assert.deepEqual(anotherBranchResult.appointments[0]?.conflicts, []);
});

test("Staff appointment surface is read-only, tenant-scoped and does not expose phone or notes", () => {
  const source = readFileSync("src/lib/staff-pwa/appointments.ts", "utf8");
  const page = readFileSync("src/app/staff/appointments/page.tsx", "utf8");
  const route = readFileSync("src/app/api/employee-appointments/route.ts", "utf8");
  assert.match(source, /businessId: input\.auth\.businessId/);
  assert.match(source, /employeeBusinessMembershipId: input\.auth\.membershipId/);
  assert.doesNotMatch(source, /customer.*phone|customer.*notes|select:\s*\{[^}]*phone/);
  assert.doesNotMatch(page, /Edit appointment|Book appointment|customerPhone|notes/);
  assert.match(route, /requireEmployeeSelfServiceAuthContext/);
  assert.match(route, /requireEmployeeBusinessModule\(auth, "SALON"\)/);
});
