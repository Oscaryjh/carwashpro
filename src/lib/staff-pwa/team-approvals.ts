import type { PrismaClient } from "@prisma/client";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import type { AppSession } from "@/lib/auth/session";
import {
  businessCapabilities,
  canDirectStaff,
  type BusinessCapability,
} from "@/lib/business-groups/capabilities";
import { getManagerClaimDashboard, reviewEmployeeClaim } from "@/lib/claim/service";
import { getManagerLeaveDashboard, reviewLeaveRequest } from "@/lib/leave/service";
import {
  loadAttendanceResolutionQueue,
  loadPendingAttendanceExceptionQueue,
  loadPendingAttendanceP2CorrectionQueue,
} from "@/lib/attendance/resolution-read-service";
import { reviewAttendanceException } from "@/lib/attendance/management-service";
import { resolveAttendanceP2Exception } from "@/lib/attendance/p2-service";
import {
  applyManagerAttendanceResolution,
  type AttendanceManagerResolutionAction,
} from "@/lib/attendance/resolution-workflow-service";
import { loadBusinessModuleContext } from "@/lib/modules/entitlements";
import { getUnifiedApprovalCounts, getUnifiedApprovalInbox, type UnifiedApprovalContext } from "@/lib/approvals/service";
import { getHrApprovalStages, type HrApprovalActorLevel } from "@/lib/approvals/policy-service";
import type { ApprovalDomain } from "@/lib/approvals/types";
import type { AuditRequestContext } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

type ApprovalDatabase = PrismaClient;
export type MobileApprovalDomain = "LEAVE" | "CLAIMS";

export type StaffTeamApprovalAccess = Readonly<{
  actor: AppSession;
  actorLevel: HrApprovalActorLevel;
  actorMembershipId: string;
  businessId: string;
  allowedBranchIds: readonly string[];
  wholeBusinessScope: boolean;
  canReviewAttendance: boolean;
  canReviewLeave: boolean;
  canReviewClaims: boolean;
  unified: UnifiedApprovalContext;
}>;

