"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { assertServerActionSameOrigin, getAuthRequestContext } from "@/lib/auth/security";
import { getOperationalBranches, resolveOperationalBranchId } from "@/lib/branches";
import {
  consumePayrollHighRiskAuthorization,
  issuePayrollHighRiskAuthorization,
  payrollMfaFactor,
  payrollMfaPassword,
  publicPayrollMfaError,
} from "@/lib/payroll/high-risk-mfa";
import {
  attachSupplierInvoice,
  confirmSupplierBill,
  createSupplierBillDraft,
  mapSupplierApError,
  recordSupplierPayment,
  reverseSupplierPayment,
  updateSupplierBillDraft,
  voidSupplierBill,
} from "@/lib/inventory/supplier-ap-service";
import { validateClaimAttachment } from "@/lib/claim/attachment-policy";
import { getClaimPrivateAttachmentStore } from "@/lib/claim/private-attachment-storage";
import { trySynchronizeInventoryPurchaseExpense } from "@/lib/expense/source-integration";

const operationSchema = z.string().min(16).max(180);
const dateSchema = z.string().date();
const paymentMethods = ["CASH", "BANK_TRANSFER", "CARD", "EWALLET", "CHEQUE", "OTHER"] as const;

export async function createSupplierBillAction(formData: FormData) {
  const context = await requireBusinessUserForModule("INVENTORY", "CREATE_SUPPLIER_BILL");
  const parsed = z.object({
    branchId: z.string().uuid(),
    dueDate: dateSchema,
    invoiceDate: dateSchema,
    notes: z.string().max(2000).optional(),
    operationKey: operationSchema,
    purchaseOrderId: z.string().uuid(),
    supplierInvoiceNumber: z.string().trim().min(1).max(120),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) apRedirect("/inventory/supplier-bills/new", "error", parsed.error.issues[0]?.message ?? "Invalid supplier bill.");
  const lines = parseLines(formData, `/inventory/supplier-bills/new?purchaseOrderId=${parsed.data.purchaseOrderId}`);
  let billId: string;
  try {
    const branchId = await resolveOperationalBranchId(context.businessId, context.user, parsed.data.branchId);
    if (!branchId) throw new Error("An authorised branch is required.");
    billId = (await createSupplierBillDraft({
      actor: actor(context.user),
      allowedBranchIds: await allowedBranches(context.businessId, context.user),
      businessId: context.businessId,
      ...parsed.data,
      branchId,
      dueDate: asDate(parsed.data.dueDate),
      invoiceDate: asDate(parsed.data.invoiceDate),
      lines,
    })).id;
  } catch (error) {
    apRedirect(`/inventory/supplier-bills/new?purchaseOrderId=${parsed.data.purchaseOrderId}`, "error", mapSupplierApError(error));
  }
  refreshAp();
  apRedirect(`/inventory/supplier-bills/${billId}`, "success", "Draft supplier bill created. AP, stock and expenses remain unchanged.");
}

export async function attachSupplierInvoiceAction(formData: FormData) {
  const context = await requireBusinessUserForModule("INVENTORY", "EDIT_SUPPLIER_BILL_DRAFT");
  const parsed = z.object({ billId: z.string().uuid(), operationKey: operationSchema }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) apRedirect("/inventory/supplier-bills", "error", "Invalid attachment request.");
  const path = `/inventory/supplier-bills/${parsed.data.billId}`;
  const file = formData.get("invoiceAttachment");
  if (!(file instanceof File) || !file.size) apRedirect(path, "error", "Select a PDF, JPG, PNG, or WebP supplier invoice.");
  const store = getClaimPrivateAttachmentStore();
  let stored: Awaited<ReturnType<typeof store.putQuarantined>> | null = null;
  try {
    const validated = validateClaimAttachment({ bytes: new Uint8Array(await file.arrayBuffer()), claimedMimeType: file.type, originalFileName: file.name });
    stored = await store.putQuarantined(validated);
    await attachSupplierInvoice({ actor: actor(context.user), allowedBranchIds: await allowedBranches(context.businessId, context.user), billId: parsed.data.billId, businessId: context.businessId, operationKey: parsed.data.operationKey, stored: { ...stored, originalFileName: file.name, malwareStatus: validated.malwareStatus, privacyMetadataStatus: validated.privacyMetadataStatus } });
  } catch (error) {
    if (stored) await store.deleteQuarantined(stored.objectKey).catch(() => undefined);
    apRedirect(path, "error", mapSupplierApError(error));
  }
  refreshAp(); apRedirect(path, "success", "Supplier invoice attachment stored privately in quarantine.");
}

export async function updateSupplierBillAction(formData: FormData) {
  const context = await requireBusinessUserForModule("INVENTORY", "EDIT_SUPPLIER_BILL_DRAFT");
  const parsed = z.object({
    billId: z.string().uuid(),
    dueDate: dateSchema,
    expectedRevision: z.coerce.number().int().min(0),
    invoiceDate: dateSchema,
    notes: z.string().max(2000).optional(),
    operationKey: operationSchema,
    supplierInvoiceNumber: z.string().trim().min(1).max(120),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) apRedirect("/inventory/supplier-bills", "error", parsed.error.issues[0]?.message ?? "Invalid supplier bill.");
  const path = `/inventory/supplier-bills/${parsed.data.billId}`;
  try {
    await updateSupplierBillDraft({ actor: actor(context.user), allowedBranchIds: await allowedBranches(context.businessId, context.user), businessId: context.businessId, ...parsed.data, dueDate: asDate(parsed.data.dueDate), invoiceDate: asDate(parsed.data.invoiceDate), lines: parseLines(formData, path) });
  } catch (error) { apRedirect(path, "error", mapSupplierApError(error)); }
  refreshAp(); apRedirect(path, "success", "Draft supplier bill updated. AP, stock and expenses remain unchanged.");
}

export async function confirmSupplierBillAction(formData: FormData) {
  const context = await requireBusinessUserForModule("INVENTORY", "CONFIRM_SUPPLIER_BILL");
  const parsed = z.object({ billId: z.string().uuid(), expectedRevision: z.coerce.number().int().min(0), operationKey: operationSchema, priceVarianceAcknowledged: z.string().optional(), priceVarianceReason: z.string().max(500).optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) apRedirect("/inventory/supplier-bills", "error", parsed.error.issues[0]?.message ?? "Invalid confirmation.");
  const path = `/inventory/supplier-bills/${parsed.data.billId}`;
  try {
    await confirmSupplierBill({ actor: actor(context.user), allowedBranchIds: await allowedBranches(context.businessId, context.user), allowOwnerSelfConfirm: context.user.role === "BUSINESS_OWNER", businessId: context.businessId, ...parsed.data, priceVarianceAcknowledged: parsed.data.priceVarianceAcknowledged === "on" });
    await trySynchronizeInventoryPurchaseExpense({ actor: actor(context.user), businessId: context.businessId, supplierBillId: parsed.data.billId });
  }
  catch (error) { apRedirect(path, "error", mapSupplierApError(error)); }
  refreshAp(); apRedirect(path, "success", "Supplier bill confirmed. AP updated; Inventory Purchase spending synchronized when Expense is enabled; stock unchanged.");
}

export async function voidSupplierBillAction(formData: FormData) {
  const context = await requireBusinessUserForModule("INVENTORY", "VOID_SUPPLIER_BILL");
  const parsed = z.object({ billId: z.string().uuid(), expectedRevision: z.coerce.number().int().min(0), operationKey: operationSchema, reason: z.string().trim().min(3).max(500) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) apRedirect("/inventory/supplier-bills", "error", parsed.error.issues[0]?.message ?? "Invalid void request.");
  const path = `/inventory/supplier-bills/${parsed.data.billId}`;
  try {
    await voidSupplierBill({ actor: actor(context.user), allowedBranchIds: await allowedBranches(context.businessId, context.user), businessId: context.businessId, ...parsed.data });
    await trySynchronizeInventoryPurchaseExpense({ actor: actor(context.user), businessId: context.businessId, supplierBillId: parsed.data.billId });
  }
  catch (error) { apRedirect(path, "error", mapSupplierApError(error)); }
  refreshAp(); apRedirect(path, "success", "Supplier bill voided. AP removed; the Expense representation was voided when available; stock unchanged.");
}

export async function recordSupplierPaymentAction(formData: FormData) {
  const context = await requireBusinessUserForModule("INVENTORY", "RECORD_SUPPLIER_PAYMENT");
  const parsed = z.object({ amount: z.string().regex(/^\d+(\.\d{1,2})?$/), billId: z.string().uuid(), notes: z.string().max(2000).optional(), operationKey: operationSchema, paymentDate: dateSchema, paymentMethod: z.enum(paymentMethods), paymentReference: z.string().max(160).optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) apRedirect("/inventory/supplier-bills", "error", parsed.error.issues[0]?.message ?? "Invalid supplier payment.");
  const path = `/inventory/supplier-bills/${parsed.data.billId}`;
  try {
    const stepUp = await issueStepUp(context, formData, "SUPPLIER_PAYMENT_RECORD", parsed.data.billId);
    await recordSupplierPayment({ actor: actor(context.user), allowedBranchIds: await allowedBranches(context.businessId, context.user), authorize: (tx) => consumePayrollHighRiskAuthorization({ actionKey: "SUPPLIER_PAYMENT_RECORD", businessId: context.businessId, resourceId: parsed.data.billId, stepUp, userId: context.user.userId }, tx), businessId: context.businessId, ...parsed.data, paymentDate: asDate(parsed.data.paymentDate) });
    await trySynchronizeInventoryPurchaseExpense({ actor: actor(context.user), businessId: context.businessId, supplierBillId: parsed.data.billId });
  } catch (error) { apRedirect(path, "error", publicPayrollMfaError(error) ?? mapSupplierApError(error)); }
  refreshAp(); apRedirect(path, "success", "Supplier payment completed. AP settlement synchronized; no second Expense and no stock change.");
}

export async function reverseSupplierPaymentAction(formData: FormData) {
  const context = await requireBusinessUserForModule("INVENTORY", "REVERSE_SUPPLIER_PAYMENT");
  const parsed = z.object({ billId: z.string().uuid(), operationKey: operationSchema, paymentId: z.string().uuid(), reason: z.string().trim().min(3).max(500) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) apRedirect("/inventory/supplier-bills", "error", parsed.error.issues[0]?.message ?? "Invalid payment reversal.");
  const path = `/inventory/supplier-bills/${parsed.data.billId}`;
  try {
    const stepUp = await issueStepUp(context, formData, "SUPPLIER_PAYMENT_REVERSE", parsed.data.paymentId);
    await reverseSupplierPayment({ actor: actor(context.user), allowedBranchIds: await allowedBranches(context.businessId, context.user), authorize: (tx) => consumePayrollHighRiskAuthorization({ actionKey: "SUPPLIER_PAYMENT_REVERSE", businessId: context.businessId, resourceId: parsed.data.paymentId, stepUp, userId: context.user.userId }, tx), businessId: context.businessId, operationKey: parsed.data.operationKey, paymentId: parsed.data.paymentId, reason: parsed.data.reason });
    await trySynchronizeInventoryPurchaseExpense({ actor: actor(context.user), businessId: context.businessId, supplierBillId: parsed.data.billId });
  } catch (error) { apRedirect(path, "error", publicPayrollMfaError(error) ?? mapSupplierApError(error)); }
  refreshAp(); apRedirect(path, "success", "Supplier payment reversed. AP settlement synchronized; no second Expense and no stock change.");
}

async function issueStepUp(context: Awaited<ReturnType<typeof requireBusinessUserForModule>>, formData: FormData, actionKey: "SUPPLIER_PAYMENT_RECORD" | "SUPPLIER_PAYMENT_REVERSE", resourceId: string) {
  const requestHeaders = await headers(); assertServerActionSameOrigin(requestHeaders);
  return issuePayrollHighRiskAuthorization({ access: context.access, actionKey, businessId: context.businessId, enabledModules: context.moduleContext.enabledModules, factor: payrollMfaFactor(formData), password: payrollMfaPassword(formData), request: getAuthRequestContext(requestHeaders), resourceId, user: context.user });
}

function parseLines(formData: FormData, path: string) {
  const ids = formData.getAll("purchaseOrderLineId").map(String);
  const quantities = formData.getAll("billedQuantity").map(String);
  const prices = formData.getAll("unitPrice").map(String);
  const result = z.array(z.object({ purchaseOrderLineId: z.string().uuid(), billedQuantity: z.coerce.number().int().positive(), unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/) })).min(1).max(100).safeParse(ids.map((purchaseOrderLineId, index) => ({ purchaseOrderLineId, billedQuantity: quantities[index], unitPrice: prices[index] })));
  if (!result.success) apRedirect(path, "error", result.error.issues[0]?.message ?? "At least one valid bill line is required.");
  return result.data;
}

function asDate(value: string) { return new Date(`${value}T00:00:00Z`); }
async function allowedBranches(businessId: string, user: Parameters<typeof getOperationalBranches>[1]) { return (await getOperationalBranches(businessId, user)).map((branch) => branch.id); }
function actor(user: { userId: string; name: string; email: string }) { return { email: user.email, name: user.name, userId: user.userId }; }
function refreshAp() { ["/inventory", "/inventory/purchase-orders", "/inventory/supplier-bills", "/inventory/accounts-payable", "/inventory/reconciliation", "/expenses", "/expenses/history", "/expenses/integrations"].forEach((path) => revalidatePath(path)); }
function apRedirect(path: string, type: "error" | "success", message: string): never { redirect(`${path}${path.includes("?") ? "&" : "?"}type=${type}&message=${encodeURIComponent(message)}`); }
