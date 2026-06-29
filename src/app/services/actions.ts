"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertRole } from "@/lib/auth/permissions";
import { resolveBranchId } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { money, serviceSchema } from "@/lib/validation/services";

export type DeleteServiceState = {
  status: "idle" | "success" | "error";
  message: string;
};

export async function createServiceAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUser();
  assertRole(user, ["BUSINESS_OWNER"]);

  const branchId = await resolveBranchId(businessId, formData.get("branchId"));
  const input = serviceSchema.parse({
    name: formData.get("name"),
    categoryId: formData.get("categoryId") ?? "",
    category: formData.get("category") ?? "",
    description: formData.get("description") ?? "",
    price: formData.get("price"),
    status: "ACTIVE",
  });
  const category = await resolveServiceCategory(businessId, input.categoryId);

  const existing = await prisma.service.findFirst({
    where: {
      businessId,
      branchId,
      name: input.name,
    },
  });

  if (existing) {
    throw new Error("Service name already exists in this business.");
  }

  const service = await prisma.service.create({
    data: {
      businessId,
      branchId,
      name: input.name,
      categoryId: category?.id ?? null,
      category: (category?.name ?? input.category) || null,
      description: input.description || null,
      price: money(input.price),
      status: "ACTIVE",
    },
  });

  revalidatePath("/services");
  redirect(`/services/${service.id}`);
}

export async function updateServiceAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUser();
  assertRole(user, ["BUSINESS_OWNER"]);

  const branchId = await resolveBranchId(businessId, formData.get("branchId"));
  const serviceId = formData.get("serviceId")?.toString();

  if (!serviceId) {
    throw new Error("Service id is required.");
  }

  const input = serviceSchema.parse({
    name: formData.get("name"),
    categoryId: formData.get("categoryId") ?? "",
    category: formData.get("category") ?? "",
    description: formData.get("description") ?? "",
    price: formData.get("price"),
    status: formData.get("status"),
  });
  const category = await resolveServiceCategory(businessId, input.categoryId);

  const service = await prisma.service.findFirstOrThrow({
    where: {
      id: serviceId,
      businessId,
    },
  });

  const duplicate = await prisma.service.findFirst({
    where: {
      businessId,
      name: input.name,
      id: {
        not: service.id,
      },
    },
  });

  if (duplicate) {
    throw new Error("Service name already exists in this business.");
  }

  await prisma.service.update({
    where: { id: service.id },
    data: {
      name: input.name,
      branchId,
      categoryId: category?.id ?? null,
      category: (category?.name ?? input.category) || null,
      description: input.description || null,
      price: money(input.price),
      status: input.status,
    },
  });

  revalidatePath("/services");
  revalidatePath(`/services/${service.id}`);
  redirect("/services");
}

async function resolveServiceCategory(
  businessId: string,
  categoryId: string | undefined,
) {
  if (!categoryId) {
    return null;
  }

  return prisma.serviceCategory.findFirstOrThrow({
    where: {
      id: categoryId,
      businessId,
    },
    select: {
      id: true,
      name: true,
    },
  });
}

export async function deactivateServiceAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUser();
  assertRole(user, ["BUSINESS_OWNER"]);

  const serviceId = formData.get("serviceId")?.toString();

  if (!serviceId) {
    throw new Error("Service id is required.");
  }

  const service = await prisma.service.findFirstOrThrow({
    where: {
      id: serviceId,
      businessId,
    },
  });

  await prisma.service.update({
    where: { id: service.id },
    data: { status: "INACTIVE" },
  });

  revalidatePath("/services");
  revalidatePath(`/services/${service.id}`);
  redirect(`/services/${service.id}`);
}

export async function deleteServiceAction(
  _previousState: DeleteServiceState,
  formData: FormData,
): Promise<DeleteServiceState> {
  const { user, businessId } = await requireBusinessUser();
  assertRole(user, ["BUSINESS_OWNER"]);

  const serviceId = formData.get("serviceId")?.toString();

  if (!serviceId) {
    return {
      status: "error",
      message: "Service id is required.",
    };
  }

  const service = await prisma.service.findFirst({
    where: {
      id: serviceId,
      businessId,
    },
    include: {
      _count: {
        select: {
          items: true,
          packages: true,
        },
      },
    },
  });

  if (!service) {
    return {
      status: "error",
      message: "Service not found.",
    };
  }

  if (service._count.items > 0 || service._count.packages > 0) {
    return {
      status: "error",
      message:
        "Cannot delete this service because it is already used by work orders or packages. Deactivate it instead.",
    };
  }

  await prisma.service.delete({
    where: { id: service.id },
  });

  revalidatePath("/services");
  redirect("/services");
}
