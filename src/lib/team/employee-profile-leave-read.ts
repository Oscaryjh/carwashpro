import type { Prisma, PrismaClient } from "@prisma/client";
import { getBranchLocalDateKey } from "@/lib/attendance/work-date";
import { resolveLeaveEntitlementDays } from "@/lib/leave/policy";
import { prisma } from "@/lib/prisma";
import {
  buildPeopleMembershipScopeWhere,
  type PeopleScopeInput,
} from "@/lib/team/people-scope";

type EmployeeLeaveSectionInput = PeopleScopeInput & {
  membershipId: string;
};

export async function loadEmployeeLeaveSection(
  input: EmployeeLeaveSectionInput,
  database: PrismaClient = prisma,
) {
  const membership = await database.employeeBusinessMembership.findFirst({
    where: {
      ...buildPeopleMembershipScopeWhere(input),
      id: input.membershipId,
    },
    select: {
      id: true,
      joinedAt: true,
      business: {
        select: {
          timezone: true,
        },
      },
    },
  });

  if (!membership) {
    return null;
  }

  const todayKey = getBranchLocalDateKey(
    input.now,
    membership.business.timezone,
  );
  const year = Number(todayKey.slice(0, 4));
  const yearFrom = new Date(Date.UTC(year, 0, 1));
  const yearTo = new Date(Date.UTC(year + 1, 0, 1));
  const today = new Date(`${todayKey}T00:00:00.000Z`);
  const requestScope: Prisma.LeaveRequestWhereInput = {
    branchId: { in: [...input.allowedBranchIds] },
    businessId: input.businessId,
    membershipId: membership.id,
  };

  const [
    policies,
    balances,
    approvedRequests,
    pendingRequestCount,
    upcomingApprovedLeave,
    recentLeaveHistory,
  ] = await Promise.all([
    database.leavePolicy.findMany({
      where: {
        active: true,
        businessId: input.businessId,
      },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        payTreatment: true,
        countMode: true,
        balanceTracked: true,
        defaultEntitlementDays: true,
        underTwoYearsDays: true,
        twoToFiveYearsDays: true,
        fiveYearsPlusDays: true,
      },
    }),
    database.employeeLeaveBalance.findMany({
      where: {
        businessId: input.businessId,
        membershipId: membership.id,
        year,
      },
      select: {
        policyId: true,
        entitlementOverrideDays: true,
        carriedForwardDays: true,
        adjustmentDays: true,
      },
    }),
    database.leaveRequest.findMany({
      where: {
        ...requestScope,
        status: "APPROVED",
        days: {
          some: {
            leaveDate: { gte: yearFrom, lt: yearTo },
          },
        },
      },
      select: {
        policyId: true,
        days: {
          where: {
            leaveDate: { gte: yearFrom, lt: yearTo },
          },
          select: {
            dayFraction: true,
          },
        },
      },
    }),
    database.leaveRequest.count({
      where: {
        ...requestScope,
        status: "PENDING",
      },
    }),
    database.leaveRequest.findMany({
      where: {
        ...requestScope,
        endsOn: { gte: today },
        status: "APPROVED",
      },
      orderBy: [{ startsOn: "asc" }, { createdAt: "asc" }],
      take: 5,
      select: leaveRequestSummarySelect,
    }),
    database.leaveRequest.findMany({
      where: requestScope,
      orderBy: [{ createdAt: "desc" }],
      take: 20,
      select: leaveRequestSummarySelect,
    }),
  ]);

  const balanceByPolicy = new Map(
    balances.map((balance) => [balance.policyId, balance]),
  );
  const usedByPolicy = new Map<string, number>();
  let approvedLeaveDays = 0;

  for (const request of approvedRequests) {
    const usedDays = request.days.reduce(
      (total, day) => total + Number(day.dayFraction),
      0,
    );
    approvedLeaveDays += usedDays;
    usedByPolicy.set(
      request.policyId,
      (usedByPolicy.get(request.policyId) ?? 0) + usedDays,
    );
  }

  return {
    id: membership.id,
    year,
    applicablePolicyCount: policies.length,
    pendingRequestCount,
    approvedLeaveDays,
    policies: policies.map((policy) => {
      const balance = balanceByPolicy.get(policy.id);
      const entitlementDays =
        balance?.entitlementOverrideDays !== null &&
        balance?.entitlementOverrideDays !== undefined
          ? Number(balance.entitlementOverrideDays)
          : resolveLeaveEntitlementDays(policy, membership.joinedAt, year);
      const carriedForwardDays = Number(balance?.carriedForwardDays ?? 0);
      const adjustmentDays = Number(balance?.adjustmentDays ?? 0);
      const usedDays = usedByPolicy.get(policy.id) ?? 0;
      const availableDays =
        entitlementDays + carriedForwardDays + adjustmentDays;

      return {
        id: policy.id,
        code: policy.code,
        name: policy.name,
        payTreatment: policy.payTreatment,
        countMode: policy.countMode,
        balanceTracked: policy.balanceTracked,
        entitlementDays,
        carriedForwardDays,
        adjustmentDays,
        usedDays,
        remainingDays: policy.balanceTracked
          ? availableDays - usedDays
          : null,
      };
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

type LeaveRequestSummary = Prisma.LeaveRequestGetPayload<{
  select: typeof leaveRequestSummarySelect;
}>;

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
