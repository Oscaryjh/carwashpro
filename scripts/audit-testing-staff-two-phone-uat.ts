import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const OUTPUT_PATH = join(process.cwd(), ".tmp", "testing-staff-two-phone-uat-audit.json");
const EMPLOYEE_PHONE = "+601112212259";
const MANAGER_PHONE = "+60128793848";

function assertTestingReadOnlyBoundary() {
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== "testing") {
    throw new Error("TWO_PHONE_UAT_AUDIT_REQUIRES_RAILWAY_TESTING_ENVIRONMENT");
  }
  if (process.env.RAILWAY_SERVICE_NAME !== "tetamu-pos-web") {
    throw new Error("TWO_PHONE_UAT_AUDIT_REQUIRES_TESTING_WEB_SERVICE_CONTEXT");
  }
  if (process.env.TETAMU_TESTING_DATABASE_AUDIT !== "true") {
    throw new Error("TWO_PHONE_UAT_AUDIT_REQUIRES_EXPLICIT_READ_ONLY_ACKNOWLEDGEMENT");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_IS_REQUIRED");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  const approved = hostname === "postgres-singapore.railway.internal"
    || hostname.endsWith(".proxy.rlwy.net");
  if (!approved) {
    throw new Error("TWO_PHONE_UAT_AUDIT_DATABASE_HOST_IS_NOT_APPROVED_TESTING_RAILWAY");
  }
  return hostname;
}

