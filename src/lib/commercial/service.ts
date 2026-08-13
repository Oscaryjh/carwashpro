import { Prisma, type CommercialBillingInterval, type CommercialOverrideType, type CommercialPlanType, type CommercialScopeType } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { createAiAllowancePolicy } from "@/lib/ai/commercial";
import type { AppSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { MODULE_REGISTRY, moduleKeys, type ModuleKey } from "@/lib/modules/registry";
import { percentDiscount } from "./money";

export class CommercialError extends Error { constructor(readonly code: string) { super(code); } }
const TX = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

export type PlanVersionInput = {
  planId: string; operationKey: string; effectiveFrom: Date; effectiveTo?: Date | null;
  monthlyListPriceCents: number | null; annualListPriceCents: number | null; setupFeeCents: number | null;
  includedBranches: number | null; includedEmployees: number | null;
  extraBranchUnitPriceCents: number | null; extraEmployeeUnitPriceCents: number | null;
  businessAiAllowance: number | null; groupAiAllowance: number | null; modules: ModuleKey[];
};

export function assertPlatformAdmin(actor: AppSession) {
  if (actor.role !== "PLATFORM_ADMIN" || actor.status !== "active") throw new CommercialError("COMMERCIAL_PLATFORM_AUTHORITY_REQUIRED");
}

export async function createCommercialPlan(actor: AppSession, input: { code: string; displayName: string; description?: string; scopeType: CommercialScopeType; planType: CommercialPlanType; operationKey: string }) {
  assertPlatformAdmin(actor);
  return idempotent(input.operationKey, "CREATE_PLAN", actor.userId, async (tx) => {
    const plan = await tx.commercialPlan.create({ data: { code: input.code.trim().toUpperCase(), displayName: input.displayName.trim(), description: input.description?.trim() || null, scopeType: input.scopeType, planType: input.planType, createdById: actor.userId } });
    await audit(tx, actor.userId, "PLAN_CREATED", "CommercialPlan", plan.id, null, { code: plan.code, scopeType: plan.scopeType, planType: plan.planType });
    return plan;
  });
}

export async function createCommercialPlanVersion(actor: AppSession, input: PlanVersionInput) {
  assertPlatformAdmin(actor); validateVersion(input);
  return idempotent(input.operationKey, "CREATE_PLAN_VERSION", actor.userId, async (tx) => {
    await lock(tx, `commercial-plan:${input.planId}`);
    const plan = await tx.commercialPlan.findUnique({ where: { id: input.planId } });
    if (!plan) throw new CommercialError("COMMERCIAL_PLAN_NOT_FOUND");
    validateModules(input.modules);
    if (plan.scopeType === "BUSINESS" && input.groupAiAllowance) throw new CommercialError("COMMERCIAL_SCOPE_MISMATCH");
    if (plan.scopeType === "GROUP" && (input.businessAiAllowance || input.modules.length)) throw new CommercialError("COMMERCIAL_SCOPE_MISMATCH");
    const latest = await tx.commercialPlanVersion.findFirst({ where: { planId: plan.id }, orderBy: { version: "desc" } });
    const version = await tx.commercialPlanVersion.create({ data: { planId: plan.id, version: (latest?.version ?? 0) + 1, currency: "MYR", effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo ?? null, monthlyListPriceCents: input.monthlyListPriceCents, annualListPriceCents: input.annualListPriceCents, setupFeeCents: input.setupFeeCents, includedBranches: input.includedBranches, includedEmployees: input.includedEmployees, extraBranchUnitPriceCents: input.extraBranchUnitPriceCents, extraEmployeeUnitPriceCents: input.extraEmployeeUnitPriceCents, businessAiAllowance: input.businessAiAllowance, groupAiAllowance: input.groupAiAllowance, createdById: actor.userId, modules: { createMany: { data: [...new Set(input.modules)].map(moduleKey => ({ moduleKey })) } } } });
    await audit(tx, actor.userId, "PLAN_VERSION_CREATED", "CommercialPlanVersion", version.id, null, { planId: plan.id, version: version.version });
    return version;
  });
}

export async function activateCommercialPlanVersion(actor: AppSession, planVersionId: string, operationKey: string, now = new Date()) {
  assertPlatformAdmin(actor);
  return idempotent(operationKey, "ACTIVATE_PLAN_VERSION", actor.userId, async (tx) => {
    const version = await tx.commercialPlanVersion.findUnique({ where: { id: planVersionId }, include: { plan: true, modules: true } });
    if (!version) throw new CommercialError("COMMERCIAL_PLAN_VERSION_NOT_FOUND");
    await lock(tx, `commercial-plan:${version.planId}`);
    const current = await tx.commercialPlanVersion.findUnique({ where: { id: version.id } });
    if (current?.status === "ACTIVE") return current;
    if (current?.status !== "DRAFT") throw new CommercialError("COMMERCIAL_PLAN_VERSION_IMMUTABLE");
    validateModules(version.modules.map(row => row.moduleKey as ModuleKey));
    await tx.commercialPlanVersion.updateMany({ where: { planId: version.planId, status: "ACTIVE", effectiveFrom: { lt: version.effectiveFrom } }, data: { status: "RETIRED", effectiveTo: version.effectiveFrom } });
    const active = await tx.commercialPlanVersion.update({ where: { id: version.id }, data: { status: "ACTIVE", activatedAt: now, activatedById: actor.userId } });
    await audit(tx, actor.userId, "PLAN_VERSION_ACTIVATED", "CommercialPlanVersion", active.id, { status: "DRAFT" }, { status: "ACTIVE" });
    return active;
  });
}

export async function createCommercialPromotion(actor: AppSession, input: { name: string; code?: string; discountType: "PERCENT" | "FIXED_AMOUNT"; discountValue: number; effectiveFrom: Date; effectiveTo?: Date | null; eligiblePlanVersionIds: string[]; operationKey: string }) {
  assertPlatformAdmin(actor);
  if (!Number.isInteger(input.discountValue) || input.discountValue <= 0 || (input.discountType === "PERCENT" && input.discountValue > 10_000)) throw new CommercialError("COMMERCIAL_DISCOUNT_INVALID");
  return idempotent(input.operationKey, "CREATE_PROMOTION", actor.userId, async tx => {
    const promotion = await tx.commercialPromotion.create({ data: { name: input.name.trim(), code: input.code?.trim() || null, discountType: input.discountType, discountValue: input.discountValue, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo ?? null, status: "ACTIVE", createdById: actor.userId, eligibleVersions: { createMany: { data: [...new Set(input.eligiblePlanVersionIds)].map(planVersionId => ({ planVersionId })) } } } });
    await audit(tx, actor.userId, "PROMOTION_CREATED", "CommercialPromotion", promotion.id, null, { discountType: promotion.discountType, discountValue: promotion.discountValue });
    return promotion;
  });
}

export async function createCommercialSubscription(actor: AppSession, input: { scopeType: CommercialScopeType; businessId?: string | null; groupId?: string | null; basePlanVersionId: string; addOnPlanVersionIds?: string[]; billingInterval: CommercialBillingInterval; startDate: Date; renewalDate: Date; promotionId?: string | null; operationKey: string }) {
  assertPlatformAdmin(actor);
  return idempotent(input.operationKey, "CREATE_SUBSCRIPTION", actor.userId, async tx => {
    const scope = await resolveScope(tx, input);
    await lock(tx, `commercial-scope:${scope.scopeKey}`);
    const versions = await tx.commercialPlanVersion.findMany({ where: { id: { in: [input.basePlanVersionId, ...(input.addOnPlanVersionIds ?? [])] } }, include: { plan: true } });
    const base = versions.find(v => v.id === input.basePlanVersionId);
    if (!base || base.status !== "ACTIVE" || base.plan.planType !== "BASE" || base.plan.scopeType !== input.scopeType || !effectiveOn(base, input.startDate)) throw new CommercialError("COMMERCIAL_BASE_PLAN_INVALID");
    for (const id of input.addOnPlanVersionIds ?? []) { const item = versions.find(v => v.id === id); if (!item || item.status !== "ACTIVE" || item.plan.planType !== "ADD_ON" || item.plan.scopeType !== input.scopeType || !effectiveOn(item, input.startDate)) throw new CommercialError("COMMERCIAL_ADD_ON_INVALID"); }
    const current = await tx.commercialSubscription.findFirst({ where: scope.businessId ? { businessId: scope.businessId, status: { in: ["PENDING", "ACTIVE", "SUSPENDED"] } } : { groupId: scope.groupId, status: { in: ["PENDING", "ACTIVE", "SUSPENDED"] } } });
    if (current) throw new CommercialError("COMMERCIAL_SUBSCRIPTION_ALREADY_EXISTS");
    const subscription = await tx.commercialSubscription.create({ data: { scopeType: input.scopeType, businessId: scope.businessId, groupId: scope.groupId, status: input.startDate <= new Date() ? "ACTIVE" : "PENDING", startDate: input.startDate, renewalDate: input.renewalDate, billingIntervalSnapshot: input.billingInterval, promotionId: input.promotionId ?? null, createdById: actor.userId, items: { createMany: { data: [{ planVersionId: base.id, itemType: "BASE" as const, startDate: input.startDate, status: input.startDate <= new Date() ? "ACTIVE" as const : "SCHEDULED" as const }, ...(input.addOnPlanVersionIds ?? []).map(planVersionId => ({ planVersionId, itemType: "ADD_ON" as const, startDate: input.startDate, status: input.startDate <= new Date() ? "ACTIVE" as const : "SCHEDULED" as const }))] } } } });
    await audit(tx, actor.userId, "SUBSCRIPTION_CREATED", "CommercialSubscription", subscription.id, null, { scopeType: input.scopeType, basePlanVersionId: base.id }, subscription.id);
    return subscription;
  });
}

export async function addCommercialSubscriptionItem(actor: AppSession, input: { subscriptionId: string; planVersionId: string; quantity?: number; startDate?: Date; operationKey: string }) {
  assertPlatformAdmin(actor);
  const quantity = input.quantity ?? 1;
  const startDate = input.startDate ?? new Date();
  if (!Number.isInteger(quantity) || quantity <= 0 || !Number.isFinite(startDate.getTime())) throw new CommercialError("COMMERCIAL_ADD_ON_INVALID");
  const item = await idempotent(input.operationKey, "ADD_SUBSCRIPTION_ITEM", actor.userId, async tx => {
    await lock(tx, `commercial-subscription:${input.subscriptionId}`);
    const [subscription, version] = await Promise.all([
      tx.commercialSubscription.findUnique({ where: { id: input.subscriptionId } }),
      tx.commercialPlanVersion.findUnique({ where: { id: input.planVersionId }, include: { plan: true } }),
    ]);
    if (!subscription || subscription.status !== "ACTIVE" || !version || version.status !== "ACTIVE" || version.plan.planType !== "ADD_ON" || version.plan.scopeType !== subscription.scopeType || !effectiveOn(version, startDate)) throw new CommercialError("COMMERCIAL_ADD_ON_INVALID");
    const duplicate = await tx.commercialSubscriptionItem.findFirst({ where: { subscriptionId: subscription.id, planVersionId: version.id, status: { in: ["SCHEDULED", "ACTIVE"] } } });
    if (duplicate) throw new CommercialError("COMMERCIAL_ADD_ON_ALREADY_ACTIVE");
    const created = await tx.commercialSubscriptionItem.create({ data: { subscriptionId: subscription.id, planVersionId: version.id, itemType: "ADD_ON", quantity, startDate, status: startDate <= new Date() ? "ACTIVE" : "SCHEDULED" } });
    await tx.commercialSubscription.update({ where: { id: subscription.id }, data: { revision: { increment: 1 } } });
    await audit(tx, actor.userId, "SUBSCRIPTION_ADD_ON_ADDED", "CommercialSubscriptionItem", created.id, null, { planVersionId: version.id, quantity }, subscription.id);
    return created;
  });
  if (item.status === "ACTIVE") await projectCommercialConfiguration(actor, input.subscriptionId, startDate);
  return item;
}

export async function renewCommercialSubscription(actor: AppSession, input: { subscriptionId: string; renewalDate: Date; reason: string; expectedRevision?: number; operationKey: string }) {
  assertPlatformAdmin(actor);
  if (!Number.isFinite(input.renewalDate.getTime()) || input.reason.trim().length < 5) throw new CommercialError("COMMERCIAL_RENEWAL_INVALID");
  return idempotent(input.operationKey, "RENEW_SUBSCRIPTION", actor.userId, async tx => {
    await lock(tx, `commercial-subscription:${input.subscriptionId}`);
    const current = await tx.commercialSubscription.findUnique({ where: { id: input.subscriptionId } });
    if (!current || !["ACTIVE", "SUSPENDED"].includes(current.status) || input.renewalDate <= current.renewalDate) throw new CommercialError("COMMERCIAL_RENEWAL_INVALID");
    if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) throw new CommercialError("COMMERCIAL_SUBSCRIPTION_STALE");
    const renewed = await tx.commercialSubscription.update({ where: { id: current.id }, data: { renewalDate: input.renewalDate, revision: { increment: 1 } } });
    await audit(tx, actor.userId, "SUBSCRIPTION_RENEWED", "CommercialSubscription", renewed.id, { renewalDate: current.renewalDate.toISOString(), revision: current.revision }, { renewalDate: renewed.renewalDate.toISOString(), revision: renewed.revision }, renewed.id);
    return renewed;
  });
}

