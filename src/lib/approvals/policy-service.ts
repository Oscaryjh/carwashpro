import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type HrApprovalActorLevel = "OWNER" | "MANAGER";
export type HrApprovalDomainName = "LEAVE" | "CLAIMS";
export type HrApprovalModeName = "ONE_LEVEL" | "TWO_LEVEL_ALWAYS" | "TWO_LEVEL_THRESHOLD";
export type HrApprovalOutcomeName = "APPROVED" | "REJECTED";

export type HrApprovalPolicyView = {
  domain: HrApprovalDomainName;
  mode: HrApprovalModeName;
  thresholdValue: number | null;
};

const DEFAULT_POLICIES: Record<HrApprovalDomainName, HrApprovalPolicyView> = {
  LEAVE: { domain: "LEAVE", mode: "ONE_LEVEL", thresholdValue: null },
  CLAIMS: { domain: "CLAIMS", mode: "ONE_LEVEL", thresholdValue: null },
};

type ApprovalDatabase = PrismaClient | Prisma.TransactionClient;

export async function getHrApprovalPolicies(
  businessId: string,
  database: ApprovalDatabase = prisma,
): Promise<Record<HrApprovalDomainName, HrApprovalPolicyView>> {
  const rows = await database.hrApprovalPolicy.findMany({ where: { businessId } });
  const result = structuredClone(DEFAULT_POLICIES);
  for (const row of rows) {
    result[row.domain] = {
      domain: row.domain,
      mode: row.mode,
      thresholdValue: row.thresholdValue == null ? null : Number(row.thresholdValue),
    };
  }
  return result;
}

export async function saveHrApprovalPolicy(input: {
  businessId: string;
  domain: HrApprovalDomainName;
  mode: HrApprovalModeName;
  thresholdValue?: number | null;
}, database: ApprovalDatabase = prisma) {
  const threshold = input.mode === "TWO_LEVEL_THRESHOLD" ? Number(input.thresholdValue) : null;
  if (input.mode === "TWO_LEVEL_THRESHOLD" && (threshold == null || !Number.isFinite(threshold) || threshold <= 0)) {
    throw new Error(input.domain === "CLAIMS" ? "请输入大于 RM0 的二级审批金额门槛。" : "请输入大于 0 天的二级审批天数门槛。");
  }
  return database.hrApprovalPolicy.upsert({
    where: { businessId_domain: { businessId: input.businessId, domain: input.domain } },
    create: {
      businessId: input.businessId,
      domain: input.domain,
      mode: input.mode,
      thresholdValue: threshold,
    },
    update: { mode: input.mode, thresholdValue: threshold },
  });
}

export function policyRequiresSecondLevel(policy: HrApprovalPolicyView, subjectValue: number) {
  if (policy.mode === "TWO_LEVEL_ALWAYS") return true;
  if (policy.mode !== "TWO_LEVEL_THRESHOLD") return false;
  return subjectValue >= (policy.thresholdValue ?? Number.POSITIVE_INFINITY);
}

export type HrApprovalRoutingResult = {
  finalized: boolean;
  stage: "LEVEL_ONE" | "LEVEL_TWO";
  requiresSecondLevel: boolean;
  payload: unknown;
};

export async function routeHrApprovalDecision(
  transaction: Prisma.TransactionClient,
  input: {
    businessId: string;
    domain: HrApprovalDomainName;
    subjectId: string;
    subjectRevision: number;
    subjectValue: number;
    actorUserId: string;
    actorLevel: HrApprovalActorLevel;
    outcome: HrApprovalOutcomeName;
    payload: Prisma.InputJsonValue;
    reason?: string | null;
  },
): Promise<HrApprovalRoutingResult> {
  const policies = await getHrApprovalPolicies(input.businessId, transaction);
  const currentPolicy = policies[input.domain];
  const firstDecision = await transaction.hrApprovalDecision.findUnique({
    where: {
      businessId_domain_subjectId_subjectRevision_stage: {
        businessId: input.businessId,
        domain: input.domain,
        subjectId: input.subjectId,
        subjectRevision: input.subjectRevision,
        stage: "LEVEL_ONE",
      },
    },
  });
  const policy = firstDecision ? policyFromDecisionSnapshot(firstDecision) : currentPolicy;
  const requiresSecondLevel = policyRequiresSecondLevel(policy, input.subjectValue);

  if (!requiresSecondLevel) {
    if (firstDecision) {
      throw new Error("这项申请已经完成审批，请刷新页面。");
    }
    await createDecision(transaction, input, "LEVEL_ONE", policy);
    return {
      finalized: true,
      stage: "LEVEL_ONE",
      requiresSecondLevel: false,
      payload: input.payload,
    };
  }

  if (input.actorLevel === "MANAGER") {
    if (firstDecision) {
      throw new Error("第一级审批已经完成，请刷新页面。");
    }
    await createDecision(transaction, input, "LEVEL_ONE", policy);
    return {
      finalized: input.outcome === "REJECTED",
      stage: "LEVEL_ONE",
      requiresSecondLevel: true,
      payload: input.payload,
    };
  }

  if (!firstDecision || firstDecision.outcome !== "APPROVED") {
    throw new Error("这项申请必须先由店长或主管完成第一级审批。 ");
  }
  if (firstDecision.actorUserId === input.actorUserId) {
    throw new Error("同一个人不能同时完成第一级和第二级审批。 ");
  }

  await createDecision(transaction, input, "LEVEL_TWO", policy);
  return {
    finalized: true,
    stage: "LEVEL_TWO",
    requiresSecondLevel: true,
    payload: input.outcome === "APPROVED" ? firstDecision.decisionPayload : input.payload,
  };
}

