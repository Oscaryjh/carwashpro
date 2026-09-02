import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { getStaffAppointmentDay } from "../src/lib/staff-pwa/appointments";
import {
  getStaffAttendanceCorrectionQueue,
  getStaffTeamApprovalSummary,
  resolveStaffTeamApprovalAccess,
} from "../src/lib/staff-pwa/team-approvals";
import {
  getStaffOvertimeQueue,
  getStaffOvertimeSummary,
} from "../src/lib/staff-pwa/overtime-approvals";
import { getBranchLocalDateKey } from "../src/lib/attendance/work-date";

const ARTIFACT_PATH = join(process.cwd(), ".tmp", "testing-staff-two-phone-uat-prepared.json");

type Artifact = {
  environment: string;
  productionAccessed: boolean;
  business: { id: string };
  branch: { id: string; timezone: string };
  employee: { accountId: string; membershipId: string; activeSessionId: string; activePhysicalDevice: { id: string } };
  manager: { accountId: string; membershipId: string; activeSessionId: string; activePhysicalDevice: { id: string } };
  attendanceCorrection: { sourceAttendanceId: string };
  overtime: { finalResultIds: string[] };
  appointments: { enabled: boolean };
};

function assertTestingBoundary() {
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== "testing") throw new Error("TWO_PHONE_UAT_VERIFY_REQUIRES_TESTING");
  if (process.env.RAILWAY_SERVICE_NAME !== "tetamu-pos-web") throw new Error("TWO_PHONE_UAT_VERIFY_REQUIRES_WEB_SERVICE_CONTEXT");
  if (process.env.TETAMU_TESTING_DATABASE_AUDIT !== "true") throw new Error("TWO_PHONE_UAT_VERIFY_REQUIRES_READ_ONLY_ACK");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_IS_REQUIRED");
  const host = new URL(databaseUrl).hostname.toLowerCase();
  if (host !== "postgres-singapore.railway.internal" && !host.endsWith(".proxy.rlwy.net")) {
    throw new Error("TWO_PHONE_UAT_VERIFY_DATABASE_HOST_IS_NOT_APPROVED_TESTING_RAILWAY");
  }
}

function auth(input: {
  accountId: string;
  membershipId: string;
  sessionId: string;
  deviceId: string;
  businessId: string;
  branchId: string;
}) {
  return {
    sessionId: input.sessionId,
    employeeAccountId: input.accountId,
    membershipId: input.membershipId,
    businessId: input.businessId,
    primaryBranchId: input.branchId,
    attendanceBranchId: input.branchId,
    deviceId: input.deviceId,
  };
}

async function main() {
  assertTestingBoundary();
  const artifact = JSON.parse(await readFile(ARTIFACT_PATH, "utf8")) as Artifact;
  if (artifact.environment !== "testing" || artifact.productionAccessed !== false) throw new Error("INVALID_PREPARATION_ARTIFACT");
  const employeeAuth = auth({
    accountId: artifact.employee.accountId,
    membershipId: artifact.employee.membershipId,
    sessionId: artifact.employee.activeSessionId,
    deviceId: artifact.employee.activePhysicalDevice.id,
    businessId: artifact.business.id,
    branchId: artifact.branch.id,
  });
  const managerAuth = auth({
    accountId: artifact.manager.accountId,
    membershipId: artifact.manager.membershipId,
    sessionId: artifact.manager.activeSessionId,
    deviceId: artifact.manager.activePhysicalDevice.id,
    businessId: artifact.business.id,
    branchId: artifact.branch.id,
  });

  const [
    employeeApprovalAccess,
    managerApprovalAccess,
    approvalSummary,
    attendanceQueue,
    overtimeSummary,
    overtimeQueue,
    sourceAttendance,
    appointments,
  ] = await Promise.all([
    resolveStaffTeamApprovalAccess(employeeAuth),
    resolveStaffTeamApprovalAccess(managerAuth),
    getStaffTeamApprovalSummary(managerAuth),
    getStaffAttendanceCorrectionQueue({ auth: managerAuth }),
    getStaffOvertimeSummary(managerAuth),
    getStaffOvertimeQueue({ auth: managerAuth, month: "2026-08" }),
    prisma.employeeAttendance.findUnique({ where: { id: artifact.attendanceCorrection.sourceAttendanceId } }),
    artifact.appointments.enabled
      ? getStaffAppointmentDay({ auth: employeeAuth, date: getBranchLocalDateKey(new Date(), artifact.branch.timezone), now: new Date() })
      : Promise.resolve(null),
  ]);

  if (employeeApprovalAccess) throw new Error("EMPLOYEE_APPROVAL_ACCESS_MUST_BE_DENIED");
  if (!managerApprovalAccess || managerApprovalAccess.wholeBusinessScope) throw new Error("MANAGER_MUST_HAVE_BRANCH_LIMITED_APPROVAL_ACCESS");
  if (!approvalSummary?.canReviewLeave || !approvalSummary.canReviewClaims || !approvalSummary.canReviewAttendance) {
    throw new Error("MANAGER_DOMAIN_APPROVAL_ACCESS_IS_INCOMPLETE");
  }
  if (!attendanceQueue || attendanceQueue.totalActionable !== 0) {
    throw new Error("ATTENDANCE_QUEUE_MUST_START_EMPTY_BEFORE_IPHONE_LIVE_SUBMISSION");
  }
  if (!sourceAttendance || sourceAttendance.status !== "INCOMPLETE" || sourceAttendance.clockOutAt) {
    throw new Error("ATTENDANCE_CORRECTION_SOURCE_SESSION_IS_NOT_READY");
  }
  if (!overtimeSummary || overtimeSummary.pending < 3 || !overtimeQueue || overtimeQueue.pending < 3) {
    throw new Error("THREE_PENDING_OT_CANDIDATES_ARE_REQUIRED");
  }
  const preparedIds = new Set(artifact.overtime.finalResultIds);
  const preparedVisible = overtimeQueue.items.filter((item) => preparedIds.has(item.finalResultId));
  if (preparedVisible.length !== 3 || preparedVisible.some((item) => item.employeeUserId === managerApprovalAccess.actor.userId)) {
    throw new Error("OT_CANDIDATE_SCOPE_OR_SELF_REVIEW_GUARD_FAILED");
  }
  if (appointments && appointments.appointments.length < 1) throw new Error("TODAY_APPOINTMENT_IS_NOT_VISIBLE");

  console.log(JSON.stringify({
    environment: "testing",
    productionAccessed: false,
    employeeApprovalAccessDenied: true,
    managerBranchLimited: true,
    managerCapabilities: {
      leave: approvalSummary.canReviewLeave,
      claims: approvalSummary.canReviewClaims,
      attendance: approvalSummary.canReviewAttendance,
      overtime: Boolean(overtimeSummary?.canReviewOvertime),
    },
    initialLiveApprovalCounts: {
      leave: approvalSummary.leave,
      claims: approvalSummary.claims,
      attendance: approvalSummary.attendance,
      overtime: overtimeQueue.pending,
    },
    attendanceCorrectionSourceReady: true,
    attendanceCountContractAfterLiveSubmission: "0 -> 1 expected",
    preparedOvertimeCandidates: preparedVisible.length,
    managerSelfReviewExcluded: true,
    visibleAppointmentsToday: appointments?.appointments.length ?? 0,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