export async function createCommercialOverride(actor: AppSession, input: { subscriptionId: string; type: CommercialOverrideType; value: number; effectiveFrom: Date; effectiveTo?: Date | null; reason: string; expectedRevision?: number; operationKey: string }) {
  assertPlatformAdmin(actor);
  if (!Number.isInteger(input.value) || input.value < 0 || input.reason.trim().length < 5) throw new CommercialError("COMMERCIAL_OVERRIDE_INVALID");
  return idempotent(input.operationKey, "CREATE_OVERRIDE", actor.userId, async tx => {
    await lock(tx, `commercial-subscription:${input.subscriptionId}`);
    const subscription = await tx.commercialSubscription.findUnique({ where: { id: input.subscriptionId } });
    if (!subscription) throw new CommercialError("COMMERCIAL_SUBSCRIPTION_NOT_FOUND");
    const latest = await tx.commercialOverride.findFirst({ where: { subscriptionId: subscription.id, type: input.type }, orderBy: { revision: "desc" } });
    if (input.expectedRevision !== undefined && (latest?.revision ?? 0) !== input.expectedRevision) throw new CommercialError("COMMERCIAL_OVERRIDE_STALE");
    if (latest?.status === "ACTIVE") await tx.commercialOverride.update({ where: { id: latest.id }, data: { status: "SUPERSEDED" } });
    const created = await tx.commercialOverride.create({ data: { subscriptionId: subscription.id, scopeType: subscription.scopeType, businessId: subscription.businessId, groupId: subscription.groupId, type: input.type, value: input.value, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo ?? null, reason: input.reason.trim(), revision: (latest?.revision ?? 0) + 1, createdById: actor.userId } });
    await audit(tx, actor.userId, "SUBSCRIPTION_OVERRIDE_CREATED", "CommercialOverride", created.id, latest ? { revision: latest.revision, value: latest.value } : null, { revision: created.revision, value: created.value, type: created.type }, subscription.id);
    return created;
  });
}

