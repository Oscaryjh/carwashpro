import { randomUUID } from "node:crypto";
import type { AiScopeType } from "@prisma/client";
import { getBusinessDayRange } from "@/lib/business-day";
import { getBusinessPerformanceReadModel } from "@/lib/business-performance/read-model";
import { resolveExpenseReadScope } from "@/lib/expense/access";
import { resolveAuthorizedGroupReportingScope } from "@/lib/business-groups/all-stores-access";
import { isBusinessModuleEnabled } from "@/lib/modules/entitlements";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/auth/session";
import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import { aiMetric, buildBusinessAiContext, buildGroupAiContext } from "./context";
import { classifyAiQuestion, type AiIntentClassification } from "./intent";
import { createAiProvider, getAiConfiguration, type AiProvider } from "./provider";
import { AI_CONTEXT_VERSION, AI_PROMPT_VERSION } from "./schema";
import { sourceDomainsForIntent, type AiScopeSnapshot } from "./presentation";
import {
  AiCommercialError,
  assertAiAllowanceConfigured,
  finalizeAiFailure,
  finalizeAiSuccess,
  getAiCommercialConfiguration,
  getAiCommercialSummary,
  reserveAiQuota,
  type AiCommercialScope,
} from "./commercial";

const DEFAULT_REQUESTS_PER_MINUTE = 6;
const DEFAULT_REQUESTS_PER_SCOPE_MINUTE = 30;

export class AiServiceError extends Error {
  constructor(readonly code: string) { super(code); }
}

type Scope =
  | { type: "BUSINESS"; businessId: string; access: ResolvedBusinessAccess; user: AppSession; selectedBranchId?: string | null }
  | { type: "GROUP"; groupId: string; currentBusinessId: string | null };

