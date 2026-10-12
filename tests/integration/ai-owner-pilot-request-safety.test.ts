import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { resolveBusinessAccess } from "@/lib/business-groups/business-access";
import { createAiAllowancePolicy, getAiCommercialSummary, reserveAiQuota, releaseAiQuota } from "@/lib/ai/commercial";
import { MockAiProvider, type AiProvider } from "@/lib/ai/provider";
import type { AppSession } from "@/lib/auth/session";
import { aiServiceModule } from "../helpers/ai-service-import";

assert.equal(new URL(process.env.DATABASE_URL!).port, "55484");
assert.equal(new URL(process.env.DATABASE_URL!).pathname, "/owner_pilot_phase2_disposable");
process.env.AI_PROVIDER = "mock";
process.env.AI_MOCK_COMMERCIAL_COUNTED = "true";
let { askTetamuAi, getAiWorkspace } = {} as Awaited<ReturnType<typeof aiServiceModule>>;
test.before(async () => { ({ askTetamuAi, getAiWorkspace } = await aiServiceModule()); });
const now = new Date("2026-10-12T04:00:00Z");
async function fixture(configured = true) {
  const business = await prisma.business.create({ data: { name: "Request synthetic", slug: randomUUID(), timezone: "Asia/Kuching" } });
  const branch = await prisma.branch.create({ data: { businessId: business.id, name: "Current" } });
  const owner = await prisma.user.create({ data: { businessId: business.id, name: "Synthetic Owner", role: "BUSINESS_OWNER" } });
  await prisma.businessModuleEntitlement.createMany({ data: (["AI", "POS"] as const).map(moduleKey => ({ businessId: business.id, moduleKey, status: "ENABLED", source: "MANUAL", enabledFrom: new Date(0), createdById: owner.id, updatedById: owner.id })) });
  if (configured) {
    const admin = await prisma.user.create({ data: { name: "Synthetic Admin", role: "PLATFORM_ADMIN" } });
    await createAiAllowancePolicy({ actorUserId: admin.id, scopeType: "BUSINESS", businessId: business.id, requestLimit: 100, timezone: "Asia/Kuching", effectiveFrom: new Date(0), source: "PLATFORM_OVERRIDE", reason: "Disposable Pilot fixture" });
  }
  const user: AppSession = { userId: owner.id, businessId: business.id, homeBusinessId: business.id, activeBusinessId: business.id, contextVersion: 1, branchId: null, name: owner.name, email: "synthetic@test.local", role: owner.role, permissions: [], status: owner.status };
  const access = await resolveBusinessAccess({ userId: owner.id, requestedBusinessId: business.id });
  const scope = { type: "BUSINESS" as const, businessId: business.id, user, access };
  const commercial = { scopeType: "BUSINESS" as const, scopeKey: `BUSINESS:${business.id}`, businessId: business.id, groupId: null };
  let calls = 0;
  const payloads: unknown[] = [];
  const provider: AiProvider = { analyze: async input => { calls++; payloads.push(input); const result = await new MockAiProvider().analyze(input); result.analysis.summary = `Answer ${calls}: ${input.question}`; return result; } };
  const request = (overrides: Record<string, unknown> = {}) => ({ user, scope, question: "Sales this month", clientRequestId: randomUUID(), range: "month", ...overrides });
  const ask = (input = request(), fake = provider) => askTetamuAi(input, { provider: fake, now });
  const summary = () => getAiCommercialSummary(commercial, now);
  return { business, branch, owner, user, scope, commercial, calls: () => calls, payloads, provider, request, ask, summary };
}

test("success, follow-up and Q1 replay persist and consume exactly their original answers", async () => {
  const f = await fixture();
  const initial = await f.summary(); assert.equal(initial.configured && initial.remainingRequests, 100);
  const q1 = f.request(); const a1 = await f.ask(q1);
  const q2 = f.request({ conversationId: a1.conversationId, question: "Payments this month" }); const a2 = await f.ask(q2);
  const replay = await f.ask(q1);
  assert.equal(replay.analysis.summary, a1.analysis.summary); assert.notEqual(replay.analysis.summary, a2.analysis.summary);
  assert.equal(f.calls(), 2); assert.equal(replay.conversationId, a1.conversationId);
  const summary = await f.summary(); assert.equal(summary.configured && summary.usedRequests, 2);
  assert.equal(await prisma.aiMessage.count({ where: { conversationId: a1.conversationId } }), 4);
  assert.equal(await prisma.aiUsageEvent.count({ where: { businessId: f.business.id, eventType: "SUCCEEDED", commerciallyCounted: true } }), 2);
});