export async function scheduleCommercialPlanChange(actor: AppSession, input: { subscriptionId: string; newBasePlanVersionId: string; effectiveAt: Date; reason: string; operationKey: string }) {
  assertPlatformAdmin(actor);
  if (input.reason.trim().length < 5) throw new CommercialError("COMMERCIAL_CHANGE_REASON_INVALID");
  return idempotent(input.operationKey, "SCHEDULE_PLAN_CHANGE", actor.userId, async tx => {
    await lock(tx, `commercial-subscription:${input.subscriptionId}`);
    const [subscription, version] = await Promise.all([tx.commercialSubscription.findUnique({ where: { id: input.subscriptionId } }), tx.commercialPlanVersion.findUnique({ where: { id: input.newBasePlanVersionId }, include: { plan: true } })]);
    if (!subscription || !version || version.status !== "ACTIVE" || version.plan.planType !== "BASE" || version.plan.scopeType !== subscription.scopeType) throw new CommercialError("COMMERCIAL_SCHEDULED_PLAN_INVALID");
    await tx.commercialScheduledPlanChange.updateMany({ where: { subscriptionId: subscription.id, status: "SCHEDULED" }, data: { status: "CANCELLED" } });
    const change = await tx.commercialScheduledPlanChange.create({ data: { subscriptionId: subscription.id, newBasePlanVersionId: version.id, effectiveAt: input.effectiveAt, reason: input.reason.trim(), operationKey: input.operationKey, createdById: actor.userId } });
    await audit(tx, actor.userId, "PLAN_CHANGE_SCHEDULED", "CommercialScheduledPlanChange", change.id, null, { newBasePlanVersionId: version.id, effectiveAt: change.effectiveAt.toISOString() }, subscription.id);
    return change;
  });
}

