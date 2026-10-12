import { randomUUID } from "node:crypto";
import type { AiScopeType, Prisma } from "@prisma/client";
import { isBusinessModuleEnabled } from "@/lib/modules/entitlements";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/auth/session";
import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import { classifyAiQuestion } from "./intent";
import { createAiProvider, getAiConfiguration, type AiProvider } from "./provider";
import { AI_CONTEXT_VERSION, AI_PROMPT_VERSION, validateAiAnalysis } from "./schema";
import { aiRequestFingerprint, storedAiRequestFingerprint } from "./request-identity";
import { canSendOwnerPilot, resolvePilotReadGrants } from "./pilot-access";
import { isPilotHistoryVisible, pilotPeriod, PILOT_HISTORY_PLACEHOLDER } from "./pilot-boundary";
import { readOwnerPilotContext } from "./pilot-source";
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
  let read: Awaited<ReturnType<typeof resolvePilotReadGrants>>;
  let period: ReturnType<typeof pilotPeriod>;
  try {
    read = await resolvePilotReadGrants({ userId: input.user.userId, businessId: scopeIdentity.businessId,
      ...(input.scope.type === "BUSINESS" && Object.hasOwn(input.scope, "selectedBranchId") ? { explicitBranchInput: input.scope.selectedBranchId } : {}),
    });
    period = pilotPeriod({ ...input, ...read.business, now });
  } catch (error) {
    if (error instanceof Error && /^AI_(SCOPE_DENIED|DATE_RANGE_INVALID|DATE_RANGE_TOO_LARGE)$/.test(error.message)) throw new AiServiceError(error.message);
    throw error;
  }
  const requestKey = `${scopeIdentity.key}:${input.clientRequestId}`;
  const requestFingerprint = aiRequestFingerprint({ actorUserId: input.user.userId, businessId: read.business.id,
    conversationId: input.conversationId, question, range: input.range, from: input.from, to: input.to,
    branch: input.scope.type === "BUSINESS" && Object.hasOwn(input.scope, "selectedBranchId")
      ? { kind: "explicit", value: input.scope.selectedBranchId } : { kind: "absent" },
  });
  const commercialScope: AiCommercialScope = {
    scopeType: input.scope.type,
    scopeKey: scopeIdentity.key,
    businessId: scopeIdentity.businessId,
    groupId: scopeIdentity.groupId,
  };

  async function replayExisting() {
    const duplicate = await prisma.aiUsage.findUnique({ where: { userId_requestKey: { userId: input.user.userId, requestKey } } });
    if (!duplicate) return null;
    const message = duplicate.messageId ? await prisma.aiMessage.findFirst({ where: {
      id: duplicate.messageId, conversationId: duplicate.conversationId!,
      conversation: { createdById: input.user.userId, businessId: scopeIdentity.businessId, groupId: null },
    } }) : null;
    const savedFingerprint = storedAiRequestFingerprint(message?.structuredMetadata);
    if (!savedFingerprint) throw new AiServiceError("AI_REQUEST_DUPLICATE"); // Unproven legacy identity: never redispatch.
    if (savedFingerprint !== requestFingerprint) throw new AiServiceError("AI_REQUEST_CONFLICT");
    if (duplicate.status === "SUCCEEDED" && message?.role === "ASSISTANT" && isPilotHistoryVisible(message.structuredMetadata, read.business.id, read.grants)) {
      return { conversationId: duplicate.conversationId!, analysis: validateAiAnalysis(message.structuredMetadata), duplicate: true };
    }
    if (duplicate.status === "PENDING") throw new AiServiceError("AI_REQUEST_PENDING");
    throw new AiServiceError("AI_REQUEST_FAILED");
  }
  const replay = await replayExisting();
  if (replay) return replay;
  try {
    await assertAiAllowanceConfigured(commercialScope, now);
  } catch (error) {
    throw mapCommercialError(error);
  }
  const commerciallyCounted = config.provider === "openai" || commercialConfig.countMockCommercially;
  let reservation: Awaited<ReturnType<typeof reserveAiQuota>> | null = null;
  // The unique usage row and its fingerprint-bearing USER are one atomic claim.
  // Concurrent losers roll back all new-conversation/message work, then replay.
  let claimed;
  try {
    claimed = await prisma.$transaction(async tx => {
      const conversation = await resolveConversation({
        conversationId: input.conversationId,
        createdById: input.user.userId,
        scopeType: input.scope.type,
        businessId: scopeIdentity.businessId,
        groupId: scopeIdentity.groupId,
        title: question.slice(0, 80),
      }, tx);
      const userMessage = await tx.aiMessage.create({ data: { conversationId: conversation.id, role: "USER", content: question,
        clientRequestId: input.clientRequestId, structuredMetadata: { requestFingerprint } } });
      const usage = await tx.aiUsage.create({ data: {
        businessId: scopeIdentity.businessId,
        groupId: scopeIdentity.groupId,
        userId: input.user.userId,
        conversationId: conversation.id,
        provider: config.provider,
        model: config.model,
        requestKey,
        status: "PENDING",
        commerciallyCounted,
        messageId: userMessage.id,
        promptVersion: AI_PROMPT_VERSION,
        contextVersion: AI_CONTEXT_VERSION,
      } });
      return { conversation, userMessage, usage };
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      const replay = await replayExisting();
      if (replay) return replay;
    }
    throw error;
  }
  const { conversation, userMessage, usage } = claimed;
  const started = Date.now();
  try {
    await enforceRateLimit(input.user.userId, scopeIdentity, now, usage.id);
    if (commerciallyCounted) {
      try {
        reservation = await reserveAiQuota({ scope: commercialScope, userId: input.user.userId, requestKey, provider: config.provider, model: config.model, now });
      } catch (error) { throw mapCommercialError(error); }
      await prisma.aiUsage.update({ where: { id: usage.id }, data: { reservationId: reservation.id } });
    }
    const [safeContext, recentMessages] = await Promise.all([
      readOwnerPilotContext({ ...read, period }),
      prisma.aiMessage.findMany({
        where: { conversationId: conversation.id, id: { not: userMessage.id } },
        orderBy: { createdAt: "desc" }, take: 8,
        select: { role: true, content: true, structuredMetadata: true },
      }),
    ]);
    await prisma.aiMessage.update({
      where: { id: userMessage.id },
      data: { structuredMetadata: { requestFingerprint, scopeSnapshot: safeContext.scopeSnapshot, ownerPilot: safeContext.ownerPilot } },
    });
    if (safeContext.approximateInputTokens > commercialConfig.maxContextTokens) throw new AiServiceError("AI_CONTEXT_TOO_LARGE");
    const result = await (dependencies.provider ?? createAiProvider()).analyze({
      question,
      intent: classification.intent,
      language: classification.language,
      temporalSemantics: classification.temporalSemantics,
      context: safeContext.payload,
      recentMessages: recentMessages.reverse().filter(m => isPilotHistoryVisible(m.structuredMetadata, read.business.id, read.grants)).map(({ role, content }) => ({ role, content })),
    });
    const groundedAnalysis = removeUnavailableEvidence({
      ...validateAiAnalysis(result.analysis),
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
          requestFingerprint,
          scopeSnapshot: safeContext.scopeSnapshot,
          sourceDomains: safeContext.sourceDomains,
          ownerPilot: safeContext.ownerPilot,
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
          status: error instanceof AiServiceError && error.code === "AI_RATE_LIMITED" ? "RATE_LIMITED" : "FAILED",
          errorCategory,
        } }).then(() => undefined),
      });
    } catch {
      // Preserve the original safe error; reconciliation detects any terminalization drift.
    }
    throw error instanceof AiServiceError ? error : new AiServiceError(
      ["PROVIDER_TIMEOUT", "PROVIDER_UNAVAILABLE", "PROVIDER_RATE_LIMIT", "PROVIDER_AUTHENTICATION_FAILED", "PROVIDER_ACCESS_DENIED", "PROVIDER_QUOTA_EXHAUSTED"].includes(errorCategory)
        ? "AI_PROVIDER_TEMPORARILY_UNAVAILABLE" : "AI_REQUEST_FAILED",
    );
  }
}

