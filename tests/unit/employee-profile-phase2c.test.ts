import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { loadEmployeeAttendanceSection } from "../../src/lib/team/employee-profile-attendance-read";

const input = {
  allowedBranchIds: ["11111111-1111-4111-8111-111111111111"],
  businessId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  membershipId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  now: new Date("2026-08-02T04:00:00.000Z"),
  wholeBusinessScope: false,
};

test("Attendance loader keeps People and Attendance tenant scope", async () => {
  const captured: Array<{ kind: string; query: Record<string, unknown> }> = [];
  const database = createDatabase(captured);

  await loadEmployeeAttendanceSection(input, database);

  assert.ok(captured.length >= 7);
  const serialized = JSON.stringify(captured);
  assert.match(serialized, /aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/);
  assert.match(serialized, /bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/);
  assert.match(serialized, /11111111-1111-4111-8111-111111111111/);
  assert.match(serialized, /effectiveFrom/);
  assert.match(serialized, /effectiveUntil/);
  assert.match(serialized, /"take":10/);

  for (const forbidden of [
    "baseSalary",
    "payBasis",
    "payrollEntries",
    "statutoryNationality",
    "statutoryIdentityNumber",
    "bankAccount",
    "latitude",
    "longitude",
    "accuracyMeters",
    "distanceFromBranchMeters",
    "insideGeofence",
    "geofenceStatus",
    "deviceId",
    "ipAddress",
    "reason",
    "reviewNote",
  ]) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `${forbidden} must not be selected by Attendance Profile`,
    );
  }
});

test("Attendance loader returns formal status summaries without inferred labels", async () => {
  const data = await loadEmployeeAttendanceSection(input, createDatabase([]));

  assert.ok(data);
  assert.equal(data.attendanceEnabled, true);
  assert.equal(data.currentClockStatus, "OPEN");
  assert.equal(data.currentBranchName, "Oscar Salon Lintas");
  assert.equal(data.todayWorkedMinutes, 600);
  assert.equal(data.todayBreakMinutes, 60);
  assert.equal(data.monthlyWorkedDays, 1);
  assert.equal(data.completedShiftCount, 2);
  assert.equal(data.incompleteShiftCount, 1);
  assert.equal(data.pendingApprovalCount, 2);
  assert.equal(data.pendingExceptionCount, 3);
  assert.equal(data.normalWorkMinutesPerDay, 480);
  assert.equal(data.normalWorkPolicySource, "Primary branch attendance setting");
  assert.equal(data.targetBreakMinutes, 60);
  assert.equal(data.clockInBranches.length, 1);
  assert.equal(data.recentAttendance.length, 1);
});

test("Attendance UI remains read-only after Leave is added", async () => {
  const root = process.cwd();
  const route = await readFile(
    path.join(root, "src/app/(business)/team/people/[personId]/page.tsx"),
    "utf8",
  );
  const component = await readFile(
    path.join(root, "src/components/employee-profile-attendance.tsx"),
    "utf8",
  );
  const source = `${route}\n${component}`;

  assert.match(route, /activeSection === "attendance"/);
  assert.match(route, /activeSection === "leave"/);
  assert.match(component, /Open Attendance Management/);
  assert.match(component, /Up to 10 records/);
  assert.doesNotMatch(component, /<form|<input|<button|action=/);

  for (const forbiddenLabel of [
    "Overtime",
    "OT Pay",
    "Late",
    "Missing Clock Out",
    "Salary",
    "Pay Basis",
    "Payroll Entry",
    "Bank Account",
    "Statutory",
    "GPS",
    "IP address",
    "Device ID",
  ]) {
    assert.equal(
      source.includes(forbiddenLabel),
      false,
      `${forbiddenLabel} must not be rendered by Attendance Profile`,
    );
  }
});

function createDatabase(
  captured: Array<{ kind: string; query: Record<string, unknown> }>,
) {
  const completedAt = new Date("2026-08-02T03:00:00.000Z");
  const openAt = new Date("2026-08-02T02:00:00.000Z");
  const branch = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Oscar Salon Lintas",
  };
  const database = {
    employeeBusinessMembership: {
      findFirst(query: Record<string, unknown>) {
        captured.push({ kind: "membership", query });
        return Promise.resolve({
          id: input.membershipId,
          attendanceEnabled: true,
          normalWorkMinutesPerDay: null,
          targetBreakMinutes: null,
          business: { timezone: "Asia/Kuala_Lumpur" },
          branchAssignments: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              canClockIn: true,
              isPrimary: true,
              branch: {
                ...branch,
                attendanceSetting: {
                  normalWorkMinutesPerDay: 480,
                  targetBreakMinutes: 60,
                },
              },
            },
          ],
        });
      },
    },
    employeeAttendance: {
      findFirst(query: Record<string, unknown>) {
        captured.push({ kind: "active", query });
        return Promise.resolve({
          id: "33333333-3333-4333-8333-333333333333",
          status: "OPEN",
          branch,
        });
      },
      findMany(query: Record<string, unknown>) {
        captured.push({ kind: "sessions", query });
        if (query.take === 10) {
          return Promise.resolve([
            {
              id: "44444444-4444-4444-8444-444444444444",
              workDate: new Date("2026-08-02T00:00:00.000Z"),
              status: "COMPLETED",
              clockInAt: new Date("2026-08-01T16:00:00.000Z"),
              clockOutAt: completedAt,
              totalBreakMinutes: 60,
              totalWorkedMinutes: 480,
              requiresApproval: false,
              approvalStatus: "NOT_REQUIRED",
              branch: {
                ...branch,
                attendanceSetting: { timezone: "Asia/Kuala_Lumpur" },
              },
            },
          ]);
        }
        const select = query.select as Record<string, unknown>;
        if (select.punches) {
          return Promise.resolve([
            {
              id: "44444444-4444-4444-8444-444444444444",
              status: "COMPLETED",
              clockInAt: new Date("2026-08-01T16:00:00.000Z"),
              clockOutAt: completedAt,
              totalBreakMinutes: 60,
              totalWorkedMinutes: 480,
              punches: [],
            },
            {
              id: "33333333-3333-4333-8333-333333333333",
              status: "OPEN",
              clockInAt: openAt,
              clockOutAt: null,
              totalBreakMinutes: 0,
              totalWorkedMinutes: 0,
              punches: [],
            },
          ]);
        }
        return Promise.resolve([
          {
            workDate: new Date("2026-08-01T00:00:00.000Z"),
            status: "COMPLETED",
          },
          {
            workDate: new Date("2026-08-01T00:00:00.000Z"),
            status: "COMPLETED",
          },
          {
            workDate: new Date("2026-08-02T00:00:00.000Z"),
            status: "INCOMPLETE",
          },
        ]);
      },
      count(query: Record<string, unknown>) {
        captured.push({ kind: "approval-count", query });
        return Promise.resolve(2);
      },
    },
    attendanceException: {
      count(query: Record<string, unknown>) {
        captured.push({ kind: "exception-count", query });
        return Promise.resolve(3);
      },
    },
  };
  return database as unknown as PrismaClient;
}