export async function applyDueCommercialPlanChange(actor: AppSession, subscriptionId: string, now = new Date()) {
  assertPlatformAdmin(actor);
  const change = await prisma.commercialScheduledPlanChange.findFirst({ where: { subscriptionId, status: "SCHEDULED", effectiveAt: { lte: now } }, orderBy: { effectiveAt: "asc" } });
  if (!change) throw new CommercialError("COMMERCIAL_SCHEDULED_CHANGE_NOT_DUE");
  const result = await idempotent(`APPLY:${change.operationKey}`, "APPLY_PLAN_CHANGE", actor.userId, async tx => {
    await lock(tx, `commercial-subscription:${subscriptionId}`);
    const currentBase = await tx.commercialSubscriptionItem.findFirst({ where: { subscriptionId, itemType: "BASE", status: "ACTIVE" } });
    if (!currentBase) throw new CommercialError("COMMERCIAL_ACTIVE_BASE_MISSING");
    await tx.commercialSubscriptionItem.update({ where: { id: currentBase.id }, data: { status: "ENDED", endDate: change.effectiveAt } });
    const item = await tx.commercialSubscriptionItem.create({ data: { subscriptionId, planVersionId: change.newBasePlanVersionId, itemType: "BASE", status: "ACTIVE", startDate: change.effectiveAt } });
    await tx.commercialScheduledPlanChange.update({ where: { id: change.id }, data: { status: "APPLIED", appliedAt: now } });
    await tx.commercialSubscription.update({ where: { id: subscriptionId }, data: { revision: { increment: 1 } } });
    return item;
  });
  await projectCommercialConfiguration(actor, subscriptionId, now);
  return result;
}

