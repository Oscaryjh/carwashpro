import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BUSINESS_ID = "611b0c19-ebf7-4548-8a48-a3b6a7af8a81";
const BRANCH_ID = "41575966-238f-46ab-a114-22bbee4949c5";
const MEMBERSHIP_ID = "8a32ee4a-bdef-451e-8a0d-09fc082190dc";
const ACCOUNT_ID = "d7f69dcc-fb85-41a7-a989-59c2f21ac984";
const ATTENDANCE_ID = "00b42416-8cf8-47fe-85b8-b73043174e05";
const WORK_DATE = new Date("2026-08-24T00:00:00.000Z");

function assertTestingReadOnlyBoundary() {
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== "testing") {
    throw new Error("ATTENDANCE_CORRECTION_AUDIT_REQUIRES_TESTING");
  }
  if (process.env.TETAMU_TESTING_DATABASE_AUDIT !== "true") {
    throw new Error("ATTENDANCE_CORRECTION_AUDIT_REQUIRES_READ_ONLY_ACK");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_IS_REQUIRED");
  const host = new URL(databaseUrl).hostname.toLowerCase();
  if (host !== "postgres-singapore.railway.internal" && !host.endsWith(".proxy.rlwy.net")) {
    throw new Error("ATTENDANCE_CORRECTION_AUDIT_DATABASE_IS_NOT_TESTING_RAILWAY");
  }
}

async function main() {
  assertTestingReadOnlyBoundary();
  const nextDate = new Date("2026-08-25T00:00:00.000Z");
  const [membership, attendance, expectedDays, p2Exceptions, legacyExceptions,
    resolutionCases, p2FinalResults, timesheet, sessions] = await Promise.all([
    prisma.employeeBusinessMembership.findFirst({
      where: { id: MEMBERSHIP_ID, employeeAccountId: ACCOUNT_ID, businessId: BUSINESS_ID },
      select: {
        id: true,
        status: true,
        attendanceEnabled: true,
        fullName: true,
        business: { select: { id: true, name: true } },
        branchAssignments: {
          where: { branchId: BRANCH_ID },
          select: { branchId: true, status: true, canClockIn: true, branch: { select: { name: true } } },
        },
      },
    }),
    prisma.employeeAttendance.findFirst({
      where: {
        id: ATTENDANCE_ID,
        employeeAccountId: ACCOUNT_ID,
        membershipId: MEMBERSHIP_ID,
        businessId: BUSINESS_ID,
        branchId: BRANCH_ID,
        workDate: WORK_DATE,
      },
      include: {
        punches: true,
        exceptions: true,
        adjustments: true,
        resolutionCase: { include: { events: true, finalResults: true } },
        finalResults: true,
        timesheetEntries: true,
      },
    }),
    prisma.attendanceExpectedDay.findMany({
      where: { businessId: BUSINESS_ID, branchId: BRANCH_ID, membershipId: MEMBERSHIP_ID, workDate: WORK_DATE },
      orderBy: { revision: "desc" },
    }),
    prisma.attendanceP2Exception.findMany({
      where: { businessId: BUSINESS_ID, branchId: BRANCH_ID, membershipId: MEMBERSHIP_ID, workDate: WORK_DATE },
      orderBy: { detectedAt: "desc" },
    }),
    prisma.attendanceException.findMany({
      where: { businessId: BUSINESS_ID, branchId: BRANCH_ID, employeeId: MEMBERSHIP_ID, attendanceSessionId: ATTENDANCE_ID },
      orderBy: { createdAt: "desc" },
    }),
    prisma.attendanceResolutionCase.findMany({
      where: { businessId: BUSINESS_ID, branchId: BRANCH_ID, employeeId: MEMBERSHIP_ID, attendanceSessionId: ATTENDANCE_ID },
      include: { events: true, finalResults: true },
    }),
    prisma.attendanceP2FinalResult.findMany({
      where: { businessId: BUSINESS_ID, branchId: BRANCH_ID, membershipId: MEMBERSHIP_ID, workDate: WORK_DATE },
      orderBy: { version: "desc" },
    }),
    prisma.attendanceMonthlyTimesheet.findUnique({
      where: { businessId_periodStart: { businessId: BUSINESS_ID, periodStart: new Date("2026-08-01T00:00:00.000Z") } },
      include: {
        branchReadiness: { where: { branchId: BRANCH_ID } },
        revisions: {
          include: {
            entries: { where: { employeeId: MEMBERSHIP_ID, workDate: { gte: WORK_DATE, lt: nextDate } } },
            p2DaySnapshots: { where: { membershipId: MEMBERSHIP_ID, workDate: { gte: WORK_DATE, lt: nextDate } } },
          },
        },
      },
    }),
    prisma.employeeSession.findMany({
      where: { employeeAccountId: ACCOUNT_ID, membershipId: MEMBERSHIP_ID, businessId: BUSINESS_ID },
      select: { id: true, revokedAt: true, expiresAt: true, lastActiveAt: true },
    }),
  ]);

  const correctionRequests = await prisma.attendanceCorrectionRequest.findMany({
    where: {
      businessId: BUSINESS_ID,
      membershipId: MEMBERSHIP_ID,
      exceptionId: { in: p2Exceptions.map((item) => item.id) },
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(JSON.stringify({
    environment: "testing",
    productionAccessed: false,
    readOnly: true,
    membership,
    attendance,
    expectedDays,
    p2Exceptions,
    correctionRequests,
    legacyExceptions,
    resolutionCases,
    p2FinalResults,
    timesheet,
    activeEmployeeSessions: sessions.filter((item) => !item.revokedAt && item.expiresAt > new Date()),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "UNKNOWN_ATTENDANCE_CORRECTION_AUDIT_ERROR");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
