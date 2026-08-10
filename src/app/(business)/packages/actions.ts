"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { resolveBranchId } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { createCustomerPackageServiceBalances } from "@/lib/packages/service-balances";
import {
  packageSchema,
  packageServiceBenefitsSchema,
  purchasePackageSchema,
} from "@/lib/validation/packages";
import { money } from "@/lib/validation/services";

export type DeletePackageState = {
  status: "idle" | "success" | "error";
  message: string;
};

export async function createPackageAction(formData: FormData) {
  const { user, businessId, industryType } = await requireBusinessUserForModule("POS");
  assertStaffPermission(user, "PACKAGES");

  const branchId = await resolveBranchId(businessId, formData.get("branchId"));
  const benefits = parsePackageBenefits(formData, industryType === "SALON_BEAUTY");
  const aggregateUses = benefits.reduce((sum, benefit) => sum + benefit.totalUses, 0);
  const input = packageSchema.parse({
    name: formData.get("name"),
    categoryId: formData.get("categoryId") ?? "",
    description: formData.get("description"),
    serviceId:
      benefits.length === 1
        ? benefits[0].serviceId
        : (formData.get("serviceId") ?? ""),
    price: formData.get("price"),
    totalUses: benefits.length ? aggregateUses : formData.get("totalUses"),
    status: "ACTIVE",
  });

  const existing = await prisma.package.findFirst({
    where: {
      businessId,
      name: input.name,
    },
  });

  if (existing) {
    throw new Error("Package name already exists in this business.");
  }

  const resolvedBenefits = await resolvePackageBenefits(businessId, branchId, benefits);
  const serviceId = resolvedBenefits.length === 1
    ? resolvedBenefits[0].serviceId
    : await resolvePackageService({
        businessId,
        branchId,
        serviceId: input.serviceId || null,
        serviceRequired: false,
      });
  const persistedBenefits = resolvedBenefits.length
    ? resolvedBenefits
    : serviceId
      ? [{ serviceId, totalUses: input.totalUses }]
      : [];
  const category = await resolvePackageCategory(businessId, input.categoryId);

  const packagePlan = await prisma.package.create({
    data: {
      businessId,
      branchId,
      categoryId: category.id,
      serviceId,
      name: input.name,
      description: input.description || null,
      price: money(input.price),
      totalUses: input.totalUses,
      status: "ACTIVE",
      serviceBenefits: persistedBenefits.length
        ? {
            create: persistedBenefits.map((benefit) => ({
              businessId,
              serviceId: benefit.serviceId,
              totalUses: benefit.totalUses,
            })),
          }
        : undefined,
    },
  });

  revalidatePath("/packages");
  redirect(`/packages/${packagePlan.id}`);
}

export async function updatePackageAction(formData: FormData) {
  const { user, businessId, industryType } = await requireBusinessUserForModule("POS");
  assertStaffPermission(user, "PACKAGES");

  const branchId = await resolveBranchId(businessId, formData.get("branchId"));
  const packageId = formData.get("packageId")?.toString();

  if (!packageId) {
    throw new Error("Package id is required.");
  }

  const benefits = parsePackageBenefits(formData, industryType === "SALON_BEAUTY");
  const aggregateUses = benefits.reduce((sum, benefit) => sum + benefit.totalUses, 0);
  const input = packageSchema.parse({
    name: formData.get("name"),
    categoryId: formData.get("categoryId") ?? "",
    description: formData.get("description"),
    serviceId:
      benefits.length === 1
        ? benefits[0].serviceId
        : (formData.get("serviceId") ?? ""),
    price: formData.get("price"),
    totalUses: benefits.length ? aggregateUses : formData.get("totalUses"),
    status: formData.get("status"),
  });

  const packagePlan = await prisma.package.findFirstOrThrow({
    where: {
      id: packageId,
      businessId,
    },
  });

  const duplicate = await prisma.package.findFirst({
    where: {
      businessId,
      name: input.name,
      id: {
        not: packagePlan.id,
      },
    },
  });

  if (duplicate) {
    throw new Error("Package name already exists in this business.");
  }

  const resolvedBenefits = await resolvePackageBenefits(businessId, branchId, benefits);
  const serviceId = resolvedBenefits.length === 1
    ? resolvedBenefits[0].serviceId
    : await resolvePackageService({
        businessId,
        branchId,
        serviceId: input.serviceId || null,
        serviceRequired: false,
      });
  const persistedBenefits = resolvedBenefits.length
    ? resolvedBenefits
    : serviceId
      ? [{ serviceId, totalUses: input.totalUses }]
      : [];
  const category = await resolvePackageCategory(businessId, input.categoryId);

  await prisma.$transaction(async (tx) => {
    await tx.packageServiceBenefit.deleteMany({
      where: { packageId: packagePlan.id, businessId },
    });
    await tx.package.update({
      where: { id: packagePlan.id },
      data: {
        categoryId: category.id,
        serviceId,
        branchId,
        name: input.name,
        description: input.description || null,
        price: money(input.price),
        totalUses: input.totalUses,
        status: input.status,
        serviceBenefits: persistedBenefits.length
          ? {
              create: persistedBenefits.map((benefit) => ({
                businessId,
                serviceId: benefit.serviceId,
                totalUses: benefit.totalUses,
              })),
            }
          : undefined,
      },
    });
  });

  revalidatePath("/packages");
  revalidatePath(`/packages/${packagePlan.id}`);
  redirect("/packages");
}