export async function getHrApprovalStages(input: {
  businessId: string;
  domain: HrApprovalDomainName;
  subjects: Array<{ id: string; revision: number; value: number }>;
  actorLevel: HrApprovalActorLevel;
}, database: ApprovalDatabase = prisma) {
  const policies = await getHrApprovalPolicies(input.businessId, database);
  const policy = policies[input.domain];
  const decisions = input.subjects.length === 0 ? [] : await database.hrApprovalDecision.findMany({
    where: {
      businessId: input.businessId,
      domain: input.domain,
      OR: input.subjects.map((subject) => ({ subjectId: subject.id, subjectRevision: subject.revision })),
    },
    orderBy: { decidedAt: "asc" },
  });
  const bySubject = new Map<string, typeof decisions>();
  for (const decision of decisions) {
    const key = approvalSubjectKey(decision.subjectId, decision.subjectRevision);
    const list = bySubject.get(key) ?? [];
    list.push(decision);
    bySubject.set(key, list);
  }

  return new Map(input.subjects.map((subject) => {
    const subjectDecisions = bySubject.get(approvalSubjectKey(subject.id, subject.revision)) ?? [];
    const first = subjectDecisions.find((decision) => decision.stage === "LEVEL_ONE") ?? null;
    const effectivePolicy = first ? policyFromDecisionSnapshot(first) : policy;
    const requiresSecondLevel = policyRequiresSecondLevel(effectivePolicy, subject.value);
    const stage = requiresSecondLevel && first?.outcome === "APPROVED" ? "LEVEL_TWO" as const : "LEVEL_ONE" as const;
    const visible = !requiresSecondLevel
      ? first == null
      : input.actorLevel === "OWNER"
        ? first?.outcome === "APPROVED"
        : first == null;
    return [subject.id, { visible, stage, requiresSecondLevel, firstDecision: first }] as const;
  }));
}

function policyFromDecisionSnapshot(decision: {
  domain: HrApprovalDomainName;
  policyModeSnapshot: HrApprovalModeName;
  thresholdValueSnapshot: Prisma.Decimal | number | null;
}): HrApprovalPolicyView {
  return {
    domain: decision.domain,
    mode: decision.policyModeSnapshot,
    thresholdValue: decision.thresholdValueSnapshot == null ? null : Number(decision.thresholdValueSnapshot),
  };
}

function approvalSubjectKey(subjectId: string, subjectRevision: number) {
  return `${subjectId}:${subjectRevision}`;
}

async function createDecision(
  transaction: Prisma.TransactionClient,
  input: {
    businessId: string;
    domain: HrApprovalDomainName;
    subjectId: string;
    subjectRevision: number;
    subjectValue: number;
    actorUserId: string;
    outcome: HrApprovalOutcomeName;
    payload: Prisma.InputJsonValue;
    reason?: string | null;
  },
  stage: "LEVEL_ONE" | "LEVEL_TWO",
  policy: HrApprovalPolicyView,
) {
  try {
    return await transaction.hrApprovalDecision.create({
      data: {
        businessId: input.businessId,
        domain: input.domain,
        subjectId: input.subjectId,
        subjectRevision: input.subjectRevision,
        stage,
        outcome: input.outcome,
        policyModeSnapshot: policy.mode,
        thresholdValueSnapshot: policy.thresholdValue,
        subjectValueSnapshot: input.subjectValue,
        decisionPayload: input.payload,
        payloadDigest: digestPayload(input.payload),
        reason: input.reason?.trim() || null,
        actorUserId: input.actorUserId,
      },
    });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
      throw new Error(stage === "LEVEL_ONE" ? "第一级审批已经完成，请刷新页面。" : "第二级审批已经完成，请刷新页面。");
    }
    throw error;
  }
}

function digestPayload(payload: Prisma.InputJsonValue) {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
