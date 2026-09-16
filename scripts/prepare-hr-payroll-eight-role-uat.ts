import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { createEmployeeSessionRecord } from "../src/lib/attendance/employee-auth/session";
import {
  createSessionToken,
  persistSessionContext,
  SESSION_CONTEXT_VERSION,
} from "../src/lib/auth/session";
import {
  HR_PAYROLL_EIGHT_ROLE_PERSONAS,
  assertEightRoleUatEnvironment,
} from "./hr-payroll-eight-role-uat-contract";

const prisma = new PrismaClient();
const EXPECTED_BUSINESS_NAME = "Tetamu HR Acceptance Test";
const ARTIFACT_PATH = join(process.cwd(), ".tmp", "hr-payroll-core-acceptance.json");
const OUTPUT_PATH = join(process.cwd(), ".tmp", "hr-payroll-eight-role-uat.json");

type AcceptanceArtifact = {
  environment: string;
  productionAccessed: boolean;
  businessId: string;
  businessName: string;
  branchId: string;
  ownerEmail: string;
  employeeMemberships: Record<string, { membershipId: string }>;
};

async function main() {
  const password = assertEightRoleUatEnvironment(process.env);
  process.env.SESSION_SECRET ??= "tetamu-local-eight-role-app-session-secret-v1";
  process.env.EMPLOYEE_AUTH_SECRET ??= "tetamu-local-eight-role-employee-session-secret-v1";

  const artifact = JSON.parse(await readFile(ARTIFACT_PATH, "utf8")) as AcceptanceArtifact;
  if (
    artifact.environment !== "LOCAL / TESTING ONLY" ||
    artifact.productionAccessed !== false ||
    artifact.businessName !== EXPECTED_BUSINESS_NAME
  ) {
    throw new Error("HR_EIGHT_ROLE_UAT_ARTIFACT_IS_NOT_LOCAL_ACCEPTANCE_DATA");
  }

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: artifact.businessId },
    select: { id: true, industryType: true, name: true, status: true },
  });
  if (business.name !== EXPECTED_BUSINESS_NAME || business.status !== "active") {
    throw new Error("HR_EIGHT_ROLE_UAT_BUSINESS_IS_NOT_ACTIVE_ACCEPTANCE_DATA");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const prepared = await prisma.$transaction(async (tx) => {
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
          branchId: artifact.branchId,
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
          branchId: artifact.branchId,
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
    const existingMembership = await tx.businessGroupMember.findFirst({
      where: { businessId: artifact.businessId, status: "ACTIVE" },
      select: { groupId: true },
    });
    if (existingMembership && existingMembership.groupId !== group.id) {
      throw new Error("HR_EIGHT_ROLE_UAT_BUSINESS_ALREADY_HAS_ANOTHER_ACTIVE_GROUP");
    }
    if (!existingMembership) {
      await tx.businessGroupMember.create({
        data: { businessId: artifact.businessId, groupId: group.id },
      });
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
    const device = await tx.employeeDevice.upsert({
      where: {
        employeeAccountId_deviceIdentifierHash: {
          employeeAccountId: membership.employeeAccountId,
          deviceIdentifierHash,
        },
      },
      update: { canPunch: true, canView: true, status: "ACTIVE" },
      create: {
        employeeAccountId: membership.employeeAccountId,
        deviceIdentifierHash,
        displayName: "Eight-role UAT staff browser",
        platform: "Browser",
        browser: "Codex browser",
        canView: true,
        canPunch: true,
      },
    });
    const employeeSession = await createEmployeeSessionRecord({
      employeeAccountId: membership.employeeAccountId,
      membershipId: membership.id,
      businessId: membership.businessId,
      primaryBranchId,
      attendanceBranchId: primaryBranchId,
      deviceId: device.id,
      now: new Date(),
      userAgent: "Tetamu HR eight-role local UAT",
    }, tx);

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
        sessionToken: employeeSession.token,
        sessionExpiresAt: employeeSession.expiresAt.toISOString(),
      },
    };
  });

  const desktop = await Promise.all(prepared.desktopUsers.map(async (persona) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: persona.id },
      select: {
        id: true,
        businessId: true,
        branchId: true,
        name: true,
        email: true,
        role: true,
        permissions: true,
        status: true,
      },
    });
    if (!user.email) throw new Error(`${persona.persona}_EMAIL_IS_MISSING`);
    const sessionId = randomUUID();
    const session = {
      userId: user.id,
      sessionId,
      homeBusinessId: user.businessId,
      activeBusinessId: artifact.businessId,
      contextVersion: SESSION_CONTEXT_VERSION,
      industryType: business.industryType,
      branchId: user.branchId,
      name: user.name,
      email: user.email,
      role: user.role,
      permissions: user.permissions,
      status: user.status,
    };
    const stored = await persistSessionContext(session, { database: prisma });
    return {
      persona: persona.persona,
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      permissions: user.permissions,
      appSessionToken: await createSessionToken(session, {
        absoluteExpiresAt: stored.absoluteExpiresAt,
      }),
      sessionExpiresAt: stored.absoluteExpiresAt.toISOString(),
    };
  }));

  const personaOrder = [
    ...desktop.map((persona) => persona.persona),
    prepared.staff.persona,
  ];
  const expectedOrder = HR_PAYROLL_EIGHT_ROLE_PERSONAS.map((persona) => persona.key);
  if (JSON.stringify(personaOrder) !== JSON.stringify(expectedOrder)) {
    throw new Error("HR_EIGHT_ROLE_UAT_PERSONA_ORDER_MISMATCH");
  }
  const output = {
    environment: "LOCAL / TESTING ONLY",
    productionAccessed: false,
    businessId: artifact.businessId,
    branchId: artifact.branchId,
    groupId: prepared.groupId,
    passwordProvidedThroughEnvironment: true,
    appSessionCookie: "car_wash_session",
    employeeSessionCookie: "tetamu_employee_session",
    personas: [...desktop, prepared.staff],
  };
  await mkdir(join(process.cwd(), ".tmp"), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    environment: output.environment,
    businessId: output.businessId,
    personas: personaOrder,
    outputPath: OUTPUT_PATH,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "UNKNOWN_EIGHT_ROLE_UAT_FIXTURE_ERROR");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
