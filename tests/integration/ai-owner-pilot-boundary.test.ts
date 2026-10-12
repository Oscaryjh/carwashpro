import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { aiServiceModule } from "../helpers/ai-service-import";
import { hasBusinessCapability, resolveBusinessAccess } from "@/lib/business-groups/business-access";
import { createAiAllowancePolicy } from "@/lib/ai/commercial";
import { MockAiProvider, OpenAiProvider, type AiProvider } from "@/lib/ai/provider";
import type { AppSession } from "@/lib/auth/session";

// Never let this write-bearing suite fall back to the normal Local database.
assert.equal(new URL(process.env.DATABASE_URL!).port, "55483");
assert.equal(new URL(process.env.DATABASE_URL!).pathname, "/owner_pilot_phase1_disposable");

const now = new Date("2026-10-12T04:00:00Z");
let { askTetamuAi, getAiWorkspace } = {} as Awaited<ReturnType<typeof aiServiceModule>>;
test.before(async () => { ({ askTetamuAi, getAiWorkspace } = await aiServiceModule()); });

test("canonical Pilot reader through SDK boundary has no forbidden static vocabulary", async () => {
  const f = await fixture();
  const user = f.session(f.owner);
  const access = await resolveBusinessAccess({ userId: user.userId, requestedBusinessId: f.business.id, capability: "USE_AI_ANALYSIS" });
  const requests: unknown[] = [];
  const provider = new OpenAiProvider({ apiKey: "synthetic-unused-key", model: "gpt-5.4-mini" }, {
    responses: { create: async (request: unknown) => {
      requests.push(request);
      return { output_text: JSON.stringify({ intent: "SALES", language: "en", temporalSemantics: "PERIOD", summary: "No sales in this period.", evidence: [], caveats: [], recommendations: [], followUpQuestions: [] }), model: "synthetic-returned-model" };
    } },
  } as never);
  await askTetamuAi({ user, scope: { type: "BUSINESS", businessId: f.business.id, access, user }, question: "How are sales this month?", clientRequestId: randomUUID(), range: "month" }, { provider, now });
  assert.equal(requests.length, 1);
  assert.doesNotMatch(JSON.stringify(requests[0]), /\b(?:supplier(?:[ _-]+bills?|[ _-]+payments?)?|inventory[ _-]+purchase[ _-]+spending|purchasing|purchase[ _-]+orders?|receiving|accounts[ _-]+payable|payroll(?:[ _-]+spending)?|pcb|salary|compensation|statutory|ap|po|outstanding[ _-]+ap|ap[ _-]+(?:due[ _-]+soon|overdue|open[ _-]+bills))\b/i);
});
async function fixture() {
  const token = randomUUID();
  const business = await prisma.business.create({ data: { name: "Pilot synthetic", slug: token, industryType: "SALON_BEAUTY" } });
  const branch = await prisma.branch.create({ data: { businessId: business.id, name: "Current outlet" } });
  const owner = await prisma.user.create({ data: { businessId: business.id, name: "Synthetic Owner", role: "BUSINESS_OWNER" } });
  const staff = await prisma.user.create({ data: { businessId: business.id, branchId: branch.id, name: "Synthetic Staff", role: "STAFF", permissions: ["AI_ANALYSIS_USE", "AI_ANALYSIS_VIEW", "REPORTS", "INVENTORY_VIEW", "EXPENSE_VIEW", "VIEW_APPOINTMENTS"] } });
  await prisma.businessModuleEntitlement.createMany({ data: (["AI", "POS", "INVENTORY", "EXPENSE", "SALON"] as const).map(moduleKey => ({ businessId: business.id, moduleKey, status: "ENABLED", enabledFrom: new Date(0), source: "MANUAL", createdById: owner.id, updatedById: owner.id })) });
  const admin = await prisma.user.create({ data: { name: "Synthetic admin", role: "PLATFORM_ADMIN" } });
  await createAiAllowancePolicy({ actorUserId: admin.id, scopeType: "BUSINESS", businessId: business.id, effectiveFrom: new Date(0), requestLimit: 100, tokenLimit: null, source: "PLATFORM_OVERRIDE", reason: "Disposable fixture only" });
  function session(user: typeof owner): AppSession {
    return { userId: user.id, homeBusinessId: business.id, activeBusinessId: business.id, businessId: business.id, contextVersion: 1, branchId: user.branchId, name: user.name, email: "fixture@test.local", role: user.role, permissions: user.permissions, status: user.status };
  }
  const captured: Parameters<AiProvider["analyze"]>[0][] = [];
  const provider: AiProvider = { analyze: async input => { captured.push(input); return new MockAiProvider().analyze(input); } };
  async function ask(options: { actor?: typeof owner; question?: string; branch?: string | null; conversationId?: string; range?: string; from?: string; to?: string } = {}) {
    const user = session(options.actor ?? owner);
    const access = await resolveBusinessAccess({ userId: user.userId, requestedBusinessId: business.id, capability: "USE_AI_ANALYSIS" });
    return askTetamuAi({ user, scope: { type: "BUSINESS", businessId: business.id, access, user, ...(Object.hasOwn(options, "branch") ? { selectedBranchId: options.branch } : {}) }, question: options.question ?? "Overall business summary", clientRequestId: randomUUID(), conversationId: options.conversationId, range: options.range ?? "month", from: options.from, to: options.to }, { provider, now });
  }
  return { business, branch, owner, staff, session, captured, provider, ask };
}

