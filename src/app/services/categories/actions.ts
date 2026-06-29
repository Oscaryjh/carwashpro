"use server";

import { isRedirectError } from "next/dist/client/components/redirect-error";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertRole } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";

const categorySchema = z.object({
  name: z.string().trim().min(2, "Category name is required."),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

const updateCategorySchema = categorySchema.extend({
  categoryId: z.string().uuid(),
});

export async function createServiceCategoryAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUser();
  assertRole(user, ["BUSINESS_OWNER"]);

  try {
    const input = categorySchema.parse({
      name: formData.get("name"),
      status: "ACTIVE",
    });

    const existing = await prisma.serviceCategory.findFirst({
      where: {
        businessId,
        name: input.name,
      },
      select: { id: true },
    });

    if (existing) {
      redirectWithCategoryMessage("Category already exists.", "error");
    }

    await prisma.serviceCategory.create({
      data: {
        businessId,
        name: input.name,
        status: "ACTIVE",
      },
    });

    revalidateCategoryPages();
    redirectWithCategoryMessage("Category created successfully.", "success");
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    redirectWithCategoryMessage(getErrorMessage(error, "Unable to create category."), "error");
  }
}

export async function updateServiceCategoryAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUser();
  assertRole(user, ["BUSINESS_OWNER"]);

  try {
    const input = updateCategorySchema.parse({
      categoryId: formData.get("categoryId"),
      name: formData.get("name"),
      status: formData.get("status"),
    });

    const category = await prisma.serviceCategory.findFirst({
      where: {
        id: input.categoryId,
        businessId,
      },
      select: { id: true },
    });

    if (!category) {
      redirectWithCategoryMessage("Category not found.", "error");
    }

    const duplicate = await prisma.serviceCategory.findFirst({
      where: {
        businessId,
        name: input.name,
        id: { not: input.categoryId },
      },
      select: { id: true },
    });

    if (duplicate) {
      redirectWithCategoryMessage("Category name already exists.", "error");
    }

    await prisma.$transaction([
      prisma.serviceCategory.update({
        where: { id: input.categoryId },
        data: {
          name: input.name,
          status: input.status,
        },
      }),
      prisma.service.updateMany({
        where: {
          businessId,
          categoryId: input.categoryId,
        },
        data: { category: input.name },
      }),
    ]);

    revalidateCategoryPages();
    redirectWithCategoryMessage("Category updated successfully.", "success");
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    redirectWithCategoryMessage(getErrorMessage(error, "Unable to update category."), "error");
  }
}

function revalidateCategoryPages() {
  revalidatePath("/services");
  revalidatePath("/services/categories");
  revalidatePath("/services/new");
  revalidatePath("/work-orders/new");
}

function redirectWithCategoryMessage(message: string, type: "success" | "error"): never {
  redirect(`/services/categories?type=${type}&message=${encodeURIComponent(message)}`);
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof z.ZodError) {
    return error.errors[0]?.message ?? fallback;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
}