export async function askTetamuAi(input: {
  user: AppSession;
  scope: Scope;
  conversationId?: string | null;
  question: string;
  clientRequestId: string;
  range?: string;
  from?: string;
  to?: string;
}, dependencies: { provider?: AiProvider; now?: Date } = {}) {
  const question = input.question.trim();
  if (!question || question.length > 2000) throw new AiServiceError("AI_QUESTION_INVALID");
  if (!isUuid(input.clientRequestId)) throw new AiServiceError("AI_REQUEST_ID_INVALID");
  const now = dependencies.now ?? new Date();
  const classification = classifyAiQuestion(question);
  const config = getAiConfiguration();
  const commercialConfig = getAiCommercialConfiguration();
  if (!commercialConfig.enabled) throw new AiServiceError("AI_GLOBALLY_DISABLED");
  const scopeIdentity = await authorizeScope(input.user, input.scope);
  const requestKey = `${scopeIdentity.key}:${input.clientRequestId}`;
  const commercialScope: AiCommercialScope = {
    scopeType: input.scope.type,
    scopeKey: scopeIdentity.key,
    businessId: scopeIdentity.businessId,
    groupId: scopeIdentity.groupId,
  };

  const duplicate = await prisma.aiUsage.findUnique({
    where: { userId_requestKey: { userId: input.user.userId, requestKey } },
    include: { conversation: { include: { messages: { where: { role: "ASSISTANT" }, orderBy: { createdAt: "desc" }, take: 1 } } } },
  });
  if (duplicate) {
    const message = duplicate.conversation?.messages[0];
    if (duplicate.status === "SUCCEEDED" && message?.structuredMetadata) {
      return { conversationId: duplicate.conversationId!, analysis: message.structuredMetadata, duplicate: true };
    }
    throw new AiServiceError("AI_REQUEST_DUPLICATE");
  }

  try {
    await enforceRateLimit(input.user.userId, scopeIdentity, now);
  } catch (error) {
    if (error instanceof AiServiceError && error.code === "AI_RATE_LIMITED") {
      await prisma.aiUsage.create({ data: {
        businessId: scopeIdentity.businessId, groupId: scopeIdentity.groupId,
        userId: input.user.userId, provider: config.provider, model: config.model,
        requestKey, status: "RATE_LIMITED", errorCategory: "AI_RATE_LIMITED",
      } });
    }
    throw error;
  }
  try {
    await assertAiAllowanceConfigured(commercialScope, now);
  } catch (error) {
    throw mapCommercialError(error);
  }
  const commerciallyCounted = config.provider === "openai" || commercialConfig.countMockCommercially;
  let reservation: Awaited<ReturnType<typeof reserveAiQuota>> | null = null;
  if (commerciallyCounted) {
    try {
      reservation = await reserveAiQuota({
        scope: commercialScope,
        userId: input.user.userId,
        requestKey,
        provider: config.provider,
        model: config.model,
        now,
      });
    } catch (error) {
      throw mapCommercialError(error);
    }
  }
  const conversation = await resolveConversation({
    conversationId: input.conversationId,
    createdById: input.user.userId,
    scopeType: input.scope.type,
    businessId: scopeIdentity.businessId,
    groupId: scopeIdentity.groupId,
    title: question.slice(0, 80),
  });
  const usage = await prisma.aiUsage.create({ data: {
    businessId: scopeIdentity.businessId,
    groupId: scopeIdentity.groupId,
    userId: input.user.userId,
    conversationId: conversation.id,
    provider: config.provider,
    model: config.model,
    requestKey,
    status: "PENDING",
    commerciallyCounted,
    reservationId: reservation?.id ?? null,
    promptVersion: AI_PROMPT_VERSION,
    contextVersion: AI_CONTEXT_VERSION,
  } });
  const userMessage = await prisma.aiMessage.create({ data: {
    conversationId: conversation.id,
    role: "USER",
    content: question,
    clientRequestId: input.clientRequestId,
  } });
  const started = Date.now();
  try {
    const [safeContext, recentMessages] = await Promise.all([
      buildAuthorizedContext({ ...input, scopeIdentity, now, classification }),
      prisma.aiMessage.findMany({
        where: { conversationId: conversation.id, id: { not: userMessage.id } },
        orderBy: { createdAt: "desc" }, take: 8,
        select: { role: true, content: true },
      }),
    ]);
    await prisma.aiMessage.update({
      where: { id: userMessage.id },
      data: { structuredMetadata: { scopeSnapshot: safeContext.scopeSnapshot } },
    });
    if (safeContext.approximateInputTokens > commercialConfig.maxContextTokens) throw new AiServiceError("AI_CONTEXT_TOO_LARGE");
    const result = await (dependencies.provider ?? createAiProvider()).analyze({
      question,
      intent: classification.intent,
      language: classification.language,
      temporalSemantics: classification.temporalSemantics,
      context: safeContext.payload,
      recentMessages: recentMessages.reverse(),
    });
    const groundedAnalysis = removeUnavailableEvidence({
      ...result.analysis,
      intent: classification.intent,
      language: classification.language,
      temporalSemantics: classification.temporalSemantics,
    }, safeContext.payload);
    assertGroundedEvidence(groundedAnalysis, safeContext.payload);
    const latencyMs = Date.now() - started;
    await finalizeAiSuccess({
      scope: commercialScope,
      userId: input.user.userId,
      requestKey,
      provider: result.provider,
      model: result.model,
      conversationId: conversation.id,
      usageId: usage.id,
      reservationId: reservation?.id ?? null,
      providerRequestId: result.providerRequestId ?? null,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
      latencyMs,
      persist: async (tx) => {
      const assistantMessage = await tx.aiMessage.create({ data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: groundedAnalysis.summary,
        structuredMetadata: {
          ...groundedAnalysis,
          scopeSnapshot: safeContext.scopeSnapshot,
          sourceDomains: sourceDomainsForIntent(classification.intent),
        },
        provider: result.provider,
        model: result.model,
        promptVersion: AI_PROMPT_VERSION,
        contextVersion: AI_CONTEXT_VERSION,
        contextDigest: safeContext.digest,
      } });
      await tx.aiUsage.update({ where: { id: usage.id }, data: {
        provider: result.provider, model: result.model,
        inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, totalTokens: result.usage.totalTokens,
        latencyMs, status: "SUCCEEDED",
        messageId: assistantMessage.id,
        providerRequestId: result.providerRequestId ?? null,
      } });
      await tx.aiConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
      },
    });
    return { conversationId: conversation.id, analysis: groundedAnalysis, duplicate: false };
  } catch (error) {
    const errorCategory = safeErrorCategory(error);
    try {
      await finalizeAiFailure({
        scope: commercialScope,
        userId: input.user.userId,
        requestKey,
        provider: config.provider,
        model: config.model,
        conversationId: conversation.id,
        usageId: usage.id,
        reservationId: reservation?.id ?? null,
        latencyMs: Date.now() - started,
        errorCategory,
        persist: (tx) => tx.aiUsage.update({ where: { id: usage.id }, data: {
          latencyMs: Date.now() - started,
          status: "FAILED",
          errorCategory,
        } }).then(() => undefined),
      });
    } catch {
      // Preserve the original safe error; reconciliation detects any terminalization drift.
    }
    throw error instanceof AiServiceError ? error : new AiServiceError("AI_ANALYSIS_UNAVAILABLE");
  }
}

