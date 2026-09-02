import type {
  AiAllowancePolicySource,
  AiAllowancePolicyStatus,
  AiScopeType,
  Prisma,
} from "@prisma/client";
import { isValidIanaTimeZone } from "@/lib/business-day";
import { getBranchLocalDateParts, parseBranchLocalDateTime } from "@/lib/attendance/work-date";
import { prisma } from "@/lib/prisma";
import { AI_CONTEXT_VERSION, AI_PROMPT_VERSION } from "./schema";

export class AiCommercialError extends Error {
  constructor(readonly code: string) { super(code); }
}

export type AiCommercialScope = {
  scopeType: AiScopeType;
  scopeKey: string;
  businessId: string | null;
  groupId: string | null;
};

type EventInput = {
  scope: AiCommercialScope;
  userId: string;
  requestKey: string;
  provider: string;
  model: string;
  conversationId?: string | null;
  usageId?: string | null;
  providerRequestId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  latencyMs?: number | null;
  errorCategory?: string | null;
};

export function getAiCommercialConfiguration(env: NodeJS.ProcessEnv = process.env) {
  return {
    enabled: env.AI_GLOBAL_ENABLED !== "false",
    countMockCommercially: env.AI_MOCK_COMMERCIAL_COUNTED === "true",
    maxOutputTokens: boundedInt(env.AI_MAX_OUTPUT_TOKENS, 1200, 128, 4096),
    maxContextTokens: boundedInt(env.AI_MAX_CONTEXT_TOKENS, 25_000, 1_000, 100_000),
  };
}

export async function createAiAllowancePolicy(input: {
  actorUserId: string;
  scopeType: AiScopeType;
  businessId?: string | null;
  groupId?: string | null;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  requestLimit: number | null;
  tokenLimit?: number | null;
  timezone?: string;
  status?: AiAllowancePolicyStatus;
  source: AiAllowancePolicySource;
  reason: string;
}) {
  const reason = input.reason.trim();
  if (reason.length < 8 || reason.length > 500) throw new AiCommercialError("AI_ALLOWANCE_REASON_INVALID");
  assertLimit(input.requestLimit, "AI_REQUEST_LIMIT_INVALID");
  assertLimit(input.tokenLimit ?? null, "AI_TOKEN_LIMIT_INVALID");
  if (!Number.isFinite(input.effectiveFrom.getTime()) || (input.effectiveTo && input.effectiveTo <= input.effectiveFrom)) {
    throw new AiCommercialError("AI_ALLOWANCE_PERIOD_INVALID");
  }
  const actor = await prisma.user.findUnique({ where: { id: input.actorUserId }, select: { role: true, status: true } });
  if (!actor || actor.role !== "PLATFORM_ADMIN" || actor.status !== "active") {
    throw new AiCommercialError("AI_ALLOWANCE_PLATFORM_AUTHORITY_REQUIRED");
  }
  const scope = await resolveManagedScope(input);
  const timezone = input.timezone ?? scope.defaultTimezone;
  if (!isValidIanaTimeZone(timezone)) throw new AiCommercialError("AI_ALLOWANCE_TIMEZONE_INVALID");

  return prisma.$transaction(async (tx) => {
    await advisoryLock(tx, scope.scopeKey);
    const latest = await tx.aiAllowancePolicy.findFirst({ where: { scopeKey: scope.scopeKey }, orderBy: { revision: "desc" } });
    const policy = await tx.aiAllowancePolicy.create({ data: {
      scopeType: input.scopeType,
      scopeKey: scope.scopeKey,
      businessId: scope.businessId,
      groupId: scope.groupId,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      requestLimit: input.requestLimit,
      tokenLimit: input.tokenLimit ?? null,
      timezone,
      status: input.status ?? "ACTIVE",
      source: input.source,
      revision: (latest?.revision ?? 0) + 1,
      reason,
      createdById: input.actorUserId,
    } });
    const after = {
      scopeType: policy.scopeType,
      requestLimit: policy.requestLimit,
      tokenLimit: policy.tokenLimit,
      timezone: policy.timezone,
      status: policy.status,
      source: policy.source,
      revision: policy.revision,
      effectiveFrom: policy.effectiveFrom.toISOString(),
      effectiveTo: policy.effectiveTo?.toISOString() ?? null,
      reason: policy.reason,
    };
    if (scope.businessId) {
      await tx.auditLog.create({ data: {
        businessId: scope.businessId,
        actorUserId: input.actorUserId,
        action: "AI_ALLOWANCE_POLICY_CREATED",
        entityType: "AiAllowancePolicy",
        entityId: policy.id,
        summary: `AI allowance revision ${policy.revision} created by platform authority.`,
        before: latest ? policySnapshot(latest) : undefined,
        after,
        metadata: { localOrTestingControl: true },
      } });
    } else {
      await tx.businessGroupAuditLog.create({ data: {
        groupId: scope.groupId!,
        actorUserId: input.actorUserId,
        action: "AI_ALLOWANCE_POLICY_CREATED",
        entityType: "AiAllowancePolicy",
        entityId: policy.id,
        summary: `AI allowance revision ${policy.revision} created by platform authority.`,
        before: latest ? policySnapshot(latest) : undefined,
        after,
        metadata: { localOrTestingControl: true },
      } });
    }
    return policy;
  }, { isolationLevel: "Serializable" });
}

