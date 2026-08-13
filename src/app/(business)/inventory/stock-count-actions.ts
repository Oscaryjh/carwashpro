"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { resolveOperationalBranchId } from "@/lib/branches";
import {
  approveStockCount,
  cancelStockCount,
  createStockCount,
  mapStockCountError,
  recordStockCountLine,
  reopenStockCount,
  setReorderSettings,
  startStockCount,
  submitStockCount,
} from "@/lib/inventory/stock-count-service";
import { prisma } from "@/lib/prisma";

const base = z.object({ operationKey: z.string().min(16).max(180) });
const transition = base.extend({ expectedRevision: z.coerce.number().int().min(0), sessionId: z.string().uuid() });

export async function createStockCountAction(formData: FormData) {
  const context = await requireBusinessUserForModule("INVENTORY", "CREATE_STOCK_COUNT");
  const parsed = base.extend({ branchId: z.string().uuid(), countType: z.enum(["FULL_BRANCH_COUNT", "SELECTED_PRODUCTS"]), notes: z.string().max(2000).optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/inventory/stock-counts/new", parsed.error.issues[0]?.message ?? "Invalid stock count.");
  let sessionId: string;
  try {
    const branchId = await resolveOperationalBranchId(context.businessId, context.user, parsed.data.branchId);
    if (!branchId) throw new Error("An authorised branch is required.");
    const productIds = formData.getAll("productIds").map(String);
    sessionId = (await createStockCount({ actor: actor(context.user), branchId, businessId: context.businessId, countType: parsed.data.countType, notes: parsed.data.notes, operationKey: parsed.data.operationKey, productIds })).id;
  } catch (error) { fail("/inventory/stock-counts/new", mapStockCountError(error)); }
  refresh(); success(`/inventory/stock-counts/${sessionId}`, "Stock count created. Start it when the counter is ready.");
}

export async function startStockCountAction(formData: FormData) { return runTransition(formData, "COUNT_INVENTORY", startStockCount, "Stock count started."); }
export async function submitStockCountAction(formData: FormData) { return runTransition(formData, "SUBMIT_STOCK_COUNT", submitStockCount, "Stock count submitted for approval."); }

export async function recordStockCountLineAction(formData: FormData) {
  const context = await requireBusinessUserForModule("INVENTORY", "COUNT_INVENTORY");
  const parsed = base.extend({ actualQuantity: z.coerce.number().int().min(0), expectedLineRevision: z.coerce.number().int().min(0), lineId: z.string().uuid(), notes: z.string().max(500).optional(), sessionId: z.string().uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/inventory/stock-counts", parsed.error.issues[0]?.message ?? "Invalid count quantity.");
  const path = `/inventory/stock-counts/${parsed.data.sessionId}`;
  try { await assertSessionBranch(context.businessId, context.user, parsed.data.sessionId); await recordStockCountLine({ actor: actor(context.user), businessId: context.businessId, ...parsed.data }); }
  catch (error) { fail(path, mapStockCountError(error)); }
  refresh(); success(path, "Physical quantity saved with a frozen expected snapshot.");
}

export async function reopenStockCountAction(formData: FormData) { return reasonTransition(formData, "REOPEN_STOCK_COUNT", reopenStockCount, "Count reopened for recount."); }
export async function cancelStockCountAction(formData: FormData) { return reasonTransition(formData, "CANCEL_STOCK_COUNT", cancelStockCount, "Stock count cancelled; no stock movement created."); }
export async function approveStockCountAction(formData: FormData) { return reasonTransition(formData, "APPROVE_STOCK_COUNT", approveStockCount, "Count approved; variance deltas posted to the inventory ledger."); }

export async function setReorderSettingsAction(formData: FormData) {
  const context = await requireBusinessUserForModule("INVENTORY", "MANAGE_REORDER_SETTINGS");
  const rawTarget = formData.get("targetStockLevel")?.toString().trim() ?? "";
  const parsed = base.extend({ branchId: z.string().uuid(), expectedRevision: z.coerce.number().int().min(0).optional(), productId: z.string().uuid(), reorderLevel: z.coerce.number().int().min(0) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/inventory/reorder", parsed.error.issues[0]?.message ?? "Invalid reorder settings.");
  try {
    const branchId = await resolveOperationalBranchId(context.businessId, context.user, parsed.data.branchId);
    if (!branchId) throw new Error("An authorised branch is required.");
    await setReorderSettings({ actor: actor(context.user), branchId, businessId: context.businessId, expectedRevision: parsed.data.expectedRevision, operationKey: parsed.data.operationKey, productId: parsed.data.productId, reorderLevel: parsed.data.reorderLevel, targetStockLevel: rawTarget === "" ? null : z.coerce.number().int().min(0).parse(rawTarget) });
  } catch (error) { fail("/inventory/reorder", mapStockCountError(error)); }
  refresh(); success("/inventory/reorder", "Reorder settings saved.");
}

async function runTransition(formData: FormData, capability: "COUNT_INVENTORY" | "SUBMIT_STOCK_COUNT", service: typeof startStockCount | typeof submitStockCount, message: string) {
  const context = await requireBusinessUserForModule("INVENTORY", capability);
  const parsed = transition.safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/inventory/stock-counts", parsed.error.issues[0]?.message ?? "Invalid count transition.");
  const path = `/inventory/stock-counts/${parsed.data.sessionId}`;
  try { await assertSessionBranch(context.businessId, context.user, parsed.data.sessionId); await service({ actor: actor(context.user), businessId: context.businessId, ...parsed.data }); }
  catch (error) { fail(path, mapStockCountError(error)); }
  refresh(); success(path, message);
}

async function reasonTransition(formData: FormData, capability: "REOPEN_STOCK_COUNT" | "CANCEL_STOCK_COUNT" | "APPROVE_STOCK_COUNT", service: typeof reopenStockCount | typeof cancelStockCount | typeof approveStockCount, message: string) {
  const context = await requireBusinessUserForModule("INVENTORY", capability);
  const parsed = transition.extend({ reason: z.string().trim().min(3).max(500) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/inventory/stock-counts", parsed.error.issues[0]?.message ?? "A reason is required.");
  const path = `/inventory/stock-counts/${parsed.data.sessionId}`;
  try { await assertSessionBranch(context.businessId, context.user, parsed.data.sessionId); await service({ actor: actor(context.user), businessId: context.businessId, ...parsed.data }); }
  catch (error) { fail(path, mapStockCountError(error)); }
  refresh(); success(path, message);
}

async function assertSessionBranch(businessId: string, user: Parameters<typeof resolveOperationalBranchId>[1], sessionId: string) {
  const session = await prisma.stockCountSession.findFirst({ where: { businessId, id: sessionId }, select: { branchId: true } });
  if (!session || !(await resolveOperationalBranchId(businessId, user, session.branchId))) throw new Error("Stock count is outside your branch scope.");
}
function actor(user: { userId: string; name: string; email: string }) { return { email: user.email, name: user.name, userId: user.userId }; }
function refresh() { for (const path of ["/inventory", "/inventory/stock-counts", "/inventory/reorder", "/inventory/movements", "/inventory/reconciliation"]) revalidatePath(path); }
function fail(path: string, message: string): never { redirect(`${path}?type=error&message=${encodeURIComponent(message)}`); }
function success(path: string, message: string): never { redirect(`${path}?type=success&message=${encodeURIComponent(message)}`); }
