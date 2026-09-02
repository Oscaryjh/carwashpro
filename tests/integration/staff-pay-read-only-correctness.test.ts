import assert from "node:assert/strict";
import { createHash, randomInt, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { PrismaClient } from "@prisma/client";
import { getEmployeeCommissionStatements } from "../../src/lib/commission/read";
import { getEmployeeAuthConfig } from "../../src/lib/attendance/employee-auth/config";
import {
  authenticateEmployeeSessionToken,
  getEmployeeAuthContext,
  getEmployeeSelfServiceAuthContext,
} from "../../src/lib/attendance/employee-auth/session";
import {
  hashEmployeeIdentifier,
  hashEmployeeSessionToken,
} from "../../src/lib/attendance/employee-auth/crypto";
import { loadPublishedPayslipsForEmployee } from "../../src/lib/payroll/payslip-publication";

const prisma = new PrismaClient();
const employeeAuthSecret = "staff-pay-read-only-correctness-secret-2026";
const previousEmployeeAuthSecret = process.env.EMPLOYEE_AUTH_SECRET;
process.env.EMPLOYEE_AUTH_SECRET = employeeAuthSecret;

after(async () => {
  if (previousEmployeeAuthSecret === undefined) delete process.env.EMPLOYEE_AUTH_SECRET;
  else process.env.EMPLOYEE_AUTH_SECRET = previousEmployeeAuthSecret;
  await prisma.$disconnect();
});

test("employee Commission reader returns only each period's current revision within business and membership scope", async () => {
  assertLocalDatabase();
  const token = randomUUID();
  const business = await prisma.business.create({
    data: { name: `Staff pay commission ${token}`, slug: `staff-pay-commission-${token}` },
  });
  const otherBusiness = await prisma.business.create({
    data: { name: `Other staff pay ${token}`, slug: `other-staff-pay-${token}` },
  });
  const membership = await createMembership(business.id, `COM-${token.slice(0, 8)}`);
  const otherMembership = await createMembership(business.id, `COM-OTHER-${token.slice(0, 8)}`);
  const foreignMembership = await createMembership(otherBusiness.id, `COM-FOREIGN-${token.slice(0, 8)}`);

  const firstPeriod = await prisma.commissionPeriod.create({
    data: {
      businessId: business.id,
      scopeKey: "ALL",
      earnedPeriodStart: new Date("2026-06-01T00:00:00.000Z"),
      earnedPeriodEnd: new Date("2026-06-30T00:00:00.000Z"),
      currentRevision: 1,
    },
  });
  const stale = await createStatement(firstPeriod.id, business.id, membership.id, 1, 1_000);
  await createStatement(firstPeriod.id, business.id, otherMembership.id, 1, 9_000);
  await prisma.commissionPeriod.update({
    where: { id: firstPeriod.id },
    data: { currentRevision: 2 },
  });
  const current = await createStatement(firstPeriod.id, business.id, membership.id, 2, 1_250);
  await createStatement(firstPeriod.id, business.id, otherMembership.id, 2, 9_250);

  const secondPeriod = await prisma.commissionPeriod.create({
    data: {
      businessId: business.id,
      scopeKey: "ALL",
      earnedPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
      earnedPeriodEnd: new Date("2026-07-31T00:00:00.000Z"),
      currentRevision: 1,
    },
  });
  const secondCurrent = await createStatement(secondPeriod.id, business.id, membership.id, 1, 2_000);

  const foreignPeriod = await prisma.commissionPeriod.create({
    data: {
      businessId: otherBusiness.id,
      scopeKey: "ALL",
      earnedPeriodStart: new Date("2026-06-01T00:00:00.000Z"),
      earnedPeriodEnd: new Date("2026-06-30T00:00:00.000Z"),
      currentRevision: 1,
    },
  });
  await createStatement(foreignPeriod.id, otherBusiness.id, foreignMembership.id, 1, 99_000);

  const statements = await getEmployeeCommissionStatements({
    businessId: business.id,
    membershipId: membership.id,
  }, prisma);
  assert.deepEqual(new Set(statements.map((statement) => statement.id)), new Set([current.id, secondCurrent.id]));
  assert.equal(statements.some((statement) => statement.id === stale.id), false);
  assert.equal(statements.every((statement) => statement.businessId === business.id), true);
  assert.equal(statements.every((statement) => statement.membershipId === membership.id), true);
  assert.equal(statements.every((statement) => statement.calculationRevision === statement.period.currentRevision), true);
});

test("published payslip download uses self-service auth without Attendance and remains own-only", async () => {
  assertLocalDatabase();
  const token = randomUUID();
  const first = await createPayWorkplace(token, "first");
  const firstPublication = await createPublication(first, "PAY-A");
  const config = getEmployeeAuthConfig({
    ...process.env,
    NODE_ENV: "test",
    EMPLOYEE_AUTH_SECRET: employeeAuthSecret,
  });

  assert.equal(first.membership.attendanceEnabled, false);
  const attendanceGuardSession = await createSession(first, `attendance-guard-${token}`);
  assert.equal(await getEmployeeAuthContext(request(cookie(attendanceGuardSession.token)), { database: prisma, config }), null);
  assert.ok((await prisma.employeeSession.findUniqueOrThrow({ where: { id: attendanceGuardSession.id } })).revokedAt);

  const ownSession = await createSession(first, `own-${token}`);
  const ownCookie = cookie(ownSession.token);
  const ownRequest = request(ownCookie);
  const directlyAuthenticated = await authenticateEmployeeSessionToken(ownSession.token, {
    database: prisma,
    config,
    requireAttendance: false,
  });
  assert.equal(directlyAuthenticated.membershipId, first.membership.id);
  const selfService = await getEmployeeSelfServiceAuthContext(ownRequest, { database: prisma, config });
  assert.equal(selfService?.membershipId, first.membership.id);
  const list = await loadPublishedPayslipsForEmployee({
    businessId: selfService!.businessId,
    membershipId: selfService!.membershipId,
  }, prisma);
  assert.equal(list.some((publication) => publication.id === firstPublication.id), true);

  const { GET } = await import("../../src/app/staff/payslips/[publicationId]/route");
  const own = await GET(ownRequest, params(firstPublication.id));
  assert.equal(own.status, 200);
  assert.equal(own.headers.get("content-type"), "application/pdf");
  assert.equal(own.headers.get("cache-control"), "private, no-store");
  assert.match(own.headers.get("content-disposition") ?? "", /^attachment; filename="PAY-A-/);
  assert.equal(Buffer.from(await own.arrayBuffer()).subarray(0, 4).toString("ascii"), "%PDF");

  assert.equal((await GET(request(), params(firstPublication.id))).status, 404);
  assert.equal((await GET(ownRequest, params(randomUUID()))).status, 404);
  assert.equal((await GET(ownRequest, params("not-a-uuid"))).status, 404);

  const otherEmployee = await createMembership(first.business.id, `OTHER-${token.slice(0, 8)}`);
  await prisma.employeeBranchAssignment.create({
    data: assignment(first.business.id, first.branch.id, otherEmployee.id),
  });
  const otherAccount = await prisma.employeeBusinessMembership.findUniqueOrThrow({
    where: { id: otherEmployee.id },
    select: { employeeAccountId: true },
  });
  const otherSession = await createSession({
    ...first,
    account: { id: otherAccount.employeeAccountId },
    membership: otherEmployee,
  }, `other-${token}`);
  assert.equal((await GET(request(cookie(otherSession.token)), params(firstPublication.id))).status, 404);

  const second = await createPayWorkplace(token, "second", first.account.id);
  const secondPublication = await createPublication(second, "PAY-B");
  const switchedSession = await createSession(second, `switched-${token}`);
  assert.equal((await GET(request(cookie(switchedSession.token)), params(firstPublication.id))).status, 404);
  assert.equal((await GET(ownRequest, params(secondPublication.id))).status, 404);

  await prisma.employeeSession.update({
    where: { id: ownSession.id },
    data: { revokedAt: new Date(), revokeReason: "Test workplace switch" },
  });
  assert.equal((await GET(ownRequest, params(firstPublication.id))).status, 404);

  const activeAgain = await createSession(first, `active-again-${token}`);
  await prisma.businessModuleEntitlement.update({
    where: { businessId_moduleKey: { businessId: first.business.id, moduleKey: "PAYROLL" } },
    data: { status: "DISABLED", revision: { increment: 1 } },
  });
  assert.equal((await GET(request(cookie(activeAgain.token)), params(firstPublication.id))).status, 403);
});

async function createStatement(
  periodId: string,
  businessId: string,
  membershipId: string,
  calculationRevision: number,
  finalCommissionCents: number,
) {
  return prisma.commissionStatement.create({
    data: {
      businessId,
      periodId,
      membershipId,
      calculationRevision,
      status: "CALCULATED",
      eligibleSalesCents: finalCommissionCents * 10,
      calculatedCommissionCents: finalCommissionCents,
      finalCommissionCents,
      calculationDigest: digest(`${periodId}:${membershipId}:${calculationRevision}`),
    },
  });
}

async function createPayWorkplace(token: string, suffix: string, employeeAccountId?: string) {
  const business = await prisma.business.create({
    data: { name: `Staff pay ${suffix} ${token}`, slug: `staff-pay-${suffix}-${token}` },
  });
  const branch = await prisma.branch.create({ data: { businessId: business.id, name: "Main" } });
  const owner = await prisma.user.create({
    data: { businessId: business.id, branchId: branch.id, name: "Pay owner", role: "BUSINESS_OWNER" },
  });
  const normalizedPhone = phone();
  const account = employeeAccountId
    ? await prisma.employeeAccount.findUniqueOrThrow({ where: { id: employeeAccountId } })
    : await prisma.employeeAccount.create({
        data: {
          name: "Pay employee",
          phoneNumber: normalizedPhone,
          phoneNormalized: normalizedPhone,
        },
      });
  const membership = await prisma.employeeBusinessMembership.create({
    data: {
      businessId: business.id,
      employeeAccountId: account.id,
      employeeCode: `PAY-${suffix}-${token.slice(0, 6)}`,
      fullName: suffix === "first" ? "Manager as employee" : "Multi-employer employee",
      phoneNumber: account.phoneNumber,
      phoneNumberNormalized: account.phoneNormalized,
      attendanceEnabled: false,
      joinedAt: new Date("2025-01-01T00:00:00.000Z"),
    },
  });
  await prisma.employeeBranchAssignment.create({
    data: assignment(business.id, branch.id, membership.id),
  });
  for (const moduleKey of ["HR", "PAYROLL"] as const) {
    await prisma.businessModuleEntitlement.create({
      data: {
        businessId: business.id,
        moduleKey,
        status: "ENABLED",
        enabledFrom: new Date("2025-01-01T00:00:00.000Z"),
        source: "MANUAL",
      },
    });
  }
  return { account, branch, business, membership, owner };
}

async function createPublication(
  fixture: Awaited<ReturnType<typeof createPayWorkplace>>,
  employeeCode: string,
) {
  const run = await prisma.payrollRun.create({
    data: {
      businessId: fixture.business.id,
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-31T00:00:00.000Z"),
      status: "DRAFT",
      attendanceSource: "LEGACY_OPERATIONAL_SESSION",
      workingDaysPerMonthSnapshot: 26,
      normalWorkMinutesPerDaySnapshot: 480,
      breakMinutesPerDaySnapshot: 60,
      overtimeMultiplierSnapshot: "1.50",
      publicHolidayExtraMultiplierSnapshot: "2.00",
      createdById: fixture.owner.id,
    },
  });
  const entry = await prisma.payrollEntry.create({
    data: {
      payrollRunId: run.id,
      businessId: fixture.business.id,
      membershipId: fixture.membership.id,
      employeeCodeSnapshot: employeeCode,
      fullNameSnapshot: fixture.membership.fullName,
      payBasisSnapshot: "MONTHLY",
      baseRateSnapshot: "3000.00",
      workingDaysSnapshot: 26,
      normalWorkMinutesSnapshot: 480,
      grossPay: "0.00",
      netPay: "0.00",
    },
  });
  await prisma.payrollRun.update({
    where: { id: run.id },
    data: {
      status: "FINALIZED",
      submittedAt: new Date("2026-08-31T00:00:00.000Z"),
      submittedById: fixture.owner.id,
      finalizedAt: new Date("2026-09-01T00:00:00.000Z"),
      finalizedById: fixture.owner.id,
    },
  });
  const documentBytes = Buffer.from("%PDF-1.4\n%%EOF\n");
  return prisma.payrollPayslipPublication.create({
    data: {
      businessId: fixture.business.id,
      payrollRunId: run.id,
      payrollEntryId: entry.id,
      membershipId: fixture.membership.id,
      documentBytes,
      documentSha256: createHash("sha256").update(documentBytes).digest("hex"),
      publishedById: fixture.owner.id,
    },
  });
}

async function createSession(
  fixture: {
    account: { id: string };
    branch: { id: string };
    business: { id: string };
    membership: { id: string };
  },
  token: string,
) {
  const now = new Date();
  const device = await prisma.employeeDevice.create({
    data: {
      employeeAccountId: fixture.account.id,
      deviceIdentifierHash: hashEmployeeIdentifier("device", token, employeeAuthSecret),
      status: "ACTIVE",
      canView: true,
      canPunch: false,
      firstVerifiedAt: now,
      lastActiveAt: now,
    },
  });
  const session = await prisma.employeeSession.create({
    data: {
      employeeAccountId: fixture.account.id,
      membershipId: fixture.membership.id,
      businessId: fixture.business.id,
      primaryBranchId: fixture.branch.id,
      employeeDeviceId: device.id,
      refreshTokenHash: hashEmployeeSessionToken(token, employeeAuthSecret),
      expiresAt: new Date(now.getTime() + 60 * 60_000),
      lastActiveAt: now,
      createdAt: now,
    },
  });
  return { id: session.id, token };
}

async function createMembership(businessId: string, employeeCode: string) {
  const normalizedPhone = phone();
  const account = await prisma.employeeAccount.create({
    data: { name: employeeCode, phoneNumber: normalizedPhone, phoneNormalized: normalizedPhone },
  });
  return prisma.employeeBusinessMembership.create({
    data: {
      businessId,
      employeeAccountId: account.id,
      employeeCode,
      fullName: employeeCode,
      phoneNumber: normalizedPhone,
      phoneNumberNormalized: normalizedPhone,
      joinedAt: new Date("2025-01-01T00:00:00.000Z"),
    },
  });
}

function assignment(businessId: string, branchId: string, membershipId: string) {
  return {
    businessId,
    branchId,
    membershipId,
    isPrimary: true,
    canClockIn: false,
    effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
    status: "ACTIVE" as const,
  };
}

function request(cookieHeader?: string) {
  return new Request("http://localhost/staff/payslips/document", {
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  });
}

function cookie(token: string) {
  return `tetamu_employee_session=${token}`;
}

function params(publicationId: string) {
  return { params: Promise.resolve({ publicationId }) };
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function phone() {
  return `+601${randomInt(10_000_000, 99_999_999)}`;
}

function assertLocalDatabase() {
  const hostname = new URL(process.env.DATABASE_URL ?? "").hostname;
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(hostname), "Integration test requires local PostgreSQL.");
}
