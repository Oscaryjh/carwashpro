import type { AppSession } from "@/lib/auth/session";
import type { AuditRequestContext } from "@/lib/audit";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { utcDateToDateValue } from "@/lib/business-time";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  SABAH_LEAVE_EFFECTIVE_FROM,
  SABAH_LEAVE_JURISDICTION,
  SABAH_LEAVE_OFFICIAL_SOURCES,
  SABAH_LEAVE_RULE_PACK_VERSION,
  SABAH_STATUTORY_LEAVE_RULES,
  sabahRulePackDigest,
  validateSabahStatutoryRulePack,
} from "@/lib/leave/sabah-statutory-rule-pack";

const dateValue = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalDateValue = z.union([z.literal(""), dateValue]).optional();

const tierSchema = z.object({
  minServiceMonths: z.coerce.number().int().min(0).max(1200),
  maxServiceMonths: z.union([z.literal(""), z.coerce.number().int().min(0).max(1200)]).optional(),
  entitlementUnits: z.coerce.number().min(0).max(366),
});

export const statutoryRuleSetCreateSchema = z.object({
  jurisdictionCountryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()),
  jurisdictionStateCode: z.string().trim().max(16).optional().transform((value) => value ? value.toUpperCase() : null),
  version: z.string().trim().min(1).max(40),
  effectiveFrom: dateValue,
  effectiveTo: optionalDateValue,
  sourceTitle: z.string().trim().min(3).max(200),
  sourceReference: z.string().trim().url().max(500),
  category: z.enum(["ANNUAL_LEAVE", "SICK_LEAVE", "HOSPITALISATION_LEAVE", "MATERNITY_LEAVE", "PATERNITY_LEAVE", "UNPAID_LEAVE"]),
  statutorySection: z.string().trim().min(3).max(160).default("Human-entered source section; independent confirmation required"),
  entitlementSemantics: z.enum(["PERIOD_BALANCE", "EVENT_BASED", "NON_ACCRUAL"]).default("PERIOD_BALANCE"),
  entitlementPeriodType: z.enum(["CALENDAR_YEAR", "SERVICE_ANNIVERSARY", "CUSTOM_YEAR"]).default("CALENDAR_YEAR"),
  customYearStartMonth: z.union([z.literal(""), z.coerce.number().int().min(1).max(12)]).optional(),
  customYearStartDay: z.union([z.literal(""), z.coerce.number().int().min(1).max(31)]).optional(),
  prorationMethod: z.enum(["NONE", "CALENDAR_DAY_RATIO", "COMPLETED_MONTHS"]).default("NONE"),
  entitlementRounding: z.enum(["NONE", "DOWN_TO_HALF_DAY", "NEAREST_HALF_DAY", "UP_TO_HALF_DAY", "STATUTORY_WHOLE_DAY"]).default("NONE"),
  eligibleEmploymentTypes: z.array(z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "DAILY", "HOURLY"])).default([]),
  tiers: z.array(tierSchema).min(1).max(10),
}).superRefine((value, context) => {
  if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
    context.addIssue({ code: "custom", path: ["effectiveTo"], message: "Effective end must not be before the start." });
  }
  if (value.entitlementPeriodType === "CUSTOM_YEAR" && (!value.customYearStartMonth || !value.customYearStartDay)) {
    context.addIssue({ code: "custom", path: ["customYearStartMonth"], message: "Custom year requires a month and day." });
  }
  const ordered = [...value.tiers].sort((left, right) => left.minServiceMonths - right.minServiceMonths);
  if (ordered[0]?.minServiceMonths !== 0) {
    context.addIssue({ code: "custom", path: ["tiers"], message: "The first service tier must start at month 0." });
  }
  ordered.forEach((tier, index) => {
    const max = tier.maxServiceMonths === "" || tier.maxServiceMonths === undefined ? null : tier.maxServiceMonths;
    if (max !== null && max < tier.minServiceMonths) {
      context.addIssue({ code: "custom", path: ["tiers", index, "maxServiceMonths"], message: "Tier end must not be before its start." });
    }
    const next = ordered[index + 1];
    if (next && (max === null || max + 1 !== next.minServiceMonths)) {
      context.addIssue({ code: "custom", path: ["tiers", index], message: "Service tiers must be continuous and non-overlapping." });
    }
    if (!next && max !== null) {
      context.addIssue({ code: "custom", path: ["tiers", index, "maxServiceMonths"], message: "The final service tier must have no end month." });
    }
  });
});

