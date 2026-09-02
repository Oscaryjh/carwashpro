import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function getCommissionManagerDashboard(input: {
  businessId: string;
  branchId?: string | null;
}) {
  const { businessId, branchId } = input;
  const [
    rules,
    periods,
    sourceSummary,
    memberships,
    branches,
    staffLevels,
    serviceCategories,
    productCategories,
    packageCategories,
    services,
    products,
    packages,
  ] = await Promise.all([
    prisma.commissionRule.findMany({
      where: {
        businessId,
        ...(branchId ? { revisions: { some: { OR: [{ branchId: null }, { branchId }] } } } : {}),
      },
      include: {
        revisions: {
          ...(branchId ? { where: { OR: [{ branchId: null }, { branchId }] } } : {}),
          orderBy: { revision: "desc" },
          include: { branch: { select: { name: true } } },
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
    prisma.employeeBusinessMembership.findMany({
      where: { businessId, status: "ACTIVE" },
      select: { id: true, fullName: true, employeeCode: true },
      orderBy: { fullName: "asc" },
    }),
    prisma.branch.findMany({
      where: { businessId, ...(branchId ? { id: branchId } : {}) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.staffLevel.findMany({
      where: { businessId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.serviceCategory.findMany({
      where: { businessId },
      select: { id: true, name: true, status: true },
      orderBy: { name: "asc" },
    }),
    prisma.productCategory.findMany({
      where: { businessId },
      select: { id: true, name: true, status: true },
      orderBy: { name: "asc" },
    }),
    prisma.packageCategory.findMany({
      where: { businessId },
      select: { id: true, name: true, status: true },
      orderBy: { name: "asc" },
    }),
    prisma.service.findMany({
      where: { businessId },
      select: { id: true, name: true, status: true, categoryId: true },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({
      where: { businessId },
      select: { id: true, name: true, status: true, categoryId: true },
      orderBy: { name: "asc" },
    }),
    prisma.package.findMany({
      where: { businessId },
      select: { id: true, name: true, status: true, categoryId: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return {
    rules,
    periods,
    sourceSummary,
    memberships,
    branches,
    staffLevels,
    catalogs: {
      serviceCategories,
      productCategories,
      packageCategories,
      services,
      products,
      packages,
    },
  };
}

export async function getEmployeeCommissionStatements(input: {
  businessId: string;
  membershipId: string;
}, database: PrismaClient = prisma) {
  const currentStatements = await database.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT statement."id"
      FROM "commission_statements" AS statement
      INNER JOIN "commission_periods" AS period
        ON period."id" = statement."period_id"
       AND period."business_id" = statement."business_id"
      WHERE statement."business_id" = CAST(${input.businessId} AS uuid)
        AND statement."membership_id" = CAST(${input.membershipId} AS uuid)
        AND statement."calculation_revision" = period."current_revision"
    `,
  );

  if (!currentStatements.length) return [];

  return database.commissionStatement.findMany({
    where: {
      id: { in: currentStatements.map((statement) => statement.id) },
      businessId: input.businessId,
      membershipId: input.membershipId,
      status: { in: ["CALCULATED", "APPROVED", "APPLIED_TO_PAYROLL"] },
    },
    include: {
      period: { select: { id: true, earnedPeriodStart: true, earnedPeriodEnd: true, approvedAt: true, currentRevision: true } },
      accruals: {
        select: {
          eligibleAmountCents: true,
          commissionAmountCents: true,
          status: true,
          sourceEvent: { select: { sourceType: true, businessDate: true, grossAmountCents: true, netAmountCents: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      appliedAdjustments: {
        select: {
          type: true,
          eligibleAmountCents: true,
          commissionAmountCents: true,
          reason: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: [{ period: { earnedPeriodStart: "desc" } }, { createdAt: "desc" }],
  });
}
