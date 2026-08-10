"use server";

import { isRedirectError } from "next/dist/client/components/redirect-error";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { prisma } from "@/lib/prisma";

const categorySchema = z.object({
  name: z.string().trim().min(2, "Category name is required."),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

const updateCategorySchema = categorySchema.extend({
  categoryId: z.string().uuid(),
});

export async function createProductCategoryAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUserForModule("POS");
  assertStaffPermission(user, "PRODUCTS");
  const returnPath = getCategoryReturnPath(formData);

  try {
    const input = categorySchema.parse({ name: formData.get("name"), status: "ACTIVE" });
    const existing = await prisma.productCategory.findFirst({
      where: { businessId, name: input.name },
      select: { id: true },
    });

    if (existing) redirectWithCategoryMessage(returnPath, "Category already exists.", "error");

    await prisma.productCategory.create({
      data: { businessId, name: input.name, status: "ACTIVE" },
    });

    revalidateCategoryPages();
    redirectWithCategoryMessage(returnPath, "Category created successfully.", "success");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithCategoryMessage(
      returnPath,
      getErrorMessage(error, "Unable to create category."),
      "error",
    );
  }
}

export async function updateProductCategoryAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUserForModule("POS");
  assertStaffPermission(user, "PRODUCTS");
  const returnPath = getCategoryReturnPath(formData);

  try {
    const input = updateCategorySchema.parse({
      categoryId: formData.get("categoryId"),
      name: formData.get("name"),
      status: formData.get("status"),
    });
    const category = await prisma.productCategory.findFirst({
      where: { id: input.categoryId, businessId },
      select: { id: true },
    });

    if (!category) redirectWithCategoryMessage(returnPath, "Category not found.", "error");

    const duplicate = await prisma.productCategory.findFirst({
      where: { businessId, name: input.name, id: { not: input.categoryId } },
      select: { id: true },
    });

    if (duplicate) redirectWithCategoryMessage(returnPath, "Category name already exists.", "error");

    await prisma.$transaction([
      prisma.productCategory.update({
        where: { id: input.categoryId },
        data: { name: input.name, status: input.status },
      }),
      prisma.product.updateMany({
        where: { businessId, categoryId: input.categoryId },
        data: { category: input.name },
      }),
    ]);

    revalidateCategoryPages();
    redirectWithCategoryMessage(returnPath, "Category updated successfully.", "success");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithCategoryMessage(
      returnPath,
      getErrorMessage(error, "Unable to update category."),
      "error",
    );
  }
}

export async function deleteProductCategoryAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUserForModule("POS");
  assertStaffPermission(user, "PRODUCTS");
  const returnPath = getCategoryReturnPath(formData);
  const categoryId = formData.get("categoryId")?.toString();

  if (!categoryId) {
    redirectWithCategoryMessage(returnPath, "Category is required.", "error");
  }

  const category = await prisma.productCategory.findFirst({
    where: { id: categoryId, businessId },
    include: { _count: { select: { products: true } } },
  });

  if (!category) {
    redirectWithCategoryMessage(returnPath, "Category not found.", "error");
  }

  if (category._count.products > 0) {
    redirectWithCategoryMessage(
      returnPath,
      `Cannot delete this category because ${category._count.products} product${category._count.products === 1 ? "" : "s"} still use it. Move those products first or set the category to Inactive.`,
      "error",
    );
  }

  await prisma.productCategory.delete({ where: { id: category.id } });
  revalidateCategoryPages();
  redirectWithCategoryMessage(returnPath, "Category deleted successfully.", "success");
}

function revalidateCategoryPages() {
  revalidatePath("/products");
  revalidatePath("/products/categories");
  revalidatePath("/products/new");
  revalidatePath("/cashier");
  revalidatePath("/work-orders");
}

function getCategoryReturnPath(formData: FormData) {
  return formData.get("returnPath") === "/products?modal=categories"
    ? "/products?modal=categories"
    : "/products?modal=categories";
}

function redirectWithCategoryMessage(
  returnPath: string,
  message: string,
  type: "error" | "success",
): never {
  const separator = returnPath.includes("?") ? "&" : "?";
  redirect(`${returnPath}${separator}type=${type}&message=${encodeURIComponent(message)}`);
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof z.ZodError) return error.errors[0]?.message ?? fallback;
  if (error instanceof Error) return error.message;
  return fallback;
}