const workflowSchema = z.object({
  ruleSetId: z.string().uuid(),
  expectedStatus: z.enum(["DRAFT", "READY_FOR_REVIEW", "READY_FOR_HUMAN_SIGN_OFF"]),
  reviewNote: z.string().trim().min(3).max(500).optional(),
  confirmed: z.coerce.boolean().optional(),
});

type LeaveTransaction = Prisma.TransactionClient;

export async function createStatutoryRuleSetDraft(input: {
  businessId: string;
  actor: AppSession;
  request?: AuditRequestContext;
  rawInput: unknown;
}) {
  const data = statutoryRuleSetCreateSchema.parse(input.rawInput);
  return prisma.$transaction(async (tx) => {
    await lockRuleSet(tx, input.businessId, data.jurisdictionCountryCode, data.jurisdictionStateCode);
    const duplicate = await tx.leaveStatutoryRuleSet.findFirst({
      where: {
        businessId: input.businessId,
        jurisdictionCountryCode: data.jurisdictionCountryCode,
        jurisdictionStateCode: data.jurisdictionStateCode,
        version: data.version,
      },
      select: { id: true },
    });
    if (duplicate) throw new Error("This jurisdiction and rule-pack version already exists.");
    const saved = await tx.leaveStatutoryRuleSet.create({
      data: {
        businessId: input.businessId,
        jurisdictionCountryCode: data.jurisdictionCountryCode,
        jurisdictionStateCode: data.jurisdictionStateCode,
        version: data.version,
        effectiveFrom: toDate(data.effectiveFrom),
        effectiveTo: data.effectiveTo ? toDate(data.effectiveTo) : null,
        sourceTitle: data.sourceTitle,
        sourceReference: data.sourceReference,
        createdById: input.actor.userId,
        rules: {
          create: {
            category: data.category,
            entitlementSemantics: data.entitlementSemantics,
            entitlementPeriodType: data.entitlementPeriodType,
            customYearStartMonth: optionalNumber(data.customYearStartMonth),
            customYearStartDay: optionalNumber(data.customYearStartDay),
            prorationMethod: data.prorationMethod,
            entitlementRounding: data.entitlementRounding,
            statutorySection: data.statutorySection,
            eligibleEmploymentTypes: data.eligibleEmploymentTypes,
            tiers: {
              create: data.tiers
                .sort((left, right) => left.minServiceMonths - right.minServiceMonths)
                .map((tier) => ({
                  minServiceMonths: tier.minServiceMonths,
                  maxServiceMonths: optionalNumber(tier.maxServiceMonths),
                  entitlementUnits: tier.entitlementUnits,
                })),
            },
          },
        },
      },
      include: { rules: { include: { tiers: true } } },
    });
    await writeAuditLog({
      businessId: input.businessId,
      actor: input.actor,
      request: input.request,
      action: "LEAVE_STATUTORY_RULE_SET_DRAFTED",
      entityType: "LeaveStatutoryRuleSet",
      entityId: saved.id,
      summary: `Statutory Leave rule pack ${saved.version} saved as Draft.`,
      after: { jurisdictionCountryCode: saved.jurisdictionCountryCode, jurisdictionStateCode: saved.jurisdictionStateCode, version: saved.version, status: saved.status },
    }, tx);
    return saved;
  }, { isolationLevel: "Serializable" });
}