export async function getAiWorkspace(input: { userId: string; businessId?: string; groupId?: string }) {
  const where = input.businessId
    ? { createdById: input.userId, businessId: input.businessId, groupId: null, archivedAt: null }
    : { createdById: input.userId, groupId: input.groupId!, businessId: null, archivedAt: null };
  const conversations = await prisma.aiConversation.findMany({ where, orderBy: { updatedAt: "desc" }, take: 30,
    include: { messages: { orderBy: { createdAt: "asc" }, take: 50 } } });
  const scope: AiCommercialScope = input.businessId
    ? { scopeType: "BUSINESS", scopeKey: `BUSINESS:${input.businessId}`, businessId: input.businessId, groupId: null }
    : { scopeType: "GROUP", scopeKey: `GROUP:${input.groupId!}`, businessId: null, groupId: input.groupId! };
  const allowance = await getAiCommercialSummary(scope);
  const usageWhere = input.businessId ? { businessId: input.businessId } : { groupId: input.groupId };
  const monthStart = allowance.configured ? allowance.periodStart : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const failures = await prisma.aiUsage.count({ where: { ...usageWhere, createdAt: { gte: monthStart }, status: "FAILED" } });
  return { conversations, allowance, usage: allowance.configured ? {
    requests: allowance.usedRequests,
    inputTokens: allowance.inputTokens,
    outputTokens: allowance.outputTokens,
    totalTokens: allowance.totalTokens,
    failures,
  } : { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, failures } };
}

async function authorizeScope(user: AppSession, scope: Scope) {
  if (scope.type === "BUSINESS") {
    if (!scope.access.granted || scope.access.businessId !== scope.businessId) throw new AiServiceError("AI_SCOPE_DENIED");
    if (!(await isBusinessModuleEnabled(scope.businessId, "AI"))) throw new AiServiceError("AI_MODULE_DISABLED");
    return { key: `BUSINESS:${scope.businessId}`, businessId: scope.businessId, groupId: null };
  }
  const group = await resolveAuthorizedGroupReportingScope(user.userId, scope.groupId, scope.currentBusinessId);
  if (!group) throw new AiServiceError("AI_GROUP_SCOPE_DENIED");
  const enabled = await Promise.all(group.businesses.map((business) => isBusinessModuleEnabled(business.id, "AI")));
  if (!enabled.some(Boolean)) throw new AiServiceError("AI_MODULE_DISABLED");
  return { key: `GROUP:${scope.groupId}`, businessId: null, groupId: scope.groupId, group };
}

