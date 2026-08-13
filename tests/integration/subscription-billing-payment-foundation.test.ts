import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AppSession } from "../../src/lib/auth/session";
import { prisma } from "../../src/lib/prisma";
import { activateCommercialPlanVersion, createCommercialOverride, createCommercialPlan, createCommercialPlanVersion, createCommercialSubscription, scheduleCommercialPlanChange } from "../../src/lib/commercial/service";
import { createSubscriptionInvoiceDraft, getSubscriptionInvoiceDetail, issueSubscriptionInvoice, listSubscriptionInvoices, recordSubscriptionPayment, reconcileSubscriptionBilling, renewSubscriptionWithInvoice, reverseSubscriptionPayment, voidSubscriptionInvoice } from "../../src/lib/commercial/billing-service";

after(async () => { await prisma.$disconnect(); });
const authorize = async () => ({ sensitiveActionAuthorizationId: "test-authorization", assurance: "MFA" });

async function fixture(input: { monthly?: number | null; annual?: number | null; setup?: number; branches?: number; employees?: number; branchUnit?: number; employeeUnit?: number } = {}) {
  const token = randomUUID().slice(0, 8);
  const user = await prisma.user.create({ data: { name: `Billing Admin ${token}`, email: `billing-${token}@test.local`, role: "PLATFORM_ADMIN", status: "active" } });
  const actor: AppSession = { userId: user.id, name: user.name, email: user.email!, role: user.role, status: user.status, permissions: [], homeBusinessId: null, activeBusinessId: null, businessId: null, contextVersion: 1 };
  const business = await prisma.business.create({ data: { name: `Billing Customer ${token}`, slug: `billing-${token}` } });
  await prisma.branch.create({ data: { businessId: business.id, name: "Main" } });
  const plan = await createCommercialPlan(actor, { code: `BILL-${token}`, displayName: "Billing Plan", scopeType: "BUSINESS", planType: "BASE", operationKey: `PLAN:${token}` });
  const draft = await createCommercialPlanVersion(actor, { planId: plan.id, operationKey: `VERSION:${token}`, effectiveFrom: new Date("2026-01-01Z"), monthlyListPriceCents: input.monthly === undefined ? 16_900 : input.monthly, annualListPriceCents: input.annual === undefined ? 169_000 : input.annual, setupFeeCents: input.setup ?? 0, includedBranches: input.branches ?? 1, includedEmployees: input.employees ?? 10, extraBranchUnitPriceCents: input.branchUnit ?? 3_900, extraEmployeeUnitPriceCents: input.employeeUnit ?? 400, businessAiAllowance: 50, groupAiAllowance: null, modules: ["POS"] });
  const version = await activateCommercialPlanVersion(actor, draft.id, `ACTIVATE:${token}`, new Date("2026-01-01Z"));
  const subscription = await createCommercialSubscription(actor, { scopeType: "BUSINESS", businessId: business.id, basePlanVersionId: version.id, billingInterval: "MONTHLY", startDate: new Date("2026-08-01Z"), renewalDate: new Date("2026-09-01Z"), operationKey: `SUB:${token}` });
  return { actor, business, plan, subscription, token, user, version };
}

async function issued(f: Awaited<ReturnType<typeof fixture>>, suffix = "A") {
  const draft = await createSubscriptionInvoiceDraft(f.actor, { subscriptionId: f.subscription.id, billingPeriodStart: new Date("2026-08-01Z"), billingPeriodEnd: new Date("2026-09-01Z"), invoiceDate: new Date("2026-08-01Z"), dueDate: new Date("2026-08-15Z"), operationKey: `INV:${suffix}:${f.token}` });
  return issueSubscriptionInvoice(f.actor, { invoiceId: draft.id, expectedRevision: draft.revision, operationKey: `ISSUE:${suffix}:${f.token}` });
}