export async function assertAiAllowanceConfigured(scope: AiCommercialScope, now: Date) {
  const policy = await findEffectivePolicy(prisma, scope.scopeKey, now);
  assertPolicyUsable(policy);
  return policy!;
}

export async function reserveAiQuota(input: EventInput & { now: Date }) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const outcome = await prisma.$transaction(async (tx) => {
      await advisoryLock(tx, input.scope.scopeKey);
      const policy = await findEffectivePolicy(tx, input.scope.scopeKey, input.now);
      assertPolicyUsable(policy);
      const bounds = getCalendarMonthBounds(input.now, policy!.timezone);
      let period = await tx.aiAllowancePeriod.findUnique({
        where: { scopeKey_periodStart: { scopeKey: input.scope.scopeKey, periodStart: bounds.start } },
      });
      if (!period) {
        period = await tx.aiAllowancePeriod.create({ data: {
          ...input.scope,
          periodStart: bounds.start,
          periodEnd: bounds.end,
          timezone: policy!.timezone,
          policyId: policy!.id,
          policyRevision: policy!.revision,
          requestLimitSnapshot: policy!.requestLimit,
          tokenLimitSnapshot: policy!.tokenLimit,
        } });
      } else if (period.policyId !== policy!.id) {
        period = await tx.aiAllowancePeriod.update({ where: { id: period.id }, data: {
          policyId: policy!.id,
          policyRevision: policy!.revision,
          requestLimitSnapshot: policy!.requestLimit,
          tokenLimitSnapshot: policy!.tokenLimit,
          timezone: policy!.timezone,
        } });
      }
      const existing = await tx.aiQuotaReservation.findUnique({ where: { requestKey: input.requestKey } });
      if (existing) throw new AiCommercialError("AI_REQUEST_DUPLICATE");
      const inFlightAndUsed = period.reservedRequests + period.consumedRequests;
      if (period.requestLimitSnapshot !== null && inFlightAndUsed >= period.requestLimitSnapshot) {
        await createEvent(tx, input, "QUOTA_DENIED", false, { period, policy: policy! });
        return { reservation: null, denied: true };
      }
      const reservation = await tx.aiQuotaReservation.create({ data: {
        ...input.scope,
        userId: input.userId,
        periodId: period.id,
        policyId: policy!.id,
        policyRevision: policy!.revision,
        requestKey: input.requestKey,
      } });
      await tx.aiAllowancePeriod.update({ where: { id: period.id }, data: { reservedRequests: { increment: 1 } } });
      await createEvent(tx, input, "RESERVED", false, { period, policy: policy!, reservationId: reservation.id });
      return { reservation, denied: false };
      }, { isolationLevel: "Serializable" });
      if (outcome.denied) throw new AiCommercialError("AI_QUOTA_EXCEEDED");
      return outcome.reservation!;
    } catch (error) {
      if (error instanceof AiCommercialError) throw error;
      if (isUniqueViolation(error)) throw new AiCommercialError("AI_REQUEST_DUPLICATE");
      if (isRetryableTransactionFailure(error) && attempt < 4) continue;
      throw error;
    }
  }
  throw new AiCommercialError("AI_QUOTA_RESERVATION_FAILED");
}

