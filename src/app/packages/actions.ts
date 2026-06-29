"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertRole } from "@/lib/auth/permissions";
import { resolveBranchId } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { packageSchema, purchasePackageSchema } from "@/lib/validation/packages";
import { money } from "@/lib/validation/services";

export type DeletePackageState = {
  status: "idle" | "success" | "error";
  message: string;
};

export async function createPackageAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUser();
  assertRole(user, ["BUSINESS_OWNER"]);

  const branchId = await resolveBranchId(businessId, formData.get("branchId"));
  const input = packageSchema.parse({
    name: formData.get("name"),
    categoryId: formData.get("categoryId") ?? "",
    description: formData.get("description"),
    serviceId: formData.get("serviceId"),
    price: formData.get("price"),
    totalUses: formData.get("totalUses"),
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

  const serviceId = input.serviceId || null;
  const category = await resolvePackageCategory(businessId, input.categoryId);

  if (serviceId) {
    await prisma.service.findFirstOrThrow({
      where: {
        id: serviceId,
        businessId,
      },
    });
  }

  const packagePlan = await prisma.package.create({
    data: {
      businessId,
      branchId,
      categoryId: category?.id ?? null,
      serviceId,
      name: input.name,
      description: input.description || null,
      price: money(input.price),
      totalUses: input.totalUses,
      status: "ACTIVE",
    },
  });

  revalidatePath("/packages");
  redirect(`/packages/${packagePlan.id}`);
}

export async function updatePackageAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUser();
  assertRole(user, ["BUSINESS_OWNER"]);

  const branchId = await resolveBranchId(businessId, formData.get("branchId"));
  const packageId = formData.get("packageId")?.toString();

  if (!packageId) {
    throw new Error("Package id is required.");
  }

  const input = packageSchema.parse({
    name: formData.get("name"),
    categoryId: formData.get("categoryId") ?? "",
    description: formData.get("description"),
    serviceId: formData.get("serviceId"),
    price: formData.get("price"),
    totalUses: formData.get("totalUses"),
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

  const serviceId = input.serviceId || null;
  const category = await resolvePackageCategory(businessId, input.categoryId);

  if (serviceId) {
    await prisma.service.findFirstOrThrow({
      where: {
        id: serviceId,
        businessId,
      },
    });
  }

  await prisma.package.update({
    where: { id: packagePlan.id },
    data: {
      categoryId: category?.id ?? null,
      serviceId,
      branchId,
      name: input.name,
      description: input.description || null,
      price: money(input.price),
      totalUses: input.totalUses,
      status: input.status,
    },
  });

  revalidatePath("/packages");
  revalidatePath(`/packages/${packagePlan.id}`);
  redirect("/packages");
}

async function resolvePackageCategory(
  businessId: string,
  categoryId: string | undefined,
) {
  if (!categoryId) {
    return null;
  }

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

export async function deactivatePackageAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUser();
  assertRole(user, ["BUSINESS_OWNER"]);

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
  const { user, businessId } = await requireBusinessUser();
  assertRole(user, ["BUSINESS_OWNER"]);

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
  const { businessId } = await requireBusinessUser();
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
    }),
  ]);

  const customerPackage = await prisma.customerPackage.create({
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

  revalidatePath(`/crm/customers/${customer.id}`);
  revalidatePath("/pos");
  redirect(`/pos/packages/${customerPackage.id}`);
}
