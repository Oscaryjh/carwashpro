import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma, type PrismaClient } from "@prisma/client";
import { HR_PAYROLL_EIGHT_ROLE_PERSONAS, resolveEightRoleUatDeviceWrite } from "../hr-payroll-eight-role-uat-contract";
import { HR_PAYROLL_UAT_BOUNDARY_BUSINESS_SLUG, HR_PAYROLL_UAT_SYNTHETIC_BUSINESS_SLUG } from "../uat-preview-database-guard";
type AcceptanceArtifact = {
  businessId: string;
  businessName: string;
  branchId: string;
  ownerEmail: string;
  employeeMemberships: Record<string, { membershipId: string }>;
};


export async function seedStagingRoles(prisma: PrismaClient, password: string, artifact: AcceptanceArtifact) {
const EXPECTED_BUSINESS_NAME = "Tetamu HR Acceptance Test";
const BOUNDARY_BUSINESS_NAME = "Tetamu HR Boundary Test";
const BOUNDARY_TOPOLOGY_VERSION = "hr-payroll-uat-preview-r3-v1";
const FIXTURE_DATE = new Date("2026-09-17T00:00:00.000Z");

function deterministicUuid(value: string) {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function ensureBoundaryEmployee(
  tx: Prisma.TransactionClient,
  input: {
    businessId: string;
    branchId: string;
    code: "BOUNDARY-B" | "TENANT-B";
    name: string;
    phone: string;
  },
) {
  const accountId = deterministicUuid(`uat-preview-r3:account:${input.code}`);
  const membershipId = deterministicUuid(`uat-preview-r3:membership:${input.code}`);
  await tx.employeeAccount.upsert({
    where: { id: accountId },
    update: {
      name: input.name,
      phoneNumber: input.phone,
      phoneNormalized: input.phone,
      status: "ACTIVE",
    },
    create: {
      id: accountId,
      name: input.name,
      phoneNumber: input.phone,
      phoneNormalized: input.phone,
      status: "ACTIVE",
    },
  });
  const membership = await tx.employeeBusinessMembership.upsert({
    where: { id: membershipId },
    update: {
      employeeAccountId: accountId,
      businessId: input.businessId,
      employeeCode: input.code,
      fullName: input.name,
      phoneNumber: input.phone,
      phoneNumberNormalized: input.phone,
      status: "ACTIVE",
      isTestAccount: true,
      attendanceEnabled: true,
      payBasis: "MONTHLY",
      baseSalary: 2800,
      workingDaysPerMonth: 26,
      normalWorkMinutesPerDay: 480,
    },
    create: {
      id: membershipId,
      employeeAccountId: accountId,
      businessId: input.businessId,
      employeeCode: input.code,
      fullName: input.name,
      phoneNumber: input.phone,
      phoneNumberNormalized: input.phone,
      employmentType: "FULL_TIME",
      status: "ACTIVE",
      isTestAccount: true,
      attendanceEnabled: true,
      payBasis: "MONTHLY",
      baseSalary: 2800,
      workingDaysPerMonth: 26,
      normalWorkMinutesPerDay: 480,
      targetBreakMinutes: 60,
      statutoryNationality: "MALAYSIAN",
      statutoryProfileRevision: 1,
      joinedAt: new Date("2026-01-01T00:00:00.000Z"),
      position: "Synthetic boundary tester",
    },
  });
  await tx.employeeBranchAssignment.upsert({
    where: { id: deterministicUuid(`uat-preview-r3:branch-assignment:${input.code}`) },
    update: {
      businessId: input.businessId,
      branchId: input.branchId,
      membershipId,
      isPrimary: true,
      canClockIn: true,
      status: "ACTIVE",
      effectiveUntil: null,
    },
    create: {
      id: deterministicUuid(`uat-preview-r3:branch-assignment:${input.code}`),
      businessId: input.businessId,
      branchId: input.branchId,
      membershipId,
      isPrimary: true,
      canClockIn: true,
      status: "ACTIVE",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  return membership;
}

async function ensureBoundaryLeave(
  tx: Prisma.TransactionClient,
  input: {
    businessId: string;
    branchId: string;
    membershipId: string;
    policyId: string;
    policyVersionId: string;
    policyName: string;
    reviewerId: string;
    key: string;
    date: Date;
  },
) {
  const requestId = deterministicUuid(`uat-preview-r3:leave:${input.key}`);
  const clientRequestId = deterministicUuid(`uat-preview-r3:leave-client:${input.key}`);
  const request =
    (await tx.leaveRequest.findUnique({ where: { id: requestId } })) ??
    (await tx.leaveRequest.create({
      data: {
      id: requestId,
      businessId: input.businessId,
      branchId: input.branchId,
      membershipId: input.membershipId,
      policyId: input.policyId,
      policyVersionId: input.policyVersionId,
      policyNameSnapshot: input.policyName,
      payTreatmentSnapshot: "PAID",
      balanceTrackedSnapshot: false,
      legalStatusSnapshot: "COMPANY_POLICY_ONLY",
      complianceStatusSnapshot: "NOT_APPLICABLE",
      leaveUnit: "FULL_DAY",
      startsOn: input.date,
      endsOn: input.date,
      requestedDays: 1,
      reason: "Synthetic cross-scope browser UAT leave.",
      status: "APPROVED",
      revision: 1,
      clientRequestId,
      reviewedById: input.reviewerId,
      reviewedAt: FIXTURE_DATE,
      decisionDigest: digest(`uat-preview-r3:leave-decision:${input.key}`),
      },
    }));
  const dayKey = {
    leaveRequestId_leaveDate: {
      leaveRequestId: request.id,
      leaveDate: input.date,
    },
  } as const;
  if (!(await tx.leaveRequestDay.findUnique({ where: dayKey }))) {
    await tx.leaveRequestDay.create({
      data: {
      id: deterministicUuid(`uat-preview-r3:leave-day:${input.key}`),
      leaveRequestId: request.id,
      businessId: input.businessId,
      membershipId: input.membershipId,
      leaveDate: input.date,
      dayFraction: 1,
      leaveUnit: "FULL_DAY",
      expectedDayKindSnapshot: "WORKDAY",
      policyVersionId: input.policyVersionId,
      payTreatmentSnapshot: "PAID",
      balanceConsumptionUnits: 1,
      },
    });
  }
  return request;
}

async function ensureBoundaryTimesheet(
  tx: Prisma.TransactionClient,
  input: {
    businessId: string;
    branchId: string;
    membershipId: string;
    ownerId: string;
    key: string;
    leaveRequestId: string;
    periodStart: Date;
    workDate: Date;
  },
) {
  const leave = await tx.leaveRequest.findFirstOrThrow({ where: { id: input.leaveRequestId, businessId: input.businessId, membershipId: input.membershipId } });
  const timesheet = await tx.attendanceMonthlyTimesheet.upsert({
    where: {
      businessId_periodStart: {
        businessId: input.businessId,
        periodStart: input.periodStart,
      },
    },
    update: {},
    create: {
      id: deterministicUuid(`uat-preview-r3:timesheet:${input.key}`),
      businessId: input.businessId,
      periodStart: input.periodStart,
    },
  });
  const revision = await tx.attendanceTimesheetRevision.upsert({
    where: {
      timesheetId_revision: { timesheetId: timesheet.id, revision: 1 },
    },
    update: {},
    create: {
      id: deterministicUuid(`uat-preview-r3:timesheet-revision:${input.key}`),
      timesheetId: timesheet.id,
      businessId: input.businessId,
      revision: 1,
      periodStart: input.periodStart,
      sourceDigest: digest(`uat-preview-r3:timesheet:${input.key}`),
      reason: "Synthetic cross-scope browser UAT locked timesheet.",
      lockedAt: FIXTURE_DATE,
      lockedById: input.ownerId,
    },
  });
  await tx.attendanceMonthlyTimesheet.update({
    where: { id: timesheet.id },
    data: {
      status: "LOCKED",
      currentRevisionId: revision.id,
      revisionReason: "Synthetic cross-scope browser UAT.",
    },
  });
  const finalResultId = deterministicUuid(`uat-preview-r3:final-result:${input.key}`);
  await tx.attendanceP2FinalResult.upsert({
    where: {
      businessId_membershipId_workDate_version: {
        businessId: input.businessId,
        membershipId: input.membershipId,
        workDate: input.workDate,
        version: 1,
      },
    },
    update: {},
    create: {
      id: finalResultId,
      businessId: input.businessId,
      branchId: input.branchId,
      membershipId: input.membershipId,
      workDate: input.workDate,
      version: 1,
      outcome: "APPROVED_PAID_LEAVE",
      expectedDayKindSnapshot: "WORKDAY",
      leaveRequestId: input.leaveRequestId,
      leaveDayFractionSnapshot: 1,
      totalBreakMinutes: 0,
      totalWorkedMinutes: 0,
      sourceDigest: digest(`uat-preview-r3:final-result-source:${input.key}`),
      resolutionDigest: digest(`uat-preview-r3:final-result-resolution:${input.key}`),
      createdById: input.ownerId,
    },
  });
  await tx.attendanceTimesheetP2DaySnapshot.upsert({
    where: {
      revisionId_membershipId_workDate: {
        revisionId: revision.id,
        membershipId: input.membershipId,
        workDate: input.workDate,
      },
    },
    update: {},
    create: {
      id: deterministicUuid(`uat-preview-r3:timesheet-day:${input.key}`),
      revisionId: revision.id,
      businessId: input.businessId,
      branchId: input.branchId,
      membershipId: input.membershipId,
      workDate: input.workDate,
      finalResultId,
      finalResultVersion: 1,
      outcome: "APPROVED_PAID_LEAVE",
      expectedDayKindSnapshot: "WORKDAY",
      leaveDayFractionSnapshot: 1,
      leaveRequestIdSnapshot: input.leaveRequestId,
      leaveRequestRevisionSnapshot: 1,
      leaveRequestDigestSnapshot: leave.decisionDigest,
      leavePolicyIdSnapshot: leave.policyId,
      leavePolicyVersionIdSnapshot: leave.policyVersionId,
      leavePolicyNameSnapshot: leave.policyNameSnapshot,
      leavePayTreatmentSnapshot: leave.payTreatmentSnapshot,
      leaveUnitSnapshot: leave.leaveUnit,
      leaveLegalStatusSnapshot: leave.legalStatusSnapshot,
      leaveComplianceStatusSnapshot: leave.complianceStatusSnapshot,
      timezoneSnapshot: "Asia/Kuching",
      totalBreakMinutes: 0,
      totalWorkedMinutes: 0,
      sourceDigest: digest(`uat-preview-r3:timesheet-day:${input.key}`),
    },
  });
}

async function ensureBoundaryTopology(
  tx: Prisma.TransactionClient,
  primaryBusinessId: string,
  primaryOwnerId: string,
) {
  const primaryBoundaryBranch = await tx.branch.upsert({
    where: { id: deterministicUuid("uat-preview-r3:primary-boundary-branch") },
    update: { businessId: primaryBusinessId, name: "Synthetic Boundary Branch" },
    create: {
      id: deterministicUuid("uat-preview-r3:primary-boundary-branch"),
      businessId: primaryBusinessId,
      name: "Synthetic Boundary Branch",
      countryCode: "MY",
      stateCode: "SBH",
    },
  });
  const primaryBoundaryEmployee = await ensureBoundaryEmployee(tx, {
    businessId: primaryBusinessId,
    branchId: primaryBoundaryBranch.id,
    code: "BOUNDARY-B",
    name: "Synthetic Branch Boundary Employee",
    phone: "+60000000001",
  });
  const primaryPolicy = await tx.leavePolicy.findFirstOrThrow({
    where: { businessId: primaryBusinessId, code: "ANNUAL" },
    include: { versions: { where: { status: "ACTIVE" }, orderBy: { revision: "desc" }, take: 1 } },
  });
  const primaryPolicyVersion = primaryPolicy.versions[0];
  if (!primaryPolicyVersion) throw new Error("HR_UAT_BOUNDARY_PRIMARY_POLICY_VERSION_MISSING");
  const primaryLeave = await ensureBoundaryLeave(tx, {
    businessId: primaryBusinessId,
    branchId: primaryBoundaryBranch.id,
    membershipId: primaryBoundaryEmployee.id,
    policyId: primaryPolicy.id,
    policyVersionId: primaryPolicyVersion.id,
    policyName: primaryPolicy.name,
    reviewerId: primaryOwnerId,
    key: "primary-boundary",
    date: new Date("2026-09-25T00:00:00.000Z"),
  });
  await ensureBoundaryTimesheet(tx, {
    businessId: primaryBusinessId,
    branchId: primaryBoundaryBranch.id,
    membershipId: primaryBoundaryEmployee.id,
    ownerId: primaryOwnerId,
    key: "primary-boundary",
    leaveRequestId: primaryLeave.id,
    periodStart: new Date("2026-09-01T00:00:00.000Z"),
    workDate: new Date("2026-09-25T00:00:00.000Z"),
  });


  const boundaryBusiness = await tx.business.upsert({
    where: { slug: HR_PAYROLL_UAT_BOUNDARY_BUSINESS_SLUG },
    update: { name: BOUNDARY_BUSINESS_NAME, status: "active" },
    create: {
      id: deterministicUuid("uat-preview-r3:boundary-business"),
      name: BOUNDARY_BUSINESS_NAME,
      slug: HR_PAYROLL_UAT_BOUNDARY_BUSINESS_SLUG,
      industryType: "GENERAL_SERVICE",
      timezone: "Asia/Kuching",
      status: "active",
    },
  });
  const boundaryBranch = await tx.branch.upsert({
    where: { id: deterministicUuid("uat-preview-r3:boundary-business-branch") },
    update: { businessId: boundaryBusiness.id, name: "Synthetic Tenant Branch" },
    create: {
      id: deterministicUuid("uat-preview-r3:boundary-business-branch"),
      businessId: boundaryBusiness.id,
      name: "Synthetic Tenant Branch",
      countryCode: "MY",
      stateCode: "SBH",
    },
  });
  const boundaryOwner = await tx.user.upsert({
    where: { email: "uat.boundary-owner@tetamu.local" },
    update: {
      businessId: boundaryBusiness.id,
      branchId: boundaryBranch.id,
      name: "Synthetic Boundary Owner",
      role: "BUSINESS_OWNER",
      status: "active",
      loginEnabled: false,
      passwordHash: null,
    },
    create: {
      id: deterministicUuid("uat-preview-r3:boundary-owner"),
      businessId: boundaryBusiness.id,
      branchId: boundaryBranch.id,
      name: "Synthetic Boundary Owner",
      email: "uat.boundary-owner@tetamu.local",
      role: "BUSINESS_OWNER",
      status: "active",
      loginEnabled: false,
    },
  });
  for (const moduleKey of ["HR", "PAYROLL"] as const) {
    const moduleWhere = {
      businessId_moduleKey: { businessId: boundaryBusiness.id, moduleKey },
    } as const;
    if (!(await tx.businessModuleEntitlement.findUnique({ where: moduleWhere }))) {
      await tx.businessModuleEntitlement.create({
        data: {
        id: deterministicUuid(`uat-preview-r3:boundary-module:${moduleKey}`),
        businessId: boundaryBusiness.id,
        moduleKey,
        status: "ENABLED",
        enabledFrom: new Date("2026-01-01T00:00:00.000Z"),
        source: "SYSTEM",
        planCode: "UAT_PREVIEW_SYNTHETIC_BOUNDARY",
        createdById: boundaryOwner.id,
        updatedById: boundaryOwner.id,
        },
      });
    }
  }
  const boundaryPolicyWhere = {
    businessId_code: { businessId: boundaryBusiness.id, code: "ANNUAL" },
  } as const;
  const boundaryPolicy =
    (await tx.leavePolicy.findUnique({ where: boundaryPolicyWhere })) ??
    (await tx.leavePolicy.create({
      data: {
      id: deterministicUuid("uat-preview-r3:boundary-leave-policy"),
      businessId: boundaryBusiness.id,
      code: "ANNUAL",
      name: "Synthetic annual leave",
      payTreatment: "PAID",
      balanceTracked: false,
      active: true,
      origin: "BUSINESS_CUSTOM",
      legalStatus: "COMPANY_POLICY_ONLY",
      },
    }));
  const boundaryPolicyVersionWhere = {
    policyId_revision: { policyId: boundaryPolicy.id, revision: 1 },
  } as const;
  const boundaryPolicyVersion =
    (await tx.leavePolicyVersion.findUnique({ where: boundaryPolicyVersionWhere })) ??
    (await tx.leavePolicyVersion.create({
      data: {
      id: deterministicUuid("uat-preview-r3:boundary-leave-policy-version"),
      businessId: boundaryBusiness.id,
      policyId: boundaryPolicy.id,
      revision: 1,
      status: "ACTIVE",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      nameSnapshot: boundaryPolicy.name,
      payTreatment: "PAID",
      countMode: "WEEKDAYS",
      balanceTracked: false,
      origin: "BUSINESS_CUSTOM",
      legalStatus: "COMPANY_POLICY_ONLY",
      reason: "Synthetic cross-tenant UAT boundary fixture.",
      createdById: boundaryOwner.id,
      },
    }));
  const tenantEmployee = await ensureBoundaryEmployee(tx, {
    businessId: boundaryBusiness.id,
    branchId: boundaryBranch.id,
    code: "TENANT-B",
    name: "Synthetic Tenant Boundary Employee",
    phone: "+60000000002",
  });
  const tenantLeave = await ensureBoundaryLeave(tx, {
    businessId: boundaryBusiness.id,
    branchId: boundaryBranch.id,
    membershipId: tenantEmployee.id,
    policyId: boundaryPolicy.id,
    policyVersionId: boundaryPolicyVersion.id,
    policyName: boundaryPolicy.name,
    reviewerId: boundaryOwner.id,
    key: "tenant-boundary",
    date: new Date("2026-09-26T00:00:00.000Z"),
  });
  await ensureBoundaryTimesheet(tx, {
    businessId: boundaryBusiness.id,
    branchId: boundaryBranch.id,
    membershipId: tenantEmployee.id,
    ownerId: boundaryOwner.id,
    key: "tenant-boundary",
    leaveRequestId: tenantLeave.id,
    periodStart: new Date("2026-09-01T00:00:00.000Z"),
    workDate: new Date("2026-09-26T00:00:00.000Z"),
  });

  return { boundaryBusiness, boundaryBranch, primaryBoundaryBranch };
}

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: artifact.businessId },
    select: { id: true, industryType: true, name: true, slug: true, status: true },
  });
  if (
    business.name !== EXPECTED_BUSINESS_NAME ||
    business.status !== "active" ||
    business.slug !== HR_PAYROLL_UAT_SYNTHETIC_BUSINESS_SLUG
  ) {
    throw new Error("HR_EIGHT_ROLE_UAT_BUSINESS_IS_NOT_ACTIVE_ACCEPTANCE_DATA");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const prepared = await prisma.$transaction(async (tx) => {
    // The ordinary fixture never reopens published runs or relabels a tampered employee.
    // Legacy published periods require the separately authorized maintenance CLI first.

    const owner = await tx.user.findFirstOrThrow({
      where: {
        businessId: artifact.businessId,
        email: artifact.ownerEmail,
        role: "BUSINESS_OWNER",
      },
      select: { id: true, name: true, email: true, role: true },
    });
    await tx.user.update({
      where: { id: owner.id },
      data: { passwordHash, loginEnabled: true, status: "active" },
    });

    const boundary = await ensureBoundaryTopology(
      tx,
      artifact.businessId,
      owner.id,
    );

    const directUsers = [];
    for (const persona of HR_PAYROLL_EIGHT_ROLE_PERSONAS) {
      if (persona.kind !== "DIRECT_USER") continue;
      const permissions = [...persona.permissions];
      const roleProfile = await tx.staffRoleProfile.upsert({
        where: {
          businessId_name: {
            businessId: artifact.businessId,
            name: persona.roleProfile,
          },
        },
        update: { permissions, active: true },
        create: {
          businessId: artifact.businessId,
          name: persona.roleProfile,
          permissions,
          active: true,
        },
      });
      const user = await tx.user.upsert({
        where: { email: persona.email },
        update: {
          businessId: artifact.businessId,
          branchId: persona.key === "BRANCH_MANAGER"
            ? boundary.primaryBoundaryBranch.id
            : artifact.branchId,
          name: persona.name,
          passwordHash,
          loginEnabled: true,
          role: "STAFF",
          permissions,
          staffRoleProfileId: roleProfile.id,
          status: "active",
        },
        create: {
          businessId: artifact.businessId,
          branchId: persona.key === "BRANCH_MANAGER"
            ? boundary.primaryBoundaryBranch.id
            : artifact.branchId,
          name: persona.name,
          email: persona.email,
          passwordHash,
          loginEnabled: true,
          role: "STAFF",
          permissions,
          staffRoleProfileId: roleProfile.id,
          status: "active",
        },
        select: { id: true, name: true, email: true, role: true },
      });
      directUsers.push({ persona: persona.key, ...user });
    }

    const groupCode = `hr-payroll-uat-${artifact.businessId}`;
    const group = await tx.businessGroup.upsert({
      where: { code: groupCode },
      update: { name: "HR Payroll local UAT group", status: "ACTIVE" },
      create: { code: groupCode, name: "HR Payroll local UAT group" },
    });
    for (const businessId of [artifact.businessId, boundary.boundaryBusiness.id]) {
      const existingMembership = await tx.businessGroupMember.findFirst({
        where: { businessId, status: "ACTIVE" },
        select: { id: true, groupId: true },
      });
      if (existingMembership && existingMembership.groupId !== group.id) {
        throw new Error("HR_EIGHT_ROLE_UAT_BUSINESS_ALREADY_HAS_ANOTHER_ACTIVE_GROUP");
      }
      if (!existingMembership) {
        await tx.businessGroupMember.create({
          data: {
            id: deterministicUuid(`uat-preview-r3:group-member:${businessId}`),
            businessId,
            groupId: group.id,
          },
        });
      }
    }

    const groupUsers = [];
    for (const persona of HR_PAYROLL_EIGHT_ROLE_PERSONAS) {
      if (persona.kind !== "GROUP_USER") continue;
      const identityRole = persona.groupRole === "GROUP_OWNER" ? "BUSINESS_OWNER" : "STAFF";
      const user = await tx.user.upsert({
        where: { email: persona.email },
        update: {
          businessId: null,
          branchId: null,
          name: persona.name,
          passwordHash,
          loginEnabled: true,
          role: identityRole,
          permissions: [],
          status: "active",
        },
        create: {
          businessId: null,
          branchId: null,
          name: persona.name,
          email: persona.email,
          passwordHash,
          loginEnabled: true,
          role: identityRole,
          permissions: [],
          status: "active",
        },
        select: { id: true, name: true, email: true, role: true },
      });
      const existingGrant = await tx.businessGroupUser.findFirst({
        where: { groupId: group.id, userId: user.id },
        select: { id: true },
      });
      const grantData = {
        accessScope: persona.groupRole === "GROUP_OWNER"
          ? "ALL_GROUP_BUSINESSES" as const
          : "SELECTED_BUSINESSES" as const,
        role: persona.groupRole,
        status: "ACTIVE" as const,
        revokedAt: null,
      };
      const grant = existingGrant
        ? await tx.businessGroupUser.update({ where: { id: existingGrant.id }, data: grantData })
        : await tx.businessGroupUser.create({
            data: { ...grantData, groupId: group.id, userId: user.id },
          });
      await tx.businessGroupUserBusinessAccess.deleteMany({ where: { groupUserId: grant.id } });
      if (persona.groupRole === "GROUP_MANAGER") {
        await tx.businessGroupUserBusinessAccess.create({
          data: { businessId: artifact.businessId, groupUserId: grant.id },
        });
      }
      groupUsers.push({ persona: persona.key, ...user });
    }

    const acceptanceMembershipIds = Object.values(artifact.employeeMemberships)
      .map((item) => item.membershipId)
      .filter(Boolean);
    const membership = await tx.employeeBusinessMembership.findFirst({
      where: {
        id: { in: acceptanceMembershipIds },
        businessId: artifact.businessId,
        status: "ACTIVE",
        staffUser: null,
      },
      select: {
        id: true,
        employeeAccountId: true,
        businessId: true,
        employeeCode: true,
        fullName: true,
        branchAssignments: {
          where: { status: "ACTIVE", isPrimary: true },
          select: { branchId: true },
          take: 1,
        },
      },
      orderBy: { employeeCode: "asc" },
    });
    if (!membership) throw new Error("HR_EIGHT_ROLE_UAT_STAFF_MEMBERSHIP_IS_MISSING");
    const primaryBranchId = membership.branchAssignments[0]?.branchId;
    if (!primaryBranchId) throw new Error("HR_EIGHT_ROLE_UAT_STAFF_PRIMARY_BRANCH_IS_MISSING");
    const deviceIdentifierHash = createHash("sha256")
      .update("hr-eight-role-uat-staff-browser")
      .digest("hex");
    const existingDevice = await tx.employeeDevice.findFirst({
      where: {
        employeeAccountId: membership.employeeAccountId,
        status: "ACTIVE",
        canPunch: true,
      },
      select: { id: true },
    });
    const deviceWrite = resolveEightRoleUatDeviceWrite(existingDevice, {
      employeeAccountId: membership.employeeAccountId,
      deviceIdentifierHash,
    });
    if (deviceWrite.mode === "UPDATE") {
      await tx.employeeDevice.update({
          where: deviceWrite.where,
          data: deviceWrite.data,
        });
    } else {
      await tx.employeeDevice.create({ data: deviceWrite.data });
    }
    // The orchestration layer revokes installation sessions after all service workflows.
    return {
      desktopUsers: [
        { persona: "BUSINESS_OWNER" as const, ...owner },
        ...directUsers,
        ...groupUsers,
      ],
      groupId: group.id,
      staff: {
        persona: "STAFF" as const,
        employeeCode: membership.employeeCode,
        fullName: membership.fullName,
        membershipId: membership.id,
        authentication: "STAFF_UI_HMAC_OTP_REQUIRED" as const,
      },
      topologyVersion: BOUNDARY_TOPOLOGY_VERSION,
    };
  });

  return prepared;
}