export async function consumeAiQuota(input: EventInput & { reservationId: string }) {
  await prisma.$transaction((tx) => consumeAiQuotaInTransaction(tx, input), { isolationLevel: "Serializable" });
}

export async function releaseAiQuota(input: EventInput & { reservationId: string }) {
  await prisma.$transaction((tx) => releaseAiQuotaInTransaction(tx, input), { isolationLevel: "Serializable" });
}

export async function finalizeAiSuccess(input: EventInput & {
  reservationId?: string | null;
  persist: (tx: Prisma.TransactionClient) => Promise<void>;
}) {
  await prisma.$transaction(async (tx) => {
    await input.persist(tx);
    if (input.reservationId) await consumeAiQuotaInTransaction(tx, { ...input, reservationId: input.reservationId });
    else await createUncountedEvent(tx, input, true);
  }, { isolationLevel: "Serializable" });
}

export async function finalizeAiFailure(input: EventInput & {
  reservationId?: string | null;
  persist: (tx: Prisma.TransactionClient) => Promise<void>;
}) {
  await prisma.$transaction(async (tx) => {
    await input.persist(tx);
    if (input.reservationId) await releaseAiQuotaInTransaction(tx, { ...input, reservationId: input.reservationId });
    else await createUncountedEvent(tx, input, false);
  }, { isolationLevel: "Serializable" });
}

export async function recordUncountedAiEvent(input: EventInput & { succeeded: boolean }) {
  await createUncountedEvent(prisma, input, input.succeeded);
}

async function createUncountedEvent(client: Prisma.TransactionClient | typeof prisma, input: EventInput, succeeded: boolean) {
  await client.aiUsageEvent.create({ data: {
    eventType: succeeded ? "SUCCEEDED" : "FAILED",
    ...input.scope,
    userId: input.userId,
    conversationId: input.conversationId ?? null,
    usageId: input.usageId ?? null,
    requestKey: input.requestKey,
    provider: input.provider,
    model: input.model,
    providerRequestId: input.providerRequestId ?? null,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    totalTokens: input.totalTokens ?? null,
    latencyMs: input.latencyMs ?? null,
    promptVersion: AI_PROMPT_VERSION,
    contextVersion: AI_CONTEXT_VERSION,
    commerciallyCounted: false,
    errorCategory: input.errorCategory ?? null,
  } });
}

async function consumeAiQuotaInTransaction(tx: Prisma.TransactionClient, input: EventInput & { reservationId: string }) {
  const reservation = await tx.aiQuotaReservation.findUniqueOrThrow({ where: { id: input.reservationId }, include: { period: true, policy: true } });
  await advisoryLock(tx, reservation.scopeKey);
  if (reservation.status === "CONSUMED") return;
  if (reservation.status !== "RESERVED") throw new AiCommercialError("AI_QUOTA_RESERVATION_NOT_ACTIVE");
  await tx.aiQuotaReservation.update({ where: { id: reservation.id }, data: {
    status: "CONSUMED",
    conversationId: input.conversationId ?? null,
    consumedAt: new Date(),
  } });
  await tx.aiAllowancePeriod.update({ where: { id: reservation.periodId }, data: {
    reservedRequests: { decrement: 1 },
    consumedRequests: { increment: 1 },
  } });
  await createEvent(tx, input, "SUCCEEDED", true, { period: reservation.period, policy: reservation.policy, reservationId: reservation.id });
}

async function releaseAiQuotaInTransaction(tx: Prisma.TransactionClient, input: EventInput & { reservationId: string }) {
  const reservation = await tx.aiQuotaReservation.findUnique({ where: { id: input.reservationId }, include: { period: true, policy: true } });
  if (!reservation) return;
  await advisoryLock(tx, reservation.scopeKey);
  if (reservation.status !== "RESERVED") return;
  await tx.aiQuotaReservation.update({ where: { id: reservation.id }, data: { status: "RELEASED", releasedAt: new Date() } });
  await tx.aiAllowancePeriod.update({ where: { id: reservation.periodId }, data: { reservedRequests: { decrement: 1 } } });
  await createEvent(tx, input, "RELEASED", false, { period: reservation.period, policy: reservation.policy, reservationId: reservation.id });
}

