import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { PrismaClient } from "@prisma/client";
import type { ResolvedBusinessAccess } from "../../src/lib/business-groups/business-access";
import {
  createTeamMember,
  linkExistingStaffToEmployee,
  updateLegacyStaffProfile,
  updateTeamMember,
  type TeamMemberFeatures,
} from "../../src/lib/team/people-service";
import { synchronizeTeamMemberEmploymentState } from "../../src/lib/team/people-status";

const prisma = new PrismaClient();

after(async () => {
  await prisma.$disconnect();
});

test("People service unifies employee, attendance, service, and POS identities without losing history", async () => {
  assertLocalDatabase();
  const fixture = await createFixture();
  const phones: string[] = [];

  try {
    const employeeOnlyPhone = nextPhone(phones);
    const employeeOnly = await createPerson({
      fixture,
      businessId: fixture.businessA.id,
      branchId: fixture.branchA1.id,
      code: "PEOPLE-EMPLOYEE",
      phone: employeeOnlyPhone,
      features: noFeatures(),
    });
    assert.equal(employeeOnly.staffUser, null);
    assert.equal(employeeOnly.membership.attendanceEnabled, false);

    const attendancePhone = nextPhone(phones);
    const attendanceOnly = await createPerson({
      fixture,
      businessId: fixture.businessA.id,
      branchId: fixture.branchA1.id,
      code: "PEOPLE-ATTENDANCE",
      phone: attendancePhone,
      attendanceEnabled: true,
      canClockIn: true,
      features: noFeatures(),
    });
    assert.equal(attendanceOnly.staffUser, null);
    assert.equal(attendanceOnly.membership.attendanceEnabled, true);
    assert.equal(
      attendanceOnly.membership.branchAssignments[0]?.canClockIn,
      true,
    );

    const servicePhone = nextPhone(phones);
    const serviceOnly = await createPerson({
      fixture,
      businessId: fixture.businessA.id,
      branchId: fixture.branchA1.id,
      code: "PEOPLE-SERVICE",
      phone: servicePhone,
      features: serviceFeatures(fixture),
    });
    assert.ok(serviceOnly.staffUser);
    assert.equal(serviceOnly.staffUser.loginEnabled, false);
    assert.equal(serviceOnly.staffUser.appointmentBookable, true);
    assert.equal(
      serviceOnly.staffUser.staffRoleProfileId,
      fixture.roleA.id,
    );
    assert.equal(serviceOnly.staffUser.staffLevelId, fixture.levelA.id);
    assert.deepEqual(
      await assignedServiceIds(serviceOnly.staffUser.id),
      [fixture.serviceA1.id],
    );

    const posPhone = nextPhone(phones);
    const posOnly = await createPerson({
      fixture,
      businessId: fixture.businessA.id,
      branchId: fixture.branchA1.id,
      code: "PEOPLE-POS",
      phone: posPhone,
      features: posFeatures("people-pos"),
    });
    assert.ok(posOnly.staffUser);
    assert.equal(posOnly.staffUser.loginEnabled, true);
    assert.equal(posOnly.staffUser.appointmentBookable, false);
    assert.deepEqual(posOnly.staffUser.permissions, ["TEAM"]);
    assert.deepEqual(await assignedServiceIds(posOnly.staffUser.id), []);

    const allPhone = nextPhone(phones);
    const allFeatures = {
      ...serviceFeatures(fixture),
      ...posFeatures("people-all"),
      appointmentBookable: true,
      serviceIds: [fixture.serviceA1.id, fixture.serviceA2.id],
      staffLevelId: fixture.levelA.id,
      staffRoleProfileId: fixture.roleA.id,
    };
    const allFeaturesPerson = await createPerson({
      fixture,
      businessId: fixture.businessA.id,
      branchId: fixture.branchA2.id,
      code: "PEOPLE-ALL",
      phone: allPhone,
      attendanceEnabled: true,
      canClockIn: true,
      features: allFeatures,
    });
    assert.ok(allFeaturesPerson.staffUser);
    assert.equal(allFeaturesPerson.staffUser.loginEnabled, true);
    assert.equal(allFeaturesPerson.staffUser.appointmentBookable, true);
    assert.deepEqual(
      await assignedServiceIds(allFeaturesPerson.staffUser.id),
      [fixture.serviceA1.id, fixture.serviceA2.id].sort(),
    );

    const secondBusinessMembership = await createPerson({
      fixture,
      businessId: fixture.businessB.id,
      branchId: fixture.branchB1.id,
      code: "PEOPLE-SHARED-IDENTITY",
      phone: employeeOnlyPhone,
      features: noFeatures(),
    });
    assert.equal(
      secondBusinessMembership.membership.employeeAccountId,
      employeeOnly.membership.employeeAccountId,
      "the same normalized phone may share one global account across businesses",
    );
    assert.notEqual(
      secondBusinessMembership.membership.id,
      employeeOnly.membership.id,
    );

    const reusedMembership = await createPerson({
      fixture,
      businessId: fixture.businessA.id,
      branchId: fixture.branchA2.id,
      code: "PEOPLE-EMPLOYEE",
      phone: employeeOnlyPhone,
      fullName: "Updated exact employee",
      features: noFeatures(),
    });
    assert.equal(reusedMembership.membership.id, employeeOnly.membership.id);
    assert.equal(reusedMembership.membership.fullName, "Updated exact employee");
    assert.equal(
      await prisma.employeeBusinessMembership.count({
        where: {
          businessId: fixture.businessA.id,
          employeeCode: "PEOPLE-EMPLOYEE",
        },
      }),
      1,
    );

    const legacyPhone = nextPhone(phones);
    const legacyStaff = await prisma.user.create({
      data: {
        businessId: fixture.businessA.id,
        branchId: fixture.branchA1.id,
        name: "Exact legacy staff",
        whatsappPhone: localPhone(legacyPhone),
        loginEnabled: false,
        role: "STAFF",
      },
    });
    const editedLegacyStaff = await updateLegacyStaffProfile(
      {
        actor: actorFrom(fixture.actorA),
        allowedBranchIds: [fixture.branchA1.id, fixture.branchA2.id],
        branchId: fixture.branchA2.id,
        businessId: fixture.businessA.id,
        features: serviceFeatures(fixture),
        name: "Edited legacy staff",
        userId: legacyStaff.id,
        whatsappPhone: localPhone(legacyPhone),
        wholeBusinessScope: true,
      },
      prisma,
    );
    assert.equal(editedLegacyStaff.name, "Edited legacy staff");
    assert.equal(editedLegacyStaff.branchId, fixture.branchA2.id);
    assert.equal(editedLegacyStaff.appointmentBookable, true);
    assert.equal(editedLegacyStaff.employeeBusinessMembershipId, null);
    assert.deepEqual(
      await assignedServiceIds(legacyStaff.id),
      [fixture.serviceA1.id],
    );
    assert.ok(
      await prisma.auditLog.findFirst({
        where: {
          action: "LEGACY_STAFF_UPDATED",
          businessId: fixture.businessA.id,
          entityId: legacyStaff.id,
        },
      }),
      "editing an unlinked Staff profile must create an audit record",
    );
    await assert.rejects(
      updateLegacyStaffProfile(
        {
          actor: actorFrom(fixture.actorA),
          allowedBranchIds: [fixture.branchA1.id, fixture.branchA2.id],
          branchId: fixture.branchB1.id,
          businessId: fixture.businessA.id,
          features: noFeatures(),
          name: "Cross-business attempt",
          userId: legacyStaff.id,
          whatsappPhone: localPhone(legacyPhone),
          wholeBusinessScope: true,
        },
        prisma,
      ),
      /active branch.*authorized branch scope/i,
    );
    assert.equal(
      (
        await prisma.user.findUniqueOrThrow({
          where: { id: legacyStaff.id },
          select: { branchId: true, name: true },
        })
      ).name,
      "Edited legacy staff",
      "a rejected branch change must not partially update the Staff profile",
    );
    await assert.rejects(
      updateLegacyStaffProfile(
        {
          actor: actorFrom(fixture.actorA),
          allowedBranchIds: [fixture.branchA2.id],
          branchId: fixture.branchA1.id,
          businessId: fixture.businessA.id,
          features: noFeatures(),
          name: "Unauthorized branch attempt",
          userId: legacyStaff.id,
          whatsappPhone: localPhone(legacyPhone),
          wholeBusinessScope: false,
        },
        prisma,
      ),
      /authorized branch scope/i,
    );
    assert.equal(
      (
        await prisma.user.findUniqueOrThrow({
          where: { id: legacyStaff.id },
          select: { branchId: true },
        })
      ).branchId,
      fixture.branchA2.id,
    );

    const reusedLegacy = await createPerson({
      fixture,
      businessId: fixture.businessA.id,
      branchId: fixture.branchA1.id,
      code: "PEOPLE-LEGACY-REUSE",
      phone: legacyPhone,
      features: noFeatures(),
      legacyStaffUserId: legacyStaff.id,
      baseSalary: 2000,
      normalWorkMinutesPerDay: 480,
      payBasis: "MONTHLY",
      targetBreakMinutes: 60,
    });
    assert.equal(reusedLegacy.staffUser?.id, legacyStaff.id);
    assert.equal(
      (
        await prisma.user.findUniqueOrThrow({
          where: { id: legacyStaff.id },
        })
      ).employeeBusinessMembershipId,
      reusedLegacy.membership.id,
      "explicit Edit upgrade must link the selected legacy Staff profile",
    );
    assert.equal(
      reusedLegacy.staffUser?.teamMemberLinkReason,
      "EDIT_EMPLOYMENT_UPGRADE",
    );
    assert.equal(reusedLegacy.membership.baseSalary?.toString(), "2000");
    assert.equal(reusedLegacy.membership.normalWorkMinutesPerDay, 480);
    assert.equal(reusedLegacy.membership.payBasis, "MONTHLY");
    assert.equal(reusedLegacy.membership.targetBreakMinutes, 60);

    const ambiguousPhone = nextPhone(phones);
    await prisma.user.createMany({
      data: [
        {
          businessId: fixture.businessA.id,
          branchId: fixture.branchA1.id,
          name: "Ambiguous staff one",
          whatsappPhone: ambiguousPhone,
          loginEnabled: false,
          role: "STAFF",
        },
        {
          businessId: fixture.businessA.id,
          branchId: fixture.branchA2.id,
          name: "Ambiguous staff two",
          whatsappPhone: localPhone(ambiguousPhone),
          loginEnabled: false,
          role: "STAFF",
        },
      ],
    });
    await assert.rejects(
      createPerson({
        fixture,
        businessId: fixture.businessA.id,
        branchId: fixture.branchA1.id,
        code: "PEOPLE-AMBIGUOUS",
        phone: ambiguousPhone,
        features: noFeatures(),
      }),
      /multiple.*staff.*manual review/i,
    );
    assert.equal(
      await prisma.employeeBusinessMembership.count({
        where: {
          businessId: fixture.businessA.id,
          employeeCode: "PEOPLE-AMBIGUOUS",
        },
      }),
      0,
      "ambiguous legacy reuse must roll back employee creation",
    );

    const invalidRolePhone = nextPhone(phones);
    await assert.rejects(
      createPerson({
        fixture,
        businessId: fixture.businessA.id,
        branchId: fixture.branchA1.id,
        code: "PEOPLE-FOREIGN-ROLE",
        phone: invalidRolePhone,
        features: {
          ...serviceFeatures(fixture),
          staffRoleProfileId: fixture.roleB.id,
        },
      }),
      /staff role.*another business/i,
    );
    assert.equal(
      await prisma.employeeBusinessMembership.count({
        where: {
          businessId: fixture.businessA.id,
          employeeCode: "PEOPLE-FOREIGN-ROLE",
        },
      }),
      0,
    );

    const invalidLevelPhone = nextPhone(phones);
    await assert.rejects(
      createPerson({
        fixture,
        businessId: fixture.businessA.id,
        branchId: fixture.branchA1.id,
        code: "PEOPLE-FOREIGN-LEVEL",
        phone: invalidLevelPhone,
        features: {
          ...serviceFeatures(fixture),
          staffLevelId: fixture.levelB.id,
        },
      }),
      /staff level.*another business/i,
    );
    assert.equal(
      await prisma.employeeBusinessMembership.count({
        where: {
          businessId: fixture.businessA.id,
          employeeCode: "PEOPLE-FOREIGN-LEVEL",
        },
      }),
      0,
    );

    const invalidServicePhone = nextPhone(phones);
    await assert.rejects(
      createPerson({
        fixture,
        businessId: fixture.businessA.id,
        branchId: fixture.branchA1.id,
        code: "PEOPLE-FOREIGN-SERVICE",
        phone: invalidServicePhone,
        features: {
          ...serviceFeatures(fixture),
          serviceIds: [fixture.serviceB.id],
        },
      }),
      /active services.*selected business/i,
    );
    assert.equal(
      await prisma.employeeBusinessMembership.count({
        where: {
          businessId: fixture.businessA.id,
          employeeCode: "PEOPLE-FOREIGN-SERVICE",
        },
      }),
      0,
    );

    const conflictingPhone = nextPhone(phones);
    await assert.rejects(
      createPerson({
        fixture,
        businessId: fixture.businessA.id,
        branchId: fixture.branchA1.id,
        code: "PEOPLE-ATTENDANCE",
        phone: conflictingPhone,
        features: noFeatures(),
      }),
      /different employee records.*manual review/i,
    );
    assert.equal(
      await prisma.employeeBusinessMembership.count({
        where: {
          businessId: fixture.businessA.id,
          phoneNumberNormalized: conflictingPhone,
        },
      }),
      0,
    );

    const linkPhone = nextPhone(phones);
    const linkTarget = await createPerson({
      fixture,
      businessId: fixture.businessA.id,
      branchId: fixture.branchA1.id,
      code: "PEOPLE-MANUAL-LINK",
      phone: linkPhone,
      features: noFeatures(),
    });
    const linkStaff = await prisma.user.create({
      data: {
        businessId: fixture.businessA.id,
        branchId: fixture.branchA1.id,
        name: "Manual link staff",
        whatsappPhone: nextPhone(phones),
        loginEnabled: false,
        role: "STAFF",
      },
    });
    const linked = await linkExistingStaffToEmployee(
      {
        actor: actorFrom(fixture.actorA),
        allowedBranchIds: [fixture.branchA1.id],
        businessId: fixture.businessA.id,
        wholeBusinessScope: true,
        membershipId: linkTarget.membership.id,
        userId: linkStaff.id,
      },
      prisma,
    );
    assert.equal(
      linked.employeeBusinessMembershipId,
      linkTarget.membership.id,
    );

    const foreignStaff = await prisma.user.create({
      data: {
        businessId: fixture.businessB.id,
        branchId: fixture.branchB1.id,
        name: "Foreign manual link",
        whatsappPhone: nextPhone(phones),
        role: "STAFF",
      },
    });
    await assert.rejects(
      linkExistingStaffToEmployee(
        {
          actor: actorFrom(fixture.actorA),
        allowedBranchIds: [fixture.branchA1.id],
          businessId: fixture.businessA.id,
        wholeBusinessScope: true,
          membershipId: linkTarget.membership.id,
          userId: foreignStaff.id,
        },
        prisma,
      ),
      /must belong to the selected business/i,
    );

    const occupiedCompetitor = await prisma.user.create({
      data: {
        businessId: fixture.businessA.id,
        branchId: fixture.branchA1.id,
        name: "Occupied competitor",
        whatsappPhone: nextPhone(phones),
        role: "STAFF",
      },
    });
    await assert.rejects(
      linkExistingStaffToEmployee(
        {
          actor: actorFrom(fixture.actorA),
        allowedBranchIds: [fixture.branchA1.id],
          businessId: fixture.businessA.id,
        wholeBusinessScope: true,
          membershipId: linkTarget.membership.id,
          userId: occupiedCompetitor.id,
        },
        prisma,
      ),
      /already linked to another staff/i,
    );

    const suspendedLinkPhone = nextPhone(phones);
    const suspendedTarget = await createPerson({
      fixture,
      businessId: fixture.businessA.id,
      branchId: fixture.branchA1.id,
      code: "PEOPLE-SUSPENDED-LINK",
      phone: suspendedLinkPhone,
      status: "SUSPENDED",
      features: noFeatures(),
    });
    const suspendedStaff = await prisma.user.create({
      data: {
        appointmentBookable: true,
        businessId: fixture.businessA.id,
        branchId: fixture.branchA1.id,
        email: `suspended-link-${randomUUID()}@test.local`,
        loginEnabled: true,
        name: "Suspended link staff",
        passwordHash: "hash",
        role: "STAFF",
      },
    });
    await linkExistingStaffToEmployee(
      {
        actor: actorFrom(fixture.actorA),
        allowedBranchIds: [fixture.branchA1.id],
        businessId: fixture.businessA.id,
        wholeBusinessScope: true,
        membershipId: suspendedTarget.membership.id,
        userId: suspendedStaff.id,
      },
      prisma,
    );
    const suspendedLinkedUser = await prisma.user.findUniqueOrThrow({
      where: { id: suspendedStaff.id },
    });
    assert.equal(suspendedLinkedUser.status, "inactive");
    assert.equal(suspendedLinkedUser.loginEnabled, false);
    assert.equal(suspendedLinkedUser.appointmentBookable, false);

    const activeSession = await prisma.employeeSession.create({
      data: {
        businessId: fixture.businessA.id,
        employeeAccountId:
          allFeaturesPerson.membership.employeeAccountId,
        expiresAt: new Date(Date.now() + 86_400_000),
        membershipId: allFeaturesPerson.membership.id,
        primaryBranchId: fixture.branchA2.id,
        refreshTokenHash: `people-${randomUUID()}`,
      },
    });
    const suspendedAll = await updateTeamMember(
      {
        actor: actorFrom(fixture.actorA),
        allowedBranchIds: [fixture.branchA1.id, fixture.branchA2.id],
        businessId: fixture.businessA.id,
        compensationAccess: businessOwnerAccess(fixture, fixture.businessA.id),
        expectedUpdatedAt: allFeaturesPerson.membership.updatedAt,
        features: allFeatures,
        input: employeeUpdateInput(
          allFeaturesPerson.membership,
          fixture.branchA2.id,
          {
            attendanceEnabled: false,
            canClockIn: false,
            status: "SUSPENDED",
          },
        ),
        userId: allFeaturesPerson.staffUser.id,
        wholeBusinessScope: true,
      },
      prisma,
    );
    assert.equal(suspendedAll.membership.status, "SUSPENDED");
    assert.equal(suspendedAll.membership.attendanceEnabled, false);
    assert.equal(suspendedAll.staffUser.status, "inactive");
    assert.equal(suspendedAll.staffUser.loginEnabled, false);
    assert.equal(suspendedAll.staffUser.appointmentBookable, false);
    assert.equal(
      (
        await prisma.employeeBranchAssignment.findFirstOrThrow({
          where: {
            membershipId: suspendedAll.membership.id,
            status: "ACTIVE",
          },
        })
      ).canClockIn,
      false,
    );
    assert.ok(
      (
        await prisma.employeeSession.findUniqueOrThrow({
          where: { id: activeSession.id },
        })
      ).revokedAt,
      "suspension must revoke active employee sessions",
    );

    const privilegedPhone = nextPhone(phones);
    const privilegedEmployee = await createPerson({
      fixture,
      businessId: fixture.businessA.id,
      branchId: fixture.branchA1.id,
      code: "PEOPLE-PRIVILEGED",
      phone: privilegedPhone,
      features: noFeatures(),
    });
    const privilegedOwner = await prisma.user.create({
      data: {
        appointmentBookable: true,
        businessId: fixture.businessA.id,
        branchId: fixture.branchA1.id,
        email: `privileged-owner-${randomUUID()}@test.local`,
        employeeAccountId:
          privilegedEmployee.membership.employeeAccountId,
        employeeBusinessMembershipId:
          privilegedEmployee.membership.id,
        loginEnabled: true,
        name: "Privileged owner",
        passwordHash: "hash",
        role: "BUSINESS_OWNER",
        status: "active",
        teamMemberLinkedAt: new Date(),
        teamMemberLinkReason: "TEST_PRIVILEGED_LINK",
        teamMemberLinkStatus: "LINKED",
      },
    });
    await prisma.$transaction((transaction) =>
      synchronizeTeamMemberEmploymentState(transaction, {
        businessId: fixture.businessA.id,
        employeeAccountId:
          privilegedEmployee.membership.employeeAccountId,
        fullName: privilegedEmployee.membership.fullName,
        membershipId: privilegedEmployee.membership.id,
        phoneNumberNormalized:
          privilegedEmployee.membership.phoneNumberNormalized,
        status: "SUSPENDED",
      }),
    );
    const protectedOwner = await prisma.user.findUniqueOrThrow({
      where: { id: privilegedOwner.id },
    });
    assert.equal(protectedOwner.status, "active");
    assert.equal(protectedOwner.loginEnabled, true);
    assert.equal(protectedOwner.appointmentBookable, true);

    const customer = await prisma.customer.create({
      data: {
        branchId: fixture.branchA1.id,
        businessId: fixture.businessA.id,
        name: "People history customer",
        phone: nextPhone(phones),
      },
    });
    const appointment = await prisma.appointment.create({
      data: {
        assignedStaffId: serviceOnly.staffUser.id,
        branchId: fixture.branchA1.id,
        businessId: fixture.businessA.id,
        customerId: customer.id,
        scheduledAt: new Date(Date.now() + 86_400_000),
        serviceId: fixture.serviceA1.id,
        serviceIds: [fixture.serviceA1.id],
      },
    });
    const serviceProfileUpdated = await updateTeamMember(
      {
        actor: actorFrom(fixture.actorA),
        allowedBranchIds: [fixture.branchA1.id, fixture.branchA2.id],
        businessId: fixture.businessA.id,
        compensationAccess: businessOwnerAccess(fixture, fixture.businessA.id),
        expectedUpdatedAt: serviceOnly.membership.updatedAt,
        features: noFeatures(),
        input: employeeUpdateInput(
          serviceOnly.membership,
          fixture.branchA1.id,
        ),
        userId: serviceOnly.staffUser.id,
        wholeBusinessScope: true,
      },
      prisma,
    );
    assert.equal(serviceProfileUpdated.staffUser.appointmentBookable, false);
    assert.deepEqual(
      await assignedServiceIds(serviceOnly.staffUser.id),
      [],
    );
    assert.ok(
      await prisma.appointment.findUnique({
        where: { id: appointment.id },
      }),
      "disabling service features must preserve appointment history",
    );
    assert.ok(
      await prisma.user.findUnique({
        where: { id: serviceOnly.staffUser.id },
      }),
      "feature changes must never hard-delete the staff profile",
    );
  } finally {
    await cleanupFixture(fixture, phones);
  }
});