export async function getAiWorkspace(input: { userId: string; businessId?: string; groupId?: string; archived?: boolean }) {
  const where = input.businessId
    ? { createdById: input.userId, businessId: input.businessId, groupId: null, archivedAt: input.archived ? { not: null } : null }
    : { createdById: input.userId, groupId: input.groupId!, businessId: null, archivedAt: null };
  const rawConversations = await prisma.aiConversation.findMany({ where, orderBy: { updatedAt: "desc" }, take: 30,
    include: { messages: { orderBy: { createdAt: "asc" }, take: 50 } } });
  const conversations = await filterWorkspaceHistory(rawConversations, input);
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
  if (scope.type === "GROUP") throw new AiServiceError("AI_PILOT_GROUP_DENIED");
  if (user.activeBusinessId !== scope.businessId) throw new AiServiceError("AI_SCOPE_DENIED");
  if (!(await canSendOwnerPilot(user.userId, scope.businessId))) throw new AiServiceError("AI_PILOT_OWNER_ONLY_DENIED");
  if (!(await isBusinessModuleEnabled(scope.businessId, "AI"))) throw new AiServiceError("AI_MODULE_DISABLED");
  return { key: `BUSINESS:${scope.businessId}`, businessId: scope.businessId, groupId: null };
}

async function filterWorkspaceHistory<T extends { title: string | null; messages: Array<{ content: string; structuredMetadata: unknown }> }>(
  conversations: T[], input: { userId: string; businessId?: string },
): Promise<T[]> {
  const read = input.businessId ? await resolvePilotReadGrants({ userId: input.userId, businessId: input.businessId }) : null;
  return conversations.map(conversation => {
    const visible = (metadata: unknown) => Boolean(read && isPilotHistoryVisible(metadata, read.business.id, read.grants));
    return { ...conversation,
      title: conversation.messages.length > 0 && conversation.messages.every(m => visible(m.structuredMetadata)) ? conversation.title : "Earlier conversation",
      messages: conversation.messages.map(message => visible(message.structuredMetadata) ? message : {
        ...message, content: PILOT_HISTORY_PLACEHOLDER, structuredMetadata: null,
      }),
    };
  });
}