test("actual model persists on the exact linked assistant and replay preserves original telemetry", async () => {
  const f = await fixture();
  const q1 = f.request();
  const provider: AiProvider = { analyze: async input => ({ ...await f.provider.analyze(input), actualModel: "gpt-5.4-mini-2026-03-17", providerRequestId: "req_original_synthetic" }) };
  const original = await f.ask(q1, provider);
  const usage = await prisma.aiUsage.findFirstOrThrow({ where: { businessId: f.business.id }, include: { message: true } });
  assert.equal(usage.model, "tetamu-mock-1");
  assert.equal(usage.providerRequestId, "req_original_synthetic");
  const metadata = usage.message!.structuredMetadata as Record<string, unknown>;
  assert.deepEqual(metadata.modelTelemetry, { version: 1, requestedModel: "tetamu-mock-1", actualModel: "gpt-5.4-mini-2026-03-17" });
  const replay = await f.ask(q1, { analyze: async () => { throw new Error("replay must not dispatch"); } });
  assert.equal(replay.analysis.summary, original.analysis.summary);
  assert.equal(f.calls(), 1);
  const saved = await prisma.aiUsage.findUniqueOrThrow({ where: { id: usage.id }, include: { message: true } });
  assert.deepEqual(saved, usage);
  const summary = await f.summary();
  assert.equal(summary.configured && summary.usedRequests, 1);
  assert.equal(summary.configured && summary.reservedRequests, 0);
});

test("missing actual model persists explicit null without backfilling from requested model", async () => {
  const f = await fixture(); await f.ask();
  const usage = await prisma.aiUsage.findFirstOrThrow({ where: { businessId: f.business.id }, include: { message: true } });
  const metadata = usage.message!.structuredMetadata as Record<string, unknown>;
  assert.deepEqual(metadata.modelTelemetry, { version: 1, requestedModel: "tetamu-mock-1", actualModel: null });
});

test("same key binds question, dates, branch absence/null/value and original conversation semantic", async () => {
  const f = await fixture(); const request = f.request(); const answer = await f.ask(request);
  for (const changed of [{ question: "Different question" }, { range: "today" }, { from: "2026-10-01" }, { conversationId: answer.conversationId }, { scope: { ...f.scope, selectedBranchId: f.branch.id } }]) {
    await assert.rejects(f.ask({ ...request, ...changed }), /AI_REQUEST_CONFLICT/);
  }
  assert.equal(f.calls(), 1);
  const summary = await f.summary(); assert.equal(summary.configured && summary.usedRequests, 1);
});

test("20 simultaneous same requests have one dispatch, one assistant and one consumption", async () => {
  const f = await fixture(); const request = f.request();
  let unlock!: () => void; const blocked = new Promise<void>(resolve => { unlock = resolve; });
  const delayed: AiProvider = { analyze: async input => { await blocked; return f.provider.analyze(input); } };
  const results = Array.from({ length: 20 }, () => f.ask(request, delayed));
  setTimeout(unlock, 100);
  const settled = await Promise.allSettled(results);
  assert.equal(f.calls(), 1);
  assert.equal(await prisma.aiMessage.count({ where: { conversation: { businessId: f.business.id }, role: "ASSISTANT" } }), 1);
  assert.equal(await prisma.aiConversation.count({ where: { businessId: f.business.id } }), 1);
  const summary = await f.summary(); assert.equal(summary.configured && summary.usedRequests, 1);
  for (const result of settled) if (result.status === "rejected") assert.match(String(result.reason), /AI_REQUEST_PENDING/);
  const replay = await f.ask(request); assert.equal(replay.duplicate, true); assert.equal(f.calls(), 1);
});

test("concurrent terminal paths leave no reservation and charge only persisted answers", async () => {
  const f = await fixture();
  let arrivals = 0;
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const fake: AiProvider = { analyze: async input => {
    if (++arrivals === 4) release();
    await barrier;
    if (input.question.startsWith("Payments")) throw Object.assign(new Error("synthetic timeout"), { name: "APIConnectionTimeoutError" });
    return f.provider.analyze(input);
  } };
  await Promise.allSettled([0, 1, 2, 3].map(i => f.ask(f.request({ question: `${i % 2 ? "Payments" : "Sales"} ${i}` }), fake)));
  const summary = await f.summary();
  assert.equal(summary.configured && summary.reservedRequests, 0);
  const answers = await prisma.aiMessage.count({ where: { role: "ASSISTANT", conversation: { businessId: f.business.id } } });
  assert.equal(answers, 2);
  assert.equal(arrivals, 4);
  assert.equal(summary.configured && summary.usedRequests, answers);
  assert.equal(await prisma.aiQuotaReservation.count({ where: { businessId: f.business.id, status: "RESERVED" } }), 0);
});

