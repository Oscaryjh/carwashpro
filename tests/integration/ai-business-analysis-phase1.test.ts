import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { askTetamuAi, AiServiceError, getAiWorkspace } from "@/lib/ai/service";
import { MockAiProvider } from "@/lib/ai/provider";
import type { AppSession } from "@/lib/auth/session";
import type { UserRole, UserStatus } from "@prisma/client";
import { createAiAllowancePolicy } from "@/lib/ai/commercial";

async function provisionAllowance(input: { businessId?: string; groupId?: string }) {
  const actor = await prisma.user.create({ data: { name: "AI quota platform QA", email: `ai.policy.${randomUUID()}@test.local`, role: "PLATFORM_ADMIN" } });
  await createAiAllowancePolicy({
    actorUserId: actor.id,
    scopeType: input.businessId ? "BUSINESS" : "GROUP",
    businessId: input.businessId,
    groupId: input.groupId,
    timezone: input.groupId ? "Asia/Kuching" : undefined,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    requestLimit: 100,
    tokenLimit: null,
    source: "PLATFORM_OVERRIDE",
    reason: "Local AI integration test allowance.",
  });
}

function sessionFor(user: { id: string; businessId: string | null; branchId: string | null; name: string; email: string | null; role: UserRole; permissions: string[]; status: UserStatus }): AppSession {
  return { userId: user.id, homeBusinessId: user.businessId!, activeBusinessId: user.businessId, contextVersion: 1, businessId: user.businessId, branchId: user.branchId, name: user.name, email: user.email!, role: user.role, permissions: user.permissions, status: user.status };
}

test("AI conversation is tenant scoped, immutable, idempotent and usage tracked", async () => {
  const token = randomUUID().slice(0, 8);
  const [businessA, businessB] = await Promise.all([
    prisma.business.create({ data: { name: `AI A ${token}`, slug: `ai-a-${token}`, industryType: "SALON_BEAUTY" } }),
    prisma.business.create({ data: { name: `AI B ${token}`, slug: `ai-b-${token}`, industryType: "AUTO_DETAILING" } }),
  ]);
  const branch = await prisma.branch.create({ data: { businessId: businessA.id, name: "Main" } });
  const user = await prisma.user.create({ data: { businessId: businessA.id, name: "AI Owner", email: `ai.owner.${token}@test.local`, passwordHash: await hash("LocalOnly!2026", 4), role: "BUSINESS_OWNER", permissions: [] } });
  await prisma.businessModuleEntitlement.createMany({ data: [
    { businessId: businessA.id, moduleKey: "AI", status: "ENABLED", enabledFrom: new Date(0), source: "MANUAL", createdById: user.id, updatedById: user.id },
    { businessId: businessA.id, moduleKey: "POS", status: "ENABLED", enabledFrom: new Date(0), source: "MANUAL", createdById: user.id, updatedById: user.id },
  ] });
  await provisionAllowance({ businessId: businessA.id });
  const session = { userId: user.id, homeBusinessId: businessA.id, activeBusinessId: businessA.id, contextVersion: 1, businessId: businessA.id, branchId: null, name: user.name, email: user.email!, role: user.role, permissions: [], status: user.status };
  const access = { granted: true as const, userId: user.id, homeBusinessId: businessA.id, businessId: businessA.id, branchId: null, identityRole: user.role, actorRole: user.role, effectiveBusinessRole: "BUSINESS_OWNER" as const, source: "DIRECT_BUSINESS" as const, industryType: businessA.industryType, permissions: [], groupId: null, groupUserId: null, capability: "USE_AI_ANALYSIS" as const };
  const clientRequestId = randomUUID();
  const first = await askTetamuAi({ user: session, scope: { type: "BUSINESS", businessId: businessA.id, access, user: session }, question: "What is my profit?", clientRequestId, range: "month" }, { provider: new MockAiProvider(), now: new Date("2026-08-12T00:00:00Z") });
  assert.equal(first.duplicate, false);
  const repeated = await askTetamuAi({ user: session, scope: { type: "BUSINESS", businessId: businessA.id, access, user: session }, question: "What is my profit?", clientRequestId, range: "month" }, { provider: new MockAiProvider(), now: new Date("2026-08-12T00:00:01Z") });
  assert.equal(repeated.duplicate, true);
  const stored = await prisma.aiConversation.findUniqueOrThrow({ where: { id: first.conversationId }, include: { messages: true, usage: true } });
  assert.equal(stored.businessId, businessA.id);
  assert.equal(stored.messages.length, 2);
  assert.equal(stored.usage[0].status, "SUCCEEDED");
  assert.match(JSON.stringify(stored.messages), /not accounting net profit/i);
  await assert.rejects(
    askTetamuAi({ user: session, scope: { type: "BUSINESS", businessId: businessB.id, access, user: session }, conversationId: first.conversationId, question: "Continue", clientRequestId: randomUUID() }, { provider: new MockAiProvider() }),
    (error: unknown) => error instanceof AiServiceError && error.code === "AI_SCOPE_DENIED",
  );
  const workspace = await getAiWorkspace({ userId: user.id, businessId: businessA.id });
  assert.equal(workspace.conversations.length, 1);
  assert.equal(workspace.usage.requests, 0);
  assert.equal(await prisma.aiUsageEvent.count({ where: { scopeKey: `BUSINESS:${businessA.id}`, eventType: "SUCCEEDED", commerciallyCounted: false } }), 1);
  assert.equal(await prisma.business.findUniqueOrThrow({ where: { id: businessA.id } }).then((row) => row.name), `AI A ${token}`);
  assert.ok(branch.id);
});