async function buildAuthorizedContext(input: Parameters<typeof askTetamuAi>[0] & {
  scopeIdentity: Awaited<ReturnType<typeof authorizeScope>>;
  now: Date;
  classification: AiIntentClassification;
}) {
  if (input.scope.type === "BUSINESS") {
    const readScope = await resolveExpenseReadScope({ access: input.scope.access, businessId: input.scope.businessId, user: input.scope.user });
    if (input.scope.selectedBranchId && !readScope.allowedBranchIds?.includes(input.scope.selectedBranchId)) {
      throw new AiServiceError("AI_SCOPE_DENIED");
    }
    const selected = input.scope.selectedBranchId ?? null;
    const model = await getBusinessPerformanceReadModel({ businessId: input.scope.businessId, allowedBranchIds: readScope.allowedBranchIds ?? [], includeBusinessWide: Boolean(readScope.includeBusinessWide), selectedBranchId: selected, range: input.range ?? "month", from: input.from, to: input.to, now: input.now });
    const supplementalMetrics = await loadIntentMetrics({
      businessId: input.scope.businessId,
      branchIds: model.scope.branchIds,
      model,
      classification: input.classification,
      now: input.now,
    });
    const context = buildBusinessAiContext(model, { classification: input.classification, supplementalMetrics });
    const selectedBranch = readScope.branches.find((branch) => branch.id === selected) ?? null;
    const scopeSnapshot: AiScopeSnapshot = {
      scopeType: "BUSINESS",
      businessId: input.scope.businessId,
      businessName: model.scope.businessName,
      selectedBranchId: selected,
      selectedBranchName: selectedBranch?.name ?? null,
      authorisedBranches: readScope.branches.map((branch) => ({ id: branch.id, name: branch.name })),
      range: model.dateRange.range,
      from: model.dateRange.from,
      to: model.dateRange.to,
      timezone: model.dateRange.timezone,
      businessDayCutoffTime: model.dateRange.businessDayCutoffTime,
    };
    return { ...context, scopeSnapshot };
  }
  const group = "group" in input.scopeIdentity ? input.scopeIdentity.group : null;
  if (!group) throw new AiServiceError("AI_GROUP_SCOPE_DENIED");
  const contexts = await Promise.all(group.businesses.map(async (business) => {
    if (!(await isBusinessModuleEnabled(business.id, "AI"))) return null;
    const branches = await prisma.branch.findMany({ where: { businessId: business.id, status: "ACTIVE" }, select: { id: true } });
    const model = await getBusinessPerformanceReadModel({ businessId: business.id, allowedBranchIds: branches.map((branch) => branch.id), includeBusinessWide: true, range: input.range ?? "month", from: input.from, to: input.to, now: input.now });
    const supplementalMetrics = await loadIntentMetrics({
      businessId: business.id,
      branchIds: model.scope.branchIds,
      model,
      classification: input.classification,
      now: input.now,
    });
    return { name: business.name, context: buildBusinessAiContext(model, { classification: input.classification, supplementalMetrics }) };
  }));
  const availableContexts = contexts.filter((item): item is NonNullable<typeof item> => Boolean(item));
  const context = buildGroupAiContext({ groupName: group.groupName, businesses: availableContexts });
  const firstPeriod = availableContexts[0]?.context.payload.period;
  const scopeSnapshot: AiScopeSnapshot = {
    scopeType: "GROUP",
    businessName: group.groupName,
    range: firstPeriod?.range ?? input.range ?? "month",
    from: firstPeriod?.from ?? input.from ?? "",
    to: firstPeriod?.to ?? input.to ?? "",
    timezone: firstPeriod?.timezone ?? "Business timezone",
    businessDayCutoffTime: firstPeriod?.businessDayCutoffTime ?? "Business setting",
  };
  return { ...context, scopeSnapshot };
}