async function createFixture() {
  const token = randomUUID();
  const businessA = await prisma.business.create({
    data: {
      name: `People Service A ${token}`,
      slug: `people-service-a-${token}`,
    },
  });
  const businessB = await prisma.business.create({
    data: {
      name: `People Service B ${token}`,
      slug: `people-service-b-${token}`,
    },
  });
  const branchA1 = await prisma.branch.create({
    data: {
      businessId: businessA.id,
      name: `People A1 ${token}`,
    },
  });
  const branchA2 = await prisma.branch.create({
    data: {
      businessId: businessA.id,
      name: `People A2 ${token}`,
    },
  });
  const branchB1 = await prisma.branch.create({
    data: {
      businessId: businessB.id,
      name: `People B1 ${token}`,
    },
  });
  const actorA = await prisma.user.create({
    data: {
      businessId: businessA.id,
      branchId: branchA1.id,
      email: `people-actor-a-${token}@test.local`,
      name: "People actor A",
      role: "BUSINESS_OWNER",
    },
  });
  const actorB = await prisma.user.create({
    data: {
      businessId: businessB.id,
      branchId: branchB1.id,
      email: `people-actor-b-${token}@test.local`,
      name: "People actor B",
      role: "BUSINESS_OWNER",
    },
  });
  const roleA = await prisma.staffRoleProfile.create({
    data: {
      businessId: businessA.id,
      name: `Therapist ${token}`,
    },
  });
  const roleB = await prisma.staffRoleProfile.create({
    data: {
      businessId: businessB.id,
      name: `Foreign role ${token}`,
    },
  });
  const levelA = await prisma.staffLevel.create({
    data: {
      businessId: businessA.id,
      name: `Senior ${token}`,
    },
  });
  const levelB = await prisma.staffLevel.create({
    data: {
      businessId: businessB.id,
      name: `Foreign level ${token}`,
    },
  });
  const serviceA1 = await prisma.service.create({
    data: {
      businessId: businessA.id,
      name: `People Service A1 ${token}`,
      price: 10,
      status: "ACTIVE",
    },
  });
  const serviceA2 = await prisma.service.create({
    data: {
      businessId: businessA.id,
      name: `People Service A2 ${token}`,
      price: 20,
      status: "ACTIVE",
    },
  });
  const serviceB = await prisma.service.create({
    data: {
      businessId: businessB.id,
      name: `People Service B ${token}`,
      price: 30,
      status: "ACTIVE",
    },
  });

  return {
    actorA,
    actorB,
    branchA1,
    branchA2,
    branchB1,
    businessA,
    businessB,
    levelA,
    levelB,
    roleA,
    roleB,
    serviceA1,
    serviceA2,
    serviceB,
  };
}