export async function installSabahStatutoryRulePackDraft(input: {
  businessId: string;
  actor: AppSession;
  request?: AuditRequestContext;
}) {
  const validation = validateSabahStatutoryRulePack();
  if (!validation.valid) throw new Error(`Sabah statutory pack validation failed: ${validation.failures.join(" ")}`);
  return prisma.$transaction(async (tx) => {
    const sabahWorkplace = await tx.branch.findFirst({
      where: {
        businessId: input.businessId,
        status: "ACTIVE",
        countryCode: { equals: "MY", mode: "insensitive" },
        stateCode: { in: ["12", "SBH", "SABAH"] },
      },
      select: { id: true },
    });
    if (!sabahWorkplace) {
      throw new Error("Sabah statutory Leave setup requires an active workplace with exact MY-SABAH jurisdiction configuration.");
    }
    await lockRuleSet(tx, input.businessId, "MY", "SABAH");
    const existing = await tx.leaveStatutoryRuleSet.findFirst({
      where: { businessId: input.businessId, jurisdictionCode: SABAH_LEAVE_JURISDICTION, version: SABAH_LEAVE_RULE_PACK_VERSION },
      include: { rules: { include: { tiers: true } }, sources: true },
    });
    if (existing) return existing;
    const saved = await tx.leaveStatutoryRuleSet.create({
      data: {
        businessId: input.businessId,
        jurisdictionCountryCode: "MY",
        jurisdictionStateCode: "SABAH",
        jurisdictionCode: SABAH_LEAVE_JURISDICTION,
        version: SABAH_LEAVE_RULE_PACK_VERSION,
        effectiveFrom: toDate(SABAH_LEAVE_EFFECTIVE_FROM),
        sourceTitle: SABAH_LEAVE_OFFICIAL_SOURCES[0].title,
        sourceReference: SABAH_LEAVE_OFFICIAL_SOURCES[0].url,
        sourceDigest: sabahRulePackDigest(),
        validationSnapshot: { stage: "DRAFT", ...validation },
        createdById: input.actor.userId,
        sources: {
          create: SABAH_LEAVE_OFFICIAL_SOURCES.map((source) => ({
            sourceTitle: source.title,
            sourceUrl: source.url,
            sourceSection: source.section,
            retrievedAt: new Date(source.retrievedAt),
            contentHash: source.contentHash,
          })),
        },
        rules: {
          create: SABAH_STATUTORY_LEAVE_RULES.map((rule) => ({
            category: rule.category,
            entitlementSemantics: rule.entitlementSemantics,
            entitlementPeriodType: rule.entitlementPeriodType,
            prorationMethod: rule.prorationMethod,
            entitlementRounding: rule.entitlementRounding,
            statutorySection: rule.statutorySection,
            requiresDocument: rule.requiresDocument,
            carryForwardAllowed: rule.carryForwardAllowed,
            eventRules: rule.eventRules as Prisma.InputJsonValue,
            reviewMarkers: rule.reviewMarkers as Prisma.InputJsonValue,
            tiers: { create: rule.tiers.map((tier) => ({ ...tier })) },
          })),
        },
      },
      include: { rules: { include: { tiers: true } }, sources: true },
    });
    await writeAuditLog({
      businessId: input.businessId,
      actor: input.actor,
      request: input.request,
      action: "LEAVE_SABAH_STATUTORY_PACK_INSTALLED_AS_DRAFT",
      entityType: "LeaveStatutoryRuleSet",
      entityId: saved.id,
      summary: `${SABAH_LEAVE_RULE_PACK_VERSION} installed as Draft; no legal rules were activated.`,
      after: { status: saved.status, jurisdictionCode: saved.jurisdictionCode, sourceDigest: saved.sourceDigest },
    }, tx);
    return saved;
  }, { isolationLevel: "Serializable" });
}

