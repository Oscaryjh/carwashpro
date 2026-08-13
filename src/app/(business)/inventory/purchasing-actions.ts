"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { resolveOperationalBranchId } from "@/lib/branches";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  closePurchaseOrder,
  createPurchaseOrder,
  createSupplier,
  mapPurchasingError,
  receivePurchaseOrder,
  reverseGoodsReceiptLine,
  updatePurchaseOrder,
  updateSupplier,
} from "@/lib/inventory/purchasing-service";
import { prisma } from "@/lib/prisma";

const supplierSchema = z.object({
  address: z.string().trim().max(1000).optional(),
  code: z.string().trim().max(40).optional(),
  contactPerson: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(160).optional().or(z.literal("")),
  name: z.string().trim().min(2).max(160),
  notes: z.string().trim().max(2000).optional(),
  operationKey: z.string().min(16).max(180),
  phone: z.string().trim().max(40).optional(),
});

const poLineSchema = z.array(z.object({
  expectedUnitCost: z.coerce.number().nonnegative(),
  notes: z.string().max(500).optional().nullable(),
  orderedQuantity: z.coerce.number().int().positive(),
  productId: z.string().uuid(),
})).min(1).max(100);

export async function createSupplierAction(formData: FormData) {
  const context = await requireBusinessUserForModule("INVENTORY", "MANAGE_SUPPLIERS");
  const parsed = supplierSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) purchasingRedirect("/inventory/suppliers", "error", parsed.error.issues[0]?.message ?? "Invalid supplier.");
  let supplierId: string;
  try {
    supplierId = (await createSupplier({ actor: actor(context.user), businessId: context.businessId, ...parsed.data })).id;
  } catch (error) {
    purchasingRedirect("/inventory/suppliers", "error", mapPurchasingError(error));
  }
  refresh();
  purchasingRedirect(`/inventory/suppliers/${supplierId}`, "success", "Supplier created.");
}