test("Pilot denies Staff with USE capability and forged Owner session before any provider/usage", async () => {
  const f = await fixture();
  await assert.rejects(f.ask({ actor: f.staff }), /AI_PILOT_OWNER_ONLY_DENIED/);
  const user = { ...f.session(f.staff), role: "BUSINESS_OWNER" as const };
  const access = await resolveBusinessAccess({ userId: f.owner.id, requestedBusinessId: f.business.id, capability: "USE_AI_ANALYSIS" });
  await assert.rejects(askTetamuAi({ user, scope: { type: "BUSINESS", businessId: f.business.id, access, user }, question: "Sales", clientRequestId: randomUUID() }, { provider: f.provider, now }), /AI_PILOT_OWNER_ONLY_DENIED/);
  assert.equal(f.captured.length, 0);
  assert.equal(await prisma.aiUsage.count({ where: { businessId: f.business.id } }), 0);
});

test("Pilot rejects Group requests before aggregation/provider", async () => {
  const f = await fixture();
  await assert.rejects(askTetamuAi({ user: f.session(f.owner), scope: { type: "GROUP", groupId: randomUUID(), currentBusinessId: f.business.id }, question: "Compare businesses", clientRequestId: randomUUID() }, { provider: f.provider, now }), /AI_PILOT_GROUP_DENIED/);
  assert.equal(f.captured.length, 0);
});