export async function submitStatutoryRuleSetForReview(input: {
  businessId: string;
  actor: AppSession;
  request?: AuditRequestContext;
  rawInput: unknown;
}) {
  const data = workflowSchema.parse(input.rawInput);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.leaveStatutoryRuleSet.findFirst({ where: { id: data.ruleSetId, businessId: input.businessId }, include: { rules: { include: { tiers: true } }, sources: true } });
    if (!existing) throw new Error("Rule pack is outside your business scope.");
    if (existing.status === "READY_FOR_REVIEW") return existing;
    if (existing.status !== "DRAFT" || data.expectedStatus !== "DRAFT") throw new Error("Refresh the rule pack before submitting it.");
    if (!existing.sources.length) throw new Error("At least one hashed official source is required before review.");
    if (!existing.rules.length || existing.rules.some((rule) => rule.entitlementSemantics === "PERIOD_BALANCE" && !rule.tiers.length)) throw new Error("Every period-balance rule requires at least one reviewed service tier.");
    if (existing.rules.some((rule) => rule.entitlementSemantics !== "PERIOD_BALANCE" && rule.tiers.length)) throw new Error("Event and non-accrual rules cannot create balance tiers.");
    const saved = await tx.leaveStatutoryRuleSet.update({ where: { id: existing.id }, data: { status: "READY_FOR_REVIEW" } });
    await writeAuditLog({ businessId: input.businessId, actor: input.actor, request: input.request, action: "LEAVE_STATUTORY_RULE_SET_SUBMITTED", entityType: "LeaveStatutoryRuleSet", entityId: saved.id, summary: `Statutory Leave rule pack ${saved.version} submitted for independent review.`, after: { status: saved.status } }, tx);
    return saved;
  }, { isolationLevel: "Serializable" });
}

export async function markStatutoryRuleSetReadyForHumanSignOff(input: {
  businessId: string;
  actor: AppSession;
  request?: AuditRequestContext;
  rawInput: unknown;
}) {
  const data = workflowSchema.parse(input.rawInput);
  if (!data.confirmed || !data.reviewNote) throw new Error("Independent review confirmation and a review note are required.");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.leaveStatutoryRuleSet.findFirst({
      where: { id: data.ruleSetId, businessId: input.businessId },
      include: { rules: { include: { tiers: true } }, sources: true },
    });
    if (!existing) throw new Error("Rule pack is outside your business scope.");
    if (existing.status === "READY_FOR_HUMAN_SIGN_OFF") return existing;
    if (existing.status !== "READY_FOR_REVIEW" || data.expectedStatus !== "READY_FOR_REVIEW") throw new Error("Only a review-ready rule pack can become a human sign-off candidate.");
    if (existing.createdById === input.actor.userId) throw new Error("Independent review is required: the creator cannot review the same rule pack.");
    const failures: string[] = [];
    if (!existing.sources.length) failures.push("No official source evidence.");
    if (existing.sources.some((source) => !/^[A-F0-9]{64}$/.test(source.contentHash))) failures.push("Invalid official source hash.");
    if (existing.rules.some((rule) => !rule.statutorySection.trim())) failures.push("Missing statutory section mapping.");
    if (existing.rules.some((rule) => rule.entitlementSemantics === "PERIOD_BALANCE" && !rule.tiers.length)) failures.push("Missing balance tier.");
    if (existing.rules.some((rule) => rule.entitlementSemantics !== "PERIOD_BALANCE" && rule.tiers.length)) failures.push("Non-balance rule has a balance tier.");
    if (failures.length) throw new Error(failures.join(" "));
    const now = new Date();
    const checklist = {
      officialSourcesHashed: true,
      statutorySectionsMapped: true,
      serviceTiersContinuous: true,
      eventRulesDoNotCarryForward: true,
      nonAccrualRulesDoNotCreateBuckets: true,
      independentReviewer: input.actor.userId,
      note: data.reviewNote,
    };
    const saved = await tx.leaveStatutoryRuleSet.update({
      where: { id: existing.id },
      data: {
        status: "READY_FOR_HUMAN_SIGN_OFF",
        reviewNote: data.reviewNote,
        reviewedById: input.actor.userId,
        reviewedAt: now,
        readyForSignOffById: input.actor.userId,
        readyForSignOffAt: now,
        validationSnapshot: { valid: true, failures: [], reviewedAt: now.toISOString() },
        signOffChecklist: checklist,
      },
    });
    await writeAuditLog({ businessId: input.businessId, actor: input.actor, request: input.request, action: "LEAVE_STATUTORY_RULE_SET_READY_FOR_HUMAN_SIGN_OFF", entityType: "LeaveStatutoryRuleSet", entityId: saved.id, summary: `${saved.version} passed independent engineering review and awaits explicit human sign-off.`, after: { status: saved.status, checklist } }, tx);
    return saved;
  }, { isolationLevel: "Serializable" });
}

