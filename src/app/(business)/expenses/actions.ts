"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { getAuditRequestContext } from "@/lib/audit";
import { assertExpenseInMutationScope, resolveExpenseMutationBranch, resolveExpenseReadScope } from "@/lib/expense/access";
import {
  confirmBusinessExpense,
  correctConfirmedBusinessExpense,
  createBusinessExpense,
  createExpenseCategory,
  createRecurringExpenseTemplate,
  expenseErrorMessage,
  generateRecurringExpense,
  getBusinessExpenseDetail,
  markBusinessExpensePaid,
  reorderExpenseCategories,
  updateDraftBusinessExpense,
  updateExpenseCategory,
  updateRecurringExpenseTemplate,
  voidBusinessExpense,
} from "@/lib/expense/service";
import { saveExpenseIntegrationSettings } from "@/lib/expense/source-integration";

const operation = z.object({ operationKey: z.string().min(16).max(180) });
const facts = operation.extend({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  branchId: z.string().uuid().optional().or(z.literal("")),
  categoryId: z.string().uuid(),
  description: z.string().trim().min(3).max(500),
  expenseDate: z.string().date(),
  notes: z.string().max(2000).optional(),
  payeeName: z.string().max(160).optional(),
});
const paymentMethods = ["CASH", "BANK_TRANSFER", "CARD", "EWALLET", "OTHER"] as const;
const paymentSources = ["POS_DRAWER", "PETTY_CASH", "BANK_ACCOUNT", "COMPANY_CARD", "OWNER_ADVANCE", "STAFF_ADVANCE", "OTHER"] as const;