async function createPerson(input: {
  fixture: Awaited<ReturnType<typeof createFixture>>;
  businessId: string;
  branchId: string;
  code: string;
  phone: string;
  features: TeamMemberFeatures & { passwordHash: string | null };
  attendanceEnabled?: boolean;
  baseSalary?: number;
  normalWorkMinutesPerDay?: number;
  payBasis?: "MONTHLY" | "DAILY" | "HOURLY";
  targetBreakMinutes?: number;
  canClockIn?: boolean;
  fullName?: string;
  status?: "ACTIVE" | "SUSPENDED";
  legacyStaffUserId?: string;
}) {
  const actor =
    input.businessId === input.fixture.businessA.id
      ? input.fixture.actorA
      : input.fixture.actorB;
  return createTeamMember(
    {
      actor: actorFrom(actor),
      allowedBranchIds:
        input.businessId === input.fixture.businessA.id
          ? [input.fixture.branchA1.id, input.fixture.branchA2.id]
          : [input.fixture.branchB1.id],
      businessId: input.businessId,
      compensationAccess: businessOwnerAccess(input.fixture, input.businessId),
      features: input.features,
      input: {
        assignments: [
          {
            branchId: input.branchId,
            canClockIn:
              input.status === "SUSPENDED"
                ? false
                : input.canClockIn ?? false,
            effectiveFrom: new Date(Date.now() - 60_000),
            effectiveUntil: null,
            isPrimary: true,
            status: "ACTIVE",
          },
        ],
        attendanceEnabled:
          input.status === "SUSPENDED"
            ? false
            : input.attendanceEnabled ?? false,
        businessId: input.businessId,
        employeeCode: input.code,
        employmentType: "FULL_TIME",
        fullName: input.fullName ?? `Employee ${input.code}`,
        baseSalary: input.baseSalary,
        normalWorkMinutesPerDay: input.normalWorkMinutesPerDay,
        payBasis: input.payBasis,
        targetBreakMinutes: input.targetBreakMinutes,
        joinedAt: new Date(Date.now() - 86_400_000),
        phoneNumber: input.phone,
        position: null,
        status: input.status ?? "ACTIVE",
        terminatedAt: null,
      },
      wholeBusinessScope: true,
      legacyStaffUserId: input.legacyStaffUserId,
    },
    prisma,
  );
}

