"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAuditRequestContext } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { addCommercialSubscriptionItem, createCommercialOverride, createCommercialPlan, createCommercialPlanVersion, createCommercialPromotion, createCommercialSubscription, activateCommercialPlanVersion, projectCommercialConfiguration, renewCommercialSubscription } from "@/lib/commercial/service";
import { parseMoneyToCents } from "@/lib/commercial/money";
import { moduleKeys, type ModuleKey } from "@/lib/modules/registry";

export async function createPlanAction(formData: FormData) {
  const actor = await requireUser();
  await getAuditRequestContext();
  return handled(async () => {
    await createCommercialPlan(actor, { code: String(formData.get("code") ?? ""), displayName: String(formData.get("displayName") ?? ""), description: String(formData.get("description") ?? ""), scopeType: String(formData.get("scopeType")) === "GROUP" ? "GROUP" : "BUSINESS", planType: String(formData.get("planType")) === "ADD_ON" ? "ADD_ON" : "BASE", operationKey: String(formData.get("operationKey")) });
  });
}

export async function createVersionAction(formData: FormData) {
  const actor = await requireUser();
  return handled(async () => {
    const modules = formData.getAll("modules").map(String).filter((value): value is ModuleKey => moduleKeys.includes(value as ModuleKey));
    await createCommercialPlanVersion(actor, { planId: String(formData.get("planId")), operationKey: String(formData.get("operationKey")), effectiveFrom: new Date(String(formData.get("effectiveFrom"))), monthlyListPriceCents: parseMoneyToCents(String(formData.get("monthlyListPrice") ?? "")), annualListPriceCents: parseMoneyToCents(String(formData.get("annualListPrice") ?? "")), setupFeeCents: parseMoneyToCents(String(formData.get("setupFee") ?? "")), includedBranches: optionalInt(formData.get("includedBranches")), includedEmployees: optionalInt(formData.get("includedEmployees")), extraBranchUnitPriceCents: parseMoneyToCents(String(formData.get("extraBranchUnitPrice") ?? "")), extraEmployeeUnitPriceCents: parseMoneyToCents(String(formData.get("extraEmployeeUnitPrice") ?? "")), businessAiAllowance: optionalInt(formData.get("businessAiAllowance")), groupAiAllowance: optionalInt(formData.get("groupAiAllowance")), modules });
  });
}

export async function activateVersionAction(formData: FormData) {
  const actor = await requireUser();
  return handled(async () => { await activateCommercialPlanVersion(actor, String(formData.get("planVersionId")), String(formData.get("operationKey"))); });
}

export async function createSubscriptionAction(formData: FormData) {
  const actor = await requireUser();
  return handled(async () => {
    const scopeType = String(formData.get("scopeType")) === "GROUP" ? "GROUP" : "BUSINESS";
    const created = await createCommercialSubscription(actor, { scopeType, businessId: scopeType === "BUSINESS" ? String(formData.get("scopeId")) : null, groupId: scopeType === "GROUP" ? String(formData.get("scopeId")) : null, basePlanVersionId: String(formData.get("basePlanVersionId")), addOnPlanVersionIds: formData.getAll("addOnPlanVersionIds").map(String).filter(Boolean), billingInterval: String(formData.get("billingInterval")) === "ANNUAL" ? "ANNUAL" : "MONTHLY", startDate: new Date(String(formData.get("startDate"))), renewalDate: new Date(String(formData.get("renewalDate"))), promotionId: String(formData.get("promotionId") || "") || null, operationKey: String(formData.get("operationKey")) });
    if (created.status === "ACTIVE") await projectCommercialConfiguration(actor, created.id);
  });
}

export async function addSubscriptionItemAction(formData: FormData) {
  const actor = await requireUser();
  return handled(async () => { await addCommercialSubscriptionItem(actor, { subscriptionId: String(formData.get("subscriptionId")), planVersionId: String(formData.get("planVersionId")), quantity: optionalInt(formData.get("quantity")) ?? 1, operationKey: String(formData.get("operationKey")) }); });
}

export async function renewSubscriptionAction(formData: FormData) {
  const actor = await requireUser();
  return handled(async () => { await renewCommercialSubscription(actor, { subscriptionId: String(formData.get("subscriptionId")), renewalDate: new Date(String(formData.get("renewalDate"))), reason: String(formData.get("reason") ?? ""), expectedRevision: Number(formData.get("expectedRevision")), operationKey: String(formData.get("operationKey")) }); });
}

export async function createPromotionAction(formData: FormData) {
  const actor = await requireUser();
  return handled(async () => {
    const discountType = String(formData.get("discountType")) === "FIXED_AMOUNT" ? "FIXED_AMOUNT" : "PERCENT";
    const discountValue = discountType === "PERCENT" ? Math.round(Number(formData.get("discountValue")) * 100) : parseMoneyToCents(String(formData.get("discountValue")))!;
    await createCommercialPromotion(actor, { name: String(formData.get("name") ?? ""), code: String(formData.get("code") ?? ""), discountType, discountValue, effectiveFrom: new Date(String(formData.get("effectiveFrom"))), effectiveTo: formData.get("effectiveTo") ? new Date(String(formData.get("effectiveTo"))) : null, eligiblePlanVersionIds: formData.getAll("eligiblePlanVersionIds").map(String).filter(Boolean), operationKey: String(formData.get("operationKey")) });
  });
}

export async function createPriceOverrideAction(formData: FormData) {
  const actor = await requireUser();
  return handled(async () => {
    const rawType = String(formData.get("overrideType"));
    const type = (["PRICE", "BRANCH_ALLOWANCE", "EMPLOYEE_ALLOWANCE", "BUSINESS_AI_ALLOWANCE", "GROUP_AI_ALLOWANCE"] as const).find(value => value === rawType) ?? "PRICE";
    const value = type === "PRICE" ? parseMoneyToCents(String(formData.get("value"))) : optionalInt(formData.get("value"));
    if (value === null) throw new Error("COMMERCIAL_OVERRIDE_INVALID");
    await createCommercialOverride(actor, { subscriptionId: String(formData.get("subscriptionId")), type, value, effectiveFrom: new Date(String(formData.get("effectiveFrom"))), effectiveTo: formData.get("effectiveTo") ? new Date(String(formData.get("effectiveTo"))) : null, reason: String(formData.get("reason") ?? ""), operationKey: String(formData.get("operationKey")) });
  });
}

function optionalInt(value: FormDataEntryValue | null) { if (value === null || String(value).trim() === "") return null; const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 0) throw new Error("COMMERCIAL_INTEGER_INVALID"); return parsed; }
async function handled(work: () => Promise<void>) { let type = "success"; let message = "Commercial configuration saved."; try { await work(); } catch (error) { type = "error"; message = error instanceof Error ? error.message : "Unable to save commercial configuration."; } revalidatePath("/admin/commercial"); redirect(`/admin/commercial?type=${type}&message=${encodeURIComponent(message)}`); }
