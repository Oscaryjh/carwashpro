import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { PrismaClient } from "@prisma/client";
import { upsertBranchAttendanceSetting } from "../../src/lib/attendance/branch-setting-service";
import {
  createAttendanceEmployee,
  updateAttendanceEmployee,
  type AttendanceServiceContext,
} from "../../src/lib/attendance/employee-service";

const prisma = new PrismaClient();

after(async () => {
  await prisma.$disconnect();
});

test("Phase 1B services enforce tenant scope, history, concurrency, and safe audit data", async () => {
  assertLocalDatabase();
  const fixture = await createFixture();
  const phone = randomPhone();
  const replacementPhone = randomPhone();
  const futurePhone = randomPhone();
  const joinedAt = new Date(Date.now() - 86_400_000);
  const wholeA: AttendanceServiceContext = {
    businessId: fixture.businessA.id,
    allowedBranchIds: [fixture.branchA1.id, fixture.branchA2.id],
    wholeBusinessScope: true,
    actor: actorFrom(fixture.actorA),
  };
  const contextB: AttendanceServiceContext = {
    businessId: fixture.businessB.id,
    allowedBranchIds: [fixture.branchB1.id],
    wholeBusinessScope: true,
    actor: actorFrom(fixture.actorB),
  };

  try {
    await assert.rejects(
      createAttendanceEmployee(
        {
          ...wholeA,
          input: createInput({
            businessId: fixture.businessB.id,
            employeeCode: "FUTURE-1",
            phoneNumber: futurePhone,
            joinedAt,
            attendanceEnabled: true,
            assignments: [
              activeAssignment(fixture.branchA1.id, {
                isPrimary: true,
                effectiveFrom: new Date(Date.now() + 86_400_000),
              }),
            ],
          }),
        },
        prisma,
      ),
      /current active primary branch/i,
    );

    const createdA = await createAttendanceEmployee(
      {
        ...wholeA,
        input: createInput({
          businessId: fixture.businessB.id,
          employeeCode: "EMP-A",
          phoneNumber: phone,
          joinedAt,
          attendanceEnabled: true,
          assignments: [
            activeAssignment(fixture.branchA1.id, {
              isPrimary: true,
            }),
            activeAssignment(fixture.branchA2.id),
          ],
        }),
      },
      prisma,
    );
    assert.equal(createdA.businessId, fixture.businessA.id);
    assert.equal(createdA.phoneNumberNormalized, phone);

    await prisma.employeeAccount.update({
      where: { id: createdA.employeeAccountId },
      data: { status: "INACTIVE" },
    });

    const createdB = await createAttendanceEmployee(
      {
        ...contextB,
        input: createInput({
          businessId: fixture.businessA.id,
          employeeCode: "EMP-B",
          phoneNumber: phone,
          joinedAt,
          attendanceEnabled: false,
          assignments: [
            activeAssignment(fixture.branchB1.id, {
              isPrimary: true,
            }),
          ],
        }),
      },
      prisma,
    );
    assert.equal(createdB.employeeAccountId, createdA.employeeAccountId);
    assert.equal(
      (
        await prisma.employeeAccount.findUniqueOrThrow({
          where: { id: createdA.employeeAccountId },
        })
      ).status,
      "INACTIVE",
      "reusing an account in another business must not reactivate it",
    );

    await assert.rejects(
      createAttendanceEmployee(
        {
          ...wholeA,
          input: createInput({
            businessId: fixture.businessA.id,
            employeeCode: "EMP-A",
            phoneNumber: randomPhone(),
            joinedAt,
            assignments: [
              activeAssignment(fixture.branchA2.id, {
                isPrimary: true,
              }),
            ],
          }),
        },
        prisma,
      ),
      /employee code is already used/i,
    );

    await assert.rejects(
      createAttendanceEmployee(
        {
          ...wholeA,
          allowedBranchIds: [fixture.branchA2.id],
          input: createInput({
            businessId: fixture.businessA.id,
            employeeCode: "OUTSIDE-SCOPE",
            phoneNumber: randomPhone(),
            joinedAt,
            assignments: [
              activeAssignment(fixture.branchA1.id, {
                isPrimary: true,
              }),
            ],
          }),
        },
        prisma,
      ),
      /outside the allowed branch scope/i,
    );

    const replacementAccount = await prisma.employeeAccount.create({
      data: {
        phoneNumber: replacementPhone,
        phoneNormalized: replacementPhone,
        name: "Replacement identity",
        status: "INACTIVE",
      },
    });

    const phoneUpdated = await updateAttendanceEmployee(
      {
        ...wholeA,
        expectedUpdatedAt: createdA.updatedAt,
        input: updateInput(createdA, {
          businessId: fixture.businessB.id,
          phoneNumber: replacementPhone,
          assignments: [
            activeAssignment(fixture.branchA1.id, {
              isPrimary: true,
            }),
            activeAssignment(fixture.branchA2.id),
          ],
        }),
      },
      prisma,
    );
    assert.equal(phoneUpdated.employeeAccountId, replacementAccount.id);
    assert.equal(
      (
        await prisma.employeeAccount.findUniqueOrThrow({
          where: { id: replacementAccount.id },
        })
      ).status,
      "INACTIVE",
    );

    const branchA1Before =
      await prisma.employeeBranchAssignment.findFirstOrThrow({
        where: {
          membershipId: createdA.id,
          branchId: fixture.branchA1.id,
          status: "ACTIVE",
        },
      });
    const restrictedA2: AttendanceServiceContext = {
      businessId: fixture.businessA.id,
      allowedBranchIds: [fixture.branchA2.id],
      actor: actorFrom(fixture.actorA),
    };
    const restrictedUpdated = await updateAttendanceEmployee(
      {
        ...restrictedA2,
        expectedUpdatedAt: phoneUpdated.updatedAt,
        input: updateInput(phoneUpdated, {
          phoneNumber: replacementPhone,
          position: "Restricted edit",
          assignments: [
            activeAssignment(fixture.branchA2.id, {
              canClockIn: false,
            }),
          ],
        }),
      },
      prisma,
    );
    const branchA1After =
      await prisma.employeeBranchAssignment.findUniqueOrThrow({
        where: { id: branchA1Before.id },
      });
    assert.equal(branchA1After.status, "ACTIVE");
    assert.equal(branchA1After.isPrimary, true);
    assert.equal(
      branchA1After.updatedAt.toISOString(),
      branchA1Before.updatedAt.toISOString(),
      "restricted update must not mutate an omitted out-of-scope assignment",
    );

    await assert.rejects(
      updateAttendanceEmployee(
        {
          ...restrictedA2,
          expectedUpdatedAt: restrictedUpdated.updatedAt,
          input: updateInput(restrictedUpdated, {
            phoneNumber: replacementPhone,
            assignments: [
              activeAssignment(fixture.branchA2.id, {
                isPrimary: true,
              }),
            ],
          }),
        },
        prisma,
      ),
      /exactly one active primary branch/i,
    );

    const concurrentUpdate =
      await prisma.employeeBusinessMembership.update({
        where: { id: createdA.id },
        data: { position: "Concurrent manager edit" },
      });
    await assert.rejects(
      updateAttendanceEmployee(
        {
          ...wholeA,
          expectedUpdatedAt: restrictedUpdated.updatedAt,
          input: updateInput(restrictedUpdated, {
            phoneNumber: replacementPhone,
            position: "Stale overwrite",
            assignments: [
              activeAssignment(fixture.branchA1.id, {
                isPrimary: true,
              }),
              activeAssignment(fixture.branchA2.id),
            ],
          }),
        },
        prisma,
      ),
      /changed by another user\. reload and try again/i,
    );

    await prisma.branch.update({
      where: { id: fixture.branchA1.id },
      data: { status: "INACTIVE" },
    });
    const movedPrimary = await updateAttendanceEmployee(
      {
        ...wholeA,
        allowedBranchIds: [fixture.branchA2.id],
        expectedUpdatedAt: concurrentUpdate.updatedAt,
        input: updateInput(concurrentUpdate, {
          phoneNumber: replacementPhone,
          assignments: [
            activeAssignment(fixture.branchA2.id, {
              isPrimary: true,
            }),
          ],
        }),
      },
      prisma,
    );
    const endedA1 =
      await prisma.employeeBranchAssignment.findUniqueOrThrow({
        where: { id: branchA1Before.id },
      });
    assert.equal(endedA1.status, "INACTIVE");
    assert.equal(endedA1.isPrimary, false);

    const suspended = await updateAttendanceEmployee(
      {
        ...wholeA,
        allowedBranchIds: [fixture.branchA2.id],
        expectedUpdatedAt: movedPrimary.updatedAt,
        input: updateInput(movedPrimary, {
          phoneNumber: replacementPhone,
          status: "SUSPENDED",
          attendanceEnabled: false,
          assignments: [
            activeAssignment(fixture.branchA2.id, {
              isPrimary: true,
              canClockIn: false,
            }),
          ],
        }),
      },
      prisma,
    );

    const terminated = await updateAttendanceEmployee(
      {
        ...wholeA,
        allowedBranchIds: [fixture.branchA2.id],
        expectedUpdatedAt: suspended.updatedAt,
        input: updateInput(suspended, {
          phoneNumber: replacementPhone,
          status: "TERMINATED",
          attendanceEnabled: false,
          terminatedAt: new Date(),
          assignments: [],
        }),
      },
      prisma,
    );

    await assert.rejects(
      updateAttendanceEmployee(
        {
          ...restrictedA2,
          expectedUpdatedAt: terminated.updatedAt,
          input: updateInput(terminated, {
            phoneNumber: replacementPhone,
            status: "TERMINATED",
            attendanceEnabled: false,
            terminatedAt: terminated.terminatedAt,
            assignments: [],
          }),
        },
        prisma,
      ),
      /outside the allowed branch scope/i,
    );

    const reactivated = await updateAttendanceEmployee(
      {
        ...wholeA,
        allowedBranchIds: [fixture.branchA2.id],
        expectedUpdatedAt: terminated.updatedAt,
        input: updateInput(terminated, {
          phoneNumber: replacementPhone,
          status: "ACTIVE",
          attendanceEnabled: true,
          terminatedAt: null,
          assignments: [
            activeAssignment(fixture.branchA2.id, {
              isPrimary: true,
            }),
          ],
        }),
      },
      prisma,
    );
    assert.equal(reactivated.status, "ACTIVE");
    const branchA2Periods =
      await prisma.employeeBranchAssignment.findMany({
        where: {
          membershipId: createdA.id,
          branchId: fixture.branchA2.id,
        },
        orderBy: { effectiveFrom: "asc" },
      });
    assert.equal(branchA2Periods.length, 2);
    assert.equal(branchA2Periods[0]?.status, "INACTIVE");
    assert.equal(branchA2Periods[1]?.status, "ACTIVE");

    assert.deepEqual(
      {
        sessions: await prisma.employeeAttendance.count({
          where: { membershipId: createdA.id },
        }),
        punches: await prisma.attendancePunch.count({
          where: { employeeId: createdA.id },
        }),
      },
      { sessions: 0, punches: 0 },
      "employee management must not create or mutate Attendance sessions/punches",
    );

    const settingCreated = await upsertBranchAttendanceSetting(
      {
        ...wholeA,
        allowedBranchIds: [fixture.branchA2.id],
        input: settingInput({
          businessId: fixture.businessB.id,
          branchId: fixture.branchA2.id,
          latitude: 1.234567,
          longitude: 110.765432,
        }),
      },
      prisma,
    );
    assert.equal(settingCreated.businessId, fixture.businessA.id);
    const settingUpdated = await upsertBranchAttendanceSetting(
      {
        ...wholeA,
        allowedBranchIds: [fixture.branchA2.id],
        input: settingInput({
          businessId: fixture.businessB.id,
          branchId: fixture.branchA2.id,
          latitude: 1.234568,
          longitude: 110.765433,
          geofenceRadiusMeters: 150,
        }),
      },
      prisma,
    );
    assert.equal(settingUpdated.id, settingCreated.id);
    assert.equal(settingUpdated.geofenceRadiusMeters, 150);

    await assert.rejects(
      upsertBranchAttendanceSetting(
        {
          ...wholeA,
          allowedBranchIds: [fixture.branchA2.id],
          input: settingInput({
            businessId: fixture.businessA.id,
            branchId: fixture.branchA1.id,
            latitude: 2,
            longitude: 111,
          }),
        },
        prisma,
      ),
      /outside the allowed branch scope/i,
    );

    const employeeAudits = await prisma.auditLog.findMany({
      where: {
        businessId: fixture.businessA.id,
        entityId: createdA.id,
      },
      orderBy: { createdAt: "asc" },
    });
    const actions = new Set(employeeAudits.map((audit) => audit.action));
    for (const action of [
      "EMPLOYEE_CREATED",
      "EMPLOYEE_UPDATED",
      "EMPLOYEE_PRIMARY_BRANCH_CHANGED",
      "EMPLOYEE_BRANCH_ASSIGNMENT_UPDATED",
      "EMPLOYEE_BRANCH_ASSIGNED",
      "EMPLOYEE_STATUS_CHANGED",
      "EMPLOYEE_SUSPENDED",
      "EMPLOYEE_TERMINATED",
      "EMPLOYEE_REACTIVATED",
      "EMPLOYEE_ATTENDANCE_DISABLED",
      "EMPLOYEE_ATTENDANCE_ENABLED",
    ]) {
      assert.equal(actions.has(action), true, `${action} audit is required`);
    }
    const assignmentAudit = employeeAudits.find(
      (audit) => audit.action === "EMPLOYEE_BRANCH_ASSIGNED",
    );
    assert.equal(
      assignmentAudit?.entityType,
      "EmployeeBusinessMembership",
    );

    const settingAudits = await prisma.auditLog.findMany({
      where: {
        businessId: fixture.businessA.id,
        entityId: settingCreated.id,
      },
      orderBy: { createdAt: "asc" },
    });
    assert.deepEqual(
      settingAudits.map((audit) => audit.action),
      [
        "BRANCH_ATTENDANCE_SETTING_CREATED",
        "BRANCH_ATTENDANCE_SETTING_UPDATED",
      ],
    );

    const serializedAudit = JSON.stringify([
      ...employeeAudits,
      ...settingAudits,
    ]);
    assert.equal(serializedAudit.includes(phone), false);
    assert.equal(serializedAudit.includes(replacementPhone), false);
    for (const coordinate of [
      "1.234567",
      "110.765432",
      "1.234568",
      "110.765433",
    ]) {
      assert.equal(
        serializedAudit.includes(coordinate),
        false,
        "Audit must not duplicate exact GPS coordinates",
      );
    }
  } finally {
    await cleanupFixture(fixture, [
      phone,
      replacementPhone,
      futurePhone,
    ]);
  }
});