test("Pilot positive expenses never include forbidden sources or legacy history in payload/UI", async () => {
  const f = await fixture();
  const category = await prisma.expenseCategory.create({ data: { businessId: f.business.id, name: "Synthetic expense", code: "PILOT" } });
  const supplier = await prisma.supplier.create({ data: { businessId: f.business.id, name: "FORBIDDEN_PURCHASING_MARKER_654" } });
  const po = await prisma.purchaseOrder.create({ data: { businessId: f.business.id, branchId: f.branch.id, supplierId: supplier.id, poNumber: "PILOT", orderDate: now, createdById: f.owner.id } });
  const bill = await prisma.supplierBill.create({ data: { businessId: f.business.id, branchId: f.branch.id, supplierId: supplier.id, purchaseOrderId: po.id, billNumber: "PILOT", supplierInvoiceNumber: "PILOT", supplierInvoiceNumberNormalized: "PILOT", invoiceDate: now, dueDate: now, createdById: f.owner.id, confirmedById: f.owner.id, confirmedAt: now, status: "CONFIRMED", confirmedRevision: 0, totalAmount: 654, subtotal: 654 } });
  for (const row of [
    { sourceType: "MANUAL" as const, amount: 12, description: "Allowed" },
    { sourceType: "PAYROLL" as const, amount: 987, description: "FORBIDDEN_PAYROLL_MARKER_987" },
    { sourceType: "INVENTORY_PURCHASE" as const, amount: 654, description: "FORBIDDEN_PURCHASING_MARKER_654" },
    { sourceType: "SYSTEM" as const, amount: 222, description: "Unproven system source" },
  ]) await prisma.businessExpense.create({ data: { ...row, ...(row.sourceType === "MANUAL" ? {} : row.sourceType === "INVENTORY_PURCHASE" ? { sourceId: bill.id, sourceRevision: "0" } : { sourceId: randomUUID(), sourceRevision: "1" }), businessId: f.business.id, branchId: f.branch.id, expenseNumber: randomUUID().slice(0, 8), categoryId: category.id, categoryNameSnapshot: category.name, expenseDate: now, createdById: f.owner.id, confirmedById: f.owner.id, confirmedAt: now, status: "CONFIRMED" } });
  const old = await prisma.aiConversation.create({ data: { scopeType: "BUSINESS", businessId: f.business.id, createdById: f.owner.id, title: "FORBIDDEN_PAYROLL_MARKER_987", messages: { create: [{ role: "USER", content: "FORBIDDEN_PURCHASING_MARKER_654" }, { role: "ASSISTANT", content: "FORBIDDEN_PAYROLL_MARKER_987", structuredMetadata: { summary: "CROSS_BUSINESS_MARKER_321", sourceDomains: ["SUPPLIER_BILLS"] } }] } } });
  const response = await f.ask({ question: "Expenses this month", conversationId: old.id });
  assert.doesNotMatch(JSON.stringify(response), /FORBIDDEN_|CROSS_BUSINESS_/);
  const payload = JSON.stringify(f.captured);
  assert.doesNotMatch(payload, /FORBIDDEN_|CROSS_BUSINESS_|PAYROLL_SPENDING|INVENTORY_PURCHASE_SPENDING|OUTSTANDING_AP|reconciliationHealth/);
  const metrics = (f.captured[0].context as { metrics: { metricKey: string; value: unknown }[] }).metrics;
  assert.equal(metrics.find(m => m.metricKey === "RECORDED_BUSINESS_SPENDING")?.value, "12.00");
  const workspace = await getAiWorkspace({ userId: f.owner.id, businessId: f.business.id });
  assert.doesNotMatch(JSON.stringify(workspace.conversations), /FORBIDDEN_|CROSS_BUSINESS_/);
  assert.match(JSON.stringify(workspace.conversations), /此旧回答无法在当前权限下重新显示/);
  assert.equal(await prisma.aiMessage.count({ where: { conversationId: old.id } }), 4);
});

test("Pilot custom range rejects 91 days before provider/usage and accepts exactly 90", async () => {
  const f = await fixture();
  await assert.rejects(f.ask({ range: "custom", from: "2026-01-01", to: "2026-04-01" }), /AI_DATE_RANGE_TOO_LARGE/);
  assert.equal(f.captured.length, 0);
  assert.equal(await prisma.aiUsage.count({ where: { businessId: f.business.id } }), 0);
  await f.ask({ range: "custom", from: "2026-01-01", to: "2026-03-31" });
  assert.equal(f.captured.length, 1);
});

test("Pilot explicit foreign/empty/null branch never falls back", async () => {
  const f = await fixture();
  for (const branch of [randomUUID(), "", null]) await assert.rejects(f.ask({ branch }), /AI_SCOPE_DENIED/);
  assert.equal(f.captured.length, 0);
  assert.equal(await prisma.aiUsage.count({ where: { businessId: f.business.id } }), 0);
});

test("Pilot source links retain the authorized explicit Branch", async () => {
  const f = await fixture();
  const result = await f.ask({ branch: f.branch.id });
  const message = await prisma.aiMessage.findFirstOrThrow({ where: { conversationId: result.conversationId, role: "ASSISTANT" } });
  const metadata = message.structuredMetadata as { scopeSnapshot: { selectedBranchId?: string; selectedBranchName?: string } };
  assert.equal(metadata.scopeSnapshot.selectedBranchId, f.branch.id);
  assert.equal(metadata.scopeSnapshot.selectedBranchName, f.branch.name);
});