async function loadIntentMetrics(input: {
  businessId: string;
  branchIds: string[];
  model: Awaited<ReturnType<typeof getBusinessPerformanceReadModel>>;
  classification: AiIntentClassification;
  now: Date;
}) {
  const branchIds = input.branchIds.length ? input.branchIds : ["00000000-0000-0000-0000-000000000000"];
  if (input.classification.intent === "PEOPLE") {
    const visibleBranch = { branchAssignments: { some: { branchId: { in: branchIds } } } };
    const activeBranch = {
      branchAssignments: {
        some: {
          branchId: { in: branchIds },
          status: "ACTIVE" as const,
          effectiveFrom: { lte: input.now },
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: input.now } }],
        },
      },
    };
    const activeWhere = {
      businessId: input.businessId,
      status: "ACTIVE" as const,
      joinedAt: { lte: input.now },
      OR: [{ terminatedAt: null }, { terminatedAt: { gt: input.now } }],
      employeeAccount: { status: "ACTIVE" as const },
      ...activeBranch,
    };
    const [active, visible] = await Promise.all([
      prisma.employeeBusinessMembership.count({ where: activeWhere }),
      prisma.employeeBusinessMembership.count({ where: { businessId: input.businessId, ...visibleBranch } }),
    ]);
    return [aiMetric("ACTIVE_EMPLOYEES", active), aiMetric("INACTIVE_EMPLOYEES", Math.max(visible - active, 0))];
  }
  const period = getBusinessDayRange({
    fromDateValue: input.model.dateRange.from,
    toDateValue: input.model.dateRange.to,
    timezone: input.model.dateRange.timezone,
    businessDayCutoffTime: input.model.dateRange.businessDayCutoffTime,
  });
  if (input.classification.intent === "APPOINTMENTS" || input.classification.intent === "GENERAL_BUSINESS") {
    const rows = await prisma.appointment.groupBy({
      by: ["status"],
      where: { businessId: input.businessId, branchId: { in: branchIds }, scheduledAt: { gte: period.fromDate, lt: period.toDateExclusive } },
      _count: { _all: true },
    });
    const count = (statuses: string[]) => rows.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0);
    return [
      aiMetric("APPOINTMENTS_TOTAL", count(rows.map((row) => row.status))),
      aiMetric("APPOINTMENTS_SCHEDULED", count(["SCHEDULED", "CONFIRMED", "ARRIVED", "IN_SERVICE"])),
      aiMetric("APPOINTMENTS_COMPLETED", count(["COMPLETED", "CONVERTED_TO_JOB"])),
      aiMetric("APPOINTMENTS_CANCELLED", count(["CANCELLED"])),
      aiMetric("APPOINTMENTS_NO_SHOW", count(["NO_SHOW"])),
    ];
  }
  if (input.classification.intent === "PAYMENTS") {
    const rows = await prisma.payment.groupBy({
      by: ["method"],
      where: { businessId: input.businessId, branchId: { in: branchIds }, status: "ACTIVE", paidAt: { gte: period.fromDate, lt: period.toDateExclusive } },
      _sum: { amount: true },
    });
    const amount = (method: string) => rows.find((row) => row.method === method)?._sum.amount?.toFixed(2) ?? "0.00";
    return [
      aiMetric("PAYMENTS_CASH", amount("CASH")),
      aiMetric("PAYMENTS_CARD", amount("CARD")),
      aiMetric("PAYMENTS_DUITNOW", amount("DUITNOW")),
      aiMetric("PAYMENTS_BANK_TRANSFER", amount("BANK_TRANSFER")),
    ];
  }
  return [];
}

async function resolveConversation(input: { conversationId?: string | null; createdById: string; scopeType: AiScopeType; businessId: string | null; groupId: string | null; title: string }) {
  if (!input.conversationId) return prisma.aiConversation.create({ data: { scopeType: input.scopeType, businessId: input.businessId, groupId: input.groupId, createdById: input.createdById, title: input.title } });
  const conversation = await prisma.aiConversation.findFirst({ where: { id: input.conversationId, createdById: input.createdById, scopeType: input.scopeType, businessId: input.businessId, groupId: input.groupId, archivedAt: null } });
  if (!conversation) throw new AiServiceError("AI_CONVERSATION_SCOPE_DENIED");
  return conversation;
}