test("draft is not receivable; issue then RM100 + RM69 closes RM169 and reversal restores RM69", async () => {
  const f = await fixture();
  const draft = await createSubscriptionInvoiceDraft(f.actor, { subscriptionId: f.subscription.id, billingPeriodStart: new Date("2026-08-01Z"), billingPeriodEnd: new Date("2026-09-01Z"), invoiceDate: new Date("2026-08-01Z"), dueDate: new Date("2026-08-15Z"), operationKey: `DRAFT:${f.token}` });
  assert.equal(draft.status, "DRAFT"); assert.equal(draft.outstandingAmountCents, 0); assert.equal(draft.totalAmountCents, 16_900);
  const invoice = await issueSubscriptionInvoice(f.actor, { invoiceId: draft.id, expectedRevision: 0, operationKey: `ISSUE:${f.token}` });
  assert.equal(invoice.outstandingAmountCents, 16_900);
  await recordSubscriptionPayment(f.actor, { invoiceId: invoice.id, amountCents: 10_000, paymentDate: new Date("2026-08-02Z"), paymentMethod: "BANK_TRANSFER", operationKey: `PAY1:${f.token}`, authorize });
  assert.equal((await getSubscriptionInvoiceDetail({ actor: f.actor, invoiceId: invoice.id })).canonicalOutstandingCents, 6_900);
  const payment = await recordSubscriptionPayment(f.actor, { invoiceId: invoice.id, amountCents: 6_900, paymentDate: new Date("2026-08-03Z"), paymentMethod: "DUITNOW_QR", operationKey: `PAY2:${f.token}`, authorize });
  assert.equal((await getSubscriptionInvoiceDetail({ actor: f.actor, invoiceId: invoice.id })).canonicalPaymentStatus, "PAID");
  await reverseSubscriptionPayment(f.actor, { paymentId: payment.id, reason: "Bank transfer was entered twice", operationKey: `REV:${f.token}`, authorize });
  const reopened = await getSubscriptionInvoiceDetail({ actor: f.actor, invoiceId: invoice.id });
  assert.equal(reopened.canonicalOutstandingCents, 6_900); assert.equal(reopened.canonicalPaymentStatus, "PARTIALLY_PAID");
  assert.equal((await reconcileSubscriptionBilling()).status, "MATCH");
});

test("idempotent and concurrent invoice generation creates one active period invoice", async () => {
  const f = await fixture();
  const input = { subscriptionId: f.subscription.id, billingPeriodStart: new Date("2026-08-01Z"), billingPeriodEnd: new Date("2026-09-01Z"), invoiceDate: new Date("2026-08-01Z"), dueDate: new Date("2026-08-15Z") };
  const [a, b] = await Promise.all([createSubscriptionInvoiceDraft(f.actor, { ...input, operationKey: `RACE:A:${f.token}` }), createSubscriptionInvoiceDraft(f.actor, { ...input, operationKey: `RACE:B:${f.token}` })]);
  assert.equal(a.id, b.id); assert.equal(await prisma.subscriptionInvoice.count({ where: { subscriptionId: f.subscription.id, status: { not: "VOID" } } }), 1);
  const replay = await createSubscriptionInvoiceDraft(f.actor, { ...input, operationKey: `RACE:A:${f.token}` }); assert.equal(replay.id, a.id);
});

test("overpayment is transactionally blocked and void requires payment reversal", async () => {
  const f = await fixture(); const invoice = await issued(f);
  await assert.rejects(() => recordSubscriptionPayment(f.actor, { invoiceId: invoice.id, amountCents: 16_901, paymentDate: new Date("2026-08-02Z"), paymentMethod: "CASH", operationKey: `OVER:${f.token}`, authorize }), /SUBSCRIPTION_OVERPAYMENT_BLOCKED/);
  const payment = await recordSubscriptionPayment(f.actor, { invoiceId: invoice.id, amountCents: 1_000, paymentDate: new Date("2026-08-02Z"), paymentMethod: "CASH", operationKey: `PAY:${f.token}`, authorize });
  await assert.rejects(() => voidSubscriptionInvoice(f.actor, { invoiceId: invoice.id, expectedRevision: 2, reason: "Incorrect customer invoice", operationKey: `VOID1:${f.token}`, authorize }), /REVERSE_SUBSCRIPTION_PAYMENTS_BEFORE_VOID/);
  await reverseSubscriptionPayment(f.actor, { paymentId: payment.id, reason: "Payment belonged to another invoice", operationKey: `REVERSE:${f.token}`, authorize });
  const latest = await getSubscriptionInvoiceDetail({ actor: f.actor, invoiceId: invoice.id });
  const voided = await voidSubscriptionInvoice(f.actor, { invoiceId: invoice.id, expectedRevision: latest.revision, reason: "Incorrect customer invoice", operationKey: `VOID2:${f.token}`, authorize });
  assert.equal(voided.status, "VOID"); assert.equal(voided.outstandingAmountCents, 0);
});