function createInput(input: {
  businessId: string;
  employeeCode: string;
  phoneNumber: string;
  joinedAt: Date;
  assignments: ReturnType<typeof activeAssignment>[];
  attendanceEnabled?: boolean;
}) {
  return {
    businessId: input.businessId,
    employeeCode: input.employeeCode,
    fullName: `Employee ${input.employeeCode}`,
    phoneNumber: input.phoneNumber,
    employmentType: "FULL_TIME",
    status: "ACTIVE",
    attendanceEnabled: input.attendanceEnabled ?? false,
    joinedAt: input.joinedAt,
    terminatedAt: null,
    position: "Technician",
    assignments: input.assignments,
  };
}

function updateInput(
  employee: {
    id: string;
    employeeCode: string;
    fullName: string;
    phoneNumber: string;
    employmentType: string;
    status: string;
    attendanceEnabled: boolean;
    joinedAt: Date;
    terminatedAt: Date | null;
    position: string | null;
    businessId: string;
  },
  overrides: Record<string, unknown>,
) {
  return {
    businessId: employee.businessId,
    employeeId: employee.id,
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    phoneNumber: employee.phoneNumber,
    employmentType: employee.employmentType,
    status: employee.status,
    attendanceEnabled: employee.attendanceEnabled,
    joinedAt: employee.joinedAt,
    terminatedAt: employee.terminatedAt,
    position: employee.position,
    assignments: [],
    ...overrides,
  };
}