async function enforceRateLimit(userId: string, scope: { businessId: string | null; groupId: string | null }, now: Date) {
  const since = new Date(now.getTime() - 60_000);
  const [userCount, scopeCount] = await Promise.all([
    prisma.aiUsage.count({ where: { userId, createdAt: { gte: since }, status: { in: ["PENDING", "SUCCEEDED", "FAILED"] } } }),
    prisma.aiUsage.count({ where: { businessId: scope.businessId, groupId: scope.groupId, createdAt: { gte: since }, status: { in: ["PENDING", "SUCCEEDED", "FAILED"] } } }),
  ]);
  const userLimit = positiveInt(process.env.AI_REQUESTS_PER_USER_MINUTE, DEFAULT_REQUESTS_PER_MINUTE);
  const scopeLimit = positiveInt(process.env.AI_REQUESTS_PER_SCOPE_MINUTE, DEFAULT_REQUESTS_PER_SCOPE_MINUTE);
  if (userCount >= userLimit || scopeCount >= scopeLimit) throw new AiServiceError("AI_RATE_LIMITED");
}

function safeErrorCategory(error: unknown) {
  if (error instanceof AiServiceError) return error.code;
  const providerError = typeof error === "object" && error
    ? error as { status?: unknown; code?: unknown; type?: unknown }
    : {};
  const status = Number(providerError.status ?? 0);
  const code = String(providerError.code ?? "").toLowerCase();
  const type = String(providerError.type ?? "").toLowerCase();
  if (code === "credit_balance_exhausted" || type === "insufficient_quota") return "PROVIDER_QUOTA_EXHAUSTED";
  if (status === 401) return "PROVIDER_AUTHENTICATION_FAILED";
  if (status === 403) return "PROVIDER_ACCESS_DENIED";
  if (status === 429) return "PROVIDER_RATE_LIMIT";
  if (status >= 500) return "PROVIDER_UNAVAILABLE";
  return "PROVIDER_ERROR";
}
function isUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
export function newAiClientRequestId() { return randomUUID(); }

export function assertGroundedEvidence(
  analysis: { evidence: Array<{ metricKey: string; value: string }> },
  context: unknown,
) {
  const allowed = collectMetricValues(context);
  for (const evidence of analysis.evidence) {
    const values = allowed.get(evidence.metricKey);
    if (!values?.size) throw new AiServiceError("AI_RESPONSE_UNGROUNDED_EVIDENCE");
    const evidenceNumbers = numericTokens(evidence.value);
    if (evidenceNumbers.length && !evidenceNumbers.some((value) => values.has(value))) {
      throw new AiServiceError("AI_RESPONSE_UNGROUNDED_EVIDENCE");
    }
  }
}

export function removeUnavailableEvidence<T extends { evidence: Array<{ metricKey: string }> }>(
  analysis: T,
  context: unknown,
): T {
  const available = collectMetricValues(context);
  return {
    ...analysis,
    evidence: analysis.evidence.filter((item) => available.has(item.metricKey)),
  };
}

function collectMetricValues(value: unknown, result = new Map<string, Set<string>>()): Map<string, Set<string>> {
  if (!value || typeof value !== "object") return result;
  if (Array.isArray(value)) {
    value.forEach((item) => collectMetricValues(item, result));
    return result;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.metricKey === "string" && row.available === true) {
    const values = result.get(row.metricKey) ?? new Set<string>();
    numericTokens(String(row.value)).forEach((token) => values.add(token));
    result.set(row.metricKey, values);
  }
  if (typeof row.netSales === "string") {
    const values = result.get("NET_SALES") ?? new Set<string>();
    numericTokens(row.netSales).forEach((token) => values.add(token));
    result.set("NET_SALES", values);
  }
  Object.values(row).forEach((item) => collectMetricValues(item, result));
  return result;
}

function numericTokens(value: string) {
  return [...value.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)].map((match) => Number(match[0].replaceAll(",", "")).toFixed(2));
}
function positiveInt(value: string | undefined, fallback: number) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; }
function mapCommercialError(error: unknown) {
  if (error instanceof AiCommercialError) return new AiServiceError(error.code);
  return error;
}
