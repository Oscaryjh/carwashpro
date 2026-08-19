import { createHash, randomUUID } from "node:crypto";
import type { AppSession } from "@/lib/auth/session";
import type { AuditRequestContext } from "@/lib/audit";
import { writeAuditLog } from "@/lib/audit";
import { routeHrApprovalDecision, type HrApprovalActorLevel } from "@/lib/approvals/policy-service";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth";
import { AttendanceApiError } from "@/lib/attendance/api-error";
import { addDaysToDateValue, parseBusinessDateTime, utcDateToDateValue } from "@/lib/business-time";
import { prisma } from "@/lib/prisma";
import type { LeaveComplianceStatus, LeavePolicyVersion, LeaveStatutoryCategory, Prisma } from "@prisma/client";
import {
  calculateLeaveEntitlement,
  completedServiceMonths,
  evaluateLeaveEligibility,
  resolveEntitlementPeriod,
  type EntitlementTier,
} from "./entitlement-engine";
import {
  allocateLeaveConsumption,
  calculateBucketRemaining,
  calculateCarryForward,
  canRestoreAllocationToBucket,
  leaveUnits,
  resolveCarryForwardExpiry,
  startOfUtcDate,
} from "./bucket-engine";
import {
  discardPreparedLeaveDocuments,
  leaveDocumentCreateData,
  serializeLeaveDocument,
  type PreparedLeaveDocument,
} from "./document-service";
import {
  COMPANY_LEAVE_STARTER,
  enumerateCalendarDates,
  leaveBalanceInputSchema,
  leaveCancelInputSchema,
  leaveManagerCancelInputSchema,
  leavePolicyCreateInputSchema,
  leavePolicyVersionInputSchema,
  leaveRequestInputSchema,
  leaveReviewInputSchema,
  resolveLeaveEntitlementDays,
} from "./policy";

type LeaveTransaction = Prisma.TransactionClient;

export async function installCompanyLeaveStarter(businessId: string, actorUserId?: string) {
  const year = new Date().getUTCFullYear();
  await prisma.$transaction(async (tx) => {
    for (const item of COMPANY_LEAVE_STARTER) {
      const policy = await tx.leavePolicy.upsert({
        where: { businessId_code: { businessId, code: item.code } },
        create: {
          businessId,
          ...item,
          origin: "BUSINESS_CUSTOM",
          legalStatus: "COMPANY_POLICY_ONLY",
        },
        update: { active: true },
      });
      const existing = await tx.leavePolicyVersion.findFirst({
        where: { businessId, policyId: policy.id, legalStatus: "COMPANY_POLICY_ONLY" },
        select: { id: true },
      });
      if (!existing) {
        const latest = await tx.leavePolicyVersion.findFirst({
          where: { businessId, policyId: policy.id },
          orderBy: { revision: "desc" },
          select: { revision: true },
        });
        await tx.leavePolicyVersion.create({
          data: {
            businessId,
            policyId: policy.id,
            revision: (latest?.revision ?? 0) + 1,
            effectiveFrom: new Date(Date.UTC(year, 0, 1)),
            nameSnapshot: item.name,
            payTreatment: item.payTreatment,
            countMode: item.countMode,
            balanceTracked: item.balanceTracked,
            defaultEntitlementDays: item.defaultEntitlementDays,
            requiresDocument: item.requiresDocument ?? false,
            allowNegativeBalance: false,
            origin: "BUSINESS_CUSTOM",
            legalStatus: "COMPANY_POLICY_ONLY",
            sourceReference: "COMPANY_POLICY",
            reason: "Company-policy starter. This version does not assert a statutory minimum.",
            createdById: actorUserId,
          },
        });
      }
    }
  }, { isolationLevel: "Serializable" });
}

// Backward-compatible export; the old unverified legal preset is intentionally
// no longer installed. Callers receive the safe company-policy starter.
export const installPeninsularLabuanLeavePreset = installCompanyLeaveStarter;

export async function createCompanyLeavePolicy(input: {
  businessId: string;
  actor: AppSession;
  request?: AuditRequestContext;
  rawInput: unknown;
}) {
  const data = leavePolicyCreateInputSchema.parse(input.rawInput);
  const effectiveFrom = new Date(`${data.effectiveFrom}T00:00:00.000Z`);
  const nullable = (value: number | "" | undefined) => value === "" || value === undefined ? null : value;

  return prisma.$transaction(async (tx) => {
    await lockLeaveKey(tx, `policy-create:${input.businessId}`);
    const duplicate = await tx.leavePolicy.findFirst({
      where: { businessId: input.businessId, name: { equals: data.name, mode: "insensitive" } },
      select: { id: true },
    });
    if (duplicate) throw new Error("A Leave type with this name already exists.");

    const code = `CUSTOM_${randomUUID().replaceAll("-", "").slice(0, 24).toUpperCase()}`;
    const policy = await tx.leavePolicy.create({
      data: {
        businessId: input.businessId,
        code,
        name: data.name,
        payTreatment: data.payTreatment,
        countMode: data.countMode,
        balanceTracked: data.balanceTracked,
        defaultEntitlementDays: nullable(data.defaultEntitlementDays),
        requiresDocument: data.requiresDocument,
        allowNegativeBalance: data.allowNegativeBalance,
        origin: "BUSINESS_CUSTOM",
        legalStatus: "COMPANY_POLICY_ONLY",
      },
    });
    const version = await tx.leavePolicyVersion.create({
      data: {
        businessId: input.businessId,
        policyId: policy.id,
        revision: 1,
        effectiveFrom,
        nameSnapshot: data.name,
        payTreatment: data.payTreatment,
        countMode: data.countMode,
        balanceTracked: data.balanceTracked,
        defaultEntitlementDays: nullable(data.defaultEntitlementDays),
        requiresDocument: data.requiresDocument,
        allowNegativeBalance: data.allowNegativeBalance,
        origin: "BUSINESS_CUSTOM",
        legalStatus: "COMPANY_POLICY_ONLY",
        sourceReference: "COMPANY_POLICY",
        reason: data.reason,
        createdById: input.actor.userId,
      },
    });
    await writeAuditLog({
      businessId: input.businessId,
      actor: input.actor,
      request: input.request,
      action: "LEAVE_POLICY_CREATED",
      entityType: "LeavePolicy",
      entityId: policy.id,
      summary: `Custom Leave type ${data.name} created.`,
      after: {
        policyId: policy.id,
        code,
        revision: version.revision,
        effectiveFrom: data.effectiveFrom,
        balanceTracked: data.balanceTracked,
        legalStatus: "COMPANY_POLICY_ONLY",
      },
    }, tx);
    return { policy, version };
  }, { isolationLevel: "Serializable" });
}

export async function createCompanyLeavePolicyVersion(input: {
  businessId: string;
  actor: AppSession;
  request?: AuditRequestContext;
  rawInput: unknown;
}) {
  const data = leavePolicyVersionInputSchema.parse(input.rawInput);
  const effectiveFrom = new Date(`${data.effectiveFrom}T00:00:00.000Z`);
  return prisma.$transaction(async (tx) => {
    await lockLeaveKey(tx, `policy:${input.businessId}:${data.policyId}`);
    const policy = await tx.leavePolicy.findFirst({ where: { id: data.policyId, businessId: input.businessId } });
    if (!policy) throw new Error("Leave type is outside your business scope.");
    const statutoryCategory = data.statutoryCategory || null;
    const statutoryEvidence = statutoryCategory
      ? await assertCompanyPolicyMeetsStatutoryMinimum(tx, input.businessId, statutoryCategory, effectiveFrom, data)
      : null;
    const latest = await tx.leavePolicyVersion.findFirst({
      where: { businessId: input.businessId, policyId: policy.id },
      orderBy: { revision: "desc" },
      select: { revision: true },
    });
    const nullable = (value: number | "" | undefined) => value === "" || value === undefined ? null : value;
    const version = await tx.leavePolicyVersion.create({
      data: {
        businessId: input.businessId,
        policyId: policy.id,
        revision: (latest?.revision ?? 0) + 1,
        effectiveFrom,
        nameSnapshot: data.name,
        payTreatment: data.payTreatment,
        countMode: data.countMode,
        balanceTracked: data.balanceTracked,
        defaultEntitlementDays: nullable(data.defaultEntitlementDays),
        underTwoYearsDays: nullable(data.underTwoYearsDays),
        twoToFiveYearsDays: nullable(data.twoToFiveYearsDays),
        fiveYearsPlusDays: nullable(data.fiveYearsPlusDays),
        requiresDocument: data.requiresDocument,
        allowNegativeBalance: data.allowNegativeBalance,
        statutoryCategory,
        entitlementPeriodType: data.entitlementPeriodType,
        customYearStartMonth: data.customYearStartMonth === "" || data.customYearStartMonth === undefined ? null : data.customYearStartMonth,
        customYearStartDay: data.customYearStartDay === "" || data.customYearStartDay === undefined ? null : data.customYearStartDay,
        prorationMethod: data.prorationMethod,
        entitlementRounding: data.entitlementRounding,
        eligibleEmploymentTypes: data.eligibleEmploymentTypes,
        carryForwardEnabled: data.carryForwardEnabled,
        carryForwardLimitUnits: nullable(data.carryForwardLimitUnits),
        carryForwardExpiryRule: data.carryForwardExpiryRule,
        carryForwardExpiryValue: data.carryForwardEnabled ? (data.carryForwardExpiryValue || null) : null,
        consumptionPriority: data.consumptionPriority,
        statutoryRuleSetId: statutoryEvidence?.ruleSetId ?? null,
        statutoryRuleId: statutoryEvidence?.ruleId ?? null,
        origin: "BUSINESS_CUSTOM",
        legalStatus: statutoryEvidence ? "VERIFIED_LEGAL" : "COMPANY_POLICY_ONLY",
        sourceReference: statutoryEvidence?.sourceReference ?? "COMPANY_POLICY",
        reason: data.reason,
        createdById: input.actor.userId,
      },
    });
    await tx.leavePolicy.update({
      where: { id: policy.id },
      data: {
        name: data.name,
        payTreatment: data.payTreatment,
        countMode: data.countMode,
        balanceTracked: data.balanceTracked,
        defaultEntitlementDays: nullable(data.defaultEntitlementDays),
        underTwoYearsDays: nullable(data.underTwoYearsDays),
        twoToFiveYearsDays: nullable(data.twoToFiveYearsDays),
        fiveYearsPlusDays: nullable(data.fiveYearsPlusDays),
        requiresDocument: data.requiresDocument,
        allowNegativeBalance: data.allowNegativeBalance,
        statutoryCategory,
        entitlementPeriodType: data.entitlementPeriodType,
        customYearStartMonth: data.customYearStartMonth === "" || data.customYearStartMonth === undefined ? null : data.customYearStartMonth,
        customYearStartDay: data.customYearStartDay === "" || data.customYearStartDay === undefined ? null : data.customYearStartDay,
        prorationMethod: data.prorationMethod,
        entitlementRounding: data.entitlementRounding,
        eligibleEmploymentTypes: data.eligibleEmploymentTypes,
        carryForwardEnabled: data.carryForwardEnabled,
        carryForwardLimitUnits: nullable(data.carryForwardLimitUnits),
        carryForwardExpiryRule: data.carryForwardExpiryRule,
        carryForwardExpiryValue: data.carryForwardEnabled ? (data.carryForwardExpiryValue || null) : null,
        consumptionPriority: data.consumptionPriority,
        origin: "BUSINESS_CUSTOM",
        legalStatus: statutoryEvidence ? "VERIFIED_LEGAL" : "COMPANY_POLICY_ONLY",
      },
    });
    await writeAuditLog({
      businessId: input.businessId,
      actor: input.actor,
      request: input.request,
      action: "LEAVE_POLICY_VERSION_CREATED",
      entityType: "LeavePolicyVersion",
      entityId: version.id,
      summary: `Company leave policy revision ${version.revision} created.`,
      after: {
        policyId: policy.id,
        revision: version.revision,
        effectiveFrom: data.effectiveFrom,
        legalStatus: statutoryEvidence ? "VERIFIED_LEGAL" : "COMPANY_POLICY_ONLY",
        statutoryCategory,
        statutoryRuleSetId: statutoryEvidence?.ruleSetId ?? null,
        carryForwardEnabled: data.carryForwardEnabled,
        carryForwardLimitUnits: nullable(data.carryForwardLimitUnits),
        carryForwardExpiryRule: data.carryForwardExpiryRule,
        consumptionPriority: data.consumptionPriority,
      },
    }, tx);
    return version;
  }, { isolationLevel: "Serializable" });
}