function activeAssignment(
  branchId: string,
  overrides: {
    isPrimary?: boolean;
    canClockIn?: boolean;
    effectiveFrom?: Date;
  } = {},
) {
  return {
    branchId,
    isPrimary: overrides.isPrimary ?? false,
    canClockIn: overrides.canClockIn ?? true,
    effectiveFrom:
      overrides.effectiveFrom ?? new Date(Date.now() - 60_000),
    effectiveUntil: null,
    status: "ACTIVE",
  };
}

function settingInput(input: {
  businessId: string;
  branchId: string;
  latitude: number;
  longitude: number;
  geofenceRadiusMeters?: number;
}) {
  return {
    ...input,
    geofenceRadiusMeters: input.geofenceRadiusMeters ?? 100,
    minimumAccuracyMeters: 80,
    requireGeofence: true,
    allowOutsideGeofenceRequest: true,
    requirePhoto: false,
    timezone: "Asia/Kuching",
    isEnabled: true,
  };
}

async function createFixture() {
  const token = randomUUID();
  const businessA = await prisma.business.create({
    data: {
      name: `Attendance Service A ${token}`,
      slug: `attendance-service-a-${token}`,
    },
  });
  const businessB = await prisma.business.create({
    data: {
      name: `Attendance Service B ${token}`,
      slug: `attendance-service-b-${token}`,
    },
  });
  const branchA1 = await prisma.branch.create({
    data: {
      businessId: businessA.id,
      name: `Attendance A1 ${token}`,
    },
  });
  const branchA2 = await prisma.branch.create({
    data: {
      businessId: businessA.id,
      name: `Attendance A2 ${token}`,
    },
  });
  const branchB1 = await prisma.branch.create({
    data: {
      businessId: businessB.id,
      name: `Attendance B1 ${token}`,
    },
  });
  const actorA = await prisma.user.create({
    data: {
      businessId: businessA.id,
      branchId: branchA1.id,
      name: "Attendance Owner A",
      email: `attendance-owner-a-${token}@test.local`,
      role: "BUSINESS_OWNER",
    },
  });
  const actorB = await prisma.user.create({
    data: {
      businessId: businessB.id,
      branchId: branchB1.id,
      name: "Attendance Owner B",
      email: `attendance-owner-b-${token}@test.local`,
      role: "BUSINESS_OWNER",
    },
  });
  return {
    businessA,
    businessB,
    branchA1,
    branchA2,
    branchB1,
    actorA,
    actorB,
  };
}