function employeeUpdateInput(
  membership: {
    id: string;
    businessId: string;
    employeeCode: string;
    employmentType: string;
    fullName: string;
    joinedAt: Date;
    phoneNumber: string;
    position: string | null;
  },
  branchId: string,
  overrides: {
    attendanceEnabled?: boolean;
    canClockIn?: boolean;
    status?: "ACTIVE" | "SUSPENDED";
  } = {},
) {
  return {
    assignments: [
      {
        branchId,
        canClockIn: overrides.canClockIn ?? false,
        effectiveFrom: new Date(Date.now() - 60_000),
        effectiveUntil: null,
        isPrimary: true,
        status: "ACTIVE",
      },
    ],
    attendanceEnabled: overrides.attendanceEnabled ?? false,
    businessId: membership.businessId,
    employeeCode: membership.employeeCode,
    employeeId: membership.id,
    employmentType: membership.employmentType,
    fullName: membership.fullName,
    joinedAt: membership.joinedAt,
    phoneNumber: membership.phoneNumber,
    position: membership.position,
    status: overrides.status ?? "ACTIVE",
    terminatedAt: null,
  };
}

function noFeatures(): TeamMemberFeatures & {
  passwordHash: null;
} {
  return {
    appointmentBookable: false,
    email: null,
    loginEnabled: false,
    passwordHash: null,
    permissions: [],
    serviceIds: [],
    staffLevelId: null,
    staffRoleProfileId: null,
  };
}