test("Pilot reads all five allowed domains from only the current operational outlet and Business", async () => {
  const f = await fixture();
  const other = await fixture();
  await prisma.business.update({ where: { id: other.business.id }, data: { name: "CROSS_BUSINESS_MARKER_321" } });
  const historical = await prisma.branch.create({ data: { businessId: f.business.id, name: "Historical", status: "INACTIVE" } });
  for (const [businessId, branchId, amount] of [[f.business.id, f.branch.id, 100], [f.business.id, historical.id, 9999], [other.business.id, other.branch.id, 8888]] as const) {
    await prisma.invoice.create({ data: { businessId, branchId, invoiceNumber: randomUUID(), subtotal: amount, total: amount, paidAmount: amount, balance: 0, status: "PAID", issuedAt: now } });
    await prisma.payment.create({ data: { businessId, branchId, amount, method: "CASH", purpose: "SALE", paidAt: now } });
  }
  const product = await prisma.product.create({ data: { businessId: f.business.id, name: "Synthetic product", price: 20, trackInventory: true } });
  await prisma.productStock.createMany({ data: [{ businessId: f.business.id, branchId: f.branch.id, productId: product.id, quantity: 5, reorderLevel: 6 }, { businessId: f.business.id, branchId: historical.id, productId: product.id, quantity: 9000 }] });
  const customer = await prisma.customer.create({ data: { businessId: f.business.id, name: "Private customer", phone: "PRIVATE_PHONE_987", email: "private@test.local" } });
  await prisma.appointment.create({ data: { businessId: f.business.id, branchId: f.branch.id, customerId: customer.id, scheduledAt: now, notes: "PRIVATE_NOTES_987", contactPhone: "PRIVATE_PHONE_987" } });
  const result = await f.ask();
  const context = f.captured[0].context as { metrics: { metricKey: string; value: unknown }[] };
  const values = Object.fromEntries(context.metrics.map(m => [m.metricKey, m.value]));
  assert.equal(values.NET_SALES, "100.00");
  assert.equal(values.PAYMENTS_COLLECTED, "100.00");
  assert.equal(values.INVENTORY_SELLING_VALUE, "100.00");
  assert.equal(values.LOW_STOCK_COUNT, 1);
  assert.equal(values.APPOINTMENTS_TOTAL, 1);
  assert.doesNotMatch(JSON.stringify(f.captured), /CROSS_BUSINESS_MARKER_321|PRIVATE_PHONE|PRIVATE_NOTES|private@test|9000|9999|8888/);
  await assert.rejects(f.ask({ branch: other.branch.id }), /AI_SCOPE_DENIED/);
  const user = { ...f.session(f.owner), activeBusinessId: other.business.id };
  await assert.rejects(askTetamuAi({ user, scope: { type: "BUSINESS", businessId: other.business.id, user, access: await resolveBusinessAccess({ userId: other.owner.id, requestedBusinessId: other.business.id }) }, question: "Summary", clientRequestId: randomUUID() }, { provider: f.provider, now }), /AI_PILOT_OWNER_ONLY_DENIED/);
  await prisma.businessModuleEntitlement.updateMany({ where: { businessId: f.business.id, moduleKey: "INVENTORY" }, data: { status: "DISABLED", revision: { increment: 1 } } });
  const workspace = await getAiWorkspace({ userId: f.owner.id, businessId: f.business.id });
  assert.equal(workspace.conversations.find(c => c.id === result.conversationId)?.messages[1].content, "此旧回答无法在当前权限下重新显示");
  await f.ask();
  assert.doesNotMatch(JSON.stringify(f.captured[1].context), /INVENTORY_SELLING_VALUE|TRACKED_PRODUCTS|LOW_STOCK_COUNT/);
});

test("Pilot history remains stored but Staff after permission revoke sees only safe placeholders", async () => {
  const f = await fixture();
  const result = await f.ask({ question: "Sales this month" });
  const visible = await getAiWorkspace({ userId: f.owner.id, businessId: f.business.id });
  assert.notEqual(visible.conversations[0].messages[1].content, "此旧回答无法在当前权限下重新显示");
  await prisma.user.update({ where: { id: f.owner.id }, data: { role: "STAFF", branchId: f.branch.id, permissions: ["AI_ANALYSIS_VIEW", "AI_ANALYSIS_USE"] } });
  const restricted = await getAiWorkspace({ userId: f.owner.id, businessId: f.business.id });
  assert.equal(restricted.conversations[0].messages[1].content, "此旧回答无法在当前权限下重新显示");
  assert.equal(restricted.conversations[0].messages[1].structuredMetadata, null);
  await assert.rejects(f.ask(), /AI_PILOT_OWNER_ONLY_DENIED/);
  assert.equal(await prisma.aiMessage.count({ where: { conversationId: result.conversationId } }), 2);
});

