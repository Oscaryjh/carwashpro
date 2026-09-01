import { randomInt, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PrismaClient, type BusinessModuleKey, type Prisma } from "@prisma/client";
import { createEmployeeSessionRecord } from "@/lib/attendance/employee-auth/session";

const databaseUrl = process.env.DATABASE_URL ?? "";
const databaseHost = databaseUrl ? new URL(databaseUrl).hostname.toLowerCase() : "";
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(databaseHost)) {
  throw new Error("Profile V2 visual fixtures are restricted to a Local database.");
}

const prisma = new PrismaClient();
const artifactPath = join(process.cwd(), ".tmp", "staff-profile-v2-visual-fixtures.json");
const modules: BusinessModuleKey[] = ["HR", "CLAIMS", "COMMISSION", "PAYROLL"];

async function main() {
  const normal = await createPersona({
    name: "Alicia Tan",
    position: "Senior Stylist",
    businessName: "Royal Salon",
    branchName: "salon online",
    avatarUrl: "/pwa/apple-touch-icon.png",
    platform: "iPhone",
    browser: "Safari",
  });
  const manager = await createPersona({
    name: "Oscar Yong",
    position: "Salon Manager",
    businessName: "Royal Salon Manager UAT",
    branchName: "Main salon",
    platform: "Android",
    browser: "Chrome",
  });
  const longNames = await createPersona({
    name: "Alexandria Beatrice Nur Syafiqah Long Employee Display Name",
    position: "Senior Customer Experience and Multi-Branch Service Operations Specialist",
    businessName: "Tetamu International Hospitality and Personal Care Services Malaysia",
    branchName: "Kuala Lumpur City Centre Flagship Salon and Training Academy",
    employeeCode: "PROFILE-V2-EMPLOYEE-CODE-WITH-A-VERY-LONG-IDENTIFIER-2026",
    platform: "Android",
    browser: "Chrome",
  });
  const noAvatar = await createPersona({
    name: "No Avatar Employee",
    position: "Stylist",
    businessName: "Profile No Avatar UAT",
    branchName: "Main workplace",
    platform: "iPhone",
    browser: "Safari",
  });
  const nullablePosition = await createPersona({
    name: "Nullable Position Employee",
    position: null,
    businessName: "Profile Optional Data UAT",
    branchName: "Main workplace",
    platform: null,
    browser: null,
  });
  const multiEmployer = await createMultiEmployerPersona();

  const fixture = {
    environment: "LOCAL ONLY",
    productionAccessed: false,
    productionModified: false,
    normal,
    manager,
    singleWorkplace: normal,
    multiEmployer,
    longNames,
    deviceExpanded: normal,
    avatarAvailable: normal,
    noAvatar,
    nullablePosition,
    platformMissing: nullablePosition,
    verifiedRedirect: normal,
  };

  await mkdir(join(process.cwd(), ".tmp"), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  process.stdout.write(JSON.stringify({
    artifactPath,
    environment: fixture.environment,
    states: Object.keys(fixture).slice(3),
  }, null, 2));
}

type PersonaInput = {
  accountId?: string;
  avatarUrl?: string;
  branchName: string;
  browser: string | null;
  businessName: string;
  employeeCode?: string;
  name: string;
  platform: string | null;
  position: string | null;
};

async function createPersona(input: PersonaInput) {
  return prisma.$transaction(async (transaction) => {
    const suffix = randomUUID();
    const account = input.accountId
      ? await transaction.employeeAccount.findUniqueOrThrow({ where: { id: input.accountId } })
      : await createAccount(input.name, transaction);
    const context = await createMembershipContext({ ...input, accountId: account.id, suffix }, transaction);
    const device = await transaction.employeeDevice.create({
      data: {
        employeeAccountId: account.id,
        deviceIdentifierHash: `profile-v2-${suffix}`,
        displayName: null,
        platform: input.platform,
        browser: input.browser,
        canView: true,
        canPunch: false,
        firstVerifiedAt: new Date("2026-08-20T04:00:00.000Z"),
        lastActiveAt: new Date(),
      },
    });
    const session = await createEmployeeSessionRecord({
      employeeAccountId: account.id,
      membershipId: context.membershipId,
      businessId: context.businessId,
      primaryBranchId: context.branchId,
      attendanceBranchId: context.branchId,
      deviceId: device.id,
      now: new Date(),
      userAgent: "Tetamu Staff Profile V2 local visual UAT",
    }, transaction);
    return { ...context, accountId: account.id, sessionToken: session.token };
  }, { isolationLevel: "Serializable", timeout: 15_000 });
}

async function createMultiEmployerPersona() {
  const account = await prisma.$transaction((transaction) => createAccount("Multi Employer Employee", transaction));
  const first = await createPersona({
    accountId: account.id,
    name: "Multi Employer Employee",
    position: "Service Specialist",
    businessName: "Royal Salon Group A",
    branchName: "Salon A",
    platform: "Android",
    browser: "Chrome",
  });
  const second = await prisma.$transaction((transaction) => createMembershipContext({
    accountId: account.id,
    name: "Multi Employer Employee",
    position: "Service Specialist",
    businessName: "Royal Salon Group B",
    branchName: "Salon B",
    browser: "Chrome",
    platform: "Android",
    suffix: randomUUID(),
  }, transaction));
  const inactive = await prisma.$transaction(async (transaction) => {
    const context = await createMembershipContext({
      accountId: account.id,
      name: "Multi Employer Employee",
      position: "Former Specialist",
      businessName: "Inactive Former Workplace",
      branchName: "Closed branch",
      browser: "Chrome",
      platform: "Android",
      suffix: randomUUID(),
    }, transaction);
    await transaction.employeeBusinessMembership.update({
      where: { id: context.membershipId },
      data: { status: "TERMINATED" },
    });
    return context;
  });
  return { ...first, alternateMembershipId: second.membershipId, inactiveMembershipId: inactive.membershipId };
}

async function createMembershipContext(
  input: PersonaInput & { accountId: string; suffix: string },
  transaction: Prisma.TransactionClient,
) {
  const account = await transaction.employeeAccount.findUniqueOrThrow({
    where: { id: input.accountId },
    select: { phoneNumber: true, phoneNormalized: true },
  });
  const business = await transaction.business.create({
    data: { name: input.businessName, slug: `staff-profile-v2-${input.suffix}` },
  });
  const branch = await transaction.branch.create({
    data: { businessId: business.id, name: input.branchName },
  });
  const membership = await transaction.employeeBusinessMembership.create({
    data: {
      avatarUrl: input.avatarUrl ?? null,
      businessId: business.id,
      employeeAccountId: input.accountId,
      employeeCode: input.employeeCode ?? `PROFILE-${input.suffix.slice(0, 8)}`,
      employmentType: "FULL_TIME",
      fullName: input.name,
      joinedAt: new Date("2026-01-01T00:00:00.000Z"),
      phoneNumber: account.phoneNumber,
      phoneNumberNormalized: account.phoneNormalized,
      position: input.position,
    },
  });
  await transaction.employeeBranchAssignment.create({
    data: {
      branchId: branch.id,
      businessId: business.id,
      membershipId: membership.id,
      isPrimary: true,
      canClockIn: false,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      status: "ACTIVE",
    },
  });
  await transaction.businessModuleEntitlement.createMany({
    data: modules.map((moduleKey) => ({
      businessId: business.id,
      moduleKey,
      status: "ENABLED" as const,
      enabledFrom: new Date("2026-01-01T00:00:00.000Z"),
      source: "MANUAL" as const,
    })),
  });
  return {
    businessId: business.id,
    businessName: business.name,
    branchId: branch.id,
    membershipId: membership.id,
  };
}

function createAccount(name: string, transaction: Prisma.TransactionClient) {
  const phone = `+601${randomInt(10_000_000, 99_999_999)}`;
  return transaction.employeeAccount.create({
    data: { name, phoneNumber: phone, phoneNormalized: phone },
  });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