test("pending duplicate validates the fingerprint stored via usage.messageId before provider finishes", async () => {
  const f = await fixture(); const request = f.request();
  let started!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  const owner = f.ask(request, { analyze: async input => { started(); await gate; return f.provider.analyze(input); } });
  await entered;
  try {
    await assert.rejects(f.ask(request), /AI_REQUEST_PENDING/);
    await assert.rejects(f.ask({ ...request, question: "Conflict while pending" }), /AI_REQUEST_CONFLICT/);
  } finally { release(); }
  await owner; assert.equal(f.calls(), 1);
});

test("assistant persistence failure rolls back success and releases existing reservation", async () => {
  const f = await fixture(); const request = f.request();
  await prisma.$executeRawUnsafe(`CREATE FUNCTION pilot_reject_answer() RETURNS trigger AS $$ BEGIN IF NEW.role = 'ASSISTANT' AND NEW.conversation_id IN (SELECT id FROM ai_conversations WHERE business_id = '${f.business.id}'::uuid) THEN RAISE EXCEPTION 'synthetic persistence failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe('CREATE TRIGGER pilot_reject_answer BEFORE INSERT ON ai_messages FOR EACH ROW EXECUTE FUNCTION pilot_reject_answer()');
  try {
    await assert.rejects(f.ask(request));
    const summary = await f.summary(); assert.equal(summary.configured && summary.usedRequests, 0); assert.equal(summary.configured && summary.reservedRequests, 0);
    assert.equal(await prisma.aiMessage.count({ where: { conversation: { businessId: f.business.id }, role: "ASSISTANT" } }), 0);
    assert.equal(await prisma.aiUsageEvent.count({ where: { businessId: f.business.id, eventType: "RELEASED" } }), 1);
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER pilot_reject_answer ON ai_messages');
    await prisma.$executeRawUnsafe('DROP FUNCTION pilot_reject_answer()');
  }
});

for (const mode of ["timeout", "5xx", "malformed", "grounding"] as const) test(`${mode} releases quota and same-key retry never redispatches`, async () => {
  const f = await fixture(); const request = f.request(); let calls = 0;
  const provider: AiProvider = { analyze: async input => {
    calls++;
    if (mode === "timeout") throw Object.assign(new Error("Timeout"), { name: "APIConnectionTimeoutError" });
    if (mode === "5xx") throw Object.assign(new Error("Unavailable"), { status: 503 });
    const result = await new MockAiProvider().analyze(input);
    if (mode === "malformed") result.analysis = {} as typeof result.analysis;
    else result.analysis.evidence = [{ metricKey: "NET_SALES", value: "999999", label: "Sales", comparison: null, scope: "Current", period: "month" }];
    return result;
  } };
  await assert.rejects(f.ask(request, provider));
  await assert.rejects(f.ask(request, provider), /AI_REQUEST_FAILED/);
  assert.equal(calls, 1);
  const summary = await f.summary(); assert.equal(summary.configured && summary.usedRequests, 0); assert.equal(summary.configured && summary.reservedRequests, 0);
  assert.equal(await prisma.aiMessage.count({ where: { conversation: { businessId: f.business.id }, role: "ASSISTANT" } }), 0);
  assert.equal(await prisma.aiUsageEvent.count({ where: { businessId: f.business.id, eventType: "RELEASED" } }), 1);
});

test("100-question boundary stops before provider, allows history and no-policy remains unconfigured", async () => {
  const f = await fixture();
  const reserved = await reserveAiQuota({ scope: f.commercial, userId: f.owner.id, requestKey: randomUUID(), provider: "mock", model: "synthetic", now });
  await releaseAiQuota({ scope: f.commercial, userId: f.owner.id, requestKey: reserved.requestKey, provider: "mock", model: "synthetic", reservationId: reserved.id });
  await prisma.aiAllowancePeriod.update({ where: { id: reserved.periodId }, data: { consumedRequests: 99 } });
  const last = await f.ask(); const summary = await f.summary(); assert.equal(summary.configured && summary.usedRequests, 100);
  await assert.rejects(f.ask(), /AI_QUOTA_EXCEEDED/); assert.equal(f.calls(), 1);
  assert.equal((await getAiWorkspace({ userId: f.owner.id, businessId: f.business.id })).conversations.some(c => c.id === last.conversationId), true);
  const empty = await fixture(false); await assert.rejects(empty.ask(), /AI_QUOTA_NOT_CONFIGURED/); assert.equal(empty.calls(), 0);
});

test("summary and reservation agree when Kuching has entered next month but UTC has not", async () => {
  const f = await fixture(); const boundary = new Date("2026-10-31T16:15:00Z");
  const summary = await getAiCommercialSummary(f.commercial, boundary);
  const reservation = await reserveAiQuota({ scope: f.commercial, userId: f.owner.id, requestKey: randomUUID(), provider: "mock", model: "synthetic", now: boundary });
  const period = await prisma.aiAllowancePeriod.findUniqueOrThrow({ where: { id: reservation.periodId } });
  assert.equal(summary.configured && summary.periodStart.toISOString(), "2026-10-31T16:00:00.000Z");
  assert.equal(summary.configured && summary.periodEnd.toISOString(), "2026-11-30T16:00:00.000Z");
  assert.equal(summary.configured && summary.periodStart.getTime(), period.periodStart.getTime());
  assert.equal(summary.configured && summary.periodEnd.getTime(), period.periodEnd.getTime());
  await releaseAiQuota({ scope: f.commercial, userId: f.owner.id, requestKey: reservation.requestKey, provider: "mock", model: "synthetic", reservationId: reservation.id });
});

test("replay fresh authorization refuses revoked Owner, foreign Business and forbidden history", async () => {
  const f = await fixture(); const request = f.request(); const answer = await f.ask(request);
  const foreign = await fixture();
  await assert.rejects(f.ask({ ...request, scope: { ...f.scope, businessId: foreign.business.id }, user: { ...f.user, activeBusinessId: foreign.business.id } }), /DENIED/);
  await prisma.user.update({ where: { id: f.owner.id }, data: { role: "STAFF", permissions: ["AI_ANALYSIS_USE", "AI_ANALYSIS_VIEW"] } });
  await assert.rejects(f.ask(request), /AI_PILOT_OWNER_ONLY_DENIED/); assert.equal(f.calls(), 1);
  assert.doesNotMatch(JSON.stringify(f.payloads), /PAYROLL_SPENDING|INVENTORY_PURCHASE_SPENDING|OUTSTANDING_AP|SUPPLIER_BILLS/);
  assert.equal((await prisma.aiUsage.findFirstOrThrow({ where: { conversationId: answer.conversationId } })).status, "SUCCEEDED");
});

test("Staff and actual GM keep capabilities but consume zero Pilot questions", async () => {
  const f = await fixture(); const target = await fixture();
  const staff = await prisma.user.create({ data: { businessId: f.business.id, branchId: f.branch.id, name: "Synthetic Staff", role: "STAFF", permissions: ["AI_ANALYSIS_VIEW", "AI_ANALYSIS_USE"] } });
  const staffSession = { ...f.user, userId: staff.id, role: "STAFF" as const, permissions: staff.permissions };
  await assert.rejects(f.ask({ ...f.request(), user: staffSession, scope: { ...f.scope, user: staffSession } }), /AI_PILOT_OWNER_ONLY_DENIED/);
  const group = await prisma.businessGroup.create({ data: { name: "Synthetic group", code: randomUUID() } });
  await prisma.businessGroupMember.create({ data: { groupId: group.id, businessId: target.business.id } });
  await prisma.businessGroupUser.create({ data: { userId: staff.id, groupId: group.id, role: "GROUP_MANAGER", accessScope: "SELECTED_BUSINESSES", businessAccesses: { create: { businessId: target.business.id } } } });
  const access = await resolveBusinessAccess({ userId: staff.id, requestedBusinessId: target.business.id, capability: "USE_AI_ANALYSIS" });
  assert.equal(access.granted, true);
  const gmSession = { ...staffSession, activeBusinessId: target.business.id };
  await assert.rejects(f.ask({ ...f.request(), user: gmSession, scope: { ...f.scope, businessId: target.business.id, user: gmSession, access } }), /AI_PILOT_OWNER_ONLY_DENIED/);
  assert.equal(f.calls(), 0);
  assert.equal(await prisma.aiQuotaReservation.count({ where: { userId: staff.id } }), 0);
});

test("invalid conversation initialization creates no reservation or orphan usage", async () => {
  const f = await fixture(); await assert.rejects(f.ask(f.request({ conversationId: randomUUID() })), /AI_CONVERSATION_SCOPE_DENIED/);
  assert.equal(f.calls(), 0); assert.equal(await prisma.aiQuotaReservation.count({ where: { businessId: f.business.id } }), 0);
  assert.equal(await prisma.aiUsage.count({ where: { businessId: f.business.id } }), 0);
});
test.after(async () => { await prisma.$disconnect(); });