export async function getEffectiveCommercialConfiguration(input: { businessId?: string; groupId?: string; now?: Date }, database: Prisma.TransactionClient | typeof prisma = prisma) {
  const now = input.now ?? new Date();
  const subscription = await database.commercialSubscription.findFirst({ where: input.businessId ? { businessId: input.businessId, status: "ACTIVE", startDate: { lte: now }, OR: [{ endDate: null }, { endDate: { gt: now } }] } : { groupId: input.groupId, status: "ACTIVE", startDate: { lte: now }, OR: [{ endDate: null }, { endDate: { gt: now } }] }, include: { promotion: true, items: { where: { status: "ACTIVE", startDate: { lte: now }, OR: [{ endDate: null }, { endDate: { gt: now } }] }, include: { planVersion: { include: { plan: true, modules: true } } } }, overrides: { where: { status: "ACTIVE", effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, orderBy: { revision: "desc" } } } });
  if (!subscription) return { state: "LEGACY_REVIEW_REQUIRED" as const, subscription: null, price: null, modules: [] as ModuleKey[], allowances: null };
  const activeItems = subscription.items;
  const base = activeItems.find(i => i.itemType === "BASE");
  if (!base) return { state: "CONFIGURATION_REVIEW_REQUIRED" as const, subscription, price: null, modules: [] as ModuleKey[], allowances: null };
  const listParts = activeItems.map(item => ({ id: item.id, cents: priceFor(item.planVersion, subscription.billingIntervalSnapshot), quantity: item.quantity }));
  const missingPrice = listParts.some(p => p.cents === null);
  const listSubtotalCents = missingPrice ? null : listParts.reduce((sum, part) => sum + part.cents! * part.quantity, 0);
  let promotionDiscountCents = 0;
  const promotionEligible = subscription.promotion && subscription.promotion.status === "ACTIVE" && subscription.promotion.effectiveFrom <= now && (!subscription.promotion.effectiveTo || subscription.promotion.effectiveTo > now);
  const eligiblePromotion = promotionEligible && await database.commercialPromotionPlanVersion.count({ where: { promotionId: subscription.promotion!.id, planVersionId: { in: activeItems.map(item => item.planVersionId) } } }) > 0;
  if (listSubtotalCents !== null && eligiblePromotion) promotionDiscountCents = subscription.promotion!.discountType === "PERCENT" ? percentDiscount(listSubtotalCents, subscription.promotion!.discountValue) : Math.min(listSubtotalCents, subscription.promotion!.discountValue);
  const latest = new Map<CommercialOverrideType, (typeof subscription.overrides)[number]>();
  for (const override of subscription.overrides) if (!latest.has(override.type)) latest.set(override.type, override);
  const priceOverride = latest.get("PRICE")?.value ?? null;
  const effectiveRecurringPriceCents = priceOverride ?? (listSubtotalCents === null ? null : Math.max(0, listSubtotalCents - promotionDiscountCents));
  const sum = (field: "includedBranches" | "includedEmployees" | "businessAiAllowance" | "groupAiAllowance") => activeItems.reduce((total, item) => total + (item.planVersion[field] ?? 0) * item.quantity, 0);
  const modules = [...new Set(activeItems.flatMap(item => item.planVersion.modules.map(row => row.moduleKey as ModuleKey)))];
  return { state: effectiveRecurringPriceCents === null ? "PRICE_REVIEW_REQUIRED" as const : "MATCH" as const, subscription, price: { listSubtotalCents, promotionDiscountCents: priceOverride === null ? promotionDiscountCents : 0, overrideCents: priceOverride, effectiveRecurringPriceCents }, modules, allowances: { branches: latest.get("BRANCH_ALLOWANCE")?.value ?? sum("includedBranches"), employees: latest.get("EMPLOYEE_ALLOWANCE")?.value ?? sum("includedEmployees"), businessAi: latest.get("BUSINESS_AI_ALLOWANCE")?.value ?? sum("businessAiAllowance"), groupAi: latest.get("GROUP_AI_ALLOWANCE")?.value ?? sum("groupAiAllowance") } };
}

export async function projectCommercialConfiguration(actor: AppSession, subscriptionId: string, now = new Date()) {
  assertPlatformAdmin(actor);
  const target = await prisma.commercialSubscription.findUnique({ where: { id: subscriptionId } });
  if (!target) throw new CommercialError("COMMERCIAL_SUBSCRIPTION_NOT_FOUND");
  const state = await getEffectiveCommercialConfiguration(target.businessId ? { businessId: target.businessId, now } : { groupId: target.groupId!, now });
  if (!state.subscription || !state.allowances) throw new CommercialError("COMMERCIAL_CONFIGURATION_NOT_EFFECTIVE");
  if (target.businessId) {
    await projectBusinessModules(actor, target.businessId, state.modules, now, state.subscription.endDate, state.subscription.id);
    await createAiAllowancePolicy({ actorUserId: actor.userId, scopeType: "BUSINESS", businessId: target.businessId, effectiveFrom: now, effectiveTo: null, requestLimit: state.allowances.businessAi, source: "PLAN", reason: `Commercial subscription ${target.id} projection.` });
  } else {
    await createAiAllowancePolicy({ actorUserId: actor.userId, scopeType: "GROUP", groupId: target.groupId, timezone: "Asia/Kuala_Lumpur", effectiveFrom: now, effectiveTo: null, requestLimit: state.allowances.groupAi, source: "PLAN", reason: `Commercial subscription ${target.id} projection.` });
  }
  return state;
}

export async function assertCommercialBranchCapacity(businessId: string, tx: Prisma.TransactionClient | typeof prisma = prisma, increment = 1, now = new Date()) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`commercial-scope:BUSINESS:${businessId}`}, 0))`;
  const state = await getEffectiveCommercialConfiguration({ businessId, now }, tx);
  if (!state.subscription || !state.allowances) return { legacy: true, allowed: null, current: await tx.branch.count({ where: { businessId, status: "ACTIVE" } }) };
  const current = await tx.branch.count({ where: { businessId, status: "ACTIVE" } });
  if (current + increment > state.allowances.branches) throw new CommercialError("COMMERCIAL_BRANCH_LIMIT_REACHED");
  return { legacy: false, allowed: state.allowances.branches, current };
}

export async function assertCommercialEmployeeCapacity(businessId: string, tx: Prisma.TransactionClient | typeof prisma = prisma, increment = 1, now = new Date()) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`commercial-scope:BUSINESS:${businessId}`}, 0))`;
  const state = await getEffectiveCommercialConfiguration({ businessId, now }, tx);
  if (!state.subscription || !state.allowances) return { legacy: true, allowed: null, current: await tx.employeeBusinessMembership.count({ where: { businessId, status: "ACTIVE" } }) };
  const current = await tx.employeeBusinessMembership.count({ where: { businessId, status: "ACTIVE" } });
  if (current + increment > state.allowances.employees) throw new CommercialError("COMMERCIAL_EMPLOYEE_LIMIT_REACHED");
  return { legacy: false, allowed: state.allowances.employees, current };
}