function serviceFeatures(
  fixture: Awaited<ReturnType<typeof createFixture>>,
): TeamMemberFeatures & { passwordHash: null } {
  return {
    appointmentBookable: true,
    email: null,
    loginEnabled: false,
    passwordHash: null,
    permissions: [],
    serviceIds: [fixture.serviceA1.id],
    staffLevelId: fixture.levelA.id,
    staffRoleProfileId: fixture.roleA.id,
  };
}

function posFeatures(
  prefix: string,
): TeamMemberFeatures & { passwordHash: string } {
  return {
    appointmentBookable: false,
    email: `${prefix}-${randomUUID()}@test.local`,
    loginEnabled: true,
    passwordHash: "integration-password-hash",
    permissions: ["TEAM"],
    serviceIds: [],
    staffLevelId: null,
    staffRoleProfileId: null,
  };
}

async function assignedServiceIds(userId: string) {
  return (
    await prisma.serviceStaffAssignment.findMany({
      where: { userId },
      orderBy: { serviceId: "asc" },
      select: { serviceId: true },
    })
  ).map((assignment) => assignment.serviceId);
}

function actorFrom(actor: {
  id: string;
  name: string;
  email: string | null;
}) {
  return {
    email: actor.email ?? "",
    name: actor.name,
    userId: actor.id,
  };
}