export async function getAiCommercialSummary(scope: AiCommercialScope, now = new Date(), monthOffset = 0) {
  const policy = await findEffectivePolicy(prisma, scope.scopeKey, now);
  if (!policy) return { configured: false as const, status: "NOT_CONFIGURED" as const };
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 15, 12));
  const bounds = getCalendarMonthBounds(target, policy.timezone);
  const period = await prisma.aiAllowancePeriod.findUnique({
    where: { scopeKey_periodStart: { scopeKey: scope.scopeKey, periodStart: bounds.start } },
  });
  const tokenUsage = await prisma.aiUsageEvent.aggregate({
    where: {
      periodId: period?.id ?? "__NO_ALLOWANCE_PERIOD__",
      eventType: "SUCCEEDED",
      commerciallyCounted: true,
    },
    _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
  });
  const used = period?.consumedRequests ?? 0;
  const reserved = period?.reservedRequests ?? 0;
  const requestLimit = period?.requestLimitSnapshot ?? policy.requestLimit;
  const tokenLimit = period?.tokenLimitSnapshot ?? policy.tokenLimit;
  const totalTokens = tokenUsage._sum.totalTokens ?? 0;
  return {
    configured: true as const,
    status: policy.status,
    scopeType: scope.scopeType,
    policyRevision: period?.policyRevision ?? policy.revision,
    source: policy.source,
    timezone: policy.timezone,
    periodStart: bounds.start,
    periodEnd: bounds.end,
    requestLimit,
    usedRequests: used,
    reservedRequests: reserved,
    remainingRequests: requestLimit === null ? null : Math.max(requestLimit - used - reserved, 0),
    inputTokens: tokenUsage._sum.inputTokens ?? 0,
    outputTokens: tokenUsage._sum.outputTokens ?? 0,
    totalTokens,
    tokenLimit,
    tokenLimitExceeded: tokenLimit !== null && totalTokens > tokenLimit,
  };
}

export async function reconcileAiCommercialUsage(scopeKey?: string) {
  const periods = await prisma.aiAllowancePeriod.findMany({ where: scopeKey ? { scopeKey } : undefined });
  const issues: Array<{ periodId: string; code: string; expected: number; actual: number }> = [];
  for (const period of periods) {
    const [reserved, consumed, commercialSuccess] = await Promise.all([
      prisma.aiQuotaReservation.count({ where: { periodId: period.id, status: "RESERVED" } }),
      prisma.aiQuotaReservation.count({ where: { periodId: period.id, status: "CONSUMED" } }),
      prisma.aiUsageEvent.count({ where: { periodId: period.id, eventType: "SUCCEEDED", commerciallyCounted: true } }),
    ]);
    if (reserved !== period.reservedRequests) issues.push({ periodId: period.id, code: "RESERVED_COUNTER_MISMATCH", expected: reserved, actual: period.reservedRequests });
    if (consumed !== period.consumedRequests) issues.push({ periodId: period.id, code: "CONSUMED_COUNTER_MISMATCH", expected: consumed, actual: period.consumedRequests });
    if (commercialSuccess !== consumed) issues.push({ periodId: period.id, code: "LEDGER_CONSUMPTION_MISMATCH", expected: consumed, actual: commercialSuccess });
  }
  const mockCounted = await prisma.aiUsageEvent.count({ where: { provider: "mock", commerciallyCounted: true } });
  if (mockCounted) issues.push({ periodId: "GLOBAL", code: "MOCK_COMMERCIAL_USAGE_REQUIRES_REVIEW", expected: 0, actual: mockCounted });
  return { ready: issues.length === 0, periods: periods.length, issues };
}

function getCalendarMonthBounds(now: Date, timezone: string) {
  const parts = getBranchLocalDateParts(now, timezone);
  const nextMonth = parts.month === 12 ? { year: parts.year + 1, month: 1 } : { year: parts.year, month: parts.month + 1 };
  return {
    start: parseBranchLocalDateTime(`${parts.year}-${pad(parts.month)}-01T00:00`, timezone),
    end: parseBranchLocalDateTime(`${nextMonth.year}-${pad(nextMonth.month)}-01T00:00`, timezone),
  };
}

