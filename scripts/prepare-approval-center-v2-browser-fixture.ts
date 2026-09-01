import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { submitAttendanceCorrectionRequest } from "@/lib/attendance/p2-service";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/car_wash_crm_pos?schema=public";
const host = new URL(databaseUrl).hostname.toLowerCase();
if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) {
  throw new Error("Approval Center V2 browser fixtures are restricted to the Local database.");
}
process.env.DATABASE_URL = databaseUrl;

const businessId = required("QA_BUSINESS_ID");
const branchId = required("QA_BRANCH_ID");
const ownerId = required("QA_OWNER_ID");
const membershipId = required("QA_EMPLOYEE_MEMBERSHIP_ID");
const prisma = new PrismaClient();
const token = randomUUID();

async function main() {
  const membership = await prisma.employeeBusinessMembership.findFirstOrThrow({
    where: { id: membershipId, businessId, status: "ACTIVE" },
    select: { employeeAccountId: true },
  });
  const device = await prisma.employeeDevice.create({
    data: {
      employeeAccountId: membership.employeeAccountId,
      deviceIdentifierHash: `approval-v2-${token}`,
      displayName: "Approval Center V2 browser fixture",
      status: "ACTIVE",
      canView: true,
      canPunch: true,
    },
  });
  const employeeSession = await prisma.employeeSession.create({
    data: {
      employeeAccountId: membership.employeeAccountId,
      membershipId,
      businessId,
      primaryBranchId: branchId,
      attendanceBranchId: branchId,
      employeeDeviceId: device.id,
      refreshTokenHash: `approval-v2-${randomUUID()}`,
      expiresAt: new Date("2027-12-31T00:00:00.000Z"),
    },
  });

  const attendanceException = await prisma.attendanceP2Exception.create({
    data: {
      businessId,
      branchId,
      membershipId,
      workDate: new Date("2026-09-01T00:00:00.000Z"),
      type: "MISSING_CLOCK_OUT",
      stableKey: `approval-v2:${token}:missing-clock-out`,
      actualClockInAt: new Date("2026-09-01T01:00:00.000Z"),
      reasonCode: "MISSING_CLOCK_OUT",
      sourceDigest: "7".repeat(64),
    },
  });
  const correction = await submitAttendanceCorrectionRequest({
    auth: {
      sessionId: employeeSession.id,
      employeeAccountId: membership.employeeAccountId,
      membershipId,
      businessId,
      primaryBranchId: branchId,
      attendanceBranchId: branchId,
      deviceId: device.id,
    },
    exceptionId: attendanceException.id,
    requestedClockOutAt: new Date("2026-09-01T10:15:00.000Z"),
    reason: "Forgot to clock out after completing the shift.",
    requestKey: `approval-v2-${token}`,
    database: prisma,
  });

  const expectedDay = await prisma.attendanceExpectedDay.create({
    data: {
      businessId,
      branchId,
      membershipId,
      workDate: new Date("2026-09-01T00:00:00.000Z"),
      kind: "WORKDAY",
      source: "MANUAL_EVIDENCE",
      expectedStartAt: new Date("2026-09-01T01:00:00.000Z"),
      expectedEndAt: new Date("2026-09-01T09:00:00.000Z"),
      timezoneSnapshot: "Asia/Kuala_Lumpur",
      evidenceReference: "LOCAL_APPROVAL_CENTER_V2",
      createdById: ownerId,
    },
  });
  const finalResult = await prisma.attendanceP2FinalResult.create({
    data: {
      businessId,
      branchId,
      membershipId,
      workDate: expectedDay.workDate,
      version: 1,
      outcome: "PRESENT",
      expectedDayKindSnapshot: "WORKDAY",
      expectedDayId: expectedDay.id,
      expectedStartAt: expectedDay.expectedStartAt,
      expectedEndAt: expectedDay.expectedEndAt,
      actualClockInAt: expectedDay.expectedStartAt,
      actualClockOutAt: new Date("2026-09-01T10:30:00.000Z"),
      totalBreakMinutes: 30,
      totalWorkedMinutes: 540,
      sourceDigest: "8".repeat(64),
      resolutionDigest: "9".repeat(64),
      createdById: ownerId,
    },
  });

  process.stdout.write(JSON.stringify({
    environment: "LOCAL ONLY",
    attendanceCorrectionId: correction.id,
    attendanceExceptionId: attendanceException.id,
    overtimeFinalResultId: finalResult.id,
  }, null, 2));
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