async function resolvePackageCategory(
  businessId: string,
  categoryId: string,
) {
  return prisma.packageCategory.findFirstOrThrow({
    where: {
      id: categoryId,
      businessId,
    },
    select: {
      id: true,
    },
  });
}

async function resolvePackageService({
  businessId,
  branchId,
  serviceId,
  serviceRequired,
}: {
  businessId: string;
  branchId: string | null;
  serviceId: string | null;
  serviceRequired: boolean;
}) {
  if (!serviceId) {
    if (serviceRequired) {
      throw new Error("Select a linked service for this package.");
    }
    return null;
  }

  const service = await prisma.service.findFirst({
    where: {
      id: serviceId,
      businessId,
      status: "ACTIVE",
    },
    select: {
      id: true,
      branchId: true,
    },
  });

  if (!service) {
    throw new Error("The selected service is no longer available.");
  }

  if (service.branchId && service.branchId !== branchId) {
    throw new Error("The selected service is not available at this branch.");
  }

  return service.id;
}

function parsePackageBenefits(formData: FormData, required: boolean) {
  const serviceIds = formData
    .getAll("benefitServiceId")
    .map((value) => value.toString());
  const totalUses = formData.getAll("benefitTotalUses");

  if (!required && serviceIds.length === 0) return [];
  if (serviceIds.length !== totalUses.length) {
    throw new Error("Each included service must have a number of uses.");
  }

  return packageServiceBenefitsSchema.parse(
    serviceIds.map((serviceId, index) => ({ serviceId, totalUses: totalUses[index] })),
  );
}

async function resolvePackageBenefits(
  businessId: string,
  branchId: string | null,
  benefits: Array<{ serviceId: string; totalUses: number }>,
) {
  if (!benefits.length) return [];

  const services = await prisma.service.findMany({
    where: {
      businessId,
      id: { in: benefits.map((benefit) => benefit.serviceId) },
      status: "ACTIVE",
    },
    select: { id: true, branchId: true },
  });
  if (services.length !== benefits.length) {
    throw new Error("One or more included services are no longer available.");
  }
  if (services.some((service) => service.branchId && service.branchId !== branchId)) {
    throw new Error("One or more included services are not available at this branch.");
  }

  return benefits;
}

export async function deactivatePackageAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUserForModule("POS");
  assertStaffPermission(user, "PACKAGES");

  const packageId = formData.get("packageId")?.toString();

  if (!packageId) {
    throw new Error("Package id is required.");
  }

  const packagePlan = await prisma.package.findFirstOrThrow({
    where: {
      id: packageId,
      businessId,
    },
  });

  await prisma.package.update({
    where: { id: packagePlan.id },
    data: { status: "INACTIVE" },
  });

  revalidatePath("/packages");
}

export async function deletePackageAction(
  _previousState: DeletePackageState,
  formData: FormData,
): Promise<DeletePackageState> {
  const { user, businessId } = await requireBusinessUserForModule("POS");
  assertStaffPermission(user, "PACKAGES");

  const packageId = formData.get("packageId")?.toString();

  if (!packageId) {
    return {
      status: "error",
      message: "Package id is required.",
    };
  }

  const packagePlan = await prisma.package.findFirst({
    where: {
      id: packageId,
      businessId,
    },
    include: {
      _count: {
        select: {
          customerPackages: true,
        },
      },
    },
  });

  if (!packagePlan) {
    return {
      status: "error",
      message: "Package not found.",
    };
  }

  if (packagePlan._count.customerPackages > 0) {
    return {
      status: "error",
      message:
        "Cannot delete this package because customers have already purchased it. Set status to Inactive instead.",
    };
  }

  await prisma.package.delete({
    where: { id: packagePlan.id },
  });

  revalidatePath("/packages");
  redirect("/packages");
}

export async function purchasePackageAction(formData: FormData) {
  const { businessId } = await requireBusinessUserForModule("POS");
  const branchId = await resolveBranchId(businessId, formData.get("branchId"));
  const input = purchasePackageSchema.parse({
    customerId: formData.get("customerId"),
    packageId: formData.get("packageId"),
  });

  const [customer, packagePlan] = await Promise.all([
    prisma.customer.findFirstOrThrow({
      where: {
        id: input.customerId,
        businessId,
      },
    }),
    prisma.package.findFirstOrThrow({
      where: {
        id: input.packageId,
        businessId,
        status: "ACTIVE",
      },
      include: {
        serviceBenefits: { select: { serviceId: true, totalUses: true } },
      },
    }),
  ]);

  const customerPackage = await prisma.$transaction(async (tx) => {
    const created = await tx.customerPackage.create({
      data: {
        businessId,
        branchId,
        customerId: customer.id,
        packageId: packagePlan.id,
        purchasePrice: packagePlan.price,
        totalUses: packagePlan.totalUses,
        remainingUses: 0,
        status: "PENDING_PAYMENT",
      },
    });
    await createCustomerPackageServiceBalances(tx, {
      businessId,
      customerPackageId: created.id,
      packagePlan,
      active: false,
    });
    return created;
  });

  revalidatePath(`/crm/customers/${customer.id}`);
  revalidatePath("/pos");
  redirect(`/pos/packages/${customerPackage.id}`);
}
