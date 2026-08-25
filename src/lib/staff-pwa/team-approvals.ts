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
  businessId: string;
  allowedBranchIds: readonly string[];
  wholeBusinessScope: boolean;
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
  const canReviewLeave = moduleContext.enabledModules.has("HR") && allowed("APPROVE_LEAVE");
  const canReviewClaims = moduleContext.enabledModules.has("HR") && moduleContext.enabledModules.has("CLAIMS") && allowed("REVIEW_CLAIM");
  if (!canReviewLeave && !canReviewClaims) return null;
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
    businessId: auth.businessId,
    allowedBranchIds,
    wholeBusinessScope,
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

export async function getStaffTeamApprovalSummary(auth: EmployeeAuthContext) {
  const access = await resolveStaffTeamApprovalAccess(auth);
  if (!access) return null;
  const result = await getUnifiedApprovalCounts(access.unified);
  return {
    leave: access.canReviewLeave ? result.counts.LEAVE : 0,
    claims: access.canReviewClaims ? result.counts.CLAIMS : 0,
    total: (access.canReviewLeave ? result.counts.LEAVE : 0) + (access.canReviewClaims ? result.counts.CLAIMS : 0),
    complete: result.complete,
    canReviewLeave: access.canReviewLeave,
    canReviewClaims: access.canReviewClaims,
  };
}

export async function getStaffTeamApprovalInbox(input: {
  auth: EmployeeAuthContext;
  domain?: MobileApprovalDomain;
  page?: number;
}) {
  const access = await resolveStaffTeamApprovalAccess(input.auth);
  if (!access) return null;
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