export async function getEmployeeLeaveOverview(auth: EmployeeAuthContext) {
  const year = new Date().getUTCFullYear();
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));
  const today = new Date();
  const balanceAsOf = startOfUtcDate(today);
  const [membership, policies, entitlements, pending, requests] = await Promise.all([
    prisma.employeeBusinessMembership.findFirstOrThrow({
      where: { id: auth.membershipId, businessId: auth.businessId, status: "ACTIVE" },
      select: { id: true, fullName: true, employeeCode: true, joinedAt: true, terminatedAt: true },
    }),
    prisma.leavePolicy.findMany({
      where: { businessId: auth.businessId, active: true },
      include: { versions: { where: { effectiveFrom: { lte: today }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] }, orderBy: { revision: "desc" }, take: 1 } },
      orderBy: { name: "asc" },
    }),
    prisma.employeeLeaveEntitlement.findMany({
      where: {
        businessId: auth.businessId,
        membershipId: auth.membershipId,
        leaveYearStart: { lte: balanceAsOf },
        leaveYearEnd: { gte: balanceAsOf },
      },
    }),
    prisma.leaveRequest.groupBy({
      by: ["policyId"],
      where: { businessId: auth.businessId, membershipId: auth.membershipId, status: "PENDING", startsOn: { gte: from, lt: to } },
      _sum: { requestedDays: true },
    }),
    prisma.leaveRequest.findMany({
      where: { businessId: auth.businessId, membershipId: auth.membershipId },
      orderBy: [{ startsOn: "desc" }, { createdAt: "desc" }],
      take: 50,
      select: {
        id: true, policyId: true, policyNameSnapshot: true, payTreatmentSnapshot: true,
        startsOn: true, endsOn: true, requestedDays: true, leaveUnit: true, reason: true,
        status: true, revision: true, reviewNote: true, cancellationReason: true, createdAt: true,
        supportingEvidenceRequiredSnapshot: true, supportingEvidenceStatus: true,
        supportingDocuments: {
          where: { lifecycleStatus: "ACTIVE" },
          orderBy: { createdAt: "asc" },
          select: {
            id: true, source: true, documentType: true, sanitizedFileName: true, mimeType: true,
            byteLength: true, securityStatus: true, lifecycleStatus: true, reviewStatus: true,
            reviewNote: true, createdAt: true,
          },
        },
      },
    }),
  ]);
  const entitlementStarts = [...new Set(entitlements.map((row) => row.leaveYearStart.toISOString()))]
    .map((value) => new Date(value));
  const [ledger, buckets] = await Promise.all([
    entitlementStarts.length
      ? prisma.leaveBalanceLedgerEntry.groupBy({
        by: ["policyId", "eventType"],
        where: {
          businessId: auth.businessId,
          membershipId: auth.membershipId,
          leaveYearStart: { in: entitlementStarts },
        },
        _sum: { units: true },
      })
      : Promise.resolve([]),
    prisma.leaveEntitlementBucket.findMany({
      where: {
        businessId: auth.businessId,
        membershipId: auth.membershipId,
        periodStart: { lte: balanceAsOf },
        periodEnd: { gte: balanceAsOf },
      },
      orderBy: [{ expiresAt: "asc" }, { availableFrom: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  const bucketUsage = await getBucketUsage(prisma, buckets.map((bucket) => bucket.id));
  const bucketBreakdown = buckets.map((bucket) => ({
    policyId: bucket.policyId,
    sourceType: bucket.sourceType,
    status: bucket.status,
    grantedDays: Number(bucket.grantedUnits),
    remainingDays: calculateBucketRemaining({
      grantedUnits: Number(bucket.grantedUnits),
      ...(bucketUsage.get(bucket.id) ?? { consumedUnits: 0, restoredUnits: 0, expiredUnits: 0 }),
    }),
    expiresAt: bucket.expiresAt ? utcDateToDateValue(bucket.expiresAt) : null,
  }));
  const entitlementByPolicy = new Map(entitlements.map((row) => [row.policyId, Number(row.entitledUnits)]));
  const balanceByPolicy = new Map<string, number>();
  const usedByPolicy = new Map<string, number>();
  const manualAdjustmentByPolicy = new Map<string, number>();
  for (const row of ledger) {
    const units = Number(row._sum.units ?? 0);
    balanceByPolicy.set(row.policyId, (balanceByPolicy.get(row.policyId) ?? 0) + units);
    if (row.eventType === "APPROVED_CONSUMPTION") {
      usedByPolicy.set(row.policyId, (usedByPolicy.get(row.policyId) ?? 0) + Math.abs(units));
    } else if (row.eventType === "CANCELLATION_RESTORE") {
      usedByPolicy.set(row.policyId, Math.max(0, (usedByPolicy.get(row.policyId) ?? 0) - units));
    } else if (row.eventType === "MANUAL_ADJUSTMENT") {
      manualAdjustmentByPolicy.set(row.policyId, (manualAdjustmentByPolicy.get(row.policyId) ?? 0) + units);
    }
  }
  const pendingByPolicy = new Map(pending.map((row) => [row.policyId, Number(row._sum.requestedDays ?? 0)]));

  return {
    year,
    employee: { fullName: membership.fullName, employeeCode: membership.employeeCode },
    policies: policies.flatMap((policy) => {
      const version = policy.versions[0];
      if (!version) return [];
      const projected = resolveLeaveEntitlementDays(version, membership.joinedAt, year);
      const balance = balanceByPolicy.get(policy.id) ?? 0;
      const policyBuckets = bucketBreakdown.filter((bucket) => bucket.policyId === policy.id);
      const carryForwardBuckets = policyBuckets
        .filter((bucket) => bucket.sourceType === "CARRY_FORWARD" && bucket.remainingDays > 0)
        .map((bucket) => ({ remainingDays: bucket.remainingDays, expiresAt: bucket.expiresAt }));
      return [{
        id: policy.id,
        code: policy.code,
        name: version.nameSnapshot,
        payTreatment: version.payTreatment,
        countMode: version.countMode,
        requiresDocument: version.requiresDocument,
        balanceTracked: version.balanceTracked,
        legalStatus: version.legalStatus,
        policyRevision: version.revision,
        entitlementDays: entitlementByPolicy.get(policy.id) ?? projected,
        usedDays: usedByPolicy.get(policy.id) ?? 0,
        pendingDays: pendingByPolicy.get(policy.id) ?? 0,
        remainingDays: version.balanceTracked ? balance : null,
        currentEntitlementDays: policyBuckets
          .filter((bucket) => bucket.sourceType === "CURRENT_ENTITLEMENT")
          .reduce((sum, bucket) => leaveUnits(sum + bucket.grantedDays), 0),
        carryForwardDays: carryForwardBuckets
          .reduce((sum, bucket) => leaveUnits(sum + bucket.remainingDays), 0),
        manualAdjustmentDays: manualAdjustmentByPolicy.get(policy.id) ?? 0,
        carryForwardBuckets,
        applicationReady: ["COMPANY_POLICY_ONLY", "VERIFIED_LEGAL"].includes(version.legalStatus),
        readinessCode: version.legalStatus === "LEGACY_REVIEW_REQUIRED" ? "LEGACY_LEAVE_REVIEW_REQUIRED" : version.legalStatus === "LEGAL_RULE_NOT_READY" ? "LEAVE_LEGAL_RULE_NOT_READY" : null,
      }];
    }),
    requests: requests.map((request) => ({
      ...request,
      supportingDocuments: request.supportingDocuments.map(serializeLeaveDocument),
      startsOn: utcDateToDateValue(request.startsOn),
      endsOn: utcDateToDateValue(request.endsOn),
      requestedDays: Number(request.requestedDays),
      createdAt: request.createdAt.toISOString(),
    })),
  };
}

export async function submitEmployeeLeave(
  auth: EmployeeAuthContext,
  rawInput: unknown,
  preparedDocuments: readonly PreparedLeaveDocument[] = [],
) {
  const input = leaveRequestInputSchema.parse(rawInput);
  const existing = await prisma.leaveRequest.findFirst({
    where: { businessId: auth.businessId, membershipId: auth.membershipId, clientRequestId: input.clientRequestId },
  });
  if (existing) {
    await discardPreparedLeaveDocuments(preparedDocuments);
    return replaySubmission(existing, input);
  }

  const membership = await prisma.employeeBusinessMembership.findFirst({
    where: { id: auth.membershipId, businessId: auth.businessId, status: "ACTIVE" },
    select: { id: true, joinedAt: true, terminatedAt: true, employmentType: true },
  });
  if (!membership) throw new AttendanceApiError("EMPLOYEE_INACTIVE", "Employee membership is unavailable.");
  const startsOn = new Date(`${input.startsOn}T00:00:00.000Z`);
  if (membership.terminatedAt && startsOn > membership.terminatedAt) {
    throw new AttendanceApiError("VALIDATION_ERROR", "Future leave cannot start after employment ended.");
  }
  const version = await resolvePolicyVersion(auth.businessId, input.policyId, startsOn);
  assertForwardPolicy(version);
  if (version.requiresDocument && preparedDocuments.length === 0 && !input.documentReference) {
    await discardPreparedLeaveDocuments(preparedDocuments);
    throw new AttendanceApiError("VALIDATION_ERROR", "Upload a supporting document for this leave type.");
  }
  const daySnapshots = await buildLeaveDaySnapshots({
    businessId: auth.businessId,
    membershipId: auth.membershipId,
    version,
    startsOn: input.startsOn,
    endsOn: input.endsOn,
    leaveUnit: input.leaveUnit,
  });
  const requestedDays = daySnapshots.reduce((sum, day) => sum + day.fraction, 0);

  try {
    return await prisma.$transaction(async (tx) => {
    await lockLeaveKey(tx, `submit:${auth.businessId}:${auth.membershipId}`);
    const replay = await tx.leaveRequest.findFirst({
      where: { businessId: auth.businessId, membershipId: auth.membershipId, clientRequestId: input.clientRequestId },
    });
    if (replay) return replaySubmission(replay, input);
    await assertNoPendingOrApprovedOverlap(tx, auth.businessId, auth.membershipId, daySnapshots);
    if (version.balanceTracked) {
      await ensureEntitlement(tx, { businessId: auth.businessId, membershipId: auth.membershipId, joinedAt: membership.joinedAt, policyId: input.policyId, version, year: startsOn.getUTCFullYear(), asOf: startsOn });
    }
    const branchId = auth.attendanceBranchId ?? auth.primaryBranchId;
    const statutorySnapshot = await resolveLeaveRequestStatutorySnapshot(tx, {
      businessId: auth.businessId,
      branchId,
      version,
      joinedAt: membership.joinedAt,
      employmentType: membership.employmentType,
      startsOn,
      requestedDays,
    });
    const request = await tx.leaveRequest.create({
      data: {
        businessId: auth.businessId,
        membershipId: auth.membershipId,
        branchId,
        policyId: input.policyId,
        policyVersionId: version.id,
        policyNameSnapshot: version.nameSnapshot,
        payTreatmentSnapshot: version.payTreatment,
        balanceTrackedSnapshot: version.balanceTracked,
        legalStatusSnapshot: version.legalStatus,
        jurisdictionCodeSnapshot: statutorySnapshot.jurisdictionCode,
        statutoryRuleSetVersionSnapshot: statutorySnapshot.ruleSetVersion,
        statutoryCategorySnapshot: version.statutoryCategory,
        statutoryEligibilitySnapshot: statutorySnapshot.eligibility,
        statutoryDurationSnapshot: statutorySnapshot.duration,
        statutoryPayTreatmentSnapshot: statutorySnapshot.payTreatment,
        complianceStatusSnapshot: statutorySnapshot.complianceStatus,
        supportingEvidenceRequiredSnapshot: version.requiresDocument,
        supportingEvidenceStatus: input.documentReference ? "REVIEW_REQUIRED" : "NOT_REVIEWED",
        leaveUnit: input.leaveUnit,
        startsOn,
        endsOn: new Date(`${input.endsOn}T00:00:00.000Z`),
        requestedDays,
        reason: input.reason,
        documentReference: input.documentReference || null,
        clientRequestId: input.clientRequestId,
        days: {
          create: daySnapshots.map((day) => ({
            businessId: auth.businessId,
            membershipId: auth.membershipId,
            leaveDate: day.date,
            dayFraction: day.fraction,
            leaveUnit: input.leaveUnit,
            expectedDayId: day.expectedDayId,
            expectedDayKindSnapshot: day.expectedKind,
            policyVersionId: version.id,
            payTreatmentSnapshot: version.payTreatment,
            balanceConsumptionUnits: day.fraction,
          })),
        },
        supportingDocuments: preparedDocuments.length || input.documentReference
          ? {
              create: [
                ...leaveDocumentCreateData({
                  businessId: auth.businessId,
                  membershipId: auth.membershipId,
                  documents: preparedDocuments,
                }),
                ...(input.documentReference
                  ? [{
                      membershipId: auth.membershipId,
                      source: "LEGACY_REFERENCE" as const,
                      documentType: "OTHER" as const,
                      legacyReference: input.documentReference,
                      securityStatus: "SCAN_NOT_AVAILABLE" as const,
                      privacyClass: "SENSITIVE_HR" as const,
                      lifecycleStatus: "LEGACY_REFERENCE" as const,
                      reviewStatus: "REVIEW_REQUIRED" as const,
                      uploadedByMembershipId: auth.membershipId,
                    }]
                  : []),
              ],
            }
          : undefined,
      },
    });
    await tx.leaveApplicationEvent.create({
      data: {
        businessId: auth.businessId,
        leaveRequestId: request.id,
        revision: 0,
        eventType: "SUBMITTED",
        statusSnapshot: "PENDING",
        reason: "Employee submitted leave.",
        sourceKey: `leave-submit:${auth.businessId}:${auth.membershipId}:${input.clientRequestId}`,
        actorMembershipId: auth.membershipId,
      },
    });
    await writeAuditLog({
      businessId: auth.businessId,
      branchId: auth.attendanceBranchId ?? auth.primaryBranchId,
      action: "LEAVE_REQUEST_SUBMITTED",
      entityType: "LeaveRequest",
      entityId: request.id,
      summary: `Employee submitted ${version.nameSnapshot}.`,
      after: {
        policyVersionId: version.id,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        units: requestedDays,
        leaveUnit: input.leaveUnit,
        supportingDocumentCount: preparedDocuments.length + (input.documentReference ? 1 : 0),
        supportingEvidenceRequired: version.requiresDocument,
      },
    }, tx);
    const uploadedDocuments = preparedDocuments.length > 0
      ? await tx.leaveSupportingDocument.findMany({
          where: { leaveRequestId: request.id, objectKey: { in: preparedDocuments.map((document) => document.objectKey) } },
          select: { id: true, privacyClass: true },
        })
      : [];
    for (const document of uploadedDocuments) {
      await writeAuditLog({
        businessId: auth.businessId,
        branchId,
        action: "LEAVE_SUPPORTING_DOCUMENT_UPLOADED",
        entityType: "LeaveSupportingDocument",
        entityId: document.id,
        summary: "Employee uploaded a private Leave supporting document.",
        after: { privacyClass: document.privacyClass, content: "[REDACTED]" },
      }, tx);
      await writeAuditLog({
        businessId: auth.businessId,
        branchId,
        action: "LEAVE_SUPPORTING_DOCUMENT_BOUND",
        entityType: "LeaveSupportingDocument",
        entityId: document.id,
        summary: "Private supporting document bound to Leave request.",
        after: { leaveRequestId: request.id, content: "[REDACTED]" },
      }, tx);
    }
    return { id: request.id, status: request.status, revision: request.revision };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    await discardPreparedLeaveDocuments(preparedDocuments);
    throw error;
  }
}

async function resolveLeaveRequestStatutorySnapshot(
  tx: LeaveTransaction,
  input: {
    businessId: string;
    branchId: string;
    version: LeavePolicyVersion;
    joinedAt: Date;
    employmentType: string;
    startsOn: Date;
    requestedDays: number;
  },
) {
  const branch = await tx.branch.findFirst({
    where: { id: input.branchId, businessId: input.businessId, status: "ACTIVE" },
    select: { countryCode: true, stateCode: true },
  });
  if (!branch) throw new AttendanceApiError("VALIDATION_ERROR", "The Leave workplace branch is unavailable.");

  const jurisdictionCode = canonicalWorkplaceJurisdiction(branch.countryCode, branch.stateCode);
  const category = input.version.statutoryCategory;
  if (!category) {
    return {
      jurisdictionCode,
      ruleSetVersion: null,
      complianceStatus: "NOT_APPLICABLE" as const,
      eligibility: { status: "NOT_APPLICABLE", basis: "COMPANY_POLICY_ONLY", workplaceJurisdiction: jurisdictionCode },
      duration: { requestedDays: input.requestedDays, source: "COMPANY_POLICY" },
      payTreatment: { companyPayTreatment: input.version.payTreatment, statutoryMinimumApplied: false },
    };
  }

  if (!jurisdictionCode) {
    return {
      jurisdictionCode: null,
      ruleSetVersion: null,
      complianceStatus: "REVIEW_REQUIRED" as const,
      eligibility: { status: "REVIEW_REQUIRED", reason: "WORKPLACE_JURISDICTION_MISSING" },
      duration: { requestedDays: input.requestedDays, category },
      payTreatment: { companyPayTreatment: input.version.payTreatment, statutoryMinimumApplied: false },
    };
  }

  const rule = await tx.leaveStatutoryRule.findFirst({
    where: {
      businessId: input.businessId,
      category,
      ruleSet: {
        status: "ACTIVE",
        jurisdictionCode,
        effectiveFrom: { lte: input.startsOn },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: input.startsOn } }],
      },
    },
    include: { tiers: { orderBy: { minServiceMonths: "asc" } }, ruleSet: true },
    orderBy: { ruleSet: { effectiveFrom: "desc" } },
  });
  if (!rule) {
    return {
      jurisdictionCode,
      ruleSetVersion: null,
      complianceStatus: "REVIEW_REQUIRED" as const,
      eligibility: { status: "REVIEW_REQUIRED", reason: "NO_ACTIVE_EXACT_JURISDICTION_RULE", category },
      duration: { requestedDays: input.requestedDays, category },
      payTreatment: { companyPayTreatment: input.version.payTreatment, statutoryMinimumApplied: false },
    };
  }

  const serviceMonths = completedServiceMonths(input.joinedAt, input.startsOn);
  const tier = rule.tiers.find((candidate) => serviceMonths >= candidate.minServiceMonths && (candidate.maxServiceMonths === null || serviceMonths <= candidate.maxServiceMonths));
  const fallbackUnits = Number(input.version.defaultEntitlementDays ?? 0);
  const companyUnits = serviceMonths < 24
    ? Number(input.version.underTwoYearsDays ?? fallbackUnits)
    : serviceMonths < 60
      ? Number(input.version.twoToFiveYearsDays ?? fallbackUnits)
      : Number(input.version.fiveYearsPlusDays ?? fallbackUnits);
  const statutoryUnits = tier ? Number(tier.entitlementUnits) : null;
  const complianceStatus: LeaveComplianceStatus = rule.entitlementSemantics === "NON_ACCRUAL"
    ? "NOT_APPLICABLE"
    : rule.entitlementSemantics === "EVENT_BASED" || statutoryUnits === null
      ? "REVIEW_REQUIRED"
      : companyUnits < statutoryUnits
        ? "BELOW_MINIMUM"
        : "COMPLIANT";

  return {
    jurisdictionCode,
    ruleSetVersion: rule.ruleSet.version,
    complianceStatus,
    eligibility: {
      status: rule.entitlementSemantics === "EVENT_BASED" ? "REVIEW_REQUIRED" : "ELIGIBLE",
      basis: "EXACT_WORKPLACE_JURISDICTION",
      employmentType: input.employmentType,
      completedServiceMonths: serviceMonths,
      statutoryRuleId: rule.id,
      statutorySection: rule.statutorySection,
    },
    duration: {
      requestedDays: input.requestedDays,
      semantics: rule.entitlementSemantics,
      statutoryUnits,
      companyUnits,
      eventRules: rule.eventRules,
    },
    payTreatment: {
      companyPayTreatment: input.version.payTreatment,
      requiresDocument: rule.requiresDocument,
      statutoryMinimumApplied: complianceStatus === "COMPLIANT",
    },
  };
}

function canonicalWorkplaceJurisdiction(countryCode: string, stateCode: string | null) {
  const country = countryCode.trim().toUpperCase();
  if (!country || !stateCode?.trim()) return null;
  const state = stateCode.trim().toUpperCase();
  const canonicalState = country === "MY" && ["12", "SBH", "SABAH"].includes(state) ? "SABAH" : state;
  return `${country}-${canonicalState}`;
}

export async function cancelEmployeeLeave(auth: EmployeeAuthContext, rawInput: unknown) {
  const input = leaveCancelInputSchema.parse(rawInput);
  await prisma.$transaction(async (tx) => {
    await lockLeaveKey(tx, `request:${auth.businessId}:${input.requestId}`);
    const request = await tx.leaveRequest.findFirst({ where: { id: input.requestId, businessId: auth.businessId, membershipId: auth.membershipId } });
    if (!request) throw new AttendanceApiError("INVALID_ATTENDANCE_STATE", "Leave request was not found.");
    if (request.status === "CANCELLED") return;
    if (request.status !== "PENDING") throw new AttendanceApiError("INVALID_ATTENDANCE_STATE", "Only a pending request can be withdrawn by the employee.");
    if (request.revision !== input.expectedRevision) throw new AttendanceApiError("INVALID_ATTENDANCE_STATE", "LEAVE_APPLICATION_UPDATED: refresh and try again.");
    const updated = await tx.leaveRequest.updateMany({
      where: { id: request.id, status: "PENDING", revision: input.expectedRevision },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: input.reason, revision: { increment: 1 } },
    });
    if (updated.count !== 1) throw new AttendanceApiError("INVALID_ATTENDANCE_STATE", "LEAVE_APPLICATION_UPDATED: refresh and try again.");
    await tx.leaveApplicationEvent.create({ data: {
      businessId: auth.businessId,
      leaveRequestId: request.id,
      revision: input.expectedRevision + 1,
      eventType: "WITHDRAWN",
      statusSnapshot: "CANCELLED",
      reason: input.reason,
      sourceKey: `leave-withdraw:${request.id}`,
      actorMembershipId: auth.membershipId,
    } });
    await writeAuditLog({ businessId: auth.businessId, branchId: request.branchId, action: "LEAVE_REQUEST_WITHDRAWN", entityType: "LeaveRequest", entityId: request.id, summary: "Employee withdrew a pending leave request." }, tx);
  }, { isolationLevel: "Serializable" });
}

export async function getManagerLeaveDashboard(input: { businessId: string; allowedBranchIds: readonly string[]; year: number }) {
  const from = new Date(Date.UTC(input.year, 0, 1));
  const to = new Date(Date.UTC(input.year + 1, 0, 1));
  const balanceAsOf = new Date(Date.UTC(input.year, 11, 31));
  const [policies, requests, employees, entitlements] = await Promise.all([
    prisma.leavePolicy.findMany({
      where: { businessId: input.businessId },
      include: { versions: { orderBy: { revision: "desc" }, take: 1 } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    prisma.leaveRequest.findMany({
      where: { businessId: input.businessId, branchId: { in: [...input.allowedBranchIds] }, startsOn: { lt: to }, endsOn: { gte: from } },
      include: {
        membership: { select: { id: true, fullName: true, employeeCode: true } },
        branch: { select: { id: true, name: true } },
        reviewedBy: { select: { name: true } },
        supportingDocuments: {
          where: { lifecycleStatus: "ACTIVE" },
          orderBy: { createdAt: "asc" },
          select: {
            id: true, source: true, documentType: true, sanitizedFileName: true, mimeType: true,
            byteLength: true, securityStatus: true, lifecycleStatus: true, reviewStatus: true,
            reviewNote: true, createdAt: true,
          },
        },
      },
      orderBy: [{ status: "asc" }, { startsOn: "asc" }],
      take: 200,
    }),
    prisma.employeeBusinessMembership.findMany({
      where: { businessId: input.businessId, status: "ACTIVE", branchAssignments: { some: { branchId: { in: [...input.allowedBranchIds] }, status: "ACTIVE" } } },
      select: { id: true, fullName: true, employeeCode: true, joinedAt: true },
      orderBy: { fullName: "asc" },
    }),
    prisma.employeeLeaveEntitlement.findMany({
      where: {
        businessId: input.businessId,
        leaveYearStart: { lte: balanceAsOf },
        leaveYearEnd: { gte: balanceAsOf },
      },
      select: { membershipId: true, policyId: true, leaveYearStart: true },
    }),
  ]);
  const scopedMembershipIds = new Set(employees.map((employee) => employee.id));
  const entitlementStarts = [...new Set(entitlements
    .filter((item) => scopedMembershipIds.has(item.membershipId))
    .map((item) => item.leaveYearStart.toISOString()))].map((value) => new Date(value));
  const ledger = entitlementStarts.length
    ? await prisma.leaveBalanceLedgerEntry.groupBy({
      by: ["membershipId", "policyId"],
      where: { businessId: input.businessId, membershipId: { in: [...scopedMembershipIds] }, leaveYearStart: { in: entitlementStarts } },
      _sum: { units: true },
    })
    : [];
  const balanceMap = new Map(ledger.map((row) => [`${row.membershipId}:${row.policyId}`, Number(row._sum.units ?? 0)]));
  for (const employee of employees) {
    for (const policy of policies) {
      const version = policy.versions[0];
      if (!version?.balanceTracked) continue;
      const key = `${employee.id}:${policy.id}`;
      if (!balanceMap.has(key)) {
        balanceMap.set(key, resolveLeaveEntitlementDays(version, employee.joinedAt, input.year));
      }
    }
  }
  const buckets = scopedMembershipIds.size
    ? await prisma.leaveEntitlementBucket.findMany({
      where: {
        businessId: input.businessId,
        membershipId: { in: [...scopedMembershipIds] },
        periodStart: { lt: to },
        periodEnd: { gte: from },
      },
      orderBy: [{ expiresAt: "asc" }, { availableFrom: "asc" }, { createdAt: "asc" }],
    })
    : [];
  const bucketIds = buckets.map((bucket) => bucket.id);
  const [allocations, restorations, expiries] = bucketIds.length
    ? await Promise.all([
      prisma.leaveConsumptionAllocation.groupBy({
        by: ["bucketId"],
        where: { businessId: input.businessId, bucketId: { in: bucketIds } },
        _sum: { units: true },
      }),
      prisma.leaveAllocationRestoration.groupBy({
        by: ["bucketId"],
        where: { businessId: input.businessId, bucketId: { in: bucketIds } },
        _sum: { units: true },
      }),
      prisma.leaveBucketExpiry.groupBy({
        by: ["bucketId"],
        where: { businessId: input.businessId, bucketId: { in: bucketIds } },
        _sum: { units: true },
      }),
    ])
    : [[], [], []];
  const consumedByBucket = new Map(allocations.map((row) => [row.bucketId, Number(row._sum.units ?? 0)]));
  const restoredByBucket = new Map(restorations.map((row) => [row.bucketId, Number(row._sum.units ?? 0)]));
  const expiredByBucket = new Map(expiries.map((row) => [row.bucketId, Number(row._sum.units ?? 0)]));
  const bucketBalances = buckets.map((bucket) => {
    const granted = Number(bucket.grantedUnits);
    const consumed = consumedByBucket.get(bucket.id) ?? 0;
    const restored = restoredByBucket.get(bucket.id) ?? 0;
    const expired = expiredByBucket.get(bucket.id) ?? 0;
    return {
      id: bucket.id,
      membershipId: bucket.membershipId,
      policyId: bucket.policyId,
      sourceType: bucket.sourceType,
      status: bucket.status,
      grantedUnits: granted,
      consumedUnits: consumed,
      restoredUnits: restored,
      expiredUnits: expired,
      remainingUnits: calculateBucketRemaining({ grantedUnits: granted, consumedUnits: consumed, restoredUnits: restored, expiredUnits: expired }),
      periodStart: utcDateToDateValue(bucket.periodStart),
      periodEnd: utcDateToDateValue(bucket.periodEnd),
      availableFrom: utcDateToDateValue(bucket.availableFrom),
      expiresAt: bucket.expiresAt ? utcDateToDateValue(bucket.expiresAt) : null,
    };
  });
  return {
    policies: policies.map((policy) => ({ ...policy, latestVersion: policy.versions[0] ? serializeVersion(policy.versions[0]) : null })),
    employees,
    requests: requests.map((request) => ({
      id: request.id,
      employee: request.membership,
      branch: request.branch,
      policyId: request.policyId,
      policyName: request.policyNameSnapshot,
      policyRevision: request.policyVersionId,
      payTreatment: request.payTreatmentSnapshot,
      legalStatus: request.legalStatusSnapshot,
      startsOn: utcDateToDateValue(request.startsOn),
      endsOn: utcDateToDateValue(request.endsOn),
      requestedDays: Number(request.requestedDays),
      leaveUnit: request.leaveUnit,
      reason: request.reason,
      documentReference: request.documentReference,
      supportingEvidenceRequired: request.supportingEvidenceRequiredSnapshot,
      supportingEvidenceStatus: request.supportingEvidenceStatus,
      supportingDocuments: request.supportingDocuments.map(serializeLeaveDocument),
      status: request.status,
      revision: request.revision,
      reviewNote: request.reviewNote,
      cancellationReason: request.cancellationReason,
      reviewedBy: request.reviewedBy?.name ?? null,
      currentBalance: request.balanceTrackedSnapshot ? balanceMap.get(`${request.membershipId}:${request.policyId}`) ?? 0 : null,
      resultingBalance: request.balanceTrackedSnapshot
        ? request.status === "PENDING"
          ? (balanceMap.get(`${request.membershipId}:${request.policyId}`) ?? 0) - Number(request.requestedDays)
          : balanceMap.get(`${request.membershipId}:${request.policyId}`) ?? 0
        : null,
    })),
    balances: [...balanceMap.entries()].map(([key, units]) => {
      const [membershipId, policyId] = key.split(":");
      return { membershipId, policyId, units };
    }),
    bucketBalances,
    summary: { pending: requests.filter((request) => request.status === "PENDING").length, approved: requests.filter((request) => request.status === "APPROVED").length, employees: employees.length },
  };
}

export async function reviewLeaveRequest(input: { businessId: string; allowedBranchIds: readonly string[]; actor: AppSession; actorLevel?: HrApprovalActorLevel; request?: AuditRequestContext; rawInput: unknown }) {
  const decision = leaveReviewInputSchema.parse(input.rawInput);
  return prisma.$transaction(async (tx) => {
    const leave = await tx.leaveRequest.findFirst({
      where: { id: decision.requestId, businessId: input.businessId, branchId: { in: [...input.allowedBranchIds] } },
      include: {
        membership: { include: { staffUser: { select: { id: true } } } },
        days: true,
        policyVersion: true,
        supportingDocuments: {
          where: { lifecycleStatus: "ACTIVE" },
          select: { id: true, source: true, reviewStatus: true, checksumSha256: true },
        },
      },
    });
    if (!leave) throw new Error("Leave request is unavailable in your branch scope.");
    await lockLeaveKey(tx, `approval:${leave.businessId}:${leave.membershipId}:${leave.policyId}:${leave.startsOn.getUTCFullYear()}`);
    if (leave.status === decision.decision) return { id: leave.id, status: leave.status, revision: leave.revision };
    if (leave.status !== "PENDING" || leave.revision !== decision.expectedRevision) throw new Error("LEAVE_APPLICATION_UPDATED: refresh before reviewing.");
    if (leave.membership.staffUser?.id === input.actor.userId) throw new Error("Employees cannot approve or reject their own Leave application.");
    const evidencePresent = leave.supportingDocuments.length > 0;
    const evidenceStatus = leave.supportingEvidenceStatus;
    if (decision.decision === "APPROVED" && leave.supportingEvidenceRequiredSnapshot) {
      if (!evidencePresent) throw new Error("A verified supporting document is required before this Leave can be approved.");
      if (evidenceStatus !== "VERIFIED" || leave.supportingDocuments.some((document) => document.reviewStatus !== "VERIFIED")) {
        throw new Error("Review and verify every required supporting document before approving this Leave.");
      }
    }
    const approvalRoute = await routeHrApprovalDecision(tx, {
      businessId: input.businessId,
      domain: "LEAVE",
      subjectId: leave.id,
      subjectRevision: leave.revision,
      subjectValue: Number(leave.requestedDays),
      actorUserId: input.actor.userId,
      actorLevel: input.actorLevel ?? "MANAGER",
      outcome: decision.decision,
      payload: {
        requestId: leave.id,
        expectedRevision: decision.expectedRevision,
        decision: decision.decision,
        reviewNote: decision.reviewNote || null,
      },
      reason: decision.reviewNote || null,
    });
    if (!approvalRoute.finalized) {
      await writeAuditLog({
        businessId: input.businessId,
        branchId: leave.branchId,
        actor: input.actor,
        request: input.request,
        action: "LEAVE_REQUEST_LEVEL_ONE_APPROVED",
        entityType: "LeaveRequest",
        entityId: leave.id,
        summary: `${leave.policyNameSnapshot} passed manager review and is awaiting owner approval.`,
        after: { status: leave.status, revision: leave.revision, approvalStage: "LEVEL_ONE" },
      }, tx);
      return { id: leave.id, status: leave.status, revision: leave.revision, finalized: false, approvalStage: "LEVEL_ONE" as const };
    }
    if (decision.decision === "APPROVED") {
      assertForwardPolicy(leave.policyVersion);
      await assertNoApprovedOverlap(tx, leave);
      if (leave.balanceTrackedSnapshot) {
        const entitlementResult = await ensureEntitlement(tx, {
          businessId: input.businessId,
          membershipId: leave.membershipId,
          joinedAt: leave.membership.joinedAt,
          policyId: leave.policyId,
          version: leave.policyVersion,
          year: leave.startsOn.getUTCFullYear(),
          asOf: leave.startsOn,
          actorUserId: input.actor.userId,
        });
        const leaveYearStart = entitlementResult.entitlement.leaveYearStart;
        await expireCarryForwardBuckets(tx, {
          businessId: input.businessId,
          membershipId: leave.membershipId,
          policyId: leave.policyId,
          asOf: new Date(),
          actorUserId: input.actor.userId,
        });
        const available = await getLedgerBalance(tx, input.businessId, leave.membershipId, leave.policyId, leaveYearStart);
        if (!leave.policyVersion.allowNegativeBalance && available < Number(leave.requestedDays)) {
          throw new Error(`Insufficient leave balance. Available: ${available.toFixed(2)} day(s).`);
        }
        await allocateApprovedLeave(tx, {
          businessId: input.businessId,
          leaveRequestId: leave.id,
          membershipId: leave.membershipId,
          policyId: leave.policyId,
          policyVersionId: leave.policyVersionId,
          leaveYearStart,
          requestedUnits: Number(leave.requestedDays),
          asOf: new Date(),
          priority: leave.policyVersion.consumptionPriority,
          actorUserId: input.actor.userId,
        });
      }
    }
    const nextRevision = leave.revision + 1;
    const evidenceReference = evidencePresent
      ? sha256(leave.supportingDocuments.map((document) => ({ id: document.id, checksum: document.checksumSha256, status: document.reviewStatus })))
      : null;
    const digest = sha256({
      requestId: leave.id,
      policyVersionId: leave.policyVersionId,
      payTreatment: leave.payTreatmentSnapshot,
      units: leave.requestedDays.toString(),
      decision: decision.decision,
      evidencePresent,
      evidenceStatus,
      evidenceReference,
    });
    const updated = await tx.leaveRequest.updateMany({
      where: { id: leave.id, status: "PENDING", revision: decision.expectedRevision },
      data: {
        status: decision.decision,
        revision: nextRevision,
        reviewedById: input.actor.userId,
        reviewedAt: new Date(),
        reviewNote: decision.reviewNote || null,
        decisionDigest: digest,
        supportingEvidencePresentSnapshot: evidencePresent,
        supportingEvidenceStatusSnapshot: evidenceStatus,
        supportingEvidenceReferenceSnapshot: evidenceReference,
        supportingEvidenceDocumentCountSnapshot: leave.supportingDocuments.length,
      },
    });
    if (updated.count !== 1) throw new Error("LEAVE_APPLICATION_UPDATED: refresh before reviewing.");
    if (decision.decision === "APPROVED" && leave.membership.staffUser) {
      const start = utcDateToDateValue(leave.startsOn);
      const endExclusive = addDaysToDateValue(utcDateToDateValue(leave.endsOn), 1);
      await tx.staffTimeOff.upsert({
        where: { leaveRequestId: leave.id },
        create: { businessId: input.businessId, userId: leave.membership.staffUser.id, leaveRequestId: leave.id, startsAt: parseBusinessDateTime(start, "00:00"), endsAt: parseBusinessDateTime(endExclusive, "00:00"), reason: leave.policyNameSnapshot },
        update: {},
      });
    }
    await tx.leaveApplicationEvent.create({ data: {
      businessId: input.businessId,
      leaveRequestId: leave.id,
      revision: nextRevision,
      eventType: decision.decision,
      statusSnapshot: decision.decision,
      reason: decision.reviewNote || (decision.decision === "APPROVED" ? "Approved." : "Rejected."),
      sourceKey: `leave-decision:${leave.id}:${decision.decision}`,
      actorUserId: input.actor.userId,
    } });
    await writeAuditLog({
      businessId: input.businessId,
      branchId: leave.branchId,
      actor: input.actor,
      request: input.request,
      action: `LEAVE_REQUEST_${decision.decision}`,
      entityType: "LeaveRequest",
      entityId: leave.id,
      summary: `${leave.policyNameSnapshot} ${decision.decision.toLowerCase()}.`,
      after: {
        status: decision.decision,
        revision: nextRevision,
        decisionDigest: digest,
        supportingEvidencePresent: evidencePresent,
        supportingEvidenceStatus: evidenceStatus,
        supportingEvidenceDocumentCount: leave.supportingDocuments.length,
      },
    }, tx);
    return { id: leave.id, status: decision.decision, revision: nextRevision, finalized: true, approvalStage: approvalRoute.stage };
  }, { isolationLevel: "Serializable" });
}

export async function cancelApprovedLeaveRequest(input: { businessId: string; allowedBranchIds: readonly string[]; actor: AppSession; request?: AuditRequestContext; rawInput: unknown }) {
  const data = leaveManagerCancelInputSchema.parse(input.rawInput);
  return prisma.$transaction(async (tx) => {
    const leave = await tx.leaveRequest.findFirst({ where: { id: data.requestId, businessId: input.businessId, branchId: { in: [...input.allowedBranchIds] } } });
    if (!leave) throw new Error("Leave request is unavailable in your branch scope.");
    await lockLeaveKey(tx, `approval:${leave.businessId}:${leave.membershipId}:${leave.policyId}:${leave.startsOn.getUTCFullYear()}`);
    if (leave.status === "CANCELLED") return { id: leave.id, status: leave.status, revision: leave.revision };
    if (leave.status !== "APPROVED" || leave.revision !== data.expectedRevision) throw new Error("LEAVE_APPLICATION_UPDATED: refresh before cancelling.");
    const cancelledAt = new Date();
    if (leave.balanceTrackedSnapshot) {
      await restoreCancelledLeaveAllocations(tx, {
        businessId: input.businessId,
        leaveRequestId: leave.id,
        membershipId: leave.membershipId,
        policyId: leave.policyId,
        policyVersionId: leave.policyVersionId,
        requestedUnits: Number(leave.requestedDays),
        cancelledAt,
        reason: data.reason,
        actorUserId: input.actor.userId,
      });
    }
    const nextRevision = leave.revision + 1;
    const updated = await tx.leaveRequest.updateMany({
      where: { id: leave.id, status: "APPROVED", revision: data.expectedRevision },
      data: { status: "CANCELLED", revision: nextRevision, cancelledAt, cancelledById: input.actor.userId, cancellationReason: data.reason },
    });
    if (updated.count !== 1) throw new Error("LEAVE_APPLICATION_UPDATED: refresh before cancelling.");
    await tx.staffTimeOff.deleteMany({ where: { businessId: input.businessId, leaveRequestId: leave.id } });
    await tx.leaveApplicationEvent.create({ data: {
      businessId: input.businessId,
      leaveRequestId: leave.id,
      revision: nextRevision,
      eventType: "CANCELLED",
      statusSnapshot: "CANCELLED",
      reason: data.reason,
      sourceKey: `leave-manager-cancel:${leave.id}`,
      actorUserId: input.actor.userId,
    } });
    await writeAuditLog({ businessId: input.businessId, branchId: leave.branchId, actor: input.actor, request: input.request, action: "LEAVE_REQUEST_CANCELLED", entityType: "LeaveRequest", entityId: leave.id, summary: "Manager cancelled approved leave and restored its balance once.", after: { revision: nextRevision } }, tx);
    return { id: leave.id, status: "CANCELLED" as const, revision: nextRevision };
  }, { isolationLevel: "Serializable" });
}

export async function upsertEmployeeLeaveBalance(input: { businessId: string; allowedBranchIds: readonly string[]; actor: AppSession; request?: AuditRequestContext; rawInput: unknown }) {
  const data = leaveBalanceInputSchema.parse(input.rawInput);
  return prisma.$transaction(async (tx) => {
    await lockLeaveKey(tx, `balance:${input.businessId}:${data.membershipId}:${data.policyId}:${data.year}`);
    const [membership, version] = await Promise.all([
      tx.employeeBusinessMembership.findFirst({ where: { id: data.membershipId, businessId: input.businessId, branchAssignments: { some: { branchId: { in: [...input.allowedBranchIds] }, status: "ACTIVE" } } } }),
      resolvePolicyVersion(input.businessId, data.policyId, yearStart(data.year), tx),
    ]);
    if (!membership || !version) throw new Error("Employee or leave policy is outside your access scope.");
    assertForwardPolicy(version);
    const entitlementResult = await ensureEntitlement(tx, { businessId: input.businessId, membershipId: membership.id, joinedAt: membership.joinedAt, policyId: data.policyId, version, year: data.year, actorUserId: input.actor.userId });
    const saved = await tx.leaveBalanceLedgerEntry.create({ data: {
      businessId: input.businessId,
      membershipId: membership.id,
      policyId: data.policyId,
      policyVersionId: version.id,
      leaveYearStart: entitlementResult.entitlement.leaveYearStart,
      eventType: "MANUAL_ADJUSTMENT",
      units: data.units,
      sourceKey: `leave-adjustment:${input.businessId}:${data.sourceKey}`,
      reason: data.reason,
      actorUserId: input.actor.userId,
    } });
    await writeAuditLog({ businessId: input.businessId, actor: input.actor, request: input.request, action: "LEAVE_BALANCE_ADJUSTED", entityType: "LeaveBalanceLedgerEntry", entityId: saved.id, summary: `Leave balance adjusted for ${membership.fullName}.`, after: { year: data.year, policyId: data.policyId, units: data.units } }, tx);
    return saved;
  }, { isolationLevel: "Serializable" });
}

export async function generateLeaveEntitlementsForYear(input: {
  businessId: string;
  actor: AppSession;
  request?: AuditRequestContext;
  year: number;
}) {
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2200) throw new Error("Invalid entitlement year.");
  const periodStart = new Date(Date.UTC(input.year, 0, 1));
  const periodEnd = new Date(Date.UTC(input.year, 11, 31));
  return prisma.$transaction(async (tx) => {
    await lockLeaveKey(tx, `entitlement-run:${input.businessId}:${input.year}`);
    const [memberships, policies] = await Promise.all([
      tx.employeeBusinessMembership.findMany({
        where: {
          businessId: input.businessId,
          joinedAt: { lte: periodEnd },
          OR: [{ terminatedAt: null }, { terminatedAt: { gte: periodStart } }],
        },
        select: { id: true, joinedAt: true },
      }),
      tx.leavePolicy.findMany({
        where: { businessId: input.businessId, active: true, balanceTracked: true },
        include: {
          versions: {
            where: {
              effectiveFrom: { lte: periodEnd },
              OR: [{ effectiveTo: null }, { effectiveTo: { gte: periodStart } }],
            },
            orderBy: [{ effectiveFrom: "desc" }, { revision: "desc" }],
            take: 1,
          },
        },
      }),
    ]);
    let created = 0;
    let unchanged = 0;
    let notEligible = 0;
    const processedEntitlements = new Set<string>();
    const reviewRequired: Array<{ membershipId: string; policyId: string; reason: string }> = [];
    for (const membership of memberships) {
      for (const policy of policies) {
        const version = policy.versions[0];
        if (!version) continue;
        const periodAnchors = version.entitlementPeriodType === "CALENDAR_YEAR"
          ? [periodEnd]
          : [periodStart, periodEnd];
        for (const asOf of periodAnchors) {
          try {
            const result = await ensureEntitlement(tx, {
              businessId: input.businessId,
              membershipId: membership.id,
              joinedAt: membership.joinedAt,
              policyId: policy.id,
              version,
              year: input.year,
              asOf,
              actorUserId: input.actor.userId,
            });
            const periodKey = `${membership.id}:${policy.id}:${result.entitlement.leaveYearStart.toISOString()}`;
            if (processedEntitlements.has(periodKey)) continue;
            processedEntitlements.add(periodKey);
            if (result.created) created += 1;
            else unchanged += 1;
            if (result.eligibilityStatus === "NOT_ELIGIBLE") notEligible += 1;
          } catch (error) {
            const reason = error instanceof Error ? error.message : "Eligibility requires review.";
            reviewRequired.push({ membershipId: membership.id, policyId: policy.id, reason });
          }
        }
      }
    }
    await writeAuditLog({
      businessId: input.businessId,
      actor: input.actor,
      request: input.request,
      action: "LEAVE_ENTITLEMENT_RUN_COMPLETED",
      entityType: "EmployeeLeaveEntitlement",
      summary: `Leave entitlement generation completed for ${input.year}.`,
      after: { year: input.year, created, unchanged, notEligible, reviewRequired: reviewRequired.length },
    }, tx);
    return { year: input.year, created, unchanged, notEligible, reviewRequired };
  }, { isolationLevel: "Serializable" });
}

export async function processDueCarryForwardExpiries(input: {
  businessId: string;
  actor: AppSession;
  request?: AuditRequestContext;
  asOf?: Date;
}) {
  const asOf = startOfUtcDate(input.asOf ?? new Date());
  return prisma.$transaction(async (tx) => {
    await lockLeaveKey(tx, `leave-expiry:${input.businessId}:${utcDateToDateValue(asOf)}`);
    const result = await expireCarryForwardBuckets(tx, {
      businessId: input.businessId,
      asOf,
      actorUserId: input.actor.userId,
    });
    await writeAuditLog({
      businessId: input.businessId,
      actor: input.actor,
      request: input.request,
      action: "LEAVE_CARRY_FORWARD_EXPIRY_RUN_COMPLETED",
      entityType: "LeaveBucketExpiry",
      summary: `Carry-forward expiry run completed for ${utcDateToDateValue(asOf)}.`,
      after: { asOf: utcDateToDateValue(asOf), ...result },
    }, tx);
    return result;
  }, { isolationLevel: "Serializable" });
}

export async function processLeavePeriodRollover(input: {
  businessId: string;
  membershipId: string;
  policyId: string;
  destinationAsOf: Date;
  actor: AppSession;
  request?: AuditRequestContext;
}) {
  const destinationAsOf = startOfUtcDate(input.destinationAsOf);
  return prisma.$transaction(async (tx) => {
    const membership = await tx.employeeBusinessMembership.findFirst({
      where: { id: input.membershipId, businessId: input.businessId },
      select: { id: true, joinedAt: true },
    });
    if (!membership) throw new Error("Employee is outside your business scope.");
    const destinationVersion = await resolvePolicyVersion(input.businessId, input.policyId, destinationAsOf, tx);
    assertForwardPolicy(destinationVersion);
    const destinationPeriod = resolveEntitlementPeriod({
      type: destinationVersion.entitlementPeriodType,
      asOf: destinationAsOf,
      joinedAt: membership.joinedAt,
      customYearStartMonth: destinationVersion.customYearStartMonth,
      customYearStartDay: destinationVersion.customYearStartDay,
    });
    const sourceAsOf = new Date(destinationPeriod.start.getTime() - 86_400_000);
    const sourceVersion = await resolvePolicyVersion(input.businessId, input.policyId, sourceAsOf, tx);
    assertForwardPolicy(sourceVersion);
    const sourcePeriod = resolveEntitlementPeriod({
      type: sourceVersion.entitlementPeriodType,
      asOf: sourceAsOf,
      joinedAt: membership.joinedAt,
      customYearStartMonth: sourceVersion.customYearStartMonth,
      customYearStartDay: sourceVersion.customYearStartDay,
    });
    await lockLeaveKey(tx, `leave-rollover:${input.businessId}:${input.membershipId}:${input.policyId}:${utcDateToDateValue(sourcePeriod.start)}:${utcDateToDateValue(destinationPeriod.start)}`);
    const existing = await tx.leavePeriodRollover.findFirst({
      where: {
        businessId: input.businessId,
        membershipId: input.membershipId,
        policyId: input.policyId,
        sourcePeriodStart: sourcePeriod.start,
        destinationPeriodStart: destinationPeriod.start,
      },
    });
    if (existing) return { rollover: existing, created: false };
    await ensureEntitlement(tx, {
      businessId: input.businessId,
      membershipId: input.membershipId,
      joinedAt: membership.joinedAt,
      policyId: input.policyId,
      version: sourceVersion,
      year: sourceAsOf.getUTCFullYear(),
      asOf: sourceAsOf,
      actorUserId: input.actor.userId,
    });
    const destinationEntitlement = await ensureEntitlement(tx, {
      businessId: input.businessId,
      membershipId: input.membershipId,
      joinedAt: membership.joinedAt,
      policyId: input.policyId,
      version: destinationVersion,
      year: destinationAsOf.getUTCFullYear(),
      asOf: destinationAsOf,
      actorUserId: input.actor.userId,
    });
    await expireCarryForwardBuckets(tx, {
      businessId: input.businessId,
      membershipId: input.membershipId,
      policyId: input.policyId,
      asOf: destinationPeriod.start,
      actorUserId: input.actor.userId,
    });
    const sourceBuckets = await tx.leaveEntitlementBucket.findMany({
      where: {
        businessId: input.businessId,
        membershipId: input.membershipId,
        policyId: input.policyId,
        periodStart: sourcePeriod.start,
        status: { in: ["ACTIVE", "EXHAUSTED"] },
      },
    });
    const usage = await getBucketUsage(tx, sourceBuckets.map((bucket) => bucket.id));
    const sourceRemainingUnits = leaveUnits(sourceBuckets.reduce((sum, bucket) => sum + calculateBucketRemaining({
      grantedUnits: Number(bucket.grantedUnits),
      ...(usage.get(bucket.id) ?? { consumedUnits: 0, restoredUnits: 0, expiredUnits: 0 }),
    }), 0));
    const amounts = calculateCarryForward({
      enabled: sourceVersion.carryForwardEnabled,
      sourceRemainingUnits,
      limitUnits: sourceVersion.carryForwardLimitUnits === null ? null : Number(sourceVersion.carryForwardLimitUnits),
    });
    const carryExpiresAt = amounts.carriedUnits > 0
      ? resolveCarryForwardExpiry({
          destinationPeriodStart: destinationPeriod.start,
          destinationPeriodEnd: destinationPeriod.end,
          rule: sourceVersion.carryForwardExpiryRule,
          value: sourceVersion.carryForwardExpiryValue,
        })
      : null;
    const ruleSnapshot = {
      sourcePolicyVersionId: sourceVersion.id,
      sourcePolicyRevision: sourceVersion.revision,
      enabled: sourceVersion.carryForwardEnabled,
      limitUnits: sourceVersion.carryForwardLimitUnits === null ? null : Number(sourceVersion.carryForwardLimitUnits),
      expiryRule: sourceVersion.carryForwardExpiryRule,
      expiryValue: sourceVersion.carryForwardExpiryValue,
      consumptionPriority: sourceVersion.consumptionPriority,
    };
    const digest = sha256({
      businessId: input.businessId,
      membershipId: input.membershipId,
      policyId: input.policyId,
      sourcePeriod,
      destinationPeriod,
      amounts,
      carryExpiresAt,
      ruleSnapshot,
    });
    const rollover = await tx.leavePeriodRollover.create({
      data: {
        businessId: input.businessId,
        membershipId: input.membershipId,
        policyId: input.policyId,
        policyVersionId: sourceVersion.id,
        sourcePeriodStart: sourcePeriod.start,
        sourcePeriodEnd: sourcePeriod.end,
        destinationPeriodStart: destinationPeriod.start,
        destinationPeriodEnd: destinationPeriod.end,
        ...amounts,
        carryExpiresAt,
        carryForwardRuleSnapshot: ruleSnapshot,
        sourceDigest: digest,
        actorUserId: input.actor.userId,
      },
    });
    if (amounts.carriedUnits > 0) {
      const bucket = await tx.leaveEntitlementBucket.create({
        data: {
          businessId: input.businessId,
          membershipId: input.membershipId,
          policyId: input.policyId,
          policyVersionId: destinationVersion.id,
          periodStart: destinationEntitlement.entitlement.leaveYearStart,
          periodEnd: destinationEntitlement.entitlement.leaveYearEnd,
          sourceType: "CARRY_FORWARD",
          grantedUnits: amounts.carriedUnits,
          availableFrom: destinationPeriod.start,
          expiresAt: carryExpiresAt,
          rolloverId: rollover.id,
          sourceDigest: digest,
        },
      });
      await tx.leaveBalanceLedgerEntry.create({
        data: {
          businessId: input.businessId,
          membershipId: input.membershipId,
          policyId: input.policyId,
          policyVersionId: destinationVersion.id,
          leaveYearStart: destinationEntitlement.entitlement.leaveYearStart,
          eventType: "CARRY_FORWARD",
          units: amounts.carriedUnits,
          sourceKey: `leave-rollover-carry:${rollover.id}`,
          bucketId: bucket.id,
          rolloverId: rollover.id,
          reason: "Unused leave carried into the next entitlement period under the frozen policy rule.",
          actorUserId: input.actor.userId,
        },
      });
    }
    if (amounts.lapsedUnits > 0) {
      await tx.leaveBalanceLedgerEntry.create({
        data: {
          businessId: input.businessId,
          membershipId: input.membershipId,
          policyId: input.policyId,
          policyVersionId: sourceVersion.id,
          leaveYearStart: sourcePeriod.start,
          eventType: "CARRY_FORWARD_LAPSE",
          units: -amounts.lapsedUnits,
          sourceKey: `leave-rollover-lapse:${rollover.id}`,
          rolloverId: rollover.id,
          reason: "Unused leave exceeded the carry-forward rule and lapsed at period rollover.",
          actorUserId: input.actor.userId,
        },
      });
    }
    await writeAuditLog({
      businessId: input.businessId,
      actor: input.actor,
      request: input.request,
      action: "LEAVE_PERIOD_ROLLOVER_COMPLETED",
      entityType: "LeavePeriodRollover",
      entityId: rollover.id,
      summary: "Leave period rollover completed from frozen policy evidence.",
      after: { sourcePeriodStart: utcDateToDateValue(sourcePeriod.start), destinationPeriodStart: utcDateToDateValue(destinationPeriod.start), ...amounts, carryExpiresAt: carryExpiresAt ? utcDateToDateValue(carryExpiresAt) : null },
    }, tx);
    return { rollover, created: true };
  }, { isolationLevel: "Serializable" });
}

export async function processDueLeavePeriodRollovers(input: {
  businessId: string;
  actor: AppSession;
  request?: AuditRequestContext;
  asOf?: Date;
}) {
  const asOf = startOfUtcDate(input.asOf ?? new Date());
  const activePolicies = await prisma.leavePolicy.findMany({
    where: { businessId: input.businessId, active: true, balanceTracked: true },
    select: { id: true },
  });
  const due = await prisma.employeeLeaveEntitlement.findMany({
    where: {
      businessId: input.businessId,
      leaveYearEnd: { lt: asOf },
      policyId: { in: activePolicies.map((policy) => policy.id) },
    },
    orderBy: { leaveYearEnd: "asc" },
    select: { membershipId: true, policyId: true, leaveYearEnd: true },
  });
  let created = 0;
  let unchanged = 0;
  const reviewRequired: Array<{ membershipId: string; policyId: string; reason: string }> = [];
  for (const item of due) {
    try {
      const result = await processLeavePeriodRollover({
        ...input,
        membershipId: item.membershipId,
        policyId: item.policyId,
        destinationAsOf: new Date(item.leaveYearEnd.getTime() + 86_400_000),
      });
      if (result.created) created += 1;
      else unchanged += 1;
    } catch (error) {
      reviewRequired.push({ membershipId: item.membershipId, policyId: item.policyId, reason: error instanceof Error ? error.message : "Rollover requires review." });
    }
  }
  return { asOf: utcDateToDateValue(asOf), created, unchanged, reviewRequired };
}

async function resolvePolicyVersion(businessId: string, policyId: string, effectiveDate: Date, tx: LeaveTransaction | typeof prisma = prisma) {
  const policy = await tx.leavePolicy.findFirst({ where: { id: policyId, businessId, active: true }, select: { id: true } });
  if (!policy) throw new AttendanceApiError("VALIDATION_ERROR", "Leave type is unavailable.");
  const version = await tx.leavePolicyVersion.findFirst({
    where: { businessId, policyId, effectiveFrom: { lte: effectiveDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveDate } }] },
    orderBy: [{ effectiveFrom: "desc" }, { revision: "desc" }],
  });
  if (!version) throw new AttendanceApiError("VALIDATION_ERROR", "LEAVE_POLICY_NOT_READY: no effective policy version exists.");
  return version;
}

function assertForwardPolicy(version: LeavePolicyVersion) {
  if (version.legalStatus === "LEGACY_REVIEW_REQUIRED") throw new Error("LEGACY_LEAVE_REVIEW_REQUIRED: create an effective company policy revision before new use.");
  if (version.legalStatus === "LEGAL_RULE_NOT_READY") throw new Error("LEAVE_LEGAL_RULE_NOT_READY: configure a company policy or activate a verified legal rule.");
}

async function buildLeaveDaySnapshots(input: { businessId: string; membershipId: string; version: LeavePolicyVersion; startsOn: string; endsOn: string; leaveUnit: "FULL_DAY" | "HALF_DAY_AM" | "HALF_DAY_PM" }) {
  const dates = enumerateCalendarDates(input.startsOn, input.endsOn);
  if (input.leaveUnit !== "FULL_DAY" && dates.length !== 1) throw new Error("Half-day leave must cover one date only.");
  const dateObjects = dates.map((date) => new Date(`${date}T00:00:00.000Z`));
  const evidence = await prisma.attendanceExpectedDay.findMany({
    where: { businessId: input.businessId, membershipId: input.membershipId, workDate: { in: dateObjects }, status: "CURRENT" },
    orderBy: { revision: "desc" },
  });
  const latest = new Map<string, (typeof evidence)[number]>();
  for (const item of evidence) {
    const key = utcDateToDateValue(item.workDate);
    if (!latest.has(key)) latest.set(key, item);
  }
  if (input.version.countMode === "WEEKDAYS") {
    const missing = dates.filter((date) => !latest.has(date));
    if (missing.length) {
      throw new AttendanceApiError(
        "INVALID_ATTENDANCE_STATE",
        `Your work schedule for ${missing[0]} is not ready yet. Ask your manager to publish or confirm the Roster before submitting Leave.`,
      );
    }
  }
  const included = dates.flatMap((date) => {
    const expected = latest.get(date);
    if (input.version.countMode === "WEEKDAYS" && expected?.kind !== "WORKDAY") return [];
    const fraction = input.leaveUnit === "FULL_DAY" ? 1 : 0.5;
    return [{ date: new Date(`${date}T00:00:00.000Z`), dateValue: date, fraction, expectedDayId: expected?.id ?? null, expectedKind: expected?.kind ?? null, leaveUnit: input.leaveUnit }];
  });
  if (!included.length) throw new Error("The selected period contains no countable leave workday.");
  return included;
}

async function assertNoPendingOrApprovedOverlap(tx: LeaveTransaction, businessId: string, membershipId: string, days: Array<{ date: Date; leaveUnit: string }>) {
  const existing = await tx.leaveRequestDay.findMany({
    where: { businessId, membershipId, leaveDate: { in: days.map((day) => day.date) }, leaveRequest: { status: { in: ["PENDING", "APPROVED"] } } },
    select: { leaveDate: true, leaveUnit: true },
  });
  const conflict = existing.some((row) => days.some((day) => day.date.getTime() === row.leaveDate.getTime() && (day.leaveUnit === "FULL_DAY" || row.leaveUnit === "FULL_DAY" || day.leaveUnit === row.leaveUnit)));
  if (conflict) throw new AttendanceApiError("INVALID_ATTENDANCE_STATE", "A pending or approved leave application overlaps this period.");
}

async function assertNoApprovedOverlap(tx: LeaveTransaction, leave: { id: string; businessId: string; membershipId: string; days: Array<{ leaveDate: Date; leaveUnit: string }> }) {
  const existing = await tx.leaveRequestDay.findMany({
    where: { businessId: leave.businessId, membershipId: leave.membershipId, leaveDate: { in: leave.days.map((day) => day.leaveDate) }, leaveRequestId: { not: leave.id }, leaveRequest: { status: "APPROVED" } },
    select: { leaveDate: true, leaveUnit: true },
  });
  const conflict = existing.some((row) => leave.days.some((day) => day.leaveDate.getTime() === row.leaveDate.getTime() && (day.leaveUnit === "FULL_DAY" || row.leaveUnit === "FULL_DAY" || day.leaveUnit === row.leaveUnit)));
  if (conflict) throw new Error("LEAVE_OVERLAP: another approved Leave application covers this time.");
}

async function ensureEntitlement(tx: LeaveTransaction, input: { businessId: string; membershipId: string; joinedAt: Date; policyId: string; version: LeavePolicyVersion; year: number; asOf?: Date; actorUserId?: string }) {
  const membership = await tx.employeeBusinessMembership.findFirst({
    where: { id: input.membershipId, businessId: input.businessId },
    select: {
      joinedAt: true,
      terminatedAt: true,
      employmentType: true,
      branchAssignments: {
        where: { status: "ACTIVE" },
        orderBy: [{ isPrimary: "desc" }, { effectiveFrom: "asc" }],
        take: 1,
        select: { branch: { select: { countryCode: true, stateCode: true } } },
      },
    },
  });
  if (!membership) throw new Error("Employee is outside your business scope.");

  const asOf = input.asOf ?? new Date(Date.UTC(input.year, 11, 31));
  const period = resolveEntitlementPeriod({
    type: input.version.entitlementPeriodType,
    asOf,
    joinedAt: membership.joinedAt,
    customYearStartMonth: input.version.customYearStartMonth,
    customYearStartDay: input.version.customYearStartDay,
  });
  const start = period.start;
  const existing = await tx.employeeLeaveEntitlement.findFirst({ where: { businessId: input.businessId, membershipId: input.membershipId, policyId: input.policyId, leaveYearStart: start } });
  if (existing) {
    await ensureCurrentEntitlementBucket(tx, existing);
    const snapshot = existing.eligibilitySnapshot as { status?: string } | null;
    return { entitlement: existing, created: false, eligibilityStatus: snapshot?.status ?? "ELIGIBLE" };
  }

  const workplace = membership.branchAssignments[0]?.branch ?? null;
  const jurisdictionCode = workplace
    ? canonicalWorkplaceJurisdiction(workplace.countryCode, workplace.stateCode)
    : null;
  if (input.version.statutoryCategory && !jurisdictionCode) {
    throw new Error("Leave entitlement requires human eligibility review: the employee has no exact workplace jurisdiction configured.");
  }
  const statutoryRule = input.version.statutoryCategory && jurisdictionCode
    ? await tx.leaveStatutoryRule.findFirst({
      where: {
        businessId: input.businessId,
        category: input.version.statutoryCategory,
        ruleSet: {
          status: "ACTIVE",
          jurisdictionCode,
          OR: [
            { effectiveTo: null },
            { effectiveTo: { gte: period.start } },
          ],
          effectiveFrom: { lte: period.end },
        },
      },
      orderBy: { ruleSet: { effectiveFrom: "desc" } },
      include: { tiers: { orderBy: { minServiceMonths: "asc" } }, ruleSet: true },
    })
    : null;

  if (input.version.statutoryCategory && !statutoryRule) {
    throw new Error(
      `Leave entitlement requires human eligibility review: no active statutory rule matches exact workplace jurisdiction ${jurisdictionCode}.`,
    );
  }

  const companyTiers: EntitlementTier[] = [
    { minServiceMonths: 0, maxServiceMonths: 23, entitlementUnits: Number(input.version.underTwoYearsDays ?? input.version.defaultEntitlementDays ?? 0) },
    { minServiceMonths: 24, maxServiceMonths: 59, entitlementUnits: Number(input.version.twoToFiveYearsDays ?? input.version.defaultEntitlementDays ?? 0) },
    { minServiceMonths: 60, maxServiceMonths: null, entitlementUnits: Number(input.version.fiveYearsPlusDays ?? input.version.defaultEntitlementDays ?? 0) },
  ];
  const eligibleEmploymentTypes = statutoryRule?.eligibleEmploymentTypes.length
    ? statutoryRule.eligibleEmploymentTypes
    : input.version.eligibleEmploymentTypes;
  const eligibility = evaluateLeaveEligibility({
    joinedAt: membership.joinedAt,
    terminatedAt: membership.terminatedAt,
    employmentType: membership.employmentType,
    eligibleEmploymentTypes,
    periodStart: period.start,
    periodEnd: period.end,
    entitlementSemantics: statutoryRule?.entitlementSemantics,
  });
  const calculation = calculateLeaveEntitlement({
    periodStart: period.start,
    periodEnd: period.end,
    joinedAt: membership.joinedAt,
    terminatedAt: membership.terminatedAt,
    policyEffectiveFrom: input.version.effectiveFrom,
    eligibility,
    serviceTiers: companyTiers,
    statutoryTiers: statutoryRule?.tiers.map((tier) => ({
      minServiceMonths: tier.minServiceMonths,
      maxServiceMonths: tier.maxServiceMonths,
      entitlementUnits: Number(tier.entitlementUnits),
    })),
    prorationMethod: statutoryRule?.prorationMethod ?? input.version.prorationMethod,
    rounding: statutoryRule?.entitlementRounding ?? input.version.entitlementRounding,
  });
  if (calculation.eligibility.status === "REVIEW_REQUIRED") {
    throw new Error(`Leave entitlement requires human eligibility review: ${calculation.eligibility.explanation}`);
  }
  const units = calculation.entitledUnits;
  const eligibilitySnapshot = {
    ...calculation.eligibility,
    employmentType: membership.employmentType,
    eligibleEmploymentTypes,
    jurisdiction: {
      code: jurisdictionCode,
      countryCode: workplace?.countryCode ?? null,
      stateCode: workplace?.stateCode ?? null,
      source: "PRIMARY_ACTIVE_BRANCH_ASSIGNMENT",
    },
  };
  const calculationSnapshot = {
    periodType: input.version.entitlementPeriodType,
    periodStart: utcDateToDateValue(calculation.periodStart),
    periodEnd: utcDateToDateValue(calculation.periodEnd),
    serviceMonths: calculation.serviceMonths,
    statutoryUnits: calculation.statutoryUnits,
    companyUnits: calculation.companyUnits,
    effectiveBaseUnits: calculation.effectiveBaseUnits,
    eligibleDays: calculation.eligibleDays,
    periodDays: calculation.periodDays,
    prorationMethod: statutoryRule?.prorationMethod ?? input.version.prorationMethod,
    prorationFactor: calculation.prorationFactor,
    rawEntitledUnits: calculation.rawEntitledUnits,
    rounding: calculation.rounding,
    explanation: calculation.explanation,
  };
  const digest = sha256({
    businessId: input.businessId,
    membershipId: input.membershipId,
    policyVersionId: input.version.id,
    statutoryRuleSetId: statutoryRule?.ruleSetId ?? null,
    statutoryRuleId: statutoryRule?.id ?? null,
    eligibilitySnapshot,
    calculationSnapshot,
    units,
  });
  const entitlement = await tx.employeeLeaveEntitlement.create({ data: {
    businessId: input.businessId,
    membershipId: input.membershipId,
    policyId: input.policyId,
    policyVersionId: input.version.id,
    leaveYearStart: start,
    leaveYearEnd: period.end,
    entitledUnits: units,
    rawEntitledUnits: calculation.rawEntitledUnits,
    prorationFactor: calculation.prorationFactor,
    eligibilitySnapshot,
    calculationSnapshot,
    statutoryRuleSetId: statutoryRule?.ruleSetId,
    statutoryRuleId: statutoryRule?.id,
    source: statutoryRule ? "STATUTORY_OVERLAY" : "COMPANY_POLICY",
    sourceDigest: digest,
    createdById: input.actorUserId,
  } });
  const bucket = await ensureCurrentEntitlementBucket(tx, entitlement);
  if (units !== 0) {
    await tx.leaveBalanceLedgerEntry.create({ data: {
      businessId: input.businessId,
      membershipId: input.membershipId,
      policyId: input.policyId,
      policyVersionId: input.version.id,
      leaveYearStart: start,
      eventType: "ENTITLEMENT",
      units,
      sourceKey: `leave-entitlement:${entitlement.id}`,
      entitlementId: entitlement.id,
      bucketId: bucket.id,
      reason: "Deterministic entitlement from the frozen policy version.",
      actorUserId: input.actorUserId,
    } });
  }
  return { entitlement, created: true, eligibilityStatus: calculation.eligibility.status };
}

async function ensureCurrentEntitlementBucket(
  tx: LeaveTransaction,
  entitlement: {
    id: string;
    businessId: string;
    membershipId: string;
    policyId: string;
    policyVersionId: string;
    leaveYearStart: Date;
    leaveYearEnd: Date;
    entitledUnits: Prisma.Decimal;
    sourceDigest: string;
  },
) {
  const existing = await tx.leaveEntitlementBucket.findUnique({ where: { entitlementId: entitlement.id } });
  if (existing) return existing;
  return tx.leaveEntitlementBucket.create({
    data: {
      businessId: entitlement.businessId,
      membershipId: entitlement.membershipId,
      policyId: entitlement.policyId,
      policyVersionId: entitlement.policyVersionId,
      periodStart: entitlement.leaveYearStart,
      periodEnd: entitlement.leaveYearEnd,
      sourceType: "CURRENT_ENTITLEMENT",
      grantedUnits: entitlement.entitledUnits,
      availableFrom: entitlement.leaveYearStart,
      entitlementId: entitlement.id,
      sourceDigest: entitlement.sourceDigest,
    },
  });
}

async function getBucketUsage(tx: LeaveTransaction, bucketIds: readonly string[]) {
  if (!bucketIds.length) return new Map<string, { consumedUnits: number; restoredUnits: number; expiredUnits: number }>();
  const [consumed, restored, expired] = await Promise.all([
    tx.leaveConsumptionAllocation.groupBy({ by: ["bucketId"], where: { bucketId: { in: [...bucketIds] } }, _sum: { units: true } }),
    tx.leaveAllocationRestoration.groupBy({ by: ["bucketId"], where: { bucketId: { in: [...bucketIds] } }, _sum: { units: true } }),
    tx.leaveBucketExpiry.groupBy({ by: ["bucketId"], where: { bucketId: { in: [...bucketIds] } }, _sum: { units: true } }),
  ]);
  const usage = new Map<string, { consumedUnits: number; restoredUnits: number; expiredUnits: number }>();
  const rowFor = (bucketId: string) => usage.get(bucketId) ?? { consumedUnits: 0, restoredUnits: 0, expiredUnits: 0 };
  for (const row of consumed) usage.set(row.bucketId, { ...rowFor(row.bucketId), consumedUnits: Number(row._sum.units ?? 0) });
  for (const row of restored) usage.set(row.bucketId, { ...rowFor(row.bucketId), restoredUnits: Number(row._sum.units ?? 0) });
  for (const row of expired) usage.set(row.bucketId, { ...rowFor(row.bucketId), expiredUnits: Number(row._sum.units ?? 0) });
  return usage;
}

async function expireCarryForwardBuckets(tx: LeaveTransaction, input: {
  businessId: string;
  membershipId?: string;
  policyId?: string;
  asOf: Date;
  actorUserId?: string;
}) {
  const asOf = startOfUtcDate(input.asOf);
  const buckets = await tx.leaveEntitlementBucket.findMany({
    where: {
      businessId: input.businessId,
      membershipId: input.membershipId,
      policyId: input.policyId,
      sourceType: "CARRY_FORWARD",
      status: "ACTIVE",
      expiresAt: { lt: asOf },
    },
  });
  const usage = await getBucketUsage(tx, buckets.map((bucket) => bucket.id));
  let expiredBuckets = 0;
  let expiredUnits = 0;
  for (const bucket of buckets) {
    const remaining = calculateBucketRemaining({
      grantedUnits: Number(bucket.grantedUnits),
      ...(usage.get(bucket.id) ?? { consumedUnits: 0, restoredUnits: 0, expiredUnits: 0 }),
    });
    if (remaining > 0) {
      const expiry = await tx.leaveBucketExpiry.create({
        data: {
          businessId: bucket.businessId,
          bucketId: bucket.id,
          units: remaining,
          expiresAt: bucket.expiresAt!,
          sourceKey: `leave-bucket-expiry:${bucket.id}`,
        },
      });
      await tx.leaveBalanceLedgerEntry.create({
        data: {
          businessId: bucket.businessId,
          membershipId: bucket.membershipId,
          policyId: bucket.policyId,
          policyVersionId: bucket.policyVersionId,
          leaveYearStart: bucket.periodStart,
          eventType: "EXPIRY",
          units: -remaining,
          sourceKey: `leave-bucket-expiry-ledger:${bucket.id}`,
          bucketId: bucket.id,
          bucketExpiryId: expiry.id,
          reason: "Unused carry-forward leave expired under the frozen rollover rule.",
          actorUserId: input.actorUserId,
        },
      });
      expiredUnits = leaveUnits(expiredUnits + remaining);
    }
    await tx.leaveEntitlementBucket.update({ where: { id: bucket.id }, data: { status: remaining > 0 ? "EXPIRED" : "EXHAUSTED" } });
    expiredBuckets += 1;
  }
  return { expiredBuckets, expiredUnits };
}

async function allocateApprovedLeave(tx: LeaveTransaction, input: {
  businessId: string;
  leaveRequestId: string;
  membershipId: string;
  policyId: string;
  policyVersionId: string;
  leaveYearStart: Date;
  requestedUnits: number;
  asOf: Date;
  priority: "EARLIEST_EXPIRY_FIRST" | "OLDEST_ENTITLEMENT_FIRST";
  actorUserId?: string;
}) {
  const buckets = await tx.leaveEntitlementBucket.findMany({
    where: {
      businessId: input.businessId,
      membershipId: input.membershipId,
      policyId: input.policyId,
      periodStart: input.leaveYearStart,
      status: "ACTIVE",
    },
  });
  const usage = await getBucketUsage(tx, buckets.map((bucket) => bucket.id));
  const result = allocateLeaveConsumption({
    requestedUnits: input.requestedUnits,
    asOf: input.asOf,
    priority: input.priority,
    buckets: buckets.map((bucket) => ({
      id: bucket.id,
      grantedUnits: Number(bucket.grantedUnits),
      ...(usage.get(bucket.id) ?? { consumedUnits: 0, restoredUnits: 0, expiredUnits: 0 }),
      availableFrom: bucket.availableFrom,
      expiresAt: bucket.expiresAt,
      createdAt: bucket.createdAt,
    })),
  });
  for (const item of result.allocations) {
    const allocation = await tx.leaveConsumptionAllocation.create({
      data: {
        businessId: input.businessId,
        leaveRequestId: input.leaveRequestId,
        bucketId: item.bucketId,
        units: item.units,
        sourceKey: `leave-allocation:${input.leaveRequestId}:${item.bucketId}`,
      },
    });
    await tx.leaveBalanceLedgerEntry.create({
      data: {
        businessId: input.businessId,
        membershipId: input.membershipId,
        policyId: input.policyId,
        policyVersionId: input.policyVersionId,
        leaveYearStart: input.leaveYearStart,
        eventType: "APPROVED_CONSUMPTION",
        units: -item.units,
        sourceKey: `leave-approval:${input.leaveRequestId}:bucket:${item.bucketId}`,
        leaveRequestId: input.leaveRequestId,
        bucketId: item.bucketId,
        allocationId: allocation.id,
        reason: "Approved leave allocated to its canonical entitlement bucket.",
        actorUserId: input.actorUserId,
      },
    });
    const bucket = buckets.find((candidate) => candidate.id === item.bucketId)!;
    const before = usage.get(item.bucketId) ?? { consumedUnits: 0, restoredUnits: 0, expiredUnits: 0 };
    if (calculateBucketRemaining({ grantedUnits: Number(bucket.grantedUnits), ...before, consumedUnits: before.consumedUnits + item.units }) === 0) {
      await tx.leaveEntitlementBucket.update({ where: { id: item.bucketId }, data: { status: "EXHAUSTED" } });
    }
  }
  if (result.unallocatedUnits > 0) {
    await tx.leaveBalanceLedgerEntry.create({
      data: {
        businessId: input.businessId,
        membershipId: input.membershipId,
        policyId: input.policyId,
        policyVersionId: input.policyVersionId,
        leaveYearStart: input.leaveYearStart,
        eventType: "APPROVED_CONSUMPTION",
        units: -result.unallocatedUnits,
        sourceKey: `leave-approval:${input.leaveRequestId}:unallocated`,
        leaveRequestId: input.leaveRequestId,
        reason: "Approved leave consumed outside entitlement buckets under the policy balance rule.",
        actorUserId: input.actorUserId,
      },
    });
  }
  return result;
}

async function restoreCancelledLeaveAllocations(tx: LeaveTransaction, input: {
  businessId: string;
  leaveRequestId: string;
  membershipId: string;
  policyId: string;
  policyVersionId: string;
  requestedUnits: number;
  cancelledAt: Date;
  reason: string;
  actorUserId?: string;
}) {
  const allocations = await tx.leaveConsumptionAllocation.findMany({
    where: { businessId: input.businessId, leaveRequestId: input.leaveRequestId },
  });
  const buckets = await tx.leaveEntitlementBucket.findMany({ where: { id: { in: allocations.map((row) => row.bucketId) }, businessId: input.businessId } });
  const bucketById = new Map(buckets.map((bucket) => [bucket.id, bucket]));
  for (const allocation of allocations) {
    const bucket = bucketById.get(allocation.bucketId);
    if (!bucket) throw new Error("Approved leave bucket evidence is missing; cancellation requires review.");
    if (!canRestoreAllocationToBucket({ expiresAt: bucket.expiresAt, cancelledAt: input.cancelledAt }) || bucket.status === "EXPIRED") {
      throw new Error("LEAVE_CANCELLATION_REVIEW_REQUIRED: the original carry-forward bucket has expired and cannot be restored silently.");
    }
  }
  let allocatedUnits = 0;
  for (const allocation of allocations) {
    const bucket = bucketById.get(allocation.bucketId)!;
    const units = Number(allocation.units);
    const restoration = await tx.leaveAllocationRestoration.create({
      data: {
        businessId: input.businessId,
        leaveRequestId: input.leaveRequestId,
        allocationId: allocation.id,
        bucketId: bucket.id,
        units,
        sourceKey: `leave-restoration:${allocation.id}`,
      },
    });
    await tx.leaveBalanceLedgerEntry.create({
      data: {
        businessId: input.businessId,
        membershipId: input.membershipId,
        policyId: input.policyId,
        policyVersionId: input.policyVersionId,
        leaveYearStart: bucket.periodStart,
        eventType: "CANCELLATION_RESTORE",
        units,
        sourceKey: `leave-cancel-restore:${input.leaveRequestId}:bucket:${bucket.id}`,
        leaveRequestId: input.leaveRequestId,
        bucketId: bucket.id,
        allocationId: allocation.id,
        restorationId: restoration.id,
        reason: input.reason,
        actorUserId: input.actorUserId,
      },
    });
    if (bucket.status === "EXHAUSTED") await tx.leaveEntitlementBucket.update({ where: { id: bucket.id }, data: { status: "ACTIVE" } });
    allocatedUnits = leaveUnits(allocatedUnits + units);
  }
  const unallocatedUnits = leaveUnits(input.requestedUnits - allocatedUnits);
  if (unallocatedUnits > 0) {
    const original = await tx.leaveBalanceLedgerEntry.findFirst({
      where: {
        businessId: input.businessId,
        OR: [
          { sourceKey: `leave-approval:${input.leaveRequestId}:unallocated` },
          { sourceKey: `leave-approval:${input.leaveRequestId}` },
        ],
      },
      select: { leaveYearStart: true },
    });
    if (!original) throw new Error("Approved leave balance evidence is missing; cancellation requires review.");
    await tx.leaveBalanceLedgerEntry.create({
      data: {
        businessId: input.businessId,
        membershipId: input.membershipId,
        policyId: input.policyId,
        policyVersionId: input.policyVersionId,
        leaveYearStart: original.leaveYearStart,
        eventType: "CANCELLATION_RESTORE",
        units: unallocatedUnits,
        sourceKey: `leave-cancel-restore:${input.leaveRequestId}:unallocated`,
        leaveRequestId: input.leaveRequestId,
        reason: input.reason,
        actorUserId: input.actorUserId,
      },
    });
  }
}

async function assertCompanyPolicyMeetsStatutoryMinimum(
  tx: LeaveTransaction,
  businessId: string,
  category: LeaveStatutoryCategory,
  effectiveFrom: Date,
  data: ReturnType<typeof leavePolicyVersionInputSchema.parse>,
) {
  const rules = await tx.leaveStatutoryRule.findMany({
    where: {
      businessId,
      category,
      ruleSet: {
        status: "ACTIVE",
        effectiveFrom: { lte: effectiveFrom },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
      },
    },
    include: { tiers: { orderBy: { minServiceMonths: "asc" } }, ruleSet: true },
  });
  if (!rules.length) {
    throw new Error("Activate a reviewed statutory rule pack for this Leave category before mapping the company policy.");
  }
  const nullableNumber = (value: number | "" | undefined) => value === "" || value === undefined ? null : Number(value);
  const fallback = nullableNumber(data.defaultEntitlementDays) ?? 0;
  const companyUnitsAt = (serviceMonths: number) => {
    if (serviceMonths < 24) return nullableNumber(data.underTwoYearsDays) ?? fallback;
    if (serviceMonths < 60) return nullableNumber(data.twoToFiveYearsDays) ?? fallback;
    return nullableNumber(data.fiveYearsPlusDays) ?? fallback;
  };
  for (const rule of rules) {
    for (const tier of rule.tiers) {
      const statutoryUnits = Number(tier.entitlementUnits);
      const companyUnits = companyUnitsAt(tier.minServiceMonths);
      if (companyUnits < statutoryUnits) {
        throw new Error(`Company policy is below the active statutory minimum at ${tier.minServiceMonths} service months (${companyUnits} < ${statutoryUnits}).`);
      }
    }
  }
  const primary = rules.sort((left, right) => right.ruleSet.effectiveFrom.getTime() - left.ruleSet.effectiveFrom.getTime())[0];
  return { ruleSetId: primary.ruleSetId, ruleId: primary.id, sourceReference: primary.ruleSet.sourceReference };
}

async function getLedgerBalance(tx: LeaveTransaction, businessId: string, membershipId: string, policyId: string, leaveYearStart: Date) {
  const result = await tx.leaveBalanceLedgerEntry.aggregate({ where: { businessId, membershipId, policyId, leaveYearStart }, _sum: { units: true } });
  return Number(result._sum.units ?? 0);
}

async function lockLeaveKey(tx: LeaveTransaction, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

function replaySubmission(existing: { id: string; status: string; revision: number; policyId: string; startsOn: Date; endsOn: Date; leaveUnit: string; reason: string }, input: ReturnType<typeof leaveRequestInputSchema.parse>) {
  if (existing.policyId !== input.policyId || utcDateToDateValue(existing.startsOn) !== input.startsOn || utcDateToDateValue(existing.endsOn) !== input.endsOn || existing.leaveUnit !== input.leaveUnit || existing.reason !== input.reason) {
    throw new AttendanceApiError("INVALID_ATTENDANCE_STATE", "Leave submission key was already used with different facts.");
  }
  return { id: existing.id, status: existing.status, revision: existing.revision };
}

function yearStart(yearOrDate: number | Date) {
  const year = typeof yearOrDate === "number" ? yearOrDate : yearOrDate.getUTCFullYear();
  return new Date(Date.UTC(year, 0, 1));
}

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function serializeVersion(version: LeavePolicyVersion) {
  return {
    ...version,
    effectiveFrom: utcDateToDateValue(version.effectiveFrom),
    effectiveTo: version.effectiveTo ? utcDateToDateValue(version.effectiveTo) : null,
    defaultEntitlementDays: version.defaultEntitlementDays === null ? null : Number(version.defaultEntitlementDays),
    underTwoYearsDays: version.underTwoYearsDays === null ? null : Number(version.underTwoYearsDays),
    twoToFiveYearsDays: version.twoToFiveYearsDays === null ? null : Number(version.twoToFiveYearsDays),
    fiveYearsPlusDays: version.fiveYearsPlusDays === null ? null : Number(version.fiveYearsPlusDays),
  };
}