test("Pilot archived history and Group history never re-expose unproven answers", async () => {
  const f = await fixture();
  const old = await prisma.aiConversation.create({ data: { scopeType: "BUSINESS", businessId: f.business.id, createdById: f.owner.id, title: "FORBIDDEN_PAYROLL_MARKER_987", archivedAt: now, messages: { create: { role: "ASSISTANT", content: "FORBIDDEN_PURCHASING_MARKER_654" } } } });
  const archive = await getAiWorkspace({ userId: f.owner.id, businessId: f.business.id, archived: true });
  assert.equal(archive.conversations[0].id, old.id);
  assert.doesNotMatch(JSON.stringify(archive), /FORBIDDEN_/);
  assert.equal((await getAiWorkspace({ userId: f.owner.id, businessId: f.business.id })).conversations.length, 0);
  const group = await prisma.businessGroup.create({ data: { name: "Synthetic group", code: randomUUID() } });
  await prisma.aiConversation.create({ data: { scopeType: "GROUP", groupId: group.id, createdById: f.owner.id, title: "CROSS_BUSINESS_MARKER_321", messages: { create: { role: "ASSISTANT", content: "FORBIDDEN_PAYROLL_MARKER_987" } } } });
  const grouped = await getAiWorkspace({ userId: f.owner.id, groupId: group.id });
  assert.equal(grouped.conversations.length, 1);
  assert.doesNotMatch(JSON.stringify(grouped), /FORBIDDEN_|CROSS_BUSINESS_/);
});

test("Pilot denies real Group Manager Business access without removing existing global USE capability", async () => {
  const home = await fixture();
  const target = await fixture();
  const group = await prisma.businessGroup.create({ data: { name: "Synthetic GM", code: randomUUID() } });
  await prisma.businessGroupMember.createMany({ data: [{ groupId: group.id, businessId: home.business.id }, { groupId: group.id, businessId: target.business.id }] });
  await prisma.businessGroupUser.create({ data: { userId: home.staff.id, groupId: group.id, role: "GROUP_MANAGER", accessScope: "SELECTED_BUSINESSES", businessAccesses: { create: { businessId: target.business.id } } } });
  const access = await resolveBusinessAccess({ userId: home.staff.id, requestedBusinessId: target.business.id, capability: "USE_AI_ANALYSIS" });
  assert.equal(access.granted, true);
  assert.equal(hasBusinessCapability(access, "USE_AI_ANALYSIS"), true);
  const user = { ...home.session(home.staff), activeBusinessId: target.business.id };
  await assert.rejects(askTetamuAi({ user, scope: { type: "BUSINESS", businessId: target.business.id, user, access }, question: "Sales", clientRequestId: randomUUID() }, { provider: home.provider, now }), /AI_PILOT_OWNER_ONLY_DENIED/);
  assert.equal(home.captured.length, 0);
});

test("Pilot replay never returns an unsafe old successful answer and rechecks module access", async () => {
  const f = await fixture();
  const key = randomUUID();
  const old = await prisma.aiConversation.create({ data: { businessId: f.business.id, createdById: f.owner.id, scopeType: "BUSINESS", messages: { create: { role: "ASSISTANT", content: "FORBIDDEN_PAYROLL_MARKER_987", structuredMetadata: { summary: "FORBIDDEN_PURCHASING_MARKER_654" } } } }, include: { messages: true } });
  await prisma.aiUsage.create({ data: { businessId: f.business.id, userId: f.owner.id, conversationId: old.id, messageId: old.messages[0].id, provider: "mock", model: "synthetic", status: "SUCCEEDED", requestKey: `BUSINESS:${f.business.id}:${key}` } });
  const user = f.session(f.owner);
  const access = await resolveBusinessAccess({ userId: f.owner.id, requestedBusinessId: f.business.id });
  const request = { user, scope: { type: "BUSINESS" as const, businessId: f.business.id, access, user }, question: "Sales", clientRequestId: key };
  await assert.rejects(askTetamuAi(request, { provider: f.provider, now }), /AI_REQUEST_DUPLICATE/);
  assert.equal(f.captured.length, 0);
  await prisma.businessModuleEntitlement.updateMany({ where: { businessId: f.business.id, moduleKey: "AI" }, data: { status: "DISABLED", revision: { increment: 1 } } });
  await assert.rejects(askTetamuAi(request, { provider: f.provider, now }), /AI_MODULE_DISABLED/);
  assert.equal(f.captured.length, 0);
});

test.after(async () => { await prisma.$disconnect(); });