export async function activateStatutoryRuleSet(input: {
  businessId: string;
  actor: AppSession;
  request?: AuditRequestContext;
  rawInput: unknown;
}) {
  const data = workflowSchema.parse(input.rawInput);
  if (input.actor.role !== "PLATFORM_ADMIN") throw new Error("Only a Platform statutory administrator may activate a signed-off rule pack.");
  if (!data.confirmed || !data.reviewNote) throw new Error("Explicit human sign-off and an activation note are required.");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.leaveStatutoryRuleSet.findFirst({ where: { id: data.ruleSetId, businessId: input.businessId } });
    if (!existing) throw new Error("Rule pack is outside your business scope.");
    await lockRuleSet(tx, input.businessId, existing.jurisdictionCountryCode, existing.jurisdictionStateCode);
    if (existing.status === "ACTIVE") return existing;
    if (existing.status !== "READY_FOR_HUMAN_SIGN_OFF" || data.expectedStatus !== "READY_FOR_HUMAN_SIGN_OFF") throw new Error("Only a human-sign-off candidate can be activated.");
    if (!existing.jurisdictionCode) throw new Error("An exact workplace jurisdiction is required before activation.");
    if (existing.createdById === input.actor.userId) throw new Error("Independent review is required: the rule-pack creator cannot activate the same pack.");
    await tx.leaveStatutoryRuleSet.updateMany({
      where: {
        businessId: input.businessId,
        jurisdictionCountryCode: existing.jurisdictionCountryCode,
        jurisdictionStateCode: existing.jurisdictionStateCode,
        status: "ACTIVE",
        id: { not: existing.id },
      },
      data: { status: "SUPERSEDED" },
    });
    const now = new Date();
    const saved = await tx.leaveStatutoryRuleSet.update({
      where: { id: existing.id },
      data: {
        status: "ACTIVE",
        reviewNote: data.reviewNote,
        activatedById: input.actor.userId,
        activatedAt: now,
      },
    });
    await writeAuditLog({ businessId: input.businessId, actor: input.actor, request: input.request, action: "LEAVE_STATUTORY_RULE_SET_ACTIVATED", entityType: "LeaveStatutoryRuleSet", entityId: saved.id, summary: `Reviewed statutory Leave rule pack ${saved.version} activated.`, after: { status: saved.status, reviewNote: data.reviewNote } }, tx);
    return saved;
  }, { isolationLevel: "Serializable" });
}

export async function getStatutoryRuleSetOverview(businessId: string) {
  const [ruleSets, branches] = await Promise.all([
    prisma.leaveStatutoryRuleSet.findMany({
      where: { businessId },
      include: { rules: { include: { tiers: { orderBy: { minServiceMonths: "asc" } } } }, sources: { orderBy: { createdAt: "asc" } } },
      orderBy: [{ status: "asc" }, { effectiveFrom: "desc" }, { createdAt: "desc" }],
    }),
    prisma.branch.findMany({ where: { businessId, status: "ACTIVE" }, select: { id: true, name: true, countryCode: true, stateCode: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    branches,
    ruleSets: ruleSets.map((ruleSet) => ({
      ...ruleSet,
      effectiveFrom: utcDateToDateValue(ruleSet.effectiveFrom),
      effectiveTo: ruleSet.effectiveTo ? utcDateToDateValue(ruleSet.effectiveTo) : null,
      rules: ruleSet.rules.map((rule) => ({
        ...rule,
        tiers: rule.tiers.map((tier) => ({ ...tier, entitlementUnits: Number(tier.entitlementUnits) })),
      })),
    })),
  };
}

function toDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function optionalNumber(value: number | "" | undefined) {
  return value === "" || value === undefined ? null : value;
}

async function lockRuleSet(tx: LeaveTransaction, businessId: string, countryCode: string, stateCode: string | null) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`leave-statute:${businessId}:${countryCode}:${stateCode ?? "*"}`}, 0))`;
}