function nextPhone(collection: string[]) {
  let phone = "";
  do {
    phone = `+601${randomInt(10_000_000, 99_999_999)}`;
  } while (collection.includes(phone));
  collection.push(phone);
  return phone;
}

function localPhone(phone: string) {
  return phone.replace(/^\+60/, "0");
}

async function cleanupFixture(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  phones: string[],
) {
  const businessIds = [fixture.businessA.id, fixture.businessB.id];
  await prisma.employeeSession.deleteMany({
    where: { businessId: { in: businessIds } },
  });
  await prisma.appointment.deleteMany({
    where: { businessId: { in: businessIds } },
  });
  await prisma.serviceStaffAssignment.deleteMany({
    where: { businessId: { in: businessIds } },
  });
  await prisma.auditLog.deleteMany({
    where: { businessId: { in: businessIds } },
  });
  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT set_config('tetamu.compensation_version_maintenance', 'on', TRUE)`;
    await transaction.$executeRaw`SELECT set_config('tetamu.payroll_profile_command_maintenance', 'on', TRUE)`;
    await transaction.payrollProfileCommandRecord.deleteMany({
      where: { businessId: { in: businessIds } },
    });
    await transaction.employeeCompensationVersion.deleteMany({
      where: { businessId: { in: businessIds } },
    });
  });
  await prisma.customer.deleteMany({
    where: { businessId: { in: businessIds } },
  });
  await prisma.user.deleteMany({
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
  await prisma.employeeAccount.deleteMany({
    where: { phoneNormalized: { in: phones } },
  });
  await prisma.service.deleteMany({
    where: { businessId: { in: businessIds } },
  });
  await prisma.staffRoleProfile.deleteMany({
    where: { businessId: { in: businessIds } },
  });
  await prisma.staffLevel.deleteMany({
    where: { businessId: { in: businessIds } },
  });
  await prisma.branch.deleteMany({
    where: { businessId: { in: businessIds } },
  });
  await prisma.business.deleteMany({
    where: { id: { in: businessIds } },
  });
}

function businessOwnerAccess(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  businessId: string,
): ResolvedBusinessAccess {
  const businessA = businessId === fixture.businessA.id;
  const owner = businessA ? fixture.actorA : fixture.actorB;
  const branch = businessA ? fixture.branchA1 : fixture.branchB1;
  return {
    actorRole: "BUSINESS_OWNER",
    branchId: branch.id,
    businessId,
    capability: null,
    effectiveBusinessRole: "BUSINESS_OWNER",
    granted: true,
    groupId: null,
    groupUserId: null,
    homeBusinessId: businessId,
    identityRole: "BUSINESS_OWNER",
    industryType: "AUTO_DETAILING",
    permissions: [],
    source: "DIRECT_BUSINESS",
    userId: owner.id,
  };
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required for People integration tests.",
    );
  }
  const hostname = new URL(databaseUrl).hostname;
  if (!["localhost", "127.0.0.1"].includes(hostname)) {
    throw new Error(
      "People integration tests are restricted to the local database.",
    );
  }
}