test("AI disabled fails closed even for business owner", async () => {
  const token = randomUUID().slice(0, 8);
  const business = await prisma.business.create({ data: { name: `AI Disabled ${token}`, slug: `ai-disabled-${token}`, industryType: "GENERAL_SERVICE" } });
  const user = await prisma.user.create({ data: { businessId: business.id, name: "Owner", email: `ai.disabled.${token}@test.local`, role: "BUSINESS_OWNER" } });
  const session = { userId: user.id, homeBusinessId: business.id, activeBusinessId: business.id, contextVersion: 1, businessId: business.id, branchId: null, name: user.name, email: user.email!, role: user.role, permissions: [], status: user.status };
  const access = { granted: true as const, userId: user.id, homeBusinessId: business.id, businessId: business.id, branchId: null, identityRole: user.role, actorRole: user.role, effectiveBusinessRole: "BUSINESS_OWNER" as const, source: "DIRECT_BUSINESS" as const, industryType: business.industryType, permissions: [], groupId: null, groupUserId: null, capability: "USE_AI_ANALYSIS" as const };
  await assert.rejects(askTetamuAi({ user: session, scope: { type: "BUSINESS", businessId: business.id, access, user: session }, question: "Analyse", clientRequestId: randomUUID() }, { provider: new MockAiProvider() }), (error: unknown) => error instanceof AiServiceError && error.code === "AI_MODULE_DISABLED");
  assert.equal(await prisma.aiConversation.count({ where: { businessId: business.id } }), 0);
});

test("restricted group manager context contains only authorised businesses", async () => {
  const token = randomUUID().slice(0, 8);
  const [businessA, businessB] = await Promise.all([
    prisma.business.create({ data: { name: `AI Group A ${token}`, slug: `ai-group-a-${token}`, industryType: "SALON_BEAUTY" } }),
    prisma.business.create({ data: { name: `AI Group B ${token}`, slug: `ai-group-b-${token}`, industryType: "AUTO_DETAILING" } }),
  ]);
  await Promise.all([
    prisma.branch.create({ data: { businessId: businessA.id, name: "Authorised A" } }),
    prisma.branch.create({ data: { businessId: businessB.id, name: "Restricted B" } }),
  ]);
  const user = await prisma.user.create({ data: { businessId: businessA.id, name: "Restricted Manager", email: `ai.group.${token}@test.local`, role: "STAFF", permissions: [] } });
  const group = await prisma.businessGroup.create({ data: { name: `AI Group ${token}`, code: `AIG-${token}` } });
  await prisma.businessGroupMember.createMany({ data: [
    { groupId: group.id, businessId: businessA.id }, { groupId: group.id, businessId: businessB.id },
  ] });
  const grant = await prisma.businessGroupUser.create({ data: { groupId: group.id, userId: user.id, role: "GROUP_MANAGER", accessScope: "SELECTED_BUSINESSES" } });
  await prisma.businessGroupUserBusinessAccess.create({ data: { groupUserId: grant.id, businessId: businessA.id } });
  await prisma.businessModuleEntitlement.create({ data: { businessId: businessA.id, moduleKey: "AI", status: "ENABLED", enabledFrom: new Date(0), source: "MANUAL", createdById: user.id, updatedById: user.id } });
  await provisionAllowance({ groupId: group.id });
  let providerContext: unknown = null;
  const provider = { analyze: async (input: Parameters<MockAiProvider["analyze"]>[0]) => {
    providerContext = input.context;
    return new MockAiProvider().analyze(input);
  } };
  await askTetamuAi({ user: sessionFor(user), scope: { type: "GROUP", groupId: group.id, currentBusinessId: businessA.id }, question: "Compare stores", clientRequestId: randomUUID() }, { provider });
  const serialized = JSON.stringify(providerContext);
  assert.match(serialized, new RegExp(businessA.name));
  assert.doesNotMatch(serialized, new RegExp(businessB.name));
  assert.doesNotMatch(serialized, /Restricted B/);
});