export async function createExpenseAction(formData: FormData) {
  const context = await requireBusinessUserForModule("EXPENSE", "CREATE_EXPENSE");
  const parsed = facts.extend({
    intent: z.enum(["DRAFT", "CONFIRMED"]),
    paymentDate: z.string().date().optional().or(z.literal("")),
    paymentMethod: z.enum(paymentMethods).optional().or(z.literal("")),
    paymentSource: z.enum(paymentSources).optional().or(z.literal("")),
    cashierShiftId: z.string().uuid().optional().or(z.literal("")),
    paymentReference: z.string().max(160).optional(),
    paymentStatus: z.enum(["UNPAID", "PAID"]),
    documentScanId: z.string().uuid().optional().or(z.literal("")),
    duplicateOverride: z.enum(["true", "false"]).optional(),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/expenses/new", parsed.error.issues[0]?.message ?? "Invalid Expense.");
  try {
    const branchId = await resolveExpenseMutationBranch({ access: context.access, businessId: context.businessId, requestedBranchId: parsed.data.branchId || null, user: context.user });
    const file = formData.get("receipt");
    const receipt = file instanceof File && file.size > 0 ? { bytes: new Uint8Array(await file.arrayBuffer()), claimedMimeType: file.type, originalFileName: file.name } : null;
    const expense = await createBusinessExpense({ actor: actor(context.user), amount: parsed.data.amount, branchId, businessId: context.businessId, cashierShiftId: parsed.data.cashierShiftId || null, categoryId: parsed.data.categoryId, description: parsed.data.description, desiredStatus: parsed.data.intent, expenseDate: parsed.data.expenseDate, notes: parsed.data.notes, operationKey: parsed.data.operationKey, payeeName: parsed.data.payeeName, paymentDate: parsed.data.paymentDate || null, paymentMethod: parsed.data.paymentMethod || null, paymentSource: parsed.data.paymentSource || null, paymentReference: parsed.data.paymentReference, paymentStatus: parsed.data.paymentStatus, receipt, documentScanId: parsed.data.documentScanId || null, duplicateOverride: parsed.data.duplicateOverride === "true", request: await getAuditRequestContext() });
    refresh(); success(`/expenses/${expense.id}`, `${expense.expenseNumber} created.`);
  } catch (error) { actionFailure("/expenses/new", error); }
}

export async function updateExpenseFactsAction(formData: FormData) {
  const context = await requireBusinessUserForModule("EXPENSE", "EDIT_EXPENSE_DRAFT");
  const parsed = facts.extend({ expenseId: z.string().uuid(), expectedRevision: z.coerce.number().int().min(0), reason: z.string().max(500).optional(), status: z.enum(["DRAFT", "CONFIRMED"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/expenses", parsed.error.issues[0]?.message ?? "Invalid Expense update.");
  const path = `/expenses/${parsed.data.expenseId}`;
  try {
    const scope = await resolveExpenseReadScope(context);
    const existing = await getBusinessExpenseDetail({ businessId: context.businessId, expenseId: parsed.data.expenseId, ...scope });
    assertExpenseInMutationScope(existing, scope);
    const branchId = await resolveExpenseMutationBranch({ access: context.access, businessId: context.businessId, requestedBranchId: parsed.data.branchId || null, user: context.user });
    const common = { actor: actor(context.user), amount: parsed.data.amount, branchId, businessId: context.businessId, categoryId: parsed.data.categoryId, description: parsed.data.description, expenseDate: parsed.data.expenseDate, expenseId: parsed.data.expenseId, expectedRevision: parsed.data.expectedRevision, notes: parsed.data.notes, operationKey: parsed.data.operationKey, payeeName: parsed.data.payeeName, request: await getAuditRequestContext() };
    if (parsed.data.status === "DRAFT") await updateDraftBusinessExpense(common);
    else await correctConfirmedBusinessExpense({ ...common, reason: parsed.data.reason ?? "" });
    refresh(); success(path, parsed.data.status === "DRAFT" ? "Draft Expense updated." : "Expense correction recorded with immutable history.");
  } catch (error) { actionFailure(path, error); }
}

export async function confirmExpenseAction(formData: FormData) { return transition(formData, "CONFIRM_EXPENSE", confirmBusinessExpense, "Expense confirmed."); }

export async function markExpensePaidAction(formData: FormData) {
  const context = await requireBusinessUserForModule("EXPENSE", "MARK_EXPENSE_PAID");
  const parsed = operation.extend({ amount: z.string().regex(/^\d+(\.\d{1,2})?$/), cashierShiftId: z.string().uuid().optional().or(z.literal("")), expenseId: z.string().uuid(), expectedRevision: z.coerce.number().int().min(0), paymentDate: z.string().date(), paymentMethod: z.enum(paymentMethods), paymentSource: z.enum(paymentSources), paymentReference: z.string().max(160).optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/expenses", parsed.error.issues[0]?.message ?? "Invalid payment details.");
  const path = `/expenses/${parsed.data.expenseId}`;
  try {
    await assertScoped(context, parsed.data.expenseId);
    await markBusinessExpensePaid({ actor: actor(context.user), businessId: context.businessId, ...parsed.data, cashierShiftId: parsed.data.cashierShiftId || null, request: await getAuditRequestContext() });
    refresh(); success(path, "Expense payment recorded; recognised spending is unchanged.");
  } catch (error) { actionFailure(path, error); }
}

export async function voidExpenseAction(formData: FormData) {
  const context = await requireBusinessUserForModule("EXPENSE", "VOID_EXPENSE");
  const parsed = operation.extend({ expenseId: z.string().uuid(), expectedRevision: z.coerce.number().int().min(0), reason: z.string().trim().min(5).max(500) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/expenses", parsed.error.issues[0]?.message ?? "Void reason is required.");
  const path = `/expenses/${parsed.data.expenseId}`;
  try {
    await assertScoped(context, parsed.data.expenseId);
    await voidBusinessExpense({ actor: actor(context.user), businessId: context.businessId, ...parsed.data, request: await getAuditRequestContext() });
    refresh(); success(path, "Expense voided; immutable history retained.");
  } catch (error) { actionFailure(path, error); }
}

export async function createExpenseCategoryAction(formData: FormData) {
  const context = await requireBusinessUserForModule("EXPENSE", "MANAGE_EXPENSE_CATEGORY");
  const parsed = operation.extend({ code: z.string().max(40).optional(), description: z.string().max(500).optional(), group: z.enum(["OPERATIONS", "MARKETING", "STAFF", "RENTAL", "FINANCE", "OTHER"]), name: z.string().trim().min(2).max(120), requiresReceipt: z.string().optional(), sortOrder: z.coerce.number().int().min(0).max(100000) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/expenses/categories", parsed.error.issues[0]?.message ?? "Invalid category.");
  try {
    await createExpenseCategory({ actor: actor(context.user), businessId: context.businessId, ...parsed.data, requiresReceipt: parsed.data.requiresReceipt === "on", request: await getAuditRequestContext() });
    refresh(); success("/expenses/categories", "Expense category created.");
  } catch (error) { actionFailure("/expenses/categories", error); }
}

export async function updateExpenseCategoryAction(formData: FormData) {
  const context = await requireBusinessUserForModule("EXPENSE", "MANAGE_EXPENSE_CATEGORY");
  const parsed = operation.extend({ active: z.string().optional(), categoryId: z.string().uuid(), code: z.string().max(40).optional(), description: z.string().max(500).optional(), group: z.enum(["OPERATIONS", "MARKETING", "STAFF", "RENTAL", "FINANCE", "OTHER"]), name: z.string().trim().min(2).max(120), requiresReceipt: z.string().optional(), sortOrder: z.coerce.number().int().min(0).max(100000) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/expenses/categories", parsed.error.issues[0]?.message ?? "Invalid category.");
  try {
    await updateExpenseCategory({ actor: actor(context.user), businessId: context.businessId, ...parsed.data, active: parsed.data.active === "on", requiresReceipt: parsed.data.requiresReceipt === "on", request: await getAuditRequestContext() });
    refresh(); success("/expenses/categories", "Expense category updated.");
  } catch (error) { actionFailure("/expenses/categories", error); }
}

export async function reorderExpenseCategoriesAction(formData: FormData) {
  const context = await requireBusinessUserForModule("EXPENSE", "MANAGE_EXPENSE_CATEGORY");
  const parsed = operation.extend({ expectedOrder: z.string().max(25000), order: z.string().max(25000) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/expenses/categories", parsed.error.issues[0]?.message ?? "Invalid category order.");
  const idList = z.array(z.string().uuid()).min(1).max(500);
  let expectedOrderIds: string[];
  let orderIds: string[];
  try {
    expectedOrderIds = idList.parse(JSON.parse(parsed.data.expectedOrder));
    orderIds = idList.parse(JSON.parse(parsed.data.order));
  } catch {
    fail("/expenses/categories", "Invalid category order.");
  }
  try {
    await reorderExpenseCategories({ actor: actor(context.user), businessId: context.businessId, expectedOrderIds, operationKey: parsed.data.operationKey, orderIds, request: await getAuditRequestContext() });
    refresh(); success("/expenses/categories", "Category order saved.");
  } catch (error) { actionFailure("/expenses/categories", error); }
}

export async function saveExpenseIntegrationSettingsAction(formData: FormData) {
  const context = await requireBusinessUserForModule("EXPENSE", "MANAGE_EXPENSE_CATEGORY");
  const parsed = z.object({
    claimDefaultCategoryId: z.string().uuid().optional().or(z.literal("")),
    expectedRevision: z.coerce.number().int().min(0).optional(),
    inventoryPurchaseCategoryId: z.string().uuid().optional().or(z.literal("")),
    payrollCategoryId: z.string().uuid().optional().or(z.literal("")),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/expenses/integrations", parsed.error.issues[0]?.message ?? "Invalid source mapping.");
  try {
    await saveExpenseIntegrationSettings({
      actor: actor(context.user),
      businessId: context.businessId,
      claimDefaultCategoryId: parsed.data.claimDefaultCategoryId || null,
      expectedRevision: parsed.data.expectedRevision ?? null,
      inventoryPurchaseCategoryId: parsed.data.inventoryPurchaseCategoryId || null,
      payrollCategoryId: parsed.data.payrollCategoryId || null,
      request: await getAuditRequestContext(),
    });
    refresh();
    success("/expenses/integrations", "Claims, Payroll and Inventory Purchase source mappings saved.");
  } catch (error) { actionFailure("/expenses/integrations", error); }
}

export async function createRecurringExpenseAction(formData: FormData) {
  const context = await requireBusinessUserForModule("EXPENSE", "MANAGE_EXPENSE_CATEGORY");
  const parsed = facts.omit({ expenseDate: true }).extend({ endDate: z.string().date().optional().or(z.literal("")), startDate: z.string().date() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/expenses/recurring", parsed.error.issues[0]?.message ?? "Invalid recurring template.");
  try {
    const branchId = await resolveExpenseMutationBranch({ access: context.access, businessId: context.businessId, requestedBranchId: parsed.data.branchId || null, user: context.user });
    await createRecurringExpenseTemplate({ actor: actor(context.user), amount: parsed.data.amount, branchId, businessId: context.businessId, categoryId: parsed.data.categoryId, description: parsed.data.description, endDate: parsed.data.endDate || null, notes: parsed.data.notes, operationKey: parsed.data.operationKey, payeeName: parsed.data.payeeName, startDate: parsed.data.startDate, request: await getAuditRequestContext() });
    refresh(); success("/expenses/recurring", "Monthly recurring Expense template created.");
  } catch (error) { actionFailure("/expenses/recurring", error); }
}

export async function updateRecurringExpenseAction(formData: FormData) {
  const context = await requireBusinessUserForModule("EXPENSE", "MANAGE_EXPENSE_CATEGORY");
  const parsed = facts.omit({ expenseDate: true }).extend({ active: z.string().optional(), endDate: z.string().date().optional().or(z.literal("")), expectedRevision: z.coerce.number().int().min(0), reason: z.string().trim().min(5).max(500), startDate: z.string().date(), templateId: z.string().uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/expenses/recurring", parsed.error.issues[0]?.message ?? "Invalid recurring template revision.");
  try {
    const branchId = await resolveExpenseMutationBranch({ access: context.access, businessId: context.businessId, requestedBranchId: parsed.data.branchId || null, user: context.user });
    await updateRecurringExpenseTemplate({ active: parsed.data.active === "on", actor: actor(context.user), amount: parsed.data.amount, branchId, businessId: context.businessId, categoryId: parsed.data.categoryId, description: parsed.data.description, endDate: parsed.data.endDate || null, expectedRevision: parsed.data.expectedRevision, notes: parsed.data.notes, operationKey: parsed.data.operationKey, payeeName: parsed.data.payeeName, reason: parsed.data.reason, startDate: parsed.data.startDate, templateId: parsed.data.templateId, request: await getAuditRequestContext() });
    refresh(); success("/expenses/recurring", "Recurring template revised; generated history is unchanged.");
  } catch (error) { actionFailure("/expenses/recurring", error); }
}

export async function generateRecurringExpenseAction(formData: FormData) {
  const context = await requireBusinessUserForModule("EXPENSE", "CREATE_EXPENSE");
  const parsed = operation.extend({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), templateId: z.string().uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/expenses/recurring", parsed.error.issues[0]?.message ?? "Invalid recurring period.");
  try {
    const expense = await generateRecurringExpense({ actor: actor(context.user), businessId: context.businessId, ...parsed.data, request: await getAuditRequestContext() });
    refresh(); success(`/expenses/${expense.id}`, `${expense.expenseNumber} generated as an unpaid draft.`);
  } catch (error) { actionFailure("/expenses/recurring", error); }
}

async function transition(formData: FormData, capability: "CONFIRM_EXPENSE", service: typeof confirmBusinessExpense, message: string) {
  const context = await requireBusinessUserForModule("EXPENSE", capability);
  const parsed = operation.extend({ expenseId: z.string().uuid(), expectedRevision: z.coerce.number().int().min(0) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/expenses", parsed.error.issues[0]?.message ?? "Invalid Expense action.");
  const path = `/expenses/${parsed.data.expenseId}`;
  try {
    await assertScoped(context, parsed.data.expenseId);
    await service({ actor: actor(context.user), businessId: context.businessId, ...parsed.data, request: await getAuditRequestContext() });
    refresh(); success(path, message);
  } catch (error) { actionFailure(path, error); }
}

async function assertScoped(context: Awaited<ReturnType<typeof requireBusinessUserForModule>>, expenseId: string) {
  const scope = await resolveExpenseReadScope(context);
  const expense = await getBusinessExpenseDetail({ businessId: context.businessId, expenseId, ...scope });
  assertExpenseInMutationScope(expense, scope);
}
function actor(user: { userId: string; name: string; email: string }) { return { email: user.email, name: user.name, userId: user.userId }; }
function refresh() { for (const path of ["/expenses", "/expenses/history", "/expenses/categories", "/expenses/recurring", "/expenses/integrations", "/reports"]) revalidatePath(path); }
function actionFailure(path: string, error: unknown): never {
  if (typeof error === "object" && error !== null && "digest" in error && String(error.digest).startsWith("NEXT_REDIRECT")) throw error;
  fail(path, expenseErrorMessage(error));
}
function fail(path: string, message: string): never { redirect(`${path}?type=error&message=${encodeURIComponent(message)}`); }
function success(path: string, message: string): never { redirect(`${path}?type=success&message=${encodeURIComponent(message)}`); }