export async function updateSupplierAction(formData: FormData) {
  const context = await requireBusinessUserForModule("INVENTORY", "MANAGE_SUPPLIERS");
  const parsed = supplierSchema.extend({ status: z.enum(["ACTIVE", "INACTIVE"]), supplierId: z.string().uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) purchasingRedirect("/inventory/suppliers", "error", parsed.error.issues[0]?.message ?? "Invalid supplier.");
  try {
    await updateSupplier({ actor: actor(context.user), businessId: context.businessId, ...parsed.data });
  } catch (error) {
    purchasingRedirect(`/inventory/suppliers/${parsed.data.supplierId}`, "error", mapPurchasingError(error));
  }
  refresh();
  purchasingRedirect(`/inventory/suppliers/${parsed.data.supplierId}`, "success", "Supplier updated.");
}

export async function createPurchaseOrderAction(formData: FormData) {
  const context = await requireBusinessUserForModule("INVENTORY", "CREATE_PURCHASE_ORDER");
  const parsed = z.object({ branchId: z.string().uuid(), expectedDate: z.string().optional(), lines: z.string(), notes: z.string().max(2000).optional(), operationKey: z.string().min(16).max(180), orderDate: z.string().min(1), supplierId: z.string().uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) purchasingRedirect("/inventory/purchase-orders/new", "error", parsed.error.issues[0]?.message ?? "Invalid purchase order.");
  const lines = parseLines(parsed.data.lines, "/inventory/purchase-orders/new");
  let purchaseOrderId: string;
  try {
    const branchId = await resolveOperationalBranchId(context.businessId, context.user, parsed.data.branchId);
    if (!branchId) throw new Error("An authorised branch is required.");
    purchaseOrderId = (await createPurchaseOrder({ actor: actor(context.user), branchId, businessId: context.businessId, expectedDate: parsed.data.expectedDate ? new Date(`${parsed.data.expectedDate}T00:00:00Z`) : null, lines, notes: parsed.data.notes, operationKey: parsed.data.operationKey, orderDate: new Date(`${parsed.data.orderDate}T00:00:00Z`), supplierId: parsed.data.supplierId })).id;
  } catch (error) {
    purchasingRedirect("/inventory/purchase-orders/new", "error", mapPurchasingError(error));
  }
  refresh();
  purchasingRedirect(`/inventory/purchase-orders/${purchaseOrderId}`, "success", "Draft purchase order created; stock unchanged.");
}

export async function approvePurchaseOrderAction(formData: FormData) {
  return poTransition(formData, "APPROVE_PURCHASE_ORDER", async (context, values) => approvePurchaseOrder({ actor: actor(context.user), businessId: context.businessId, expectedRevision: values.expectedRevision, operationKey: values.operationKey, purchaseOrderId: values.purchaseOrderId }), "Purchase order approved; stock unchanged.");
}

export async function updatePurchaseOrderAction(formData: FormData) {
  const context = await requireBusinessUserForModule("INVENTORY", "CREATE_PURCHASE_ORDER");
  const parsed = z.object({ expectedDate: z.string().optional(), expectedRevision: z.coerce.number().int().min(0), lines: z.string(), notes: z.string().max(2000).optional(), operationKey: z.string().min(16).max(180), orderDate: z.string().min(1), purchaseOrderId: z.string().uuid(), supplierId: z.string().uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) purchasingRedirect("/inventory/purchase-orders", "error", parsed.error.issues[0]?.message ?? "Invalid purchase order.");
  const path = `/inventory/purchase-orders/${parsed.data.purchaseOrderId}/edit`; const lines = parseLines(parsed.data.lines, path);
  try { await updatePurchaseOrder({ actor: actor(context.user), businessId: context.businessId, expectedDate: parsed.data.expectedDate ? new Date(`${parsed.data.expectedDate}T00:00:00Z`) : null, expectedRevision: parsed.data.expectedRevision, lines, notes: parsed.data.notes, operationKey: parsed.data.operationKey, orderDate: new Date(`${parsed.data.orderDate}T00:00:00Z`), purchaseOrderId: parsed.data.purchaseOrderId, supplierId: parsed.data.supplierId }); } catch (error) { purchasingRedirect(path, "error", mapPurchasingError(error)); }
  refresh(); purchasingRedirect(`/inventory/purchase-orders/${parsed.data.purchaseOrderId}`, "success", "Draft purchase order updated; stock unchanged.");
}

export async function cancelPurchaseOrderAction(formData: FormData) {
  return poTransition(formData, "CANCEL_PURCHASE_ORDER", async (context, values) => cancelPurchaseOrder({ actor: actor(context.user), businessId: context.businessId, expectedRevision: values.expectedRevision, operationKey: values.operationKey, purchaseOrderId: values.purchaseOrderId, reason: values.reason }), "Purchase order cancelled; stock unchanged.", true);
}

export async function closePurchaseOrderAction(formData: FormData) {
  return poTransition(formData, "CANCEL_PURCHASE_ORDER", async (context, values) => closePurchaseOrder({ actor: actor(context.user), businessId: context.businessId, expectedRevision: values.expectedRevision, operationKey: values.operationKey, purchaseOrderId: values.purchaseOrderId, reason: values.reason }), "Remaining quantity closed; stock unchanged.", true);
}

export async function receivePurchaseOrderAction(formData: FormData) {
  const context = await requireBusinessUserForModule("INVENTORY", "RECEIVE_PURCHASE_ORDER");
  const parsed = z.object({ deliveryReference: z.string().max(120).optional(), lines: z.string(), notes: z.string().max(2000).optional(), operationKey: z.string().min(16), purchaseOrderId: z.string().uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) purchasingRedirect("/inventory/purchase-orders", "error", parsed.error.issues[0]?.message ?? "Invalid goods receipt.");
  const path = `/inventory/purchase-orders/${parsed.data.purchaseOrderId}`;
  let lines: Array<{ purchaseOrderLineId: string; quantity: number }>;
  try { lines = z.array(z.object({ purchaseOrderLineId: z.string().uuid(), quantity: z.coerce.number().int().positive() })).min(1).parse(JSON.parse(parsed.data.lines)); } catch { purchasingRedirect(path, "error", "At least one positive receive quantity is required."); }
  let receiptNumber: string;
  try {
    const purchaseOrder = await prisma.purchaseOrder.findFirst({ where: { businessId: context.businessId, id: parsed.data.purchaseOrderId }, select: { branchId: true } });
    if (!purchaseOrder || !(await resolveOperationalBranchId(context.businessId, context.user, purchaseOrder.branchId))) throw new Error("Purchase order is outside your branch scope.");
    receiptNumber = (await receivePurchaseOrder({ actor: actor(context.user), businessId: context.businessId, deliveryReference: parsed.data.deliveryReference, lines, notes: parsed.data.notes, operationKey: parsed.data.operationKey, purchaseOrderId: parsed.data.purchaseOrderId })).receiptNumber;
  } catch (error) { purchasingRedirect(path, "error", mapPurchasingError(error)); }
  refresh(); purchasingRedirect(path, "success", `${receiptNumber} posted to inventory.`);
}

export async function reverseGoodsReceiptLineAction(formData: FormData) {
  const context = await requireBusinessUserForModule("INVENTORY", "REVERSE_GOODS_RECEIPT");
  const parsed = z.object({ goodsReceiptLineId: z.string().uuid(), operationKey: z.string().min(16), purchaseOrderId: z.string().uuid(), quantity: z.coerce.number().int().positive(), reason: z.string().trim().min(3).max(500) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) purchasingRedirect("/inventory/purchase-orders", "error", parsed.error.issues[0]?.message ?? "Invalid reversal.");
  const path = `/inventory/purchase-orders/${parsed.data.purchaseOrderId}`;
  try { await reverseGoodsReceiptLine({ actor: actor(context.user), businessId: context.businessId, goodsReceiptLineId: parsed.data.goodsReceiptLineId, operationKey: parsed.data.operationKey, quantity: parsed.data.quantity, reason: parsed.data.reason }); } catch (error) { purchasingRedirect(path, "error", mapPurchasingError(error)); }
  refresh(); purchasingRedirect(path, "success", "Goods receipt reversal posted to the ledger.");
}

async function poTransition(formData: FormData, capability: "APPROVE_PURCHASE_ORDER" | "CANCEL_PURCHASE_ORDER", work: (context: Awaited<ReturnType<typeof requireBusinessUserForModule>>, values: { expectedRevision: number; operationKey: string; purchaseOrderId: string; reason: string }) => Promise<unknown>, message: string, requiresReason = false) {
  const context = await requireBusinessUserForModule("INVENTORY", capability);
  const parsed = z.object({ expectedRevision: z.coerce.number().int().min(0), operationKey: z.string().min(16), purchaseOrderId: z.string().uuid(), reason: requiresReason ? z.string().trim().min(3).max(500) : z.string().optional().default("") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) purchasingRedirect("/inventory/purchase-orders", "error", parsed.error.issues[0]?.message ?? "Invalid purchase order action.");
  const path = `/inventory/purchase-orders/${parsed.data.purchaseOrderId}`;
  try { await work(context, parsed.data); } catch (error) { purchasingRedirect(path, "error", mapPurchasingError(error)); }
  refresh(); purchasingRedirect(path, "success", message);
}

function parseLines(raw: string, path: string) { try { return poLineSchema.parse(JSON.parse(raw)); } catch { purchasingRedirect(path, "error", "Add at least one valid product line."); } }
function actor(user: { userId: string; name: string; email: string }) { return { email: user.email, name: user.name, userId: user.userId }; }
function refresh() { revalidatePath("/inventory"); revalidatePath("/inventory/suppliers"); revalidatePath("/inventory/purchase-orders"); revalidatePath("/inventory/movements"); revalidatePath("/inventory/reconciliation"); }
function purchasingRedirect(path: string, type: "error" | "success", message: string): never { redirect(`${path}${path.includes("?") ? "&" : "?"}type=${type}&message=${encodeURIComponent(message)}`); }
