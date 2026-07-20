"use server";

import { isRedirectError } from "next/dist/client/components/redirect-error";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { prisma } from "@/lib/prisma";

const categorySchema = z.object({
  name: z.string().trim().min(2, "Category name is required."),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

const updateCategorySchema = categorySchema.extend({
  categoryId: z.string().uuid(),
});

export async function createPackageCategoryAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUser();
  assertStaffPermission(user, "PACKAGES");
  const returnPath = getCategoryReturnPath(formData);

  try {
    const input = categorySchema.parse({
      name: formData.get("name"),
      status: "ACTIVE",
    });

    const existing = await prisma.packageCategory.findFirst({
      where: {
        businessId,
        name: input.name,
      },
      select: { id: true },
    });

    if (existing) {
      redirectWithCategoryMessage(returnPath, "Category already exists.", "error");
    }

    await prisma.packageCategory.create({
      data: {
        businessId,
        name: input.name,
        status: "ACTIVE",
      },
    });

    revalidateCategoryPages();
    redirectWithCategoryMessage(returnPath, "Category created successfully.", "success");
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    redirectWithCategoryMessage(
      returnPath,
      getErrorMessage(error, "Unable to create category."),
      "error",
    );
  }
}

export async function updatePackageCategoryAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUser();
  assertStaffPermission(user, "PACKAGES");
  const returnPath = getCategoryReturnPath(formData);

  try {
    const input = updateCategorySchema.parse({
      categoryId: formData.get("categoryId"),
      name: formData.get("name"),
      status: formData.get("status"),
    });

    const category = await prisma.packageCategory.findFirst({
      where: {
        id: input.categoryId,
        businessId,
      },
      select: { id: true },
    });

    if (!category) {
      redirectWithCategoryMessage(returnPath, "Category not found.", "error");
    }

    const duplicate = await prisma.packageCategory.findFirst({
      where: {
        businessId,
        name: input.name,
        id: { not: input.categoryId },
      },
      select: { id: true },
    });

    if (duplicate) {
      redirectWithCategoryMessage(returnPath, "Category name already exists.", "error");
    }

    await prisma.packageCategory.update({
      where: { id: input.categoryId },
      data: {
        name: input.name,
        status: input.status,
      },
    });

    revalidateCategoryPages();
    redirectWithCategoryMessage(returnPath, "Category updated successfully.", "success");
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    redirectWithCategoryMessage(
      returnPath,
      getErrorMessage(error, "Unable to update category."),
      "error",
    );
  }
}

export async function deletePackageCategoryAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUser();
  assertStaffPermission(user, "PACKAGES");
  const returnPath = getCategoryReturnPath(formData);
  const categoryId = formData.get("categoryId")?.toString();

  if (!categoryId) {
    redirectWithCategoryMessage(returnPath, "Category is required.", "error");
  }

  const category = await prisma.packageCategory.findFirst({
    where: { id: categoryId, businessId },
    include: { _count: { select: { packages: true } } },
  });

  if (!category) {
    redirectWithCategoryMessage(returnPath, "Category not found.", "error");
  }

  if (category._count.packages > 0) {
    redirectWithCategoryMessage(
      returnPath,
      `Cannot delete this category because ${category._count.packages} package${category._count.packages === 1 ? "" : "s"} still use it. Move those packages first or set the category to Inactive.`,
      "error",
    );
  }

  await prisma.packageCategory.delete({ where: { id: category.id } });
  revalidateCategoryPages();
  redirectWithCategoryMessage(returnPath, "Category deleted successfully.", "success");
}

function revalidateCategoryPages() {
  revalidatePath("/packages");
  revalidatePath("/packages/categories");
  revalidatePath("/packages/new");
}

function getCategoryReturnPath(formData: FormData) {
  return formData.get("returnPath") === "/packages?modal=categories"
    ? "/packages?modal=categories"
    : "/packages?modal=categories";
}

function redirectWithCategoryMessage(
  returnPath: string,
  message: string,
  type: "success" | "error",
): never {
  const separator = returnPath.includes("?") ? "&" : "?";
  redirect(`${returnPath}${separator}type=${type}&message=${encodeURIComponent(message)}`);
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
