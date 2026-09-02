import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CORE_ARTIFACT = join(process.cwd(), ".tmp", "hr-payroll-core-acceptance.json");

type CoreArtifact = {
  environment: string;
  productionAccessed: boolean;
  businessId: string;
  branchId: string;
  employeeMemberships: Record<string, { membershipId: string }>;
};

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function assertLocalOnly() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("STAFF_3000_ATTENDANCE_CORRECTION_UAT_FORBIDDEN_IN_PRODUCTION");
  }
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required.");
  const hostname = new URL(value).hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname)) {
    throw new Error("STAFF_3000_ATTENDANCE_CORRECTION_UAT_REQUIRES_A_LOCAL_DATABASE");
  }
}

async function main() {
  assertLocalOnly();
  const artifact = JSON.parse(await readFile(CORE_ARTIFACT, "utf8")) as CoreArtifact;
  if (artifact.environment !== "LOCAL / TESTING ONLY" || artifact.productionAccessed !== false) {
    throw new Error("STAFF_3000_ATTENDANCE_CORRECTION_UAT_REQUIRES_LOCAL_CORE_ARTIFACT");
  }

  const membershipId = artifact.employeeMemberships["CORE-B"]?.membershipId;
  if (!membershipId) throw new Error("CORE_B_MEMBERSHIP_IS_MISSING");

  const requestKey = `staff3000:attendance-correction-uat:${artifact.businessId}:missing-clock-out`;
  const result = await prisma.$transaction(async (tx) => {
    const employeeSession = await tx.employeeSession.findFirst({
      where: { businessId: artifact.businessId, membershipId, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!employeeSession) throw new Error("ACTIVE_EMPLOYEE_SESSION_IS_REQUIRED");

    const exception = await tx.attendanceP2Exception.upsert({
      where: { stableKey: `staff3000:attendance-correction-uat:${artifact.businessId}:exception` },
      update: {},
      create: {
        businessId: artifact.businessId,
        branchId: artifact.branchId,
        membershipId,
        workDate: new Date("2026-08-27T00:00:00.000Z"),
        type: "MISSING_CLOCK_OUT",
        stableKey: `staff3000:attendance-correction-uat:${artifact.businessId}:exception`,
        actualClockInAt: new Date("2026-08-27T01:00:00.000Z"),
        reasonCode: "MISSING_CLOCK_OUT",
        sourceDigest: digest("staff-3000-attendance-correction-uat"),
      },
      select: { id: true },
    });

    const existingManagerQueueException = await tx.attendanceException.findFirst({
      where: {
        businessId: artifact.businessId,
        branchId: artifact.branchId,
        employeeId: membershipId,
        status: "PENDING",
        reason: "Staff 3000 authenticated manager attendance correction UAT.",
      },
      select: { id: true },
    });
    const managerQueueException = existingManagerQueueException
      ? await tx.attendanceException.update({
        where: { id: existingManagerQueueException.id },
        data: {
          type: "FORGOT_CLOCK_IN",
          requestedClockInAt: new Date("2026-08-27T01:00:00.000Z"),
          requestedClockOutAt: new Date("2026-08-27T10:00:00.000Z"),
        },
        select: { id: true },
      })
      : await tx.attendanceException.create({
      data: {
        businessId: artifact.businessId,
        branchId: artifact.branchId,
        employeeId: membershipId,
        type: "FORGOT_CLOCK_IN",
        reason: "Staff 3000 authenticated manager attendance correction UAT.",
        requestedClockInAt: new Date("2026-08-27T01:00:00.000Z"),
        requestedClockOutAt: new Date("2026-08-27T10:00:00.000Z"),
      },
      select: { id: true },
    });

    const existing = await tx.attendanceCorrectionRequest.findUnique({
      where: { requestKey },
      select: { id: true, status: true },
    });
    if (existing) return { ...existing, managerQueueExceptionId: managerQueueException.id, created: false };

    const request = await tx.attendanceCorrectionRequest.create({
      data: {
        businessId: artifact.businessId,
        exceptionId: exception.id,
        membershipId,
        employeeSessionId: employeeSession.id,
        requestKey,
        requestedClockOutAt: new Date("2026-08-27T10:00:00.000Z"),
        reason: "Staff 3000 authenticated manager attendance correction UAT.",
      },
      select: { id: true, status: true },
    });
    return { ...request, managerQueueExceptionId: managerQueueException.id, created: true };
  });

  console.log(JSON.stringify({
    environment: "LOCAL / TESTING ONLY",
    productionAccessed: false,
    businessId: artifact.businessId,
    membershipId,
    ...result,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "UNKNOWN_ATTENDANCE_CORRECTION_UAT_ERROR");
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