test("price snapshot pins override, setup fee once and active unit counts", async () => {
  const f = await fixture({ monthly: 19_900, setup: 5_000, branches: 1, employees: 0, branchUnit: 3_900, employeeUnit: 400 });
  await prisma.branch.create({ data: { businessId: f.business.id, name: "Second" } });
  await createCommercialOverride(f.actor, { subscriptionId: f.subscription.id, type: "PRICE", value: 15_900, effectiveFrom: new Date("2026-08-01Z"), reason: "Launch customer override", operationKey: `OVERRIDE:${f.token}` });
  const first = await createSubscriptionInvoiceDraft(f.actor, { subscriptionId: f.subscription.id, billingPeriodStart: new Date("2026-08-01Z"), billingPeriodEnd: new Date("2026-09-01Z"), invoiceDate: new Date("2026-08-01Z"), dueDate: new Date("2026-08-15Z"), operationKey: `FIRST:${f.token}` });
  assert.equal(first.listSubtotalCents, 19_900); assert.equal(first.overrideAdjustmentCents, -4_000); assert.equal(first.setupFeeAmountCents, 5_000); assert.equal(first.branchUnitChargeCents, 3_900); assert.equal(first.totalAmountCents, 24_800);
  await issueSubscriptionInvoice(f.actor, { invoiceId: first.id, expectedRevision: 0, operationKey: `ISSUE:${f.token}` });
  const second = await createSubscriptionInvoiceDraft(f.actor, { subscriptionId: f.subscription.id, billingPeriodStart: new Date("2026-09-01Z"), billingPeriodEnd: new Date("2026-10-01Z"), invoiceDate: new Date("2026-09-01Z"), dueDate: new Date("2026-09-15Z"), operationKey: `SECOND:${f.token}` });
  assert.equal(second.setupFeeAmountCents, 0); assert.equal(second.totalAmountCents, 19_800);
});

test("missing annual configured price fails instead of treating the subscription as free", async () => {
  const f = await fixture({ annual: null });
  await prisma.commercialSubscription.update({ where: { id: f.subscription.id }, data: { billingIntervalSnapshot: "ANNUAL" } });
  await assert.rejects(() => createSubscriptionInvoiceDraft(f.actor, { subscriptionId: f.subscription.id, billingPeriodStart: new Date("2026-08-01Z"), billingPeriodEnd: new Date("2027-08-01Z"), invoiceDate: new Date("2026-08-01Z"), dueDate: new Date("2026-08-15Z"), operationKey: `ANNUAL:${f.token}` }), /SUBSCRIPTION_CONFIGURED_PRICE_REQUIRED/);
});

test("business owner is read-only and cross-business invoice access is denied", async () => {
  const f = await fixture(); const invoice = await issued(f);
  const other = await prisma.business.create({ data: { name: `Other ${f.token}`, slug: `other-${f.token}` } });
  const owner: AppSession = { ...f.actor, role: "BUSINESS_OWNER", activeBusinessId: f.business.id, businessId: f.business.id, homeBusinessId: f.business.id };
  assert.equal((await listSubscriptionInvoices({ actor: owner, businessId: f.business.id })).length, 1);
  await assert.rejects(() => getSubscriptionInvoiceDetail({ actor: owner, invoiceId: invoice.id, businessId: other.id }), /SUBSCRIPTION_BILLING_SCOPE_DENIED/);
  await assert.rejects(() => recordSubscriptionPayment(owner, { invoiceId: invoice.id, amountCents: 100, paymentDate: new Date(), paymentMethod: "CASH", operationKey: `DENY:${f.token}`, authorize }), /COMMERCIAL_PLATFORM_AUTHORITY_REQUIRED/);
});

test("renewal applies scheduled price change, issues once and advances renewal exactly once", async () => {
  const f = await fixture();
  const nextDraft = await createCommercialPlanVersion(f.actor, { planId: f.plan.id, operationKey: `V2:${f.token}`, effectiveFrom: new Date("2026-09-01Z"), monthlyListPriceCents: 19_900, annualListPriceCents: 199_000, setupFeeCents: 0, includedBranches: 1, includedEmployees: 10, extraBranchUnitPriceCents: 3_900, extraEmployeeUnitPriceCents: 400, businessAiAllowance: 50, groupAiAllowance: null, modules: ["POS"] });
  const next = await activateCommercialPlanVersion(f.actor, nextDraft.id, `ACTIVATE2:${f.token}`, new Date("2026-09-01Z"));
  await scheduleCommercialPlanChange(f.actor, { subscriptionId: f.subscription.id, newBasePlanVersionId: next.id, effectiveAt: new Date("2026-09-01Z"), reason: "Upgrade on canonical renewal", operationKey: `SCHEDULE:${f.token}` });
  const input = { subscriptionId: f.subscription.id, invoiceDate: new Date("2026-09-01Z"), dueDate: new Date("2026-09-15Z"), operationKey: `RENEW:${f.token}` };
  const invoice = await renewSubscriptionWithInvoice(f.actor, input); const replay = await renewSubscriptionWithInvoice(f.actor, input);
  assert.equal(replay.id, invoice.id); assert.equal(invoice.totalAmountCents, 19_900); assert.equal(invoice.status, "ISSUED");
  const subscription = await prisma.commercialSubscription.findUniqueOrThrow({ where: { id: f.subscription.id } });
  assert.equal(subscription.renewalDate.toISOString().slice(0, 10), "2026-10-01");
  assert.equal(await prisma.subscriptionInvoice.count({ where: { subscriptionId: f.subscription.id } }), 1);
});

