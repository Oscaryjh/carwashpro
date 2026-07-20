import type { Prisma } from "@prisma/client";

export type PackageBenefitDefinition = {
  serviceId: string | null;
  totalUses: number;
  serviceBenefits?: Array<{ serviceId: string; totalUses: number }>;
};

export function getPackageBenefitDefinitions(packagePlan: PackageBenefitDefinition) {
  if (packagePlan.serviceBenefits?.length) {
    return packagePlan.serviceBenefits.map((benefit) => ({
      serviceId: benefit.serviceId,
      totalUses: benefit.totalUses,
    }));
  }

  return packagePlan.serviceId
    ? [{ serviceId: packagePlan.serviceId, totalUses: packagePlan.totalUses }]
    : [];
}

export async function createCustomerPackageServiceBalances(
  tx: Prisma.TransactionClient,
  input: {
    businessId: string;
    customerPackageId: string;
    packagePlan: PackageBenefitDefinition;
    active: boolean;
  },
) {
  const benefits = getPackageBenefitDefinitions(input.packagePlan);
  if (!benefits.length) return [];

  await tx.customerPackageServiceBalance.createMany({
    data: benefits.map((benefit) => ({
      businessId: input.businessId,
      customerPackageId: input.customerPackageId,
      serviceId: benefit.serviceId,
      totalUses: benefit.totalUses,
      remainingUses: input.active ? benefit.totalUses : 0,
    })),
  });

  return benefits;
}

export async function activateCustomerPackageServiceBalances(
  tx: Prisma.TransactionClient,
  customerPackageId: string,
) {
  const balances = await tx.customerPackageServiceBalance.findMany({
    where: { customerPackageId },
    select: { id: true, totalUses: true },
  });
  await Promise.all(
    balances.map((balance) =>
      tx.customerPackageServiceBalance.update({
        where: { id: balance.id },
        data: { remainingUses: balance.totalUses },
      }),
    ),
  );
}

export async function clearCustomerPackageServiceBalances(
  tx: Prisma.TransactionClient,
  customerPackageIds: string[],
) {
  if (!customerPackageIds.length) return;
  await tx.customerPackageServiceBalance.updateMany({
    where: { customerPackageId: { in: customerPackageIds } },
    data: { remainingUses: 0 },
  });
}