async function resolveConversation(input: { conversationId?: string | null; createdById: string; scopeType: AiScopeType; businessId: string | null; groupId: string | null; title: string }, db: Prisma.TransactionClient = prisma) {
  if (!input.conversationId) return db.aiConversation.create({ data: { scopeType: input.scopeType, businessId: input.businessId, groupId: input.groupId, createdById: input.createdById, title: input.title } });
  const conversation = await db.aiConversation.findFirst({ where: { id: input.conversationId, createdById: input.createdById, scopeType: input.scopeType, businessId: input.businessId, groupId: input.groupId, archivedAt: null } });
  if (!conversation) throw new AiServiceError("AI_CONVERSATION_SCOPE_DENIED");
  return conversation;
}

async function enforceRateLimit(userId: string, scope: { businessId: string | null; groupId: string | null }, now: Date, excludeUsageId: string) {
  const since = new Date(now.getTime() - 60_000);
  const [userCount, scopeCount] = await Promise.all([
    prisma.aiUsage.count({ where: { id: { not: excludeUsageId }, userId, createdAt: { gte: since }, status: { in: ["PENDING", "SUCCEEDED", "FAILED"] } } }),
    prisma.aiUsage.count({ where: { id: { not: excludeUsageId }, businessId: scope.businessId, groupId: scope.groupId, createdAt: { gte: since }, status: { in: ["PENDING", "SUCCEEDED", "FAILED"] } } }),
  ]);
  const userLimit = positiveInt(process.env.AI_REQUESTS_PER_USER_MINUTE, DEFAULT_REQUESTS_PER_MINUTE);
  const scopeLimit = positiveInt(process.env.AI_REQUESTS_PER_SCOPE_MINUTE, DEFAULT_REQUESTS_PER_SCOPE_MINUTE);
  if (userCount >= userLimit || scopeCount >= scopeLimit) throw new AiServiceError("AI_RATE_LIMITED");
}

function safeErrorCategory(error: unknown) {
  if (error instanceof AiServiceError) return error.code;
  if (error instanceof Error && /timeout|timed out|APIConnectionError/i.test(`${error.name} ${error.message}`)) return "PROVIDER_TIMEOUT";
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