async function main() {
  const databaseHost = assertTestingReadOnlyBoundary();
  const accounts = await prisma.employeeAccount.findMany({
    where: { phoneNormalized: { in: [EMPLOYEE_PHONE, MANAGER_PHONE] } },
    orderBy: { phoneNormalized: "asc" },
    include: {
      devices: { orderBy: { lastActiveAt: "desc" } },
      sessions: {
        where: { revokedAt: null },
        orderBy: { lastActiveAt: "desc" },
      },
      memberships: {
        include: {
          business: { select: { id: true, name: true, slug: true, industryType: true, status: true } },
          staffUser: {
            select: {
              id: true,
              name: true,
              role: true,
              permissions: true,
              status: true,
              loginEnabled: true,
              branchId: true,
              appointmentBookable: true,
              staffRoleProfile: { select: { id: true, name: true, permissions: true, active: true } },
            },
          },
          branchAssignments: {
            include: { branch: { select: { id: true, name: true, status: true } } },
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          },
          leaveRequests: { orderBy: { createdAt: "desc" }, take: 10 },
          employeeClaims: { orderBy: { createdAt: "desc" }, take: 10 },
          payrollPayslipPublications: { orderBy: { publishedAt: "desc" }, take: 10 },
          commissionStatements: { orderBy: { createdAt: "desc" }, take: 10 },
        },
      },
    },
  });

  const memberships = accounts.flatMap((account) => account.memberships);
  const membershipIds = memberships.map((membership) => membership.id);
  const businessIds = [...new Set(memberships.map((membership) => membership.businessId))];

  const [
    branches,
    rosterAssignments,
    attendances,
    attendanceExceptions,
    pendingAttendanceRequests,
    overtimeReviews,
    leaveEntitlements,
    leaveLedger,
    appointments,
    claimCategories,
    leavePolicies,
    branchCandidates,
  ] = await Promise.all([
    prisma.branch.findMany({
      where: { businessId: { in: businessIds } },
      include: { attendanceSetting: true },
      orderBy: [{ businessId: "asc" }, { name: "asc" }],
    }),
    prisma.rosterAssignment.findMany({
      where: { membershipId: { in: membershipIds } },
      include: {
        rosterPeriod: { select: { id: true, weekStart: true, publicationRevision: true } },
        shiftTemplate: { select: { id: true, name: true, startMinute: true, endMinute: true } },
      },
      orderBy: { workDate: "desc" },
      take: 40,
    }),
    prisma.employeeAttendance.findMany({
      where: { membershipId: { in: membershipIds } },
      orderBy: [{ workDate: "desc" }, { clockInAt: "desc" }],
      take: 40,
    }),
    prisma.attendanceP2Exception.findMany({
      where: { membershipId: { in: membershipIds } },
      orderBy: { detectedAt: "desc" },
      take: 40,
    }),
    prisma.attendanceException.findMany({
      where: { employeeId: { in: membershipIds } },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
    prisma.attendanceOvertimeReview.findMany({
      where: { membershipId: { in: membershipIds } },
      orderBy: [{ workDate: "desc" }, { createdAt: "desc" }],
      take: 40,
    }),
    prisma.employeeLeaveEntitlement.findMany({
      where: { membershipId: { in: membershipIds } },
      orderBy: { leaveYearStart: "desc" },
      take: 40,
    }),
    prisma.leaveBalanceLedgerEntry.findMany({
      where: { membershipId: { in: membershipIds } },
      orderBy: { createdAt: "desc" },
      take: 80,
    }),
    prisma.appointment.findMany({
      where: {
        businessId: { in: businessIds },
        assignedStaffId: { in: memberships.map((membership) => membership.staffUser?.id).filter((id): id is string => Boolean(id)) },
      },
      orderBy: { scheduledAt: "desc" },
      take: 30,
    }),
    prisma.claimCategory.findMany({
      where: { businessId: { in: businessIds }, active: true },
      select: { id: true, businessId: true, code: true, name: true, active: true },
      orderBy: [{ businessId: "asc" }, { code: "asc" }],
    }),
    prisma.leavePolicy.findMany({
      where: { businessId: { in: businessIds }, active: true },
      select: { id: true, businessId: true, code: true, name: true, active: true },
      orderBy: [{ businessId: "asc" }, { code: "asc" }],
    }),
    prisma.employeeBusinessMembership.findMany({
      where: {
        businessId: { in: businessIds },
        status: "ACTIVE",
        branchAssignments: { some: { status: "ACTIVE" } },
      },
      select: {
        id: true,
        businessId: true,
        employeeCode: true,
        fullName: true,
        staffUser: { select: { id: true } },
        branchAssignments: {
          where: { status: "ACTIVE" },
          select: { branchId: true, canClockIn: true },
        },
      },
      orderBy: [{ businessId: "asc" }, { employeeCode: "asc" }],
    }),
  ]);

  const output = {
    environment: "testing",
    productionAccessed: false,
    readOnly: true,
    auditedAt: new Date().toISOString(),
    databaseHost,
    requestedPhones: [EMPLOYEE_PHONE, MANAGER_PHONE],
    accounts: accounts.map((account) => ({
      id: account.id,
      phoneNormalized: account.phoneNormalized,
      name: account.name,
      status: account.status,
      activeSessions: account.sessions.map((session) => ({
        id: session.id,
        membershipId: session.membershipId,
        businessId: session.businessId,
        primaryBranchId: session.primaryBranchId,
        attendanceBranchId: session.attendanceBranchId,
        employeeDeviceId: session.employeeDeviceId,
        expiresAt: session.expiresAt,
        lastActiveAt: session.lastActiveAt,
      })),
      devices: account.devices.map((device) => ({
        id: device.id,
        displayName: device.displayName,
        platform: device.platform,
        browser: device.browser,
        status: device.status,
        canView: device.canView,
        canPunch: device.canPunch,
        firstVerifiedAt: device.firstVerifiedAt,
        lastActiveAt: device.lastActiveAt,
        revokedAt: device.revokedAt,
      })),
      memberships: account.memberships.map((membership) => ({
        id: membership.id,
        businessId: membership.businessId,
        business: membership.business,
        employeeCode: membership.employeeCode,
        fullName: membership.fullName,
        status: membership.status,
        attendanceEnabled: membership.attendanceEnabled,
        avatarUrlConfigured: Boolean(membership.avatarUrl),
        staffUser: membership.staffUser,
        branchAssignments: membership.branchAssignments.map((assignment) => ({
          id: assignment.id,
          branch: assignment.branch,
          status: assignment.status,
          isPrimary: assignment.isPrimary,
          canClockIn: assignment.canClockIn,
        })),
        recentLeaveRequests: membership.leaveRequests.map((request) => ({
          id: request.id,
          status: request.status,
          startsOn: request.startsOn,
          endsOn: request.endsOn,
          requestedDays: request.requestedDays,
          createdAt: request.createdAt,
        })),
        recentClaims: membership.employeeClaims.map((claim) => ({
          id: claim.id,
          claimNumber: claim.claimNumber,
          status: claim.status,
          submittedTotal: claim.submittedTotal,
          createdAt: claim.createdAt,
        })),
        payslipPublications: membership.payrollPayslipPublications.map((publication) => ({
          id: publication.id,
          payrollRunId: publication.payrollRunId,
          publishedAt: publication.publishedAt,
        })),
        commissionStatements: membership.commissionStatements.map((statement) => ({
          id: statement.id,
          periodId: statement.periodId,
          status: statement.status,
          finalCommissionCents: statement.finalCommissionCents,
          createdAt: statement.createdAt,
        })),
      })),
    })),
    branches: branches.map((branch) => ({
      id: branch.id,
      businessId: branch.businessId,
      name: branch.name,
      status: branch.status,
      attendanceSetting: branch.attendanceSetting ? {
        isEnabled: branch.attendanceSetting.isEnabled,
        timezone: branch.attendanceSetting.timezone,
        latitude: branch.attendanceSetting.latitude,
        longitude: branch.attendanceSetting.longitude,
        geofenceRadiusMeters: branch.attendanceSetting.geofenceRadiusMeters,
        requireGeofence: branch.attendanceSetting.requireGeofence,
        allowOutsideGeofenceRequest: branch.attendanceSetting.allowOutsideGeofenceRequest,
      } : null,
    })),
    rosterAssignments,
    attendances,
    attendanceExceptions,
    pendingAttendanceRequests,
    overtimeReviews,
    leaveEntitlements,
    leaveLedger,
    appointments,
    claimCategories,
    leavePolicies,
    branchCandidates,
  };

  await mkdir(join(process.cwd(), ".tmp"), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    environment: output.environment,
    productionAccessed: output.productionAccessed,
    readOnly: output.readOnly,
    accountCount: output.accounts.length,
    membershipCount: output.accounts.reduce((sum, account) => sum + account.memberships.length, 0),
    businessIds,
    branchCount: output.branches.length,
    rosterAssignmentCount: output.rosterAssignments.length,
    attendanceCount: output.attendances.length,
    attendanceExceptionCount: output.attendanceExceptions.length,
    pendingAttendanceRequestCount: output.pendingAttendanceRequests.length,
    overtimeReviewCount: output.overtimeReviews.length,
    appointmentCount: output.appointments.length,
    outputPath: OUTPUT_PATH,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
