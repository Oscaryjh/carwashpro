"use server";

import { isRedirectError } from "next/dist/client/components/redirect-error";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { prisma } from "@/lib/prisma";
import { catalogDiscountSchema } from "@/lib/validation/catalog-discounts";

function redirectWithMessage(type: "error" | "success", message: string) {
  redirect(`/discounts?type=${type}&message=${encodeURIComponent(message)}`);
}

function readInput(formData: FormData) {
  return catalogDiscountSchema.parse({
    name: formData.get("name"),
    discountType: formData.get("discountType"),
    percentage: formData.get("percentage"),
    fixedAmount: formData.get("fixedAmount"),
    scope: formData.get("scope"),
    branchId: formData.get("branchId")?.toString() || "",
    minimumSpend: formData.get("minimumSpend"),
    maximumDiscount: formData.get("maximumDiscount"),
    allowLoyaltyStacking: formData.get("allowLoyaltyStacking") === "on",
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
    active: formData.get("active") === "on",
  });
}

async function validateBranch(businessId: string, branchId?: string) {
  if (!branchId) return null;
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, businessId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!branch) throw new Error("The selected branch is no longer active.");
  return branch.id;
}

export async function createCatalogDiscountAction(formData: FormData) {
  try {
    const { user, businessId } = await requireBusinessUser();
    assertStaffPermission(user, "DISCOUNTS");
    const input = readInput(formData);
    const branchId = await validateBranch(businessId, input.branchId);

    await prisma.catalogDiscount.create({
      data: {
        businessId,
        branchId,
        name: input.name,
        discountType: input.discountType,
        percentage: input.discountType === "PERCENTAGE" ? input.percentage : null,
        fixedAmount: input.discountType === "FIXED_AMOUNT" ? input.fixedAmount : null,
        scope: input.scope,
        minimumSpend: input.minimumSpend,
        maximumDiscount: input.discountType === "PERCENTAGE" ? input.maximumDiscount ?? null : null,
        allowLoyaltyStacking: input.allowLoyaltyStacking,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        active: input.active,
      },
    });
    revalidatePath("/discounts");
    redirectWithMessage("success", "Discount created successfully.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage(
      "error",
      error instanceof Error && error.message.includes("Unique constraint")
        ? "A discount with this name already exists."
        : error instanceof Error ? error.message : "Unable to create discount.",
    );
  }
}

export async function updateCatalogDiscountAction(formData: FormData) {
  try {
    const { user, businessId } = await requireBusinessUser();
    assertStaffPermission(user, "DISCOUNTS");
    const discountId = formData.get("discountId")?.toString();
    if (!discountId) throw new Error("Discount is required.");
    const input = readInput(formData);
    const branchId = await validateBranch(businessId, input.branchId);

    const updated = await prisma.catalogDiscount.updateMany({
      where: { id: discountId, businessId },
      data: {
        branchId,
        name: input.name,
        discountType: input.discountType,
        percentage: input.discountType === "PERCENTAGE" ? input.percentage : null,
        fixedAmount: input.discountType === "FIXED_AMOUNT" ? input.fixedAmount : null,
        scope: input.scope,
        minimumSpend: input.minimumSpend,
        maximumDiscount: input.discountType === "PERCENTAGE" ? input.maximumDiscount ?? null : null,
        allowLoyaltyStacking: input.allowLoyaltyStacking,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        active: input.active,
      },
    });
    if (updated.count !== 1) throw new Error("Discount could not be found.");
    revalidatePath("/discounts");
    redirectWithMessage("success", "Discount updated successfully.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("error", error instanceof Error ? error.message : "Unable to update discount.");
  }
}

export async function deleteCatalogDiscountAction(formData: FormData) {
  try {
    const { user, businessId } = await requireBusinessUser();
    assertStaffPermission(user, "DISCOUNTS");
    const discountId = formData.get("discountId")?.toString();
    if (!discountId) throw new Error("Discount is required.");
    const deleted = await prisma.catalogDiscount.deleteMany({ where: { id: discountId, businessId } });
    if (deleted.count !== 1) throw new Error("Discount could not be found.");
    revalidatePath("/discounts");
    redirectWithMessage("success", "Discount deleted.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("error", error instanceof Error ? error.message : "Unable to delete discount.");
  }
}
