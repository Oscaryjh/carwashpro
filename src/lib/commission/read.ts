import { prisma } from "@/lib/prisma";

export async function getCommissionManagerDashboard(input: {
  businessId: string;
  branchId?: string | null;
}) {
  const { businessId, branchId } = input;
  const [rules, periods, sourceSummary] = await Promise.all([
    prisma.commissionRule.findMany({
      where: {
        businessId,
        ...(branchId ? { revisions: { some: { OR: [{ branchId: null }, { branchId }] } } } : {}),
      },
      include: {
        revisions: {
          ...(branchId ? { where: { OR: [{ branchId: null }, { branchId }] } } : {}),
          orderBy: { revision: "desc" },
          take: 1,
        },
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
    prisma.commissionPeriod.findMany({
      where: { businessId, ...(branchId ? { branchId } : {}) },
      include: {
        branch: { select: { name: true } },
        statements: {
          include: {
            membership: { select: { fullName: true, employeeCode: true } },
            accruals: {
              include: {
                sourceEvent: {
                  select: {
                    sourceType: true,
                    businessDate: true,
                    grossAmountCents: true,
                    netAmountCents: true,
                  },
                },
                ruleRevision: { select: { revision: true, ruleType: true, basis: true } },
              },
              orderBy: { createdAt: "asc" },
            },
            originatingAdjustments: {
              select: { type: true, commissionAmountCents: true, payrollStatus: true, reason: true },
              orderBy: { createdAt: "asc" },
            },
          },
          orderBy: { membership: { fullName: "asc" } },
        },
      },
      orderBy: [{ earnedPeriodStart: "desc" }, { createdAt: "desc" }],
      take: 24,
    }),
    prisma.commissionSourceEvent.groupBy({
      by: ["attributionStatus"],
      where: { businessId, ...(branchId ? { branchId } : {}) },
      _count: { _all: true },
    }),
  ]);
  return { rules, periods, sourceSummary };
}

export async function getEmployeeCommissionStatements(input: {
  businessId: string;
  membershipId: string;
}) {
  return prisma.commissionStatement.findMany({
    where: {
      businessId: input.businessId,
      membershipId: input.membershipId,
      status: { in: ["CALCULATED", "APPROVED", "APPLIED_TO_PAYROLL"] },
    },
    include: {
      period: { select: { earnedPeriodStart: true, earnedPeriodEnd: true, approvedAt: true } },
      accruals: {
        include: { sourceEvent: { select: { sourceType: true, businessDate: true, grossAmountCents: true, netAmountCents: true } } },
        orderBy: { createdAt: "asc" },
      },
      originatingAdjustments: { orderBy: { createdAt: "asc" } },
      appliedAdjustments: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });
}