function actorFrom(actor: {
  id: string;
  name: string;
  email: string | null;
}) {
  return {
    userId: actor.id,
    name: actor.name,
    email: actor.email ?? "",
  };
}

async function cleanupFixture(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  phoneNumbers: string[],
) {
  const businessIds = [fixture.businessA.id, fixture.businessB.id];
  await prisma.auditLog.deleteMany({
    where: { businessId: { in: businessIds } },
  });
  await prisma.branchAttendanceSetting.deleteMany({
    where: { businessId: { in: businessIds } },
  });
  await prisma.employeeBusinessMembership.updateMany({
    where: { businessId: { in: businessIds } },
    data: { attendanceEnabled: false },
  });
  await prisma.employeeBranchAssignment.deleteMany({
    where: { businessId: { in: businessIds } },
  });
  await prisma.employeeBusinessMembership.deleteMany({
    where: { businessId: { in: businessIds } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [fixture.actorA.id, fixture.actorB.id] } },
  });
  await prisma.branch.deleteMany({
    where: { businessId: { in: businessIds } },
  });
  await prisma.business.deleteMany({
    where: { id: { in: businessIds } },
  });
  await prisma.employeeAccount.deleteMany({
    where: { phoneNormalized: { in: phoneNumbers } },
  });
}

function randomPhone() {
  return `+601${randomInt(10_000_000, 99_999_999)}`;
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required for Attendance integration tests.",
    );
  }
  const hostname = new URL(databaseUrl).hostname;
  if (!["localhost", "127.0.0.1"].includes(hostname)) {
    throw new Error(
      "Attendance integration tests are restricted to the local database.",
    );
  }
}