export async function reconcileCommercialState(input: { businessId?: string; groupId?: string }, now = new Date()) {
  const state = await getEffectiveCommercialConfiguration({ ...input, now });
  if (!state.subscription) return { status: "LEGACY_REVIEW_REQUIRED" as const, issues: ["LEGACY_PRICE_REVIEW_REQUIRED"] };
  const issues: string[] = [];
  if (state.state === "CONFIGURATION_REVIEW_REQUIRED") issues.push("ACTIVE_BASE_MISSING");
  if (state.state === "PRICE_REVIEW_REQUIRED") issues.push("PRICE_REVIEW_REQUIRED");
  if (input.businessId && state.allowances) {
    const [branches, employees, entitlements, policy] = await Promise.all([prisma.branch.count({ where: { businessId: input.businessId, status: "ACTIVE" } }), prisma.employeeBusinessMembership.count({ where: { businessId: input.businessId, status: "ACTIVE" } }), prisma.businessModuleEntitlement.findMany({ where: { businessId: input.businessId, status: "ENABLED", enabledFrom: { lte: now }, OR: [{ enabledUntil: null }, { enabledUntil: { gt: now } }] } }), prisma.aiAllowancePolicy.findFirst({ where: { scopeKey: `BUSINESS:${input.businessId}`, source: "PLAN", effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, orderBy: { revision: "desc" } })]);
    if (branches > state.allowances.branches || employees > state.allowances.employees) issues.push("OVER_LIMIT");
    if (state.modules.some(module => module !== "CORE" && !entitlements.some(row => row.moduleKey === module))) issues.push("ENTITLEMENT_MISMATCH");
    if (policy?.requestLimit !== state.allowances.businessAi) issues.push("AI_ALLOWANCE_MISMATCH");
  }
  return { status: issues.length ? "REVIEW_REQUIRED" as const : "MATCH" as const, issues };
}

async function projectBusinessModules(actor: AppSession, businessId: string, desired: ModuleKey[], from: Date, until: Date | null, planCode: string) {
  const ordered = moduleKeys.filter(key => key !== "CORE" && desired.includes(key));
  await prisma.$transaction(async tx => { await lock(tx, `business-module:${businessId}`); const current = await tx.businessModuleEntitlement.findMany({ where: { businessId } }); for (const moduleKey of [...moduleKeys].reverse()) { if (moduleKey === "CORE" || desired.includes(moduleKey)) continue; const row = current.find(v => v.moduleKey === moduleKey); if (!row || row.status === "DISABLED") continue; const revision = row.revision + 1; const entitlement = await tx.businessModuleEntitlement.update({ where: { id: row.id }, data: { status: "DISABLED", enabledFrom: from, enabledUntil: null, source: "PLAN", planCode, revision, updatedById: actor.userId } }); await tx.businessModuleEntitlementEvent.create({ data: { entitlementId: entitlement.id, businessId, moduleKey, revision, oldStatus: row.status, newStatus: "DISABLED", oldEnabledFrom: row.enabledFrom, newEnabledFrom: from, oldEnabledUntil: row.enabledUntil, newEnabledUntil: null, source: "PLAN", planCode, reason: "Commercial subscription projection.", actorUserId: actor.userId } }); } for (const moduleKey of ordered) { const row = current.find(v => v.moduleKey === moduleKey); const revision = (row?.revision ?? 0) + 1; const entitlement = row ? await tx.businessModuleEntitlement.update({ where: { id: row.id }, data: { status: "ENABLED", enabledFrom: from, enabledUntil: until, source: "PLAN", planCode, revision, updatedById: actor.userId } }) : await tx.businessModuleEntitlement.create({ data: { businessId, moduleKey, status: "ENABLED", enabledFrom: from, enabledUntil: until, source: "PLAN", planCode, revision, createdById: actor.userId, updatedById: actor.userId } }); await tx.businessModuleEntitlementEvent.create({ data: { entitlementId: entitlement.id, businessId, moduleKey, revision, oldStatus: row?.status ?? null, newStatus: "ENABLED", oldEnabledFrom: row?.enabledFrom ?? null, newEnabledFrom: from, oldEnabledUntil: row?.enabledUntil ?? null, newEnabledUntil: until, source: "PLAN", planCode, reason: "Commercial subscription projection.", actorUserId: actor.userId } }); } }, TX);
}

function validateVersion(input: PlanVersionInput) { if (!Number.isFinite(input.effectiveFrom.getTime()) || (input.effectiveTo && input.effectiveTo <= input.effectiveFrom)) throw new CommercialError("COMMERCIAL_VERSION_PERIOD_INVALID"); for (const value of [input.monthlyListPriceCents, input.annualListPriceCents, input.setupFeeCents, input.includedBranches, input.includedEmployees, input.extraBranchUnitPriceCents, input.extraEmployeeUnitPriceCents, input.businessAiAllowance, input.groupAiAllowance]) if (value !== null && (!Number.isInteger(value) || value < 0)) throw new CommercialError("COMMERCIAL_VERSION_VALUE_INVALID"); }
function validateModules(modules: ModuleKey[]) { const set = new Set(modules); for (const key of set) for (const dependency of MODULE_REGISTRY[key].dependencies) if (dependency !== "CORE" && !set.has(dependency)) throw new CommercialError(`COMMERCIAL_MODULE_DEPENDENCY_REQUIRED:${key}:${dependency}`); }
function priceFor(version: { monthlyListPriceCents: number | null; annualListPriceCents: number | null }, interval: CommercialBillingInterval) { return interval === "MONTHLY" ? version.monthlyListPriceCents : version.annualListPriceCents; }
function effectiveOn(version: { effectiveFrom: Date; effectiveTo: Date | null }, at: Date) { return version.effectiveFrom <= at && (!version.effectiveTo || version.effectiveTo > at); }
async function resolveScope(tx: Prisma.TransactionClient, input: { scopeType: CommercialScopeType; businessId?: string | null; groupId?: string | null }) { if (input.scopeType === "BUSINESS" && input.businessId && !input.groupId && await tx.business.count({ where: { id: input.businessId } })) return { businessId: input.businessId, groupId: null, scopeKey: `BUSINESS:${input.businessId}` }; if (input.scopeType === "GROUP" && input.groupId && !input.businessId && await tx.businessGroup.count({ where: { id: input.groupId } })) return { businessId: null, groupId: input.groupId, scopeKey: `GROUP:${input.groupId}` }; throw new CommercialError("COMMERCIAL_SCOPE_INVALID"); }
async function lock(tx: Prisma.TransactionClient, key: string) { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`; }
async function replayCommand<T>(tx: Prisma.TransactionClient, commandType: string, resultId: string): Promise<T | null> {
  const where = { where: { id: resultId } };
  switch (commandType) {
    case "CREATE_PLAN": return await tx.commercialPlan.findUnique(where) as T | null;
    case "CREATE_PLAN_VERSION":
    case "ACTIVATE_PLAN_VERSION": return await tx.commercialPlanVersion.findUnique(where) as T | null;
    case "CREATE_SUBSCRIPTION":
    case "RENEW_SUBSCRIPTION": return await tx.commercialSubscription.findUnique(where) as T | null;
    case "CREATE_PROMOTION": return await tx.commercialPromotion.findUnique(where) as T | null;
    case "CREATE_OVERRIDE": return await tx.commercialOverride.findUnique(where) as T | null;
    case "SCHEDULE_PLAN_CHANGE": return await tx.commercialScheduledPlanChange.findUnique(where) as T | null;
    case "APPLY_PLAN_CHANGE":
    case "ADD_SUBSCRIPTION_ITEM": return await tx.commercialSubscriptionItem.findUnique(where) as T | null;
    default: throw new CommercialError("COMMERCIAL_IDEMPOTENT_REPLAY_UNSUPPORTED");
  }
}
async function idempotent<T extends { id: string }>(operationKey: string, commandType: string, actorUserId: string, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> { for (let attempt = 0; attempt < 4; attempt++) try { return await prisma.$transaction(async tx => { const existing = await tx.commercialCommand.findUnique({ where: { operationKey } }); if (existing && existing.commandType !== commandType) throw new CommercialError("COMMERCIAL_OPERATION_KEY_CONFLICT"); if (existing?.resultId) { const replay = await replayCommand<T>(tx, commandType, existing.resultId); if (replay) return replay; } if (!existing) await tx.commercialCommand.create({ data: { operationKey, commandType, actorUserId } }); const result = await work(tx); await tx.commercialCommand.update({ where: { operationKey }, data: { resultId: result.id } }); return result; }, TX); } catch (error) { if (attempt < 3 && typeof error === "object" && error && "code" in error && (error as { code: unknown }).code === "P2034") continue; throw error; } throw new CommercialError("COMMERCIAL_TRANSACTION_RETRY_EXHAUSTED"); }
async function audit(tx: Prisma.TransactionClient, actorUserId: string, action: string, entityType: string, entityId: string, before: Prisma.InputJsonValue | null, after: Prisma.InputJsonValue | null, subscriptionId?: string) { await tx.commercialAuditEvent.create({ data: { action, entityType, entityId, actorUserId, subscriptionId: subscriptionId ?? null, before: before ?? undefined, after: after ?? undefined } }); }
export function newCommercialOperationKey(prefix: string) { return `${prefix}:${randomUUID()}`; }
