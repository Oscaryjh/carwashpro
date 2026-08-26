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

const prisma = new PrismaClient();
const EXPECTED_BUSINESS_NAME = "Tetamu HR Acceptance Test";
const ARTIFACT_PATH = join(process.cwd(), ".tmp", "hr-payroll-core-acceptance.json");
const OUTPUT_PATH = join(process.cwd(), ".tmp", "hr-payroll-five-role-uat.json");

const personas = [
  {
    key: "SUPERVISOR",
    name: "UAT Supervisor",
    email: "uat.supervisor@tetamu.local",
    roleProfile: "Supervisor",
    permissions: ["APPROVE_LEAVE", "REVIEW_CLAIM"],
  },
  {
    key: "BRANCH_MANAGER",
    name: "UAT Branch Manager",
    email: "uat.branch-manager@tetamu.local",
    roleProfile: "Branch Manager",
    permissions: [
      "ATTENDANCE_EMPLOYEE_READ",
      "ROSTER_VIEW",
      "APPROVE_LEAVE",
      "REVIEW_CLAIM",
    ],
  },
  {
    key: "HR",
    name: "UAT HR",
    email: "uat.hr@tetamu.local",
    roleProfile: "HR",
    permissions: [
      "ALL_BRANCHES",
      "ATTENDANCE_EMPLOYEE_READ",
      "ATTENDANCE_EMPLOYEE_MANAGE",
      "ROSTER_VIEW",
      "VIEW_LEAVE",
      "APPROVE_LEAVE",
      "VIEW_CLAIM",
      "REVIEW_CLAIM",
      "VIEW_COMPENSATION",
      "VIEW_PAYROLL_RUN",
      "VIEW_PAYSLIP",
      "PAYROLL_READ",
    ],
  },
] as const;

type AcceptanceArtifact = {
  environment: string;
  productionAccessed: boolean;
  businessId: string;
  businessName: string;
  branchId: string;
  ownerEmail: string;
  employeeMemberships: Record<string, { membershipId: string }>;
};

function assertLocalOnly() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("HR_FIVE_ROLE_UAT_FORBIDDEN_IN_PRODUCTION");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname)) {
    throw new Error("HR_FIVE_ROLE_UAT_REQUIRES_A_LOCAL_DATABASE");
  }
  const password = process.env.HR_FIVE_ROLE_UAT_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error("HR_FIVE_ROLE_UAT_PASSWORD_MUST_BE_AT_LEAST_12_CHARACTERS");
  }
  return password;
}

async function main() {
  const password = assertLocalOnly();
  const artifact = JSON.parse(
    await readFile(ARTIFACT_PATH, "utf8"),
  ) as AcceptanceArtifact;
  if (
    artifact.environment !== "LOCAL / TESTING ONLY" ||
    artifact.productionAccessed !== false ||
    artifact.businessName !== EXPECTED_BUSINESS_NAME
  ) {
    throw new Error("HR_FIVE_ROLE_UAT_ARTIFACT_IS_NOT_LOCAL_ACCEPTANCE_DATA");
  }

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: artifact.businessId },
    select: { id: true, name: true, status: true },
  });
  if (business.name !== EXPECTED_BUSINESS_NAME || business.status !== "active") {
    throw new Error("HR_FIVE_ROLE_UAT_BUSINESS_IS_NOT_ACTIVE_ACCEPTANCE_DATA");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const prepared = await prisma.$transaction(async (tx) => {
    const users = [];
    for (const persona of personas) {
      const roleProfile = await tx.staffRoleProfile.upsert({
        where: {
          businessId_name: {
            businessId: artifact.businessId,
            name: persona.roleProfile,
          },
        },
        update: { permissions: [...persona.permissions], active: true },
        create: {
          businessId: artifact.businessId,
          name: persona.roleProfile,
          permissions: [...persona.permissions],
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
          permissions: [...persona.permissions],
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
          permissions: [...persona.permissions],
          staffRoleProfileId: roleProfile.id,
          status: "active",
        },
        select: { id: true, name: true, email: true, role: true, permissions: true },
      });
      users.push({ persona: persona.key, ...user });
    }

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
    if (!membership) throw new Error("UNPRIVILEGED_ACCEPTANCE_EMPLOYEE_IS_MISSING");
    const primaryBranchId = membership.branchAssignments[0]?.branchId;
    if (!primaryBranchId) throw new Error("CORE_A_PRIMARY_BRANCH_IS_MISSING");
    const deviceIdentifierHash = createHash("sha256")
      .update("hr-five-role-uat-core-a-browser")
      .digest("hex");
    const existingDevice = await tx.employeeDevice.findFirst({
      where: {
        employeeAccountId: membership.employeeAccountId,
        status: "ACTIVE",
        canView: true,
      },
      orderBy: { createdAt: "desc" },
    });
    const device = existingDevice
      ? existingDevice
      : await tx.employeeDevice.create({
          data: {
            employeeAccountId: membership.employeeAccountId,
            deviceIdentifierHash,
            displayName: "Five-role UAT browser",
            platform: "Browser",
            browser: "Codex in-app browser",
            canView: true,
            canPunch: true,
          },
        });
    const employeeSession = await createEmployeeSessionRecord(
      {
        employeeAccountId: membership.employeeAccountId,
        membershipId: membership.id,
        businessId: membership.businessId,
        primaryBranchId,
        attendanceBranchId: primaryBranchId,
        deviceId: device.id,
        now: new Date(),
        userAgent: "Tetamu HR five-role local UAT",
      },
      tx,
    );

    return {
      owner: { persona: "BUSINESS_OWNER", ...owner },
      users,
      employee: {
        persona: "EMPLOYEE",
        employeeCode: membership.employeeCode,
        fullName: membership.fullName,
        membershipId: membership.id,
        sessionToken: employeeSession.token,
        sessionExpiresAt: employeeSession.expiresAt.toISOString(),
      },
    };
  });

  const businessContext = await prisma.business.findUniqueOrThrow({
    where: { id: artifact.businessId },
    select: { industryType: true },
  });
  const appPersonas = await Promise.all(
    [...prepared.users, prepared.owner].map(async (persona) => {
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
        activeBusinessId: user.businessId,
        contextVersion: SESSION_CONTEXT_VERSION,
        industryType: businessContext.industryType,
        branchId: user.branchId,
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: user.permissions,
        status: user.status,
      };
      const stored = await persistSessionContext(session, { database: prisma });
      return {
        ...persona,
        appSessionToken: await createSessionToken(session, {
          absoluteExpiresAt: stored.absoluteExpiresAt,
        }),
      };
    }),
  );

  const owner = appPersonas.find((persona) => persona.persona === "BUSINESS_OWNER");
  if (!owner) throw new Error("BUSINESS_OWNER_UAT_PERSONA_NOT_PREPARED");

  const output = {
    environment: "LOCAL / TESTING ONLY",
    productionAccessed: false,
    businessId: artifact.businessId,
    branchId: artifact.branchId,
    passwordProvidedThroughEnvironment: true,
    employeeSessionCookie: "tetamu_employee_session",
    employee: prepared.employee,
    users: appPersonas.filter((persona) => persona.persona !== "BUSINESS_OWNER"),
    owner,
  };
  await mkdir(join(process.cwd(), ".tmp"), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    environment: output.environment,
    businessId: output.businessId,
    personas: [
      output.employee.persona,
      ...output.users.map((user) => user.persona),
      output.owner.persona,
    ],
    outputPath: OUTPUT_PATH,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "UNKNOWN_UAT_FIXTURE_ERROR");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