export async function resolveStaffTeamApprovalAccess(
  auth: EmployeeAuthContext,
  database: ApprovalDatabase = prisma,
): Promise<StaffTeamApprovalAccess | null> {
  const membership = await database.employeeBusinessMembership.findFirst({
    where: { id: auth.membershipId, businessId: auth.businessId, status: "ACTIVE" },
    select: {
      staffUser: {
        select: {
          id: true,
          businessId: true,
          branchId: true,
          name: true,
          email: true,
          role: true,
          permissions: true,
          status: true,
        },
      },
    },
  });
  const user = membership?.staffUser;
  if (!user || user.businessId !== auth.businessId || user.status !== "active") return null;

  const activeBranches = await database.branch.findMany({
    where: { businessId: auth.businessId, status: "ACTIVE" },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const activeIds = activeBranches.map((branch) => branch.id);
  const wholeBusinessScope = user.role === "BUSINESS_OWNER" || user.permissions.includes("ALL_BRANCHES");
  const currentBranchId = [user.branchId, auth.attendanceBranchId, auth.primaryBranchId]
    .find((branchId): branchId is string => Boolean(branchId && activeIds.includes(branchId)));
  const allowedBranchIds = wholeBusinessScope ? activeIds : currentBranchId ? [currentBranchId] : [];
  const allowed = (capability: BusinessCapability) =>
    user.role === "BUSINESS_OWNER" || (user.role === "STAFF" && canDirectStaff(user.permissions, capability));
  const moduleContext = await loadBusinessModuleContext(auth.businessId, { database });
  const canReviewAttendance = moduleContext.enabledModules.has("HR") && allowed("MODIFY_ATTENDANCE_EMPLOYEES");
  const canReviewLeave = moduleContext.enabledModules.has("HR") && allowed("APPROVE_LEAVE");
  const canReviewClaims = moduleContext.enabledModules.has("HR") && moduleContext.enabledModules.has("CLAIMS") && allowed("REVIEW_CLAIM");
  if (!canReviewAttendance && !canReviewLeave && !canReviewClaims) return null;
  const capabilities = new Set(
    businessCapabilities.filter((capability) => allowed(capability)),
  );
  const actor: AppSession = {
    userId: user.id,
    homeBusinessId: user.businessId,
    activeBusinessId: user.businessId,
    contextVersion: 1,
    businessId: user.businessId,
    branchId: currentBranchId ?? null,
    name: user.name,
    email: user.email ?? "",
    role: user.role,
    permissions: user.permissions,
    status: user.status,
  };
  const actorLevel = user.role === "BUSINESS_OWNER" ? "OWNER" : "MANAGER";
  return {
    actor,
    actorLevel,
    actorMembershipId: auth.membershipId,
    businessId: auth.businessId,
    allowedBranchIds,
    wholeBusinessScope,
    canReviewAttendance,
    canReviewLeave,
    canReviewClaims,
    unified: {
      actorUserId: user.id,
      businessId: auth.businessId,
      allowedBranchIds,
      wholeBusinessScope,
      enabledModules: moduleContext.enabledModules,
      capabilities,
      actorLevel,
    },
  };
}

export async function getStaffTeamApprovalSummary(
  auth: EmployeeAuthContext,
  database: ApprovalDatabase = prisma,
) {
  const access = await resolveStaffTeamApprovalAccess(auth, database);
  if (!access) return null;
  const [result, attendance] = await Promise.all([
    getUnifiedApprovalCounts(access.unified, database, { domains: ["LEAVE", "CLAIMS"] }),
    access.canReviewAttendance
      ? loadStaffAttendanceTaskProjection({ access, page: 1, database })
      : Promise.resolve(null),
  ]);
  const attendanceCount = attendance?.totalActionable ?? 0;
  return {
    attendance: attendanceCount,
    leave: access.canReviewLeave ? result.counts.LEAVE : 0,
    claims: access.canReviewClaims ? result.counts.CLAIMS : 0,
    total: attendanceCount +
      (access.canReviewLeave ? result.counts.LEAVE : 0) +
      (access.canReviewClaims ? result.counts.CLAIMS : 0),
    complete: result.complete,
    canReviewAttendance: access.canReviewAttendance,
    canReviewLeave: access.canReviewLeave,
    canReviewClaims: access.canReviewClaims,
  };
}

export async function getStaffAttendanceCorrectionQueue(input: {
  auth: EmployeeAuthContext;
  page?: number;
  database?: ApprovalDatabase;
}) {
  const database = input.database ?? prisma;
  const access = await resolveStaffTeamApprovalAccess(input.auth, database);
  if (!access?.canReviewAttendance || !access.allowedBranchIds.length) return null;

  const projection = await loadStaffAttendanceTaskProjection({
    access,
    page: input.page ?? 1,
    database,
  });
  return {
    items: projection.items,
    totalActionable: projection.totalActionable,
    // Compatibility alias for existing callers while the route becomes the
    // canonical Staff Attendance task center.
    totalWaiting: projection.totalActionable,
    totalPages: projection.totalPages,
    currentPage: projection.currentPage,
    access,
  };
}

export async function loadStaffAttendanceTaskProjection(input: {
  access: StaffTeamApprovalAccess;
  page: number;
  database: ApprovalDatabase;
}) {
  const { access, database } = input;
  const pageSize = 20;
  const requestedPage = Math.min(100, Math.max(1, Math.floor(input.page)));
  const candidateLimit = requestedPage * pageSize;
  const scope = {
    businessId: access.businessId,
    allowedBranchIds: access.allowedBranchIds,
  };
  const [corrections, pendingExceptions, p2Corrections] = await Promise.all([
    loadAttendanceResolutionQueue({
      scope,
      page: 1,
      pageSize: candidateLimit,
      status: "UNDER_REVIEW",
      excludedMembershipId: access.actorMembershipId,
      database,
    }),
    loadPendingAttendanceExceptionQueue({
      scope,
      page: 1,
      pageSize: candidateLimit,
      excludedMembershipId: access.actorMembershipId,
      database,
    }),
    loadPendingAttendanceP2CorrectionQueue({
      scope,
      page: 1,
      pageSize: candidateLimit,
      excludedMembershipId: access.actorMembershipId,
      database,
    }),
  ]);
  const totalActionable = corrections.pagination.total +
    pendingExceptions.pagination.total +
    p2Corrections.pagination.total;
  const totalPages = Math.max(1, Math.ceil(totalActionable / pageSize));
  const currentPage = Math.min(requestedPage, totalPages);
  const start = (currentPage - 1) * pageSize;
  const candidates = [
    ...corrections.items.map((item) => ({
      sourceType: "RESOLUTION_CASE" as const,
      sourceId: item.id,
      requestedAt: item.updatedAt,
      item,
    })),
    ...pendingExceptions.items.map((item) => ({
      sourceType: "STANDALONE_EXCEPTION" as const,
      sourceId: item.id,
      requestedAt: item.createdAt,
      item,
    })),
    ...p2Corrections.items.map((item) => ({
      sourceType: "P2_CORRECTION_REQUEST" as const,
      sourceId: item.id,
      requestedAt: item.createdAt,
      item,
    })),
  ].sort((left, right) =>
    left.requestedAt.getTime() - right.requestedAt.getTime() ||
    `${left.sourceType}:${left.sourceId}`.localeCompare(`${right.sourceType}:${right.sourceId}`)
  );
  return {
    items: candidates.slice(start, start + pageSize),
    totalActionable,
    totalPages,
    currentPage,
  };
}

export async function reviewStaffAttendanceP2Correction(input: {
  auth: EmployeeAuthContext;
  correctionRequestId: string;
  expectedRevision: number;
  decision: "APPROVED" | "REJECTED";
  reason: string;
  request?: AuditRequestContext;
  database?: ApprovalDatabase;
}) {
  const database = input.database ?? prisma;
  const access = await resolveStaffTeamApprovalAccess(input.auth, database);
  if (!access?.canReviewAttendance) {
    throw new Error("You do not have permission to review Attendance corrections in this workplace.");
  }
  const correction = await database.attendanceCorrectionRequest.findFirst({
    where: {
      id: input.correctionRequestId,
      businessId: access.businessId,
      status: "PENDING",
      membershipId: { not: access.actorMembershipId },
    },
  });
  if (!correction) {
    throw new Error("This attendance correction has already been reviewed or is outside your approval scope.");
  }
  const issue = await database.attendanceP2Exception.findFirst({
    where: {
      id: correction.exceptionId,
      businessId: access.businessId,
      branchId: { in: [...access.allowedBranchIds] },
      membershipId: correction.membershipId,
      status: "PENDING_MANAGER",
      currentResolutionId: null,
      type: { in: ["MISSING_CLOCK_IN", "MISSING_CLOCK_OUT"] },
    },
    select: {
      id: true,
      type: true,
      revision: true,
    },
  });
  if (!issue) {
    throw new Error("This attendance correction is no longer available in your approval scope.");
  }
  if (issue.revision !== input.expectedRevision) {
    throw new Error("This attendance correction changed after you opened it. Refresh before deciding.");
  }
  if (
    input.decision === "APPROVED" &&
    ((issue.type === "MISSING_CLOCK_IN" && !correction.requestedClockInAt) ||
      (issue.type === "MISSING_CLOCK_OUT" && !correction.requestedClockOutAt))
  ) {
    throw new Error("The employee did not provide the missing time required to approve this correction.");
  }
  return resolveAttendanceP2Exception({
    context: {
      businessId: access.businessId,
      allowedBranchIds: access.allowedBranchIds,
      actor: access.actor,
      request: input.request,
    },
    input: {
      exceptionId: issue.id,
      expectedRevision: input.expectedRevision,
      type: input.decision === "APPROVED" ? "CORRECTED" : "EXCLUDED",
      reason: input.reason,
      correctedClockInAt: input.decision === "APPROVED" ? correction.requestedClockInAt : null,
      correctedClockOutAt: input.decision === "APPROVED" ? correction.requestedClockOutAt : null,
      correctedBreakMinutes: null,
    },
    database,
  });
}

export async function reviewStaffPendingAttendanceException(input: {
  auth: EmployeeAuthContext;
  exceptionId: string;
  decision: "APPROVED" | "REJECTED";
  reviewNote?: string | null;
  request?: AuditRequestContext;
}) {
  const access = await resolveStaffTeamApprovalAccess(input.auth);
  if (!access?.canReviewAttendance) {
    throw new Error("You do not have permission to review Attendance corrections in this workplace.");
  }
  return reviewAttendanceException({
    businessId: access.businessId,
    allowedBranchIds: access.allowedBranchIds,
    actor: access.actor,
    request: input.request,
    input: {
      exceptionId: input.exceptionId,
      decision: input.decision,
      reviewNote: input.reviewNote ?? "",
    },
  });
}

export async function reviewStaffAttendanceCorrection(input: {
  auth: EmployeeAuthContext;
  resolutionCaseId: string;
  action: AttendanceManagerResolutionAction;
  reason: string;
  correctedClockInLocal?: string | null;
  correctedClockOutLocal?: string | null;
  correctedBreakMinutes?: number | null;
  expectedUpdatedAt: string;
  expectedCurrentResultId?: string | null;
  request?: AuditRequestContext;
}) {
  const access = await resolveStaffTeamApprovalAccess(input.auth);
  if (!access?.canReviewAttendance) {
    throw new Error("You do not have permission to review Attendance corrections in this workplace.");
  }
  return applyManagerAttendanceResolution({
    context: {
      businessId: access.businessId,
      allowedBranchIds: access.allowedBranchIds,
      actor: access.actor,
      request: input.request,
    },
    input: {
      resolutionCaseId: input.resolutionCaseId,
      action: input.action,
      reason: input.reason,
      correctedClockInLocal: input.correctedClockInLocal ?? null,
      correctedClockOutLocal: input.correctedClockOutLocal ?? null,
      correctedBreakMinutes: input.correctedBreakMinutes ?? null,
      expectedUpdatedAt: input.expectedUpdatedAt,
      expectedCurrentResultId: input.expectedCurrentResultId ?? null,
    },
  });
}

export async function getStaffTeamApprovalInbox(input: {
  auth: EmployeeAuthContext;
  domain?: MobileApprovalDomain;
  page?: number;
}) {
  const access = await resolveStaffTeamApprovalAccess(input.auth);
  if (!access) return null;
  if (!access.canReviewLeave && !access.canReviewClaims) return null;
  if (input.domain === "LEAVE" && !access.canReviewLeave) return null;
  if (input.domain === "CLAIMS" && !access.canReviewClaims) return null;
  const inbox = await getUnifiedApprovalInbox(access.unified, {
    domain: input.domain as ApprovalDomain | undefined,
    page: input.page,
    pageSize: 20,
  });
  return {
    ...inbox,
    items: inbox.items.filter((item) => item.domain === "LEAVE" || item.domain === "CLAIMS"),
    canReviewLeave: access.canReviewLeave,
    canReviewClaims: access.canReviewClaims,
    canReviewAttendance: access.canReviewAttendance,
  };
}

export async function getStaffTeamApprovalDetail(
  auth: EmployeeAuthContext,
  domain: MobileApprovalDomain,
  requestId: string,
) {
  const access = await resolveStaffTeamApprovalAccess(auth);
  if (!access || (domain === "LEAVE" ? !access.canReviewLeave : !access.canReviewClaims)) return null;
  if (!access.allowedBranchIds.length) return null;

  if (domain === "LEAVE") {
    const source = await prisma.leaveRequest.findFirst({
      where: {
        id: requestId,
        businessId: access.businessId,
        branchId: { in: [...access.allowedBranchIds] },
        membership: { staffUser: { isNot: { id: access.actor.userId } } },
      },
      select: { id: true, revision: true, requestedDays: true, startsOn: true, status: true },
    });
    if (!source) return null;
    if (source.status === "PENDING" && !(await visibleAtCurrentStage(access, "LEAVE", source.id, source.revision, Number(source.requestedDays)))) return null;
    const dashboard = await getManagerLeaveDashboard({
      businessId: access.businessId,
      allowedBranchIds: access.allowedBranchIds,
      year: source.startsOn.getUTCFullYear(),
    });
    const request = dashboard.requests.find((item) => item.id === requestId);
    return request ? { domain, request, access } as const : null;
  }

  const source = await prisma.employeeClaim.findFirst({
    where: {
      id: requestId,
      businessId: access.businessId,
      branchId: { in: [...access.allowedBranchIds] },
      membership: { staffUser: { isNot: { id: access.actor.userId } } },
    },
    select: { id: true, revision: true, submittedTotal: true, status: true },
  });
  if (!source) return null;
  if (source.status === "SUBMITTED" && !(await visibleAtCurrentStage(access, "CLAIMS", source.id, source.revision, Number(source.submittedTotal)))) return null;
  const dashboard = await getManagerClaimDashboard({
    businessId: access.businessId,
    allowedBranchIds: [...access.allowedBranchIds],
  });
  const claim = dashboard.claims.find((item) => item.id === requestId);
  return claim ? { domain, claim, access } as const : null;
}

async function visibleAtCurrentStage(
  access: StaffTeamApprovalAccess,
  domain: MobileApprovalDomain,
  id: string,
  revision: number,
  value: number,
) {
  const stages = await getHrApprovalStages({
    businessId: access.businessId,
    domain,
    actorLevel: access.actorLevel,
    subjects: [{ id, revision, value }],
  });
  return Boolean(stages.get(id)?.visible);
}

export async function reviewStaffLeave(input: {
  auth: EmployeeAuthContext;
  requestId: string;
  expectedRevision: number;
  decision: "APPROVED" | "REJECTED";
  reviewNote?: string | null;
  request?: AuditRequestContext;
}) {
  const access = await resolveStaffTeamApprovalAccess(input.auth);
  if (!access?.canReviewLeave) throw new Error("You do not have permission to review Leave requests in this workplace.");
  return reviewLeaveRequest({
    businessId: access.businessId,
    allowedBranchIds: access.allowedBranchIds,
    actor: access.actor,
    actorLevel: access.actorLevel,
    request: input.request,
    rawInput: {
      requestId: input.requestId,
      expectedRevision: input.expectedRevision,
      decision: input.decision,
      reviewNote: input.reviewNote || null,
    },
  });
}

export async function reviewStaffClaim(input: {
  auth: EmployeeAuthContext;
  claimId: string;
  expectedRevision: number;
  decision: "APPROVED" | "REJECTED";
  reason?: string | null;
  request?: AuditRequestContext;
}) {
  const detail = await getStaffTeamApprovalDetail(input.auth, "CLAIMS", input.claimId);
  if (!detail || detail.domain !== "CLAIMS") throw new Error("This Claim is no longer available in your approval scope.");
  const reject = input.decision === "REJECTED";
  return reviewEmployeeClaim({
    businessId: detail.access.businessId,
    allowedBranchIds: [...detail.access.allowedBranchIds],
    actor: detail.access.actor,
    actorLevel: detail.access.actorLevel,
    request: input.request,
    rawInput: {
      claimId: input.claimId,
      expectedRevision: input.expectedRevision,
      reason: input.reason || null,
      lines: detail.claim.lines.map((line) => ({
        lineId: line.id,
        approvedAmount: reject ? "0" : line.submittedAmount,
        reason: reject ? input.reason || null : null,
      })),
    },
  });
}
