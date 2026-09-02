import { PrismaClient } from "@prisma/client";
import { getEmployeeTimesheetOverview } from "@/lib/attendance/employee-timesheet";

const database = new PrismaClient();
const workDate = new Date("2026-08-30T00:00:00.000Z");
const nextDate = new Date("2026-08-31T00:00:00.000Z");
const monthStart = new Date("2026-08-01T00:00:00.000Z");

function assertTestingReadOnlyBoundary() {
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== "testing") {
    throw new Error("TIMESHEET_AUDIT_REQUIRES_RAILWAY_TESTING");
  }
  if (process.env.TETAMU_TESTING_DATABASE_AUDIT !== "true") {
    throw new Error("TIMESHEET_AUDIT_REQUIRES_READ_ONLY_ACK");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_IS_REQUIRED");
  const host = new URL(databaseUrl).hostname.toLowerCase();
  if (host !== "postgres-singapore.railway.internal" && !host.endsWith(".proxy.rlwy.net")) {
    throw new Error("TIMESHEET_AUDIT_DATABASE_IS_NOT_TESTING_RAILWAY");
  }
}

async function main() {
  assertTestingReadOnlyBoundary();

  const account = await database.employeeAccount.findFirst({
    where: {
      OR: [
        { phoneNumber: "01112212259" },
        { phoneNormalized: "01112212259" },
        { phoneNormalized: "601112212259" },
        { phoneNormalized: "+601112212259" },
      ],
    },
    include: {
      memberships: {
        include: {
          business: { select: { id: true, name: true } },
          branchAssignments: {
            include: { branch: { select: { id: true, name: true } } },
          },
        },
      },
    },
  });
  if (!account) throw new Error("TESTING_EMPLOYEE_ACCOUNT_NOT_FOUND");

  const membership = account.memberships.find((candidate) =>
    candidate.business.name === "Royal Salon"
    && candidate.branchAssignments.some((assignment) => assignment.branch.name === "salon online"),
  );
  if (!membership) throw new Error("ROYAL_SALON_MEMBERSHIP_NOT_FOUND");

  const branchAssignment = membership.branchAssignments.find(
    (assignment) => assignment.branch.name === "salon online",
  );
  if (!branchAssignment) throw new Error("SALON_ONLINE_ASSIGNMENT_NOT_FOUND");

  const [attendances, expectedDays, p2Exceptions, p2FinalResults, overtimeReviews, timesheet] = await Promise.all([
    database.employeeAttendance.findMany({
      where: {
        businessId: membership.businessId,
        membershipId: membership.id,
        workDate: { gte: workDate, lt: nextDate },
      },
      orderBy: [{ clockInAt: "asc" }, { createdAt: "asc" }],
      include: {
        punches: { orderBy: { serverTimestamp: "asc" } },
        exceptions: { orderBy: { createdAt: "asc" } },
        adjustments: { orderBy: { createdAt: "asc" } },
        resolutionCase: {
          include: {
            events: { orderBy: { sequence: "asc" } },
            finalResults: { orderBy: { version: "asc" } },
          },
        },
        finalResults: { orderBy: { version: "asc" } },
      },
    }),
    database.attendanceExpectedDay.findMany({
      where: {
        businessId: membership.businessId,
        membershipId: membership.id,
        workDate: { gte: workDate, lt: nextDate },
      },
      orderBy: { revision: "asc" },
    }),
    database.attendanceP2Exception.findMany({
      where: {
        businessId: membership.businessId,
        membershipId: membership.id,
        workDate: { gte: workDate, lt: nextDate },
      },
      orderBy: [{ detectedAt: "asc" }, { id: "asc" }],
    }),
    database.attendanceP2FinalResult.findMany({
      where: {
        businessId: membership.businessId,
        membershipId: membership.id,
        workDate: { gte: workDate, lt: nextDate },
      },
      orderBy: { version: "asc" },
    }),
    database.attendanceOvertimeReview.findMany({
      where: {
        businessId: membership.businessId,
        membershipId: membership.id,
        workDate: { gte: workDate, lt: nextDate },
      },
      include: { events: { orderBy: { createdAt: "asc" } } },
    }),
    database.attendanceMonthlyTimesheet.findUnique({
      where: {
        businessId_periodStart: {
          businessId: membership.businessId,
          periodStart: monthStart,
        },
      },
      include: {
        branchReadiness: { where: { branchId: branchAssignment.branchId } },
        revisions: {
          orderBy: { revision: "asc" },
          include: {
            entries: {
              where: { employeeId: membership.id, workDate: { gte: workDate, lt: nextDate } },
            },
            p2DaySnapshots: {
              where: { membershipId: membership.id, workDate: { gte: workDate, lt: nextDate } },
            },
            p2SegmentSnapshots: {
              where: { membershipId: membership.id, localDate: { gte: workDate, lt: nextDate } },
            },
          },
        },
      },
    }),
  ]);

  const p2Resolutions = p2Exceptions.length
    ? await database.attendanceP2Resolution.findMany({
        where: { exceptionId: { in: p2Exceptions.map((row) => row.id) } },
        orderBy: [{ exceptionId: "asc" }, { revision: "asc" }],
      })
    : [];
  const correctionRequests = p2Exceptions.length
    ? await database.attendanceCorrectionRequest.findMany({
        where: { exceptionId: { in: p2Exceptions.map((row) => row.id) } },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const overview = await getEmployeeTimesheetOverview(
    {
      sessionId: "testing-read-only-audit",
      employeeAccountId: account.id,
      membershipId: membership.id,
      businessId: membership.businessId,
      primaryBranchId: branchAssignment.branchId,
      attendanceBranchId: branchAssignment.branchId,
      deviceId: "testing-read-only-audit",
    },
    { database, now: new Date("2026-08-30T12:00:00.000Z") },
  );

  const result = {
    boundary: {
      environment: process.env.RAILWAY_ENVIRONMENT_NAME,
      databaseHost: new URL(process.env.DATABASE_URL!).hostname,
      readOnly: true,
    },
    account: {
      id: account.id,
      name: account.name,
      phoneNumber: account.phoneNumber,
      phoneNormalized: account.phoneNormalized,
      status: account.status,
    },
    membership: {
      id: membership.id,
      businessId: membership.businessId,
      businessName: membership.business.name,
      fullName: membership.fullName,
      employeeCode: membership.employeeCode,
      status: membership.status,
      attendanceEnabled: membership.attendanceEnabled,
      branchId: branchAssignment.branchId,
      branchName: branchAssignment.branch.name,
      branchAssignmentStatus: branchAssignment.status,
      canClockIn: branchAssignment.canClockIn,
    },
    workDate: "2026-08-30",
    attendances,
    expectedDays,
    p2Exceptions,
    p2Resolutions,
    correctionRequests,
    p2FinalResults,
    overtimeReviews,
    timesheet,
    currentProjection: {
      days: overview.days,
      overtime: overview.overtime,
      lockedOvertime: overview.lockedOvertime,
      timesheetStatus: overview.timesheetStatus,
      sameDatePrimaryCardCount: overview.days.filter(
        (row) => row.workDate.toISOString().slice(0, 10) === "2026-08-30",
      ).length,
    },
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "UNKNOWN_AUDIT_ERROR");
    process.exitCode = 1;
  })
  .finally(async () => {
    await database.$disconnect();
  });