test("two concurrent payments cannot overpay the same canonical outstanding", async () => {
  const f = await fixture(); const invoice = await issued(f, "CONCURRENT");
  const attempts = await Promise.allSettled([
    recordSubscriptionPayment(f.actor, { invoiceId: invoice.id, amountCents: 10_000, paymentDate: new Date("2026-08-02Z"), paymentMethod: "BANK_TRANSFER", operationKey: `CONCURRENT:A:${f.token}`, authorize }),
    recordSubscriptionPayment(f.actor, { invoiceId: invoice.id, amountCents: 10_000, paymentDate: new Date("2026-08-02Z"), paymentMethod: "BANK_TRANSFER", operationKey: `CONCURRENT:B:${f.token}`, authorize }),
  ]);
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
  const detail = await getSubscriptionInvoiceDetail({ actor: f.actor, invoiceId: invoice.id });
  assert.equal(detail.canonicalPaidCents, 10_000); assert.equal(detail.canonicalOutstandingCents, 6_900);
});

test("group invoice is isolated and visible only to its active group owner", async () => {
  const token = randomUUID().slice(0, 8);
  const adminRow = await prisma.user.create({ data: { name: `Group Billing Admin ${token}`, email: `group-billing-admin-${token}@test.local`, role: "PLATFORM_ADMIN", status: "active" } });
  const admin: AppSession = { userId: adminRow.id, name: adminRow.name, email: adminRow.email!, role: adminRow.role, status: adminRow.status, permissions: [], homeBusinessId: null, activeBusinessId: null, businessId: null, contextVersion: 1 };
  const group = await prisma.businessGroup.create({ data: { name: `Billing Group ${token}`, code: `BILL-GRP-${token}` } });
  const home = await prisma.business.create({ data: { name: `Group Home ${token}`, slug: `group-home-${token}` } });
  const ownerRow = await prisma.user.create({ data: { businessId: home.id, name: `Group Owner ${token}`, email: `group-owner-${token}@test.local`, role: "BUSINESS_OWNER", status: "active" } });
  await prisma.businessGroupUser.create({ data: { groupId: group.id, userId: ownerRow.id, role: "GROUP_OWNER", status: "ACTIVE" } });
  const plan = await createCommercialPlan(admin, { code: `GROUP-${token}`, displayName: "Group Plan", scopeType: "GROUP", planType: "BASE", operationKey: `GROUP:PLAN:${token}` });
  const draft = await createCommercialPlanVersion(admin, { planId: plan.id, operationKey: `GROUP:VERSION:${token}`, effectiveFrom: new Date("2026-01-01Z"), monthlyListPriceCents: 199_900, annualListPriceCents: 1_999_000, setupFeeCents: 0, includedBranches: null, includedEmployees: null, extraBranchUnitPriceCents: null, extraEmployeeUnitPriceCents: null, businessAiAllowance: null, groupAiAllowance: 350, modules: [] });
  const version = await activateCommercialPlanVersion(admin, draft.id, `GROUP:ACTIVATE:${token}`, new Date("2026-01-01Z"));
  const subscription = await createCommercialSubscription(admin, { scopeType: "GROUP", groupId: group.id, basePlanVersionId: version.id, billingInterval: "MONTHLY", startDate: new Date("2026-08-01Z"), renewalDate: new Date("2026-09-01Z"), operationKey: `GROUP:SUB:${token}` });
  const draftInvoice = await createSubscriptionInvoiceDraft(admin, { subscriptionId: subscription.id, billingPeriodStart: new Date("2026-08-01Z"), billingPeriodEnd: new Date("2026-09-01Z"), invoiceDate: new Date("2026-08-01Z"), dueDate: new Date("2026-08-15Z"), operationKey: `GROUP:INV:${token}` });
  const invoice = await issueSubscriptionInvoice(admin, { invoiceId: draftInvoice.id, expectedRevision: 0, operationKey: `GROUP:ISSUE:${token}` });
  const owner: AppSession = { userId: ownerRow.id, name: ownerRow.name, email: ownerRow.email!, role: ownerRow.role, status: ownerRow.status, permissions: [], homeBusinessId: home.id, activeBusinessId: home.id, businessId: home.id, contextVersion: 1 };
  assert.equal((await listSubscriptionInvoices({ actor: owner, groupId: group.id }))[0]?.id, invoice.id);
  const outsiderRow = await prisma.user.create({ data: { name: `Outsider ${token}`, email: `outsider-${token}@test.local`, role: "BUSINESS_OWNER", status: "active" } });
  const outsider: AppSession = { ...owner, userId: outsiderRow.id, name: outsiderRow.name, email: outsiderRow.email! };
  await assert.rejects(() => getSubscriptionInvoiceDetail({ actor: outsider, invoiceId: invoice.id, groupId: group.id }), /SUBSCRIPTION_BILLING_SCOPE_DENIED/);
});