test("branch-scoped staff context excludes other branches and rapid requests are rate limited", async () => {
  const token = randomUUID().slice(0, 8);
  const business = await prisma.business.create({ data: { name: `AI Branch ${token}`, slug: `ai-branch-${token}`, industryType: "SALON_BEAUTY" } });
  const [allowedBranch, otherBranch] = await Promise.all([
    prisma.branch.create({ data: { businessId: business.id, name: "Allowed Branch" } }),
    prisma.branch.create({ data: { businessId: business.id, name: "Other Branch" } }),
  ]);
  const user = await prisma.user.create({ data: { businessId: business.id, branchId: allowedBranch.id, name: "AI Staff", email: `ai.staff.${token}@test.local`, role: "STAFF", permissions: ["AI_ANALYSIS_USE"] } });
  await prisma.businessModuleEntitlement.create({ data: { businessId: business.id, moduleKey: "AI", status: "ENABLED", enabledFrom: new Date(0), source: "MANUAL", createdById: user.id, updatedById: user.id } });
  await provisionAllowance({ businessId: business.id });
  const session = sessionFor(user);
  const access = { granted: true as const, userId: user.id, homeBusinessId: business.id, businessId: business.id, branchId: allowedBranch.id, identityRole: user.role, actorRole: user.role, effectiveBusinessRole: "STAFF" as const, source: "DIRECT_BUSINESS" as const, industryType: business.industryType, permissions: user.permissions, groupId: null, groupUserId: null, capability: "USE_AI_ANALYSIS" as const };
  let providerContext: unknown = null;
  const provider = { analyze: async (input: Parameters<MockAiProvider["analyze"]>[0]) => { providerContext = input.context; return new MockAiProvider().analyze(input); } };
  const priorUserLimit = process.env.AI_REQUESTS_PER_USER_MINUTE;
  const priorScopeLimit = process.env.AI_REQUESTS_PER_SCOPE_MINUTE;
  process.env.AI_REQUESTS_PER_USER_MINUTE = "1";
  process.env.AI_REQUESTS_PER_SCOPE_MINUTE = "10";
  try {
    await askTetamuAi({ user: session, scope: { type: "BUSINESS", businessId: business.id, access, user: session }, question: "Analyse branch", clientRequestId: randomUUID() }, { provider });
    const serialized = JSON.stringify(providerContext);
    assert.match(serialized, /authorisedBranchCount\":1/);
    assert.doesNotMatch(serialized, new RegExp(otherBranch.name));
    await assert.rejects(
      askTetamuAi({ user: session, scope: { type: "BUSINESS", businessId: business.id, access, user: session }, question: "Again", clientRequestId: randomUUID() }, { provider }),
      (error: unknown) => error instanceof AiServiceError && error.code === "AI_RATE_LIMITED",
    );
    assert.equal(await prisma.aiUsage.count({ where: { userId: user.id, status: "RATE_LIMITED" } }), 1);
  } finally {
    if (priorUserLimit === undefined) delete process.env.AI_REQUESTS_PER_USER_MINUTE; else process.env.AI_REQUESTS_PER_USER_MINUTE = priorUserLimit;
    if (priorScopeLimit === undefined) delete process.env.AI_REQUESTS_PER_SCOPE_MINUTE; else process.env.AI_REQUESTS_PER_SCOPE_MINUTE = priorScopeLimit;
  }
});

test("provider quota failure records safe category without assistant success", async () => {
  const token = randomUUID().slice(0, 8);
  const business = await prisma.business.create({ data: { name: `AI Quota ${token}`, slug: `ai-quota-${token}`, industryType: "GENERAL_SERVICE" } });
  const user = await prisma.user.create({ data: { businessId: business.id, name: "Owner", email: `ai.quota.${token}@test.local`, role: "BUSINESS_OWNER" } });
  await prisma.businessModuleEntitlement.create({ data: { businessId: business.id, moduleKey: "AI", status: "ENABLED", enabledFrom: new Date(0), source: "MANUAL", createdById: user.id, updatedById: user.id } });
  await provisionAllowance({ businessId: business.id });
  const session = sessionFor(user);
  const access = { granted: true as const, userId: user.id, homeBusinessId: business.id, businessId: business.id, branchId: null, identityRole: user.role, actorRole: user.role, effectiveBusinessRole: "BUSINESS_OWNER" as const, source: "DIRECT_BUSINESS" as const, industryType: business.industryType, permissions: [], groupId: null, groupUserId: null, capability: "USE_AI_ANALYSIS" as const };
  const quotaProvider = { analyze: async () => { throw Object.assign(new Error("redacted"), { status: 429, code: "credit_balance_exhausted", type: "insufficient_quota" }); } };
  await assert.rejects(askTetamuAi({ user: session, scope: { type: "BUSINESS", businessId: business.id, access, user: session }, question: "Analyse", clientRequestId: randomUUID() }, { provider: quotaProvider }));
  const usage = await prisma.aiUsage.findFirstOrThrow({ where: { userId: user.id } });
  assert.equal(usage.errorCategory, "PROVIDER_QUOTA_EXHAUSTED");
  assert.equal(await prisma.aiMessage.count({ where: { conversationId: usage.conversationId!, role: "ASSISTANT" } }), 0);
});
