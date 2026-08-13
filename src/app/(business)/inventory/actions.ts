"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { resolveOperationalBranchId } from "@/lib/branches";
import {
  runManualInventoryMovement,
  transferInventory,
} from "@/lib/inventory/service";

const movementSchema = z.object({
  branchId: z.string().uuid(),
  expectedRevision: z.coerce.number().int().min(0).optional(),
  operationKey: z.string().trim().min(16).max(160),
  productId: z.string().uuid(),
  quantity: z.coerce.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
  reference: z.string().trim().max(120).optional(),
});

const transferSchema = movementSchema.omit({ branchId: true, expectedRevision: true }).extend({
  destinationBranchId: z.string().uuid(),
  sourceBranchId: z.string().uuid(),
});

export async function stockInAction(formData: FormData) {
  return runMovementAction(formData, "STOCK_IN", 1, "MANAGE_INVENTORY");
}

export async function stockOutAction(formData: FormData) {
  return runMovementAction(formData, "STOCK_OUT", -1, "MANAGE_INVENTORY");
}

export async function adjustInventoryAction(formData: FormData) {
  const rawDelta = Number(formData.get("delta"));
  if (!Number.isInteger(rawDelta) || rawDelta === 0) {
    inventoryRedirect("error", "Adjustment delta must be a non-zero whole number.");
  }
  const normalized = new FormData();
  for (const [key, value] of formData.entries()) normalized.append(key, value);
  normalized.set("quantity", String(Math.abs(rawDelta)));
  return runMovementAction(
    normalized,
    rawDelta > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
    rawDelta > 0 ? 1 : -1,
    "ADJUST_INVENTORY",
  );
}

export async function transferInventoryAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUserForModule("INVENTORY", "TRANSFER_INVENTORY");
  const parsed = transferSchema.safeParse({
    destinationBranchId: formData.get("destinationBranchId"),
    operationKey: formData.get("operationKey"),
    productId: formData.get("productId"),
    quantity: formData.get("quantity"),
    reason: formData.get("reason"),
    reference: formData.get("reference")?.toString() || undefined,
    sourceBranchId: formData.get("sourceBranchId"),
  });
  if (!parsed.success) inventoryRedirect("error", parsed.error.issues[0]?.message ?? "Invalid transfer.");
  try {
    const sourceBranchId = await resolveOperationalBranchId(businessId, user, parsed.data.sourceBranchId);
    if (!sourceBranchId) throw new Error("Source branch is required.");
    let destinationBranchId: string;
    if (user.role === "BUSINESS_OWNER") {
      const destination = await resolveOperationalBranchId(businessId, user, parsed.data.destinationBranchId);
      if (!destination) throw new Error("Destination branch is required.");
      destinationBranchId = destination;
    } else {
      throw new Error("Branch transfers require whole-business branch access.");
    }
    await transferInventory({
      actorUserId: user.userId,
      businessId,
      destinationBranchId,
      operationKey: parsed.data.operationKey,
      productId: parsed.data.productId,
      quantity: parsed.data.quantity,
      reason: parsed.data.reason,
      reference: parsed.data.reference,
      sourceBranchId,
    });
  } catch (error) {
    inventoryRedirect("error", error instanceof Error ? error.message : "Unable to transfer stock.");
  }
  refreshInventory();
  inventoryRedirect("success", "Branch transfer completed atomically.");
}

async function runMovementAction(
  formData: FormData,
  type: "STOCK_IN" | "STOCK_OUT" | "ADJUSTMENT_IN" | "ADJUSTMENT_OUT",
  direction: 1 | -1,
  capability: "MANAGE_INVENTORY" | "ADJUST_INVENTORY",
) {
  const { businessId, user } = await requireBusinessUserForModule("INVENTORY", capability);
  const parsed = movementSchema.safeParse({
    branchId: formData.get("branchId"),
    expectedRevision: formData.get("expectedRevision")?.toString() || undefined,
    operationKey: formData.get("operationKey"),
    productId: formData.get("productId"),
    quantity: formData.get("quantity"),
    reason: formData.get("reason"),
    reference: formData.get("reference")?.toString() || undefined,
  });
  if (!parsed.success) inventoryRedirect("error", parsed.error.issues[0]?.message ?? "Invalid inventory movement.");
  try {
    const branchId = await resolveOperationalBranchId(businessId, user, parsed.data.branchId);
    if (!branchId) throw new Error("Branch is required.");
    await runManualInventoryMovement({
      actorUserId: user.userId,
      branchId,
      businessId,
      expectedRevision: parsed.data.expectedRevision,
      operationKey: parsed.data.operationKey,
      productId: parsed.data.productId,
      quantityDelta: direction * parsed.data.quantity,
      reason: parsed.data.reason,
      reference: parsed.data.reference,
      sourceId: parsed.data.operationKey,
      sourceType: "MANUAL_COMMAND",
      type,
    });
  } catch (error) {
    inventoryRedirect("error", error instanceof Error ? error.message : "Unable to record inventory movement.");
  }
  refreshInventory();
  inventoryRedirect("success", "Inventory movement recorded.");
}

function refreshInventory() {
  revalidatePath("/inventory");
  revalidatePath("/inventory/movements");
  revalidatePath("/cashier");
  revalidatePath("/products");
}

function inventoryRedirect(type: "error" | "success", message: string): never {
  redirect(`/inventory?type=${type}&message=${encodeURIComponent(message)}`);
}
