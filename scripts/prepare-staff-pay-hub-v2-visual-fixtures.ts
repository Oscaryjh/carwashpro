import { createHash, randomInt, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { createEmployeeSessionRecord } from "@/lib/attendance/employee-auth/session";

const databaseUrl = process.env.DATABASE_URL ?? "";
const databaseHost = databaseUrl ? new URL(databaseUrl).hostname.toLowerCase() : "";
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(databaseHost)) {
  throw new Error("Pay Hub V2 visual fixtures are restricted to a Local database.");
}

const prisma = new PrismaClient();
const artifactPath = join(process.cwd(), ".tmp", "staff-pay-hub-v2-visual-fixtures.json");

async function main() {
  const sharedAccount = await createAccount("Pay Hub UAT Employee");
  const normal = await createWorkplace({
    accountId: sharedAccount.id,
    businessName: "Royal Salon Pay UAT",
    employeeName: "Pay Hub UAT Employee",
    modules: ["HR", "PAYROLL", "COMMISSION"],
    publishedPay: { gross: "3800.00", net: "3245.60" },
  });
  const noPublication = await createWorkplace({
    accountId: sharedAccount.id,
    businessName: "Royal Salon No Publication UAT",
    employeeName: "Pay Hub UAT Employee",
    modules: ["HR", "PAYROLL", "COMMISSION"],
  });
  const payrollOnly = await createWorkplace({
    businessName: "Payroll Only UAT",
    employeeName: "Payroll Only Employee",
    modules: ["HR", "PAYROLL"],
    publishedPay: { gross: "1.00", net: "1.00" },
  });
  const commissionOnly = await createWorkplace({
    businessName: "Commission Only UAT",
    employeeName: "Commission Only Employee",
    modules: ["COMMISSION"],
  });
  const longLarge = await createWorkplace({
    businessName: "Tetamu International Hospitality and Personal Care Services Malaysia",
    employeeName: "Manager as Employee With an Exceptionally Long Display Name",
    modules: ["HR", "PAYROLL", "COMMISSION"],
    publishedPay: { gross: "150000.00", net: "123456.78" },
  });

  await mkdir(join(process.cwd(), ".tmp"), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify({
    environment: "LOCAL ONLY",
    productionAccessed: false,
    normal,
    noPublication,
    payrollOnly,
    commissionOnly,
    longLarge,
  }, null, 2)}\n`, "utf8");

  process.stdout.write(JSON.stringify({
    environment: "LOCAL ONLY",
    artifactPath,
    states: ["normal", "noPublication", "payrollOnly", "commissionOnly", "longLarge"],
  }, null, 2));
}

async function createAccount(name: string) {
  const phone = `+601${randomInt(10_000_000, 99_999_999)}`;
  return prisma.employeeAccount.create({
    data: { name, phoneNumber: phone, phoneNormalized: phone },
  });
}

async function createWorkplace(input: {
  accountId?: string;
  businessName: string;
  employeeName: string;
  modules: Array<"HR" | "PAYROLL" | "COMMISSION">;
  publishedPay?: { gross: string; net: string };
}) {
  return prisma.$transaction(async (transaction) => {
    const suffix = randomUUID();
    const account = input.accountId
      ? await transaction.employeeAccount.findUniqueOrThrow({ where: { id: input.accountId } })
      : await createAccountInTransaction(input.employeeName, transaction);
    const business = await transaction.business.create({
      data: {
        name: input.businessName,
        slug: `staff-pay-hub-v2-${suffix}`,
      },
    });
    const branch = await transaction.branch.create({
      data: { businessId: business.id, name: "Main workplace" },
    });
    const owner = await transaction.user.create({
      data: {
        branchId: branch.id,
        businessId: business.id,
        name: "Pay Hub V2 fixture owner",
        role: "BUSINESS_OWNER",
      },
    });
    const membership = await transaction.employeeBusinessMembership.create({
      data: {
        businessId: business.id,
        employeeAccountId: account.id,
        employeeCode: `PAY-V2-${suffix.slice(0, 8)}`,
        fullName: input.employeeName,
        phoneNumber: account.phoneNumber,
        phoneNumberNormalized: account.phoneNormalized,
        attendanceEnabled: false,
        joinedAt: new Date("2025-01-01T00:00:00.000Z"),
      },
    });
    await transaction.employeeBranchAssignment.create({
      data: {
        branchId: branch.id,
        businessId: business.id,
        membershipId: membership.id,
        isPrimary: true,
        canClockIn: false,
        effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
        status: "ACTIVE",
      },
    });
    await transaction.businessModuleEntitlement.createMany({
      data: input.modules.map((moduleKey) => ({
        businessId: business.id,
        moduleKey,
        status: "ENABLED" as const,
        enabledFrom: new Date("2025-01-01T00:00:00.000Z"),
        source: "MANUAL" as const,
      })),
    });
    const device = await transaction.employeeDevice.create({
      data: {
        employeeAccountId: account.id,
        deviceIdentifierHash: `pay-hub-v2-${suffix}`,
        displayName: "Pay Hub V2 local visual browser",
        platform: "Browser",
        browser: "Headless Chrome",
        canView: true,
        canPunch: false,
      },
    });
    const session = await createEmployeeSessionRecord({
      employeeAccountId: account.id,
      membershipId: membership.id,
      businessId: business.id,
      primaryBranchId: branch.id,
      attendanceBranchId: branch.id,
      deviceId: device.id,
      now: new Date(),
      userAgent: "Tetamu Staff Pay Hub V2 local visual UAT",
    }, transaction);

    let publicationId: string | null = null;
    if (input.publishedPay) {
      publicationId = await createPublication({
        businessId: business.id,
        employeeCode: membership.employeeCode,
        fullName: membership.fullName,
        gross: input.publishedPay.gross,
        membershipId: membership.id,
        net: input.publishedPay.net,
        ownerId: owner.id,
      }, transaction);
    }

    return {
      businessId: business.id,
      businessName: business.name,
      membershipId: membership.id,
      publicationId,
      sessionToken: session.token,
    };
  }, { isolationLevel: "Serializable", timeout: 15_000 });
}

async function createAccountInTransaction(name: string, transaction: Prisma.TransactionClient) {
  const phone = `+601${randomInt(10_000_000, 99_999_999)}`;
  return transaction.employeeAccount.create({
    data: { name, phoneNumber: phone, phoneNormalized: phone },
  });
}

async function createPublication(input: {
  businessId: string;
  employeeCode: string;
  fullName: string;
  gross: string;
  membershipId: string;
  net: string;
  ownerId: string;
}, transaction: Prisma.TransactionClient) {
  const run = await transaction.payrollRun.create({
    data: {
      attendanceSource: "LEGACY_OPERATIONAL_SESSION",
      breakMinutesPerDaySnapshot: 60,
      businessId: input.businessId,
      createdById: input.ownerId,
      normalWorkMinutesPerDaySnapshot: 480,
      overtimeMultiplierSnapshot: "1.50",
      periodEnd: new Date("2026-08-31T00:00:00.000Z"),
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      publicHolidayExtraMultiplierSnapshot: "2.00",
      workingDaysPerMonthSnapshot: 26,
    },
  });
  const canonicalDeduction = (Number(input.gross) - Number(input.net)).toFixed(2);
  const entry = await transaction.payrollEntry.create({
    data: {
      baseRateSnapshot: input.gross,
      businessId: input.businessId,
      employeeCodeSnapshot: input.employeeCode,
      fullNameSnapshot: input.fullName,
      grossPay: input.gross,
      membershipId: input.membershipId,
      netPay: input.net,
      normalWorkMinutesSnapshot: 480,
      otherDeductions: canonicalDeduction,
      payBasisSnapshot: "MONTHLY",
      payrollRunId: run.id,
      workingDaysSnapshot: 26,
    },
  });
  const components: Prisma.PayrollEntryComponentCreateManyInput[] = [
    {
        amount: input.gross,
        businessId: input.businessId,
        calculationBasis: "LOCAL_VISUAL_FIXTURE",
        code: "BASIC_SALARY",
        createdById: input.ownerId,
        lineKey: "SYSTEM:BASIC_SALARY",
        membershipId: input.membershipId,
        name: "Basic salary",
        origin: "SYSTEM",
        payrollEntryId: entry.id,
        payrollRunId: run.id,
        sortOrder: 100,
        sourceType: "PAYROLL_CALCULATION",
        type: "EARNING",
    },
  ];
  if (Number(canonicalDeduction) > 0) {
    components.push({
            adjustmentCategory: "OTHER",
            amount: canonicalDeduction,
            businessId: input.businessId,
            calculationBasis: "LOCAL_VISUAL_FIXTURE",
            code: "FIXTURE_DEDUCTION",
            createdById: input.ownerId,
            lineKey: "MANUAL:FIXTURE_DEDUCTION",
            membershipId: input.membershipId,
            name: "Fixture deduction",
            origin: "MANUAL",
            payrollEntryId: entry.id,
            payrollRunId: run.id,
            reason: "Local Pay Hub V2 visual fixture",
            sortOrder: 900,
            sourceType: "MANUAL_ADJUSTMENT",
            type: "DEDUCTION",
    });
  }
  await transaction.payrollEntryComponent.createMany({ data: components });
  await transaction.payrollRun.update({
    where: { id: run.id },
    data: {
      finalizedAt: new Date("2026-09-01T00:00:00.000Z"),
      finalizedById: input.ownerId,
      status: "FINALIZED",
      submittedAt: new Date("2026-08-31T00:00:00.000Z"),
      submittedById: input.ownerId,
    },
  });
  const bytes = Buffer.from("%PDF-1.4\n% Pay Hub V2 local visual fixture\n%%EOF\n");
  const publication = await transaction.payrollPayslipPublication.create({
    data: {
      businessId: input.businessId,
      documentBytes: bytes,
      documentSha256: createHash("sha256").update(bytes).digest("hex"),
      membershipId: input.membershipId,
      payrollEntryId: entry.id,
      payrollRunId: run.id,
      publishedById: input.ownerId,
    },
  });
  return publication.id;
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
