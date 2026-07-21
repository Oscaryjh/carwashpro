"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { resolveBranchId } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { money, serviceSchema } from "@/lib/validation/services";

export type DeleteServiceState = {
  status: "idle" | "success" | "error";
  message: string;
};

export async function createServiceAction(formData: FormData) {
  const { user, businessId, industryType } = await requireBusinessUser();
  assertStaffPermission(user, "SERVICES");

  const branchId = await resolveBranchId(businessId, formData.get("branchId"));
  const input = serviceSchema.parse({
    name: formData.get("name"),
    categoryId: formData.get("categoryId") ?? "",
    category: formData.get("category") ?? "",
    description: formData.get("description") ?? "",
    price: formData.get("price"),
    taxable: formData.get("taxable") === "on",
    taxRate: formData.get("taxRate"),
    durationMinutes: formData.get("durationMinutes"),
    staffIds: formData.getAll("staffIds").map(String),
    status: "ACTIVE",
  });
  const category = await resolveServiceCategory(businessId, input.categoryId);
  const isSalonBusiness = industryType === "SALON_BEAUTY";

  if (isSalonBusiness && !input.durationMinutes) {
    throw new Error("Service duration is required for salon services.");
  }

  const staffIds = isSalonBusiness
    ? await resolveServiceStaff(businessId, input.staffIds)
    : [];

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

  const service = await prisma.$transaction(async (tx) => {
    const createdService = await tx.service.create({
      data: {
        businessId,
        branchId,
        name: input.name,
        categoryId: category.id,
        category: category.name,
        description: input.description || null,
        price: money(input.price),
        taxable: input.taxable,
        taxRate: input.taxRate == null ? null : money(input.taxRate),
        durationMinutes: isSalonBusiness ? input.durationMinutes : null,
        status: "ACTIVE",
      },
    });

    if (staffIds.length) {
      await tx.serviceStaffAssignment.createMany({
        data: staffIds.map((userId) => ({
          businessId,
          serviceId: createdService.id,
          userId,
        })),
      });
    }

    return createdService;
  });

  revalidatePath("/services");
  redirect(`/services/${service.id}`);
}

export async function updateServiceAction(formData: FormData) {
  const { user, businessId, industryType } = await requireBusinessUser();
  assertStaffPermission(user, "SERVICES");

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
    taxable: formData.get("taxable") === "on",
    taxRate: formData.get("taxRate"),
    durationMinutes: formData.get("durationMinutes"),
    staffIds: formData.getAll("staffIds").map(String),
    status: formData.get("status"),
  });
  const category = await resolveServiceCategory(businessId, input.categoryId);
  const isSalonBusiness = industryType === "SALON_BEAUTY";

  if (isSalonBusiness && !input.durationMinutes) {
    throw new Error("Service duration is required for salon services.");
  }

  const staffIds = isSalonBusiness
    ? await resolveServiceStaff(businessId, input.staffIds)
    : [];

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

  await prisma.$transaction(async (tx) => {
    await tx.service.update({
      where: { id: service.id },
      data: {
        name: input.name,
        branchId,
        categoryId: category.id,
        category: category.name,
        description: input.description || null,
        price: money(input.price),
        taxable: input.taxable,
        taxRate: input.taxRate == null ? null : money(input.taxRate),
        durationMinutes: isSalonBusiness ? input.durationMinutes : null,
        status: input.status,
      },
    });

    if (isSalonBusiness) {
      await tx.serviceStaffAssignment.deleteMany({
        where: { businessId, serviceId: service.id },
      });

      if (staffIds.length) {
        await tx.serviceStaffAssignment.createMany({
          data: staffIds.map((userId) => ({
            businessId,
            serviceId: service.id,
            userId,
          })),
        });
      }
    }
  });

  revalidatePath("/services");
  revalidatePath(`/services/${service.id}`);
  redirect("/services");
}

async function resolveServiceCategory(
  businessId: string,
  categoryId: string,
) {
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

async function resolveServiceStaff(businessId: string, requestedIds: string[]) {
  const staffIds = [...new Set(requestedIds)];

  if (!staffIds.length) {
    return [];
  }

  const users = await prisma.user.findMany({
    where: {
      id: { in: staffIds },
      businessId,
      status: "active",
      appointmentBookable: true,
      role: { in: ["BUSINESS_OWNER", "STAFF"] },
    },
    select: { id: true },
  });

  if (users.length !== staffIds.length) {
    throw new Error("One or more selected staff members are invalid.");
  }

  return users.map((user) => user.id);
}

export async function deactivateServiceAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUser();
  assertStaffPermission(user, "SERVICES");

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
  assertStaffPermission(user, "SERVICES");

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
          packageBenefits: true,
          packageBalances: true,
          appointments: true,
          invoiceItems: true,
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

  const hasHistoricalUsage =
    service._count.items > 0 ||
    service._count.packages > 0 ||
    service._count.packageBenefits > 0 ||
    service._count.packageBalances > 0 ||
    service._count.appointments > 0 ||
    service._count.invoiceItems > 0;

  if (hasHistoricalUsage) {
    return {
      status: "error",
      message:
        "Cannot delete this service because it has existing appointments, invoices, work orders, or package records. Set status to Inactive instead.",
    };
  }

  await prisma.service.delete({
    where: { id: service.id },
  });

  revalidatePath("/services");
  redirect("/services");
}
