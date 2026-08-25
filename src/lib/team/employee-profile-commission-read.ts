import { prisma } from "@/lib/prisma";

export async function loadEmployeeCommissionSection(input: {
  businessId: string;
  membershipId: string;
}) {
  const [membership, rules, statements, services, products, packages] =
    await Promise.all([
      prisma.employeeBusinessMembership.findFirst({
        where: { id: input.membershipId, businessId: input.businessId },
        select: {
          employeeCode: true,
          fullName: true,
          staffUser: { select: { staffLevel: { select: { name: true } } } },
        },
      }),
      prisma.commissionRule.findMany({
        where: {
          businessId: input.businessId,
          status: "ACTIVE",
          revisions: {
            some: { scope: "MEMBER", scopeId: input.membershipId },
          },
        },
        select: {
          id: true,
          name: true,
          sourceType: true,
          revisions: {
            where: { scope: "MEMBER", scopeId: input.membershipId },
            orderBy: { revision: "desc" },
            take: 1,
            select: {
              basis: true,
              effectiveFrom: true,
              effectiveUntil: true,
              fixedAmountCents: true,
              itemId: true,
              rateBasisPoints: true,
              revision: true,
              ruleType: true,
            },
          },
        },
        orderBy: { sourceType: "asc" },
      }),
      prisma.commissionStatement.findMany({
        where: {
          businessId: input.businessId,
          membershipId: input.membershipId,
          status: { in: ["CALCULATED", "APPROVED", "APPLIED_TO_PAYROLL"] },
        },
        select: {
          id: true,
          status: true,
          finalCommissionCents: true,
          eligibleSalesCents: true,
          period: {
            select: { earnedPeriodStart: true, earnedPeriodEnd: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 12,
      }),
      prisma.service.findMany({
        where: { businessId: input.businessId, status: "ACTIVE" },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.product.findMany({
        where: { businessId: input.businessId, status: "ACTIVE" },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.package.findMany({
        where: { businessId: input.businessId, status: "ACTIVE" },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);

  if (!membership) return null;

  const catalogItems = [
    ...services.map((item) => ({
      ...item,
      sourceType: "SERVICE" as const,
      typeLabel: "Service",
    })),
    ...products.map((item) => ({
      ...item,
      sourceType: "PRODUCT" as const,
      typeLabel: "Product",
    })),
    ...packages.map((item) => ({
      ...item,
      sourceType: "PACKAGE_PURCHASE" as const,
      typeLabel: "Package",
    })),
  ];
  const catalogName = new Map(
    catalogItems.map((item) => [`${item.sourceType}:${item.id}`, item.name]),
  );
  const resolvedRules = rules.flatMap((rule) => {
    const revision = rule.revisions[0];
    return revision ? [{ ...rule, revision }] : [];
  });

  return {
    employeeCode: membership.employeeCode,
    employeeName: membership.fullName,
    planName: membership.staffUser?.staffLevel?.name ?? null,
    overrides: resolvedRules.filter((rule) => rule.revision.itemId === null),
    itemOverrides: resolvedRules
      .filter((rule) => rule.revision.itemId !== null)
      .map((rule) => ({
        ...rule,
        itemName:
          catalogName.get(`${rule.sourceType}:${rule.revision.itemId}`) ??
          "Archived item",
      }))
      .sort(
        (left, right) =>
          left.sourceType.localeCompare(right.sourceType) ||
          left.itemName.localeCompare(right.itemName),
      ),
    catalogItems,
    statements,
  };
}

export type EmployeeCommissionSectionData = NonNullable<
  Awaited<ReturnType<typeof loadEmployeeCommissionSection>>
>;
