import type { Prisma, PrismaClient } from "@prisma/client";
import { getBranchLocalDateKey } from "@/lib/attendance/work-date";
import { resolveLeaveEntitlementDays } from "@/lib/leave/policy";
import { prisma } from "@/lib/prisma";
import { buildPeopleMembershipScopeWhere, type PeopleScopeInput } from "@/lib/team/people-scope";

type EmployeeLeaveSectionInput = PeopleScopeInput & { membershipId: string };

export async function loadEmployeeLeaveSection(input: EmployeeLeaveSectionInput, database: PrismaClient = prisma) {
  const membership = await database.employeeBusinessMembership.findFirst({
    where: { ...buildPeopleMembershipScopeWhere(input), id: input.membershipId },
    select: { id: true, joinedAt: true, business: { select: { timezone: true } } },
  });
  if (!membership) return null;

  const todayKey = getBranchLocalDateKey(input.now, membership.business.timezone);
  const year = Number(todayKey.slice(0, 4));
  const yearFrom = new Date(Date.UTC(year, 0, 1));
  const today = new Date(`${todayKey}T00:00:00.000Z`);
  const requestScope: Prisma.LeaveRequestWhereInput = {
    branchId: { in: [...input.allowedBranchIds] },
    businessId: input.businessId,
    membershipId: membership.id,
  };

  const [policies, entitlements, ledger, pendingRequestCount, upcomingApprovedLeave, recentLeaveHistory] = await Promise.all([
    database.leavePolicy.findMany({
      where: { active: true, businessId: input.businessId },
      include: { versions: { where: { effectiveFrom: { lte: today }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] }, orderBy: { revision: "desc" }, take: 1 } },
      orderBy: [{ name: "asc" }],
    }),
    database.employeeLeaveEntitlement.findMany({ where: { businessId: input.businessId, membershipId: membership.id, leaveYearStart: yearFrom } }),
    database.leaveBalanceLedgerEntry.groupBy({
      by: ["policyId", "eventType"],
      where: { businessId: input.businessId, membershipId: membership.id, leaveYearStart: yearFrom },
      _sum: { units: true },
    }),
    database.leaveRequest.count({ where: { ...requestScope, status: "PENDING" } }),
    database.leaveRequest.findMany({ where: { ...requestScope, endsOn: { gte: today }, status: "APPROVED" }, orderBy: [{ startsOn: "asc" }, { createdAt: "asc" }], take: 5, select: leaveRequestSummarySelect }),
    database.leaveRequest.findMany({ where: requestScope, orderBy: [{ createdAt: "desc" }], take: 20, select: leaveRequestSummarySelect }),
  ]);
  const entitlementByPolicy = new Map(entitlements.map((row) => [row.policyId, Number(row.entitledUnits)]));
  const eventMap = new Map(ledger.map((row) => [`${row.policyId}:${row.eventType}`, Number(row._sum.units ?? 0)]));
  const totalByPolicy = new Map<string, number>();
  for (const row of ledger) totalByPolicy.set(row.policyId, (totalByPolicy.get(row.policyId) ?? 0) + Number(row._sum.units ?? 0));
  const approvedLeaveDays = Math.abs(ledger.filter((row) => row.eventType === "APPROVED_CONSUMPTION").reduce((sum, row) => sum + Number(row._sum.units ?? 0), 0));

  return {
    id: membership.id,
    year,
    applicablePolicyCount: policies.length,
    pendingRequestCount,
    approvedLeaveDays,
    policies: policies.flatMap((policy) => {
      const version = policy.versions[0];
      if (!version) return [];
      const entitlementDays = entitlementByPolicy.get(policy.id) ?? resolveLeaveEntitlementDays(version, membership.joinedAt, year);
      const carriedForwardDays = eventMap.get(`${policy.id}:CARRY_FORWARD`) ?? 0;
      const adjustmentDays = eventMap.get(`${policy.id}:MANUAL_ADJUSTMENT`) ?? 0;
      const usedDays = Math.abs(eventMap.get(`${policy.id}:APPROVED_CONSUMPTION`) ?? 0) - (eventMap.get(`${policy.id}:CANCELLATION_RESTORE`) ?? 0);
      return [{
        id: policy.id,
        code: policy.code,
        name: version.nameSnapshot,
        payTreatment: version.payTreatment,
        countMode: version.countMode,
        balanceTracked: version.balanceTracked,
        entitlementDays,
        carriedForwardDays,
        adjustmentDays,
        usedDays: Math.max(0, usedDays),
        remainingDays: version.balanceTracked ? totalByPolicy.get(policy.id) ?? 0 : null,
      }];
    }),
    upcomingApprovedLeave: upcomingApprovedLeave.map(toLeaveSummary),
    recentLeaveHistory: recentLeaveHistory.map(toLeaveSummary),
  };
}

const leaveRequestSummarySelect = {
  id: true,
  policyNameSnapshot: true,
  payTreatmentSnapshot: true,
  startsOn: true,
  endsOn: true,
  requestedDays: true,
  status: true,
} satisfies Prisma.LeaveRequestSelect;

type LeaveRequestSummary = Prisma.LeaveRequestGetPayload<{ select: typeof leaveRequestSummarySelect }>;

function toLeaveSummary(request: LeaveRequestSummary) {
  return {
    id: request.id,
    policyName: request.policyNameSnapshot,
    payTreatment: request.payTreatmentSnapshot,
    startsOn: request.startsOn,
    endsOn: request.endsOn,
    requestedDays: Number(request.requestedDays),
    status: request.status,
  };
}