async function resolveManagedScope(input: { scopeType: AiScopeType; businessId?: string | null; groupId?: string | null; timezone?: string }) {
  if (input.scopeType === "BUSINESS" && input.businessId && !input.groupId) {
    const business = await prisma.business.findUnique({ where: { id: input.businessId }, select: { id: true, timezone: true } });
    if (!business) throw new AiCommercialError("AI_ALLOWANCE_SCOPE_INVALID");
    return { scopeKey: `BUSINESS:${business.id}`, businessId: business.id, groupId: null, defaultTimezone: business.timezone };
  }
  if (input.scopeType === "GROUP" && input.groupId && !input.businessId) {
    const group = await prisma.businessGroup.findUnique({ where: { id: input.groupId }, select: { id: true } });
    if (!group) throw new AiCommercialError("AI_ALLOWANCE_SCOPE_INVALID");
    if (!input.timezone) throw new AiCommercialError("AI_ALLOWANCE_TIMEZONE_REQUIRED");
    return { scopeKey: `GROUP:${group.id}`, businessId: null, groupId: group.id, defaultTimezone: input.timezone };
  }
  throw new AiCommercialError("AI_ALLOWANCE_SCOPE_INVALID");
}

async function findEffectivePolicy(client: Prisma.TransactionClient | typeof prisma, scopeKey: string, now: Date) {
  const policies = await client.aiAllowancePolicy.findMany({ where: {
    scopeKey,
    effectiveFrom: { lte: now },
    OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
  }, orderBy: [{ revision: "desc" }, { effectiveFrom: "desc" }] });
  return policies.sort((left, right) => policySourcePriority(right.source) - policySourcePriority(left.source) || right.revision - left.revision)[0] ?? null;
}

function policySourcePriority(source: AiAllowancePolicySource) {
  return source === "PLATFORM_OVERRIDE" ? 4 : source === "TRIAL" ? 3 : source === "PLAN" ? 2 : 1;
}

function assertPolicyUsable(policy: Awaited<ReturnType<typeof findEffectivePolicy>>) {
  if (!policy) throw new AiCommercialError("AI_QUOTA_NOT_CONFIGURED");
  if (policy.status === "SUSPENDED") throw new AiCommercialError("AI_QUOTA_SUSPENDED");
  if (policy.status !== "ACTIVE") throw new AiCommercialError("AI_QUOTA_NOT_CONFIGURED");
}

async function createEvent(
  tx: Prisma.TransactionClient,
  input: EventInput,
  eventType: "RESERVED" | "SUCCEEDED" | "RELEASED" | "QUOTA_DENIED",
  commerciallyCounted: boolean,
  links: { period: { id: string }; policy: { id: string; revision: number }; reservationId?: string },
) {
  await tx.aiUsageEvent.create({ data: {
    eventType,
    ...input.scope,
    userId: input.userId,
    conversationId: input.conversationId ?? null,
    usageId: input.usageId ?? null,
    reservationId: links.reservationId ?? null,
    periodId: links.period.id,
    policyId: links.policy.id,
    policyRevision: links.policy.revision,
    requestKey: input.requestKey,
    provider: input.provider,
    model: input.model,
    providerRequestId: input.providerRequestId ?? null,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    totalTokens: input.totalTokens ?? null,
    latencyMs: input.latencyMs ?? null,
    promptVersion: AI_PROMPT_VERSION,
    contextVersion: AI_CONTEXT_VERSION,
    commerciallyCounted,
    errorCategory: input.errorCategory ?? null,
  } });
}

async function advisoryLock(tx: Prisma.TransactionClient, scopeKey: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scopeKey}))`;
}

function policySnapshot(policy: { requestLimit: number | null; tokenLimit: number | null; timezone: string; status: string; source: string; revision: number; effectiveFrom: Date; effectiveTo: Date | null; reason: string }): Prisma.InputJsonObject {
  return {
    requestLimit: policy.requestLimit,
    tokenLimit: policy.tokenLimit,
    timezone: policy.timezone,
    status: policy.status,
    source: policy.source,
    revision: policy.revision,
    effectiveFrom: policy.effectiveFrom.toISOString(),
    effectiveTo: policy.effectiveTo?.toISOString() ?? null,
    reason: policy.reason,
  };
}

function assertLimit(value: number | null, code: string) {
  if (value !== null && (!Number.isInteger(value) || value < 0 || value > 10_000_000)) throw new AiCommercialError(code);
}
function boundedInt(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}
function isRetryableTransactionFailure(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2034";
}
function pad(value: number) { return String(value).padStart(2, "0"); }
