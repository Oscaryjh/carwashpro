import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL ?? "";
const databaseHost = databaseUrl ? new URL(databaseUrl).hostname.toLowerCase() : "";
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(databaseHost)) {
  throw new Error("Payslips V2 visual fixtures are restricted to a Local database.");
}

const root = process.cwd();
const sourcePath = join(root, ".tmp", "staff-pay-hub-v2-visual-fixtures.json");
const artifactPath = join(root, ".tmp", "staff-payslips-v2-visual-fixtures.json");
const prisma = new PrismaClient();

async function main() {
  const preparation = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/prepare-staff-pay-hub-v2-visual-fixtures.ts"],
    { cwd: root, env: process.env, encoding: "utf8" },
  );
  if (preparation.status !== 0) {
    throw new Error(preparation.stderr || preparation.stdout || "Pay Hub fixture preparation failed.");
  }

  const base = JSON.parse(await readFile(sourcePath, "utf8"));
  const normal = await prisma.employeeBusinessMembership.findUniqueOrThrow({
    where: { id: base.normal.membershipId },
    select: { businessId: true, employeeCode: true, fullName: true, id: true },
  });
  const owner = await prisma.user.findFirstOrThrow({
    where: { businessId: normal.businessId, role: "BUSINESS_OWNER" },
    select: { id: true },
  });

  await createPublication({
    businessId: normal.businessId,
    employeeCode: normal.employeeCode,
    fullName: normal.fullName,
    gross: "3650.00",
    membershipId: normal.id,
    net: "3180.20",
    ownerId: owner.id,
    periodEnd: new Date("2026-07-31T00:00:00.000Z"),
    periodStart: new Date("2026-07-01T00:00:00.000Z"),
    publishedAt: new Date("2026-08-02T04:00:00.000Z"),
  });
  await createPublication({
    businessId: normal.businessId,
    employeeCode: normal.employeeCode,
    fullName: normal.fullName,
    gross: "3700.00",
    membershipId: normal.id,
    net: "3220.00",
    ownerId: owner.id,
    periodEnd: new Date("2026-06-30T00:00:00.000Z"),
    periodStart: new Date("2026-06-01T00:00:00.000Z"),
    publishedAt: new Date("2026-07-02T04:00:00.000Z"),
  });

  const fixture = {
    environment: "LOCAL ONLY",
    productionAccessed: false,
    productionModified: false,
    noPayslips: base.noPublication,
    onePublication: base.payrollOnly,
    multipleMonths: base.normal,
    largeNet: base.longLarge,
    longEmployer: base.longLarge,
    managerAsEmployee: base.longLarge,
    payrollDisabled: base.commissionOnly,
    multiEmployerA: base.normal,
    multiEmployerB: base.noPublication,
    foreignPublication: {
      sessionToken: base.normal.sessionToken,
      publicationId: base.longLarge.publicationId,
    },
    payrollWithoutAttendance: base.payrollOnly,
  };
  await writeFile(artifactPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  process.stdout.write(JSON.stringify({
    artifactPath,
    environment: fixture.environment,
    states: Object.keys(fixture).filter((key) => !key.startsWith("production") && key !== "environment"),
  }, null, 2));
}

async function createPublication(input: {
  businessId: string;
  employeeCode: string;
  fullName: string;
  gross: string;
  membershipId: string;
  net: string;
  ownerId: string;
  periodEnd: Date;
  periodStart: Date;
  publishedAt: Date;
}) {
  return prisma.$transaction(async (transaction) => {
    const run = await transaction.payrollRun.create({
      data: {
        attendanceSource: "LEGACY_OPERATIONAL_SESSION",
        breakMinutesPerDaySnapshot: 60,
        businessId: input.businessId,
        createdById: input.ownerId,
        normalWorkMinutesPerDaySnapshot: 480,
        overtimeMultiplierSnapshot: "1.50",
        periodEnd: input.periodEnd,
        periodStart: input.periodStart,
        publicHolidayExtraMultiplierSnapshot: "2.00",
        workingDaysPerMonthSnapshot: 26,
      },
    });
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
        otherDeductions: (Number(input.gross) - Number(input.net)).toFixed(2),
        payBasisSnapshot: "MONTHLY",
        payrollRunId: run.id,
        workingDaysSnapshot: 26,
      },
    });
    const deduction = (Number(input.gross) - Number(input.net)).toFixed(2);
    const components: Prisma.PayrollEntryComponentCreateManyInput[] = [{
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
    }];
    if (Number(deduction) > 0) {
      components.push({
        adjustmentCategory: "OTHER",
        amount: deduction,
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
        reason: "Local Payslips V2 visual fixture",
        sortOrder: 900,
        sourceType: "MANUAL_ADJUSTMENT",
        type: "DEDUCTION",
      });
    }
    await transaction.payrollEntryComponent.createMany({ data: components });
    const bytes = Buffer.from(`%PDF-1.4\n% Payslips V2 ${input.periodStart.toISOString()} local fixture\n%%EOF\n`);
    await transaction.payrollRun.update({
      where: { id: run.id },
      data: {
        finalizedAt: input.publishedAt,
        finalizedById: input.ownerId,
        status: "FINALIZED",
        submittedAt: input.publishedAt,
        submittedById: input.ownerId,
      },
    });
    return transaction.payrollPayslipPublication.create({
      data: {
        businessId: input.businessId,
        documentBytes: bytes,
        documentSha256: createHash("sha256").update(bytes).digest("hex"),
        membershipId: input.membershipId,
        payrollEntryId: entry.id,
        payrollRunId: run.id,
        publishedAt: input.publishedAt,
        publishedById: input.ownerId,
      },
    });
  }, { isolationLevel: "Serializable", timeout: 15_000 });
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
