import {
  Prisma,
  type CommercialBillingInterval,
  type SubscriptionPaymentMethod,
} from "@prisma/client";
import type { AppSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { assertPlatformAdmin } from "./service";

const SERIALIZABLE = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
} as const;

type BillingTransaction = Prisma.TransactionClient;
export type BillingAuthorization = (
  transaction: BillingTransaction,
) => Promise<Prisma.InputJsonObject>;

export class SubscriptionBillingError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "SubscriptionBillingError";
  }
}

export type CreateSubscriptionInvoiceInput = {
  subscriptionId: string;
  billingPeriodStart: Date;
  billingPeriodEnd: Date;
  invoiceDate: Date;
  dueDate: Date;
  operationKey: string;
};

export async function createSubscriptionInvoiceDraft(
  actor: AppSession,
  input: CreateSubscriptionInvoiceInput,
) {
  assertPlatformAdmin(actor);
  validateInvoiceDates(input);
  return idempotent(input.operationKey, "CREATE_SUBSCRIPTION_INVOICE", actor, async (tx) => {
    await lock(tx, `subscription-billing:${input.subscriptionId}`);
    const existing = await tx.subscriptionInvoice.findFirst({
      where: {
        subscriptionId: input.subscriptionId,
        billingPeriodStart: dateOnly(input.billingPeriodStart),
        billingPeriodEnd: dateOnly(input.billingPeriodEnd),
        status: { not: "VOID" },
      },
      include: { lines: true },
    });
    if (existing) return existing;
    return createInvoiceSnapshot(tx, actor, input, "DRAFT");
  });
}

export async function issueSubscriptionInvoice(
  actor: AppSession,
  input: {
    invoiceId: string;
    expectedRevision: number;
    operationKey: string;
  },
) {
  assertPlatformAdmin(actor);
  return idempotent(input.operationKey, "ISSUE_SUBSCRIPTION_INVOICE", actor, async (tx) => {
    await lock(tx, `subscription-invoice:${input.invoiceId}`);
    const invoice = await tx.subscriptionInvoice.findUnique({
      where: { id: input.invoiceId },
      include: { lines: true },
    });
    if (!invoice) throw new SubscriptionBillingError("SUBSCRIPTION_INVOICE_NOT_FOUND");
    if (invoice.status === "ISSUED") return invoice;
    if (invoice.status !== "DRAFT") {
      throw new SubscriptionBillingError("SUBSCRIPTION_INVOICE_NOT_ISSUABLE");
    }
    if (invoice.revision !== input.expectedRevision) {
      throw new SubscriptionBillingError("SUBSCRIPTION_INVOICE_STALE");
    }
    const updated = await tx.subscriptionInvoice.updateMany({
      where: { id: invoice.id, status: "DRAFT", revision: input.expectedRevision },
      data: {
        status: "ISSUED",
        outstandingAmountCents: invoice.totalAmountCents,
        issuedAt: new Date(),
        issuedById: actor.userId,
        revision: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new SubscriptionBillingError("SUBSCRIPTION_INVOICE_CONCURRENT_TRANSITION");
    }
    const issued = await invoiceDetail(tx, invoice.id);
    await audit(tx, actor, "SUBSCRIPTION_INVOICE_ISSUED", "SubscriptionInvoice", invoice.id, {
      invoiceNumber: invoice.invoiceNumber,
      totalAmountCents: invoice.totalAmountCents,
      status: "ISSUED",
    }, invoice.subscriptionId);
    return issued;
  });
}

export async function voidSubscriptionInvoice(
  actor: AppSession,
  input: {
    invoiceId: string;
    expectedRevision: number;
    reason: string;
    operationKey: string;
    authorize: BillingAuthorization;
  },
) {
  assertPlatformAdmin(actor);
  const reason = requiredReason(input.reason);
  return idempotent(input.operationKey, "VOID_SUBSCRIPTION_INVOICE", actor, async (tx) => {
    await lock(tx, `subscription-invoice:${input.invoiceId}`);
    const invoice = await invoiceDetail(tx, input.invoiceId);
    if (invoice.status !== "ISSUED") {
      throw new SubscriptionBillingError("ONLY_ISSUED_SUBSCRIPTION_INVOICE_CAN_BE_VOIDED");
    }
    if (invoice.revision !== input.expectedRevision) {
      throw new SubscriptionBillingError("SUBSCRIPTION_INVOICE_STALE");
    }
    const paid = canonicalPaidAmount(invoice.payments);
    if (paid !== 0) {
      throw new SubscriptionBillingError("REVERSE_SUBSCRIPTION_PAYMENTS_BEFORE_VOID");
    }
    const authorization = await input.authorize(tx);
    const updated = await tx.subscriptionInvoice.updateMany({
      where: { id: invoice.id, status: "ISSUED", revision: input.expectedRevision },
      data: {
        status: "VOID",
        voidedAt: new Date(),
        voidedById: actor.userId,
        voidReason: reason,
        outstandingAmountCents: 0,
        paymentStatus: "UNPAID",
        revision: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new SubscriptionBillingError("SUBSCRIPTION_INVOICE_CONCURRENT_TRANSITION");
    }
    const result = await invoiceDetail(tx, invoice.id);
    await audit(tx, actor, "SUBSCRIPTION_INVOICE_VOIDED", "SubscriptionInvoice", invoice.id, {
      reason,
      authorization,
    }, invoice.subscriptionId);
    return result;
  });
}

export async function recordSubscriptionPayment(
  actor: AppSession,
  input: {
    invoiceId: string;
    amountCents: number;
    paymentDate: Date;
    paymentMethod: SubscriptionPaymentMethod;
    paymentReference?: string | null;
    notes?: string | null;
    operationKey: string;
    authorize: BillingAuthorization;
  },
) {
  assertPlatformAdmin(actor);
  positiveCents(input.amountCents);
  if (!Number.isFinite(input.paymentDate.getTime())) {
    throw new SubscriptionBillingError("SUBSCRIPTION_PAYMENT_DATE_INVALID");
  }
  return idempotent(input.operationKey, "RECORD_SUBSCRIPTION_PAYMENT", actor, async (tx) => {
    await lock(tx, `subscription-invoice:${input.invoiceId}`);
    const invoice = await invoiceDetail(tx, input.invoiceId);
    if (invoice.status !== "ISSUED") {
      throw new SubscriptionBillingError("SUBSCRIPTION_PAYMENT_REQUIRES_ISSUED_INVOICE");
    }
    const canonicalPaid = canonicalPaidAmount(invoice.payments);
    const outstanding = invoice.totalAmountCents - canonicalPaid;
    if (input.amountCents > outstanding) {
      throw new SubscriptionBillingError("SUBSCRIPTION_OVERPAYMENT_BLOCKED");
    }
    const authorization = await input.authorize(tx);
    const sequence = await nextSequence(tx, "paymentSequence");
    const payment = await tx.subscriptionPayment.create({
      data: {
        invoiceId: invoice.id,
        paymentNumber: `SUB-PAY-${String(sequence).padStart(6, "0")}`,
        paymentDate: dateOnly(input.paymentDate),
        amountCents: input.amountCents,
        paymentMethod: input.paymentMethod,
        paymentReference: clean(input.paymentReference, 160),
        notes: clean(input.notes, 2_000),
        createdById: actor.userId,
      },
      include: { reversal: true },
    });
    await refreshInvoiceSettlement(tx, invoice.id, invoice.totalAmountCents);
    await audit(tx, actor, "SUBSCRIPTION_PAYMENT_RECORDED", "SubscriptionPayment", payment.id, {
      invoiceId: invoice.id,
      amountCents: payment.amountCents,
      paymentMethod: payment.paymentMethod,
      authorization,
    }, invoice.subscriptionId);
    return payment;
  });
}

export async function reverseSubscriptionPayment(
  actor: AppSession,
  input: {
    paymentId: string;
    reason: string;
    operationKey: string;
    authorize: BillingAuthorization;
  },
) {
  assertPlatformAdmin(actor);
  const reason = requiredReason(input.reason);
  return idempotent(input.operationKey, "REVERSE_SUBSCRIPTION_PAYMENT", actor, async (tx) => {
    const payment = await tx.subscriptionPayment.findUnique({
      where: { id: input.paymentId },
      include: { invoice: true, reversal: true },
    });
    if (!payment) throw new SubscriptionBillingError("SUBSCRIPTION_PAYMENT_NOT_FOUND");
    await lock(tx, `subscription-invoice:${payment.invoiceId}`);
    const canonical = await tx.subscriptionPayment.findUniqueOrThrow({
      where: { id: payment.id },
      include: { invoice: true, reversal: true },
    });
    if (canonical.status !== "COMPLETED" || canonical.reversal) {
      throw new SubscriptionBillingError("SUBSCRIPTION_PAYMENT_ALREADY_REVERSED");
    }
    const authorization = await input.authorize(tx);
    await tx.subscriptionPaymentReversal.create({
      data: { paymentId: canonical.id, reason, createdById: actor.userId },
    });
    await tx.subscriptionPayment.update({
      where: { id: canonical.id },
      data: { status: "REVERSED" },
    });
    await refreshInvoiceSettlement(tx, canonical.invoiceId, canonical.invoice.totalAmountCents);
    const result = await tx.subscriptionPayment.findUniqueOrThrow({
      where: { id: canonical.id },
      include: { reversal: true },
    });
    await audit(tx, actor, "SUBSCRIPTION_PAYMENT_REVERSED", "SubscriptionPayment", result.id, {
      reason,
      restoredOutstandingCents: result.amountCents,
      authorization,
    }, canonical.invoice.subscriptionId);
    return result;
  });
}

export async function renewSubscriptionWithInvoice(
  actor: AppSession,
  input: {
    subscriptionId: string;
    invoiceDate: Date;
    dueDate: Date;
    operationKey: string;
  },
) {
  assertPlatformAdmin(actor);
  return idempotent(input.operationKey, "RENEW_SUBSCRIPTION_WITH_INVOICE", actor, async (tx) => {
    await lock(tx, `subscription-billing:${input.subscriptionId}`);
    const subscription = await tx.commercialSubscription.findUnique({
      where: { id: input.subscriptionId },
    });
    if (!subscription || subscription.status !== "ACTIVE") {
      throw new SubscriptionBillingError("SUBSCRIPTION_NOT_RENEWABLE");
    }
    const periodStart = dateOnly(subscription.renewalDate);
    const periodEnd = addInterval(periodStart, subscription.billingIntervalSnapshot);
    await applyScheduledChangeAtRenewal(tx, subscription.id, periodStart);
    const invoice = await createInvoiceSnapshot(tx, actor, {
      subscriptionId: subscription.id,
      billingPeriodStart: periodStart,
      billingPeriodEnd: periodEnd,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate,
      operationKey: input.operationKey,
    }, "ISSUED");
    await tx.commercialSubscription.update({
      where: { id: subscription.id },
      data: { renewalDate: periodEnd, revision: { increment: 1 } },
    });
    await audit(tx, actor, "SUBSCRIPTION_RENEWED_WITH_INVOICE", "CommercialSubscription", subscription.id, {
      previousRenewalDate: subscription.renewalDate.toISOString(),
      nextRenewalDate: periodEnd.toISOString(),
      invoiceId: invoice.id,
    }, subscription.id);
    return invoice;
  });
}

export async function getSubscriptionInvoiceDetail(input: {
  invoiceId: string;
  actor: AppSession;
  businessId?: string;
  groupId?: string;
}) {
  const invoice = await invoiceDetail(prisma, input.invoiceId);
  await assertReadScope(input.actor, invoice, input.businessId, input.groupId);
  return withCanonicalSettlement(invoice);
}

export async function listSubscriptionInvoices(input: {
  actor: AppSession;
  businessId?: string;
  groupId?: string;
  status?: "DRAFT" | "ISSUED" | "VOID";
}) {
  const where = input.actor.role === "PLATFORM_ADMIN"
    ? {
        ...(input.businessId ? { businessId: input.businessId } : {}),
        ...(input.groupId ? { groupId: input.groupId } : {}),
      }
    : input.groupId
      ? { groupId: input.groupId }
      : { businessId: input.actor.activeBusinessId ?? "DENIED" };
  const invoices = await prisma.subscriptionInvoice.findMany({
    where: { ...where, ...(input.status ? { status: input.status } : {}) },
    include: {
      business: { select: { id: true, name: true } },
      group: { select: { id: true, name: true } },
      payments: { include: { reversal: true }, orderBy: { createdAt: "desc" } },
      lines: { orderBy: { createdAt: "asc" } },
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
  });
  for (const invoice of invoices) await assertReadScope(input.actor, invoice, input.businessId, input.groupId);
  return invoices.map(withCanonicalSettlement);
}

export async function getSubscriptionReceivablesOverview(actor: AppSession) {
  assertPlatformAdmin(actor);
  const invoices = await listSubscriptionInvoices({ actor, status: "ISSUED" });
  const now = dateOnly(new Date());
  return {
    totalReceivableCents: invoices.reduce((sum, row) => sum + row.canonicalOutstandingCents, 0),
    overdueCents: invoices.filter(row => row.canonicalOutstandingCents > 0 && row.dueDate < now).reduce((sum, row) => sum + row.canonicalOutstandingCents, 0),
    dueSoonCents: invoices.filter(row => row.canonicalOutstandingCents > 0 && row.dueDate >= now && row.dueDate <= addDays(now, 7)).reduce((sum, row) => sum + row.canonicalOutstandingCents, 0),
    unpaidCount: invoices.filter(row => row.canonicalPaymentStatus === "UNPAID").length,
    partiallyPaidCount: invoices.filter(row => row.canonicalPaymentStatus === "PARTIALLY_PAID").length,
    paidCount: invoices.filter(row => row.canonicalPaymentStatus === "PAID").length,
  };
}

export async function reconcileSubscriptionBilling() {
  const invoices = await prisma.subscriptionInvoice.findMany({
    include: { payments: { include: { reversal: true } } },
  });
  const issues: Array<{ invoiceId: string; code: string }> = [];
  for (const invoice of invoices) {
    const canonical = withCanonicalSettlement(invoice);
    if (invoice.status === "ISSUED" && (
      invoice.paidAmountCents !== canonical.canonicalPaidCents ||
      invoice.outstandingAmountCents !== canonical.canonicalOutstandingCents ||
      invoice.paymentStatus !== canonical.canonicalPaymentStatus
    )) issues.push({ invoiceId: invoice.id, code: "SETTLEMENT_MISMATCH" });
    if (invoice.status === "DRAFT" && invoice.outstandingAmountCents !== 0) {
      issues.push({ invoiceId: invoice.id, code: "DRAFT_RECEIVABLE_FORBIDDEN" });
    }
    if (canonical.canonicalPaidCents > invoice.totalAmountCents) {
      issues.push({ invoiceId: invoice.id, code: "OVERPAYMENT" });
    }
  }
  return { status: issues.length ? "REVIEW_REQUIRED" as const : "MATCH" as const, issues };
}

async function createInvoiceSnapshot(
  tx: BillingTransaction,
  actor: AppSession,
  input: CreateSubscriptionInvoiceInput,
  status: "DRAFT" | "ISSUED",
) {
  const at = dateOnly(input.billingPeriodStart);
  const subscription = await tx.commercialSubscription.findUnique({
    where: { id: input.subscriptionId },
    include: {
      promotion: true,
      items: {
        where: {
          startDate: { lte: at },
          OR: [{ endDate: null }, { endDate: { gt: at } }],
          status: { in: ["ACTIVE", "ENDED"] },
        },
        include: { planVersion: { include: { plan: true } } },
      },
      overrides: {
        where: {
          status: "ACTIVE",
          effectiveFrom: { lte: at },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
        },
        orderBy: { revision: "desc" },
      },
    },
  });
  if (!subscription || subscription.status !== "ACTIVE") {
    throw new SubscriptionBillingError("ACTIVE_SUBSCRIPTION_REQUIRED");
  }
  if (subscription.items.filter(row => row.itemType === "BASE").length !== 1) {
    throw new SubscriptionBillingError("ACTIVE_BASE_PLAN_REQUIRED");
  }
  if (input.billingPeriodStart < subscription.startDate || (subscription.endDate && input.billingPeriodStart >= subscription.endDate)) {
    throw new SubscriptionBillingError("SUBSCRIPTION_BILLING_PERIOD_OUTSIDE_TERM");
  }
  const priceParts = subscription.items.map(item => {
    const cents = priceFor(item.planVersion, subscription.billingIntervalSnapshot);
    if (cents === null) throw new SubscriptionBillingError("SUBSCRIPTION_CONFIGURED_PRICE_REQUIRED");
    return { item, cents, amount: cents * item.quantity };
  });
  const listSubtotalCents = priceParts.reduce((sum, row) => sum + row.amount, 0);
  const latestOverrides = new Map<string, (typeof subscription.overrides)[number]>();
  for (const override of subscription.overrides) if (!latestOverrides.has(override.type)) latestOverrides.set(override.type, override);
  const priceOverride = latestOverrides.get("PRICE")?.value ?? null;
  const promotionEligible = Boolean(
    subscription.promotion &&
    subscription.promotion.status === "ACTIVE" &&
    subscription.promotion.effectiveFrom <= at &&
    (!subscription.promotion.effectiveTo || subscription.promotion.effectiveTo > at) &&
    await tx.commercialPromotionPlanVersion.count({
      where: {
        promotionId: subscription.promotion.id,
        planVersionId: { in: subscription.items.map(row => row.planVersionId) },
      },
    }),
  );
  const promotionDiscountCents = priceOverride !== null || !promotionEligible
    ? 0
    : subscription.promotion!.discountType === "PERCENT"
      ? Math.round(listSubtotalCents * subscription.promotion!.discountValue / 10_000)
      : Math.min(listSubtotalCents, subscription.promotion!.discountValue);
  const afterPromotion = Math.max(0, listSubtotalCents - promotionDiscountCents);
  const recurringCents = priceOverride ?? afterPromotion;
  const overrideAdjustmentCents = priceOverride === null ? 0 : priceOverride - listSubtotalCents;
  const base = subscription.items.find(row => row.itemType === "BASE")!;
  const [activeBranches, activeEmployees, priorSetupCharge] = subscription.businessId
    ? await Promise.all([
        tx.branch.count({ where: { businessId: subscription.businessId, status: "ACTIVE" } }),
        tx.employeeBusinessMembership.count({ where: { businessId: subscription.businessId, status: "ACTIVE" } }),
        tx.subscriptionInvoice.count({ where: { subscriptionId: subscription.id, status: "ISSUED", setupFeeAmountCents: { gt: 0 } } }),
      ])
    : [0, 0, await tx.subscriptionInvoice.count({ where: { subscriptionId: subscription.id, status: "ISSUED", setupFeeAmountCents: { gt: 0 } } })];
  const includedBranches = latestOverrides.get("BRANCH_ALLOWANCE")?.value ?? subscription.items.reduce((sum, row) => sum + (row.planVersion.includedBranches ?? 0) * row.quantity, 0);
  const includedEmployees = latestOverrides.get("EMPLOYEE_ALLOWANCE")?.value ?? subscription.items.reduce((sum, row) => sum + (row.planVersion.includedEmployees ?? 0) * row.quantity, 0);
  const billableBranches = Math.max(0, activeBranches - includedBranches);
  const billableEmployees = Math.max(0, activeEmployees - includedEmployees);
  const branchUnitPrice = base.planVersion.extraBranchUnitPriceCents ?? 0;
  const employeeUnitPrice = base.planVersion.extraEmployeeUnitPriceCents ?? 0;
  const branchCharge = billableBranches * branchUnitPrice;
  const employeeCharge = billableEmployees * employeeUnitPrice;
  const setupFee = priorSetupCharge ? 0 : subscription.items.reduce((sum, row) => sum + (row.planVersion.setupFeeCents ?? 0) * row.quantity, 0);
  const total = recurringCents + branchCharge + employeeCharge + setupFee;
  const sequence = await nextSequence(tx, "invoiceSequence");
  const lines: Prisma.SubscriptionInvoiceLineCreateWithoutInvoiceInput[] = priceParts.map(({ item, cents, amount }) => ({
    lineType: item.itemType === "BASE" ? "BASE_PLAN" : "ADD_ON",
    planVersion: { connect: { id: item.planVersionId } },
    planCodeSnapshot: item.planVersion.plan.code,
    planNameSnapshot: item.planVersion.plan.displayName,
    planVersionSnapshot: item.planVersion.version,
    description: `${item.planVersion.plan.displayName} v${item.planVersion.version} (${subscription.billingIntervalSnapshot})`,
    quantity: item.quantity,
    unitAmountCents: cents,
    lineAmountCents: amount,
  }));
  if (branchCharge) lines.push({ lineType: "EXTRA_BRANCH", description: "Extra active branches", quantity: billableBranches, unitAmountCents: branchUnitPrice, lineAmountCents: branchCharge });
  if (employeeCharge) lines.push({ lineType: "EXTRA_EMPLOYEE", description: "Extra active employees", quantity: billableEmployees, unitAmountCents: employeeUnitPrice, lineAmountCents: employeeCharge });
  if (setupFee) lines.push({ lineType: "SETUP_FEE", description: "One-time setup fee", quantity: 1, unitAmountCents: setupFee, lineAmountCents: setupFee });
  const invoice = await tx.subscriptionInvoice.create({
    data: {
      scopeType: subscription.scopeType,
      businessId: subscription.businessId,
      groupId: subscription.groupId,
      subscriptionId: subscription.id,
      invoiceNumber: `SUB-INV-${String(sequence).padStart(6, "0")}`,
      billingPeriodStart: dateOnly(input.billingPeriodStart),
      billingPeriodEnd: dateOnly(input.billingPeriodEnd),
      invoiceDate: dateOnly(input.invoiceDate),
      dueDate: dateOnly(input.dueDate),
      currency: "MYR",
      status,
      billingIntervalSnapshot: subscription.billingIntervalSnapshot,
      listSubtotalCents,
      promotionDiscountCents,
      overrideAdjustmentCents,
      setupFeeAmountCents: setupFee,
      branchUnitChargeCents: branchCharge,
      employeeUnitChargeCents: employeeCharge,
      totalAmountCents: total,
      paidAmountCents: 0,
      outstandingAmountCents: status === "ISSUED" ? total : 0,
      activeBranchCountSnapshot: activeBranches,
      includedBranchCountSnapshot: includedBranches,
      billableBranchCountSnapshot: billableBranches,
      activeEmployeeCountSnapshot: activeEmployees,
      includedEmployeeCountSnapshot: includedEmployees,
      billableEmployeeCountSnapshot: billableEmployees,
      priceSnapshot: {
        subscriptionRevision: subscription.revision,
        promotionId: promotionEligible && priceOverride === null ? subscription.promotionId : null,
        priceOverrideId: latestOverrides.get("PRICE")?.id ?? null,
        recurringCents,
        branchUnitPriceCents: branchUnitPrice,
        employeeUnitPriceCents: employeeUnitPrice,
        setupFeeChargedOnce: setupFee > 0,
      },
      createdById: actor.userId,
      issuedById: status === "ISSUED" ? actor.userId : null,
      issuedAt: status === "ISSUED" ? new Date() : null,
      lines: { create: lines },
    },
    include: { lines: true, payments: { include: { reversal: true } } },
  });
  await audit(tx, actor, status === "ISSUED" ? "SUBSCRIPTION_INVOICE_GENERATED_AND_ISSUED" : "SUBSCRIPTION_INVOICE_DRAFT_CREATED", "SubscriptionInvoice", invoice.id, {
    invoiceNumber: invoice.invoiceNumber,
    billingPeriodStart: invoice.billingPeriodStart.toISOString(),
    billingPeriodEnd: invoice.billingPeriodEnd.toISOString(),
    totalAmountCents: total,
  }, subscription.id);
  return invoice;
}

async function refreshInvoiceSettlement(tx: BillingTransaction, invoiceId: string, total: number) {
  const aggregate = await tx.subscriptionPayment.aggregate({
    where: { invoiceId, status: "COMPLETED", reversal: null },
    _sum: { amountCents: true },
  });
  const paid = aggregate._sum.amountCents ?? 0;
  if (paid > total) throw new SubscriptionBillingError("SUBSCRIPTION_OVERPAYMENT_DETECTED");
  const outstanding = total - paid;
  await tx.subscriptionInvoice.update({
    where: { id: invoiceId },
    data: {
      paidAmountCents: paid,
      outstandingAmountCents: outstanding,
      paymentStatus: paid === 0 ? "UNPAID" : outstanding === 0 ? "PAID" : "PARTIALLY_PAID",
      revision: { increment: 1 },
    },
  });
}

async function applyScheduledChangeAtRenewal(tx: BillingTransaction, subscriptionId: string, at: Date) {
  const change = await tx.commercialScheduledPlanChange.findFirst({
    where: { subscriptionId, status: "SCHEDULED", effectiveAt: { lte: at } },
    orderBy: { effectiveAt: "asc" },
  });
  if (!change) return;
  const base = await tx.commercialSubscriptionItem.findFirst({
    where: { subscriptionId, itemType: "BASE", status: "ACTIVE" },
  });
  if (!base) throw new SubscriptionBillingError("ACTIVE_BASE_PLAN_REQUIRED");
  await tx.commercialSubscriptionItem.update({ where: { id: base.id }, data: { status: "ENDED", endDate: at } });
  await tx.commercialSubscriptionItem.create({ data: { subscriptionId, planVersionId: change.newBasePlanVersionId, itemType: "BASE", status: "ACTIVE", startDate: at } });
  await tx.commercialScheduledPlanChange.update({ where: { id: change.id }, data: { status: "APPLIED", appliedAt: new Date() } });
}

async function invoiceDetail(database: BillingTransaction | typeof prisma, invoiceId: string) {
  const invoice = await database.subscriptionInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      business: { select: { id: true, name: true } },
      group: { select: { id: true, name: true } },
      lines: { orderBy: { createdAt: "asc" } },
      payments: { include: { reversal: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!invoice) throw new SubscriptionBillingError("SUBSCRIPTION_INVOICE_NOT_FOUND");
  return invoice;
}

function withCanonicalSettlement<T extends {
  status: string;
  totalAmountCents: number;
  dueDate: Date;
  payments: Array<{ status: string; amountCents: number; reversal?: unknown | null }>;
}>(invoice: T) {
  const canonicalPaidCents = canonicalPaidAmount(invoice.payments);
  const canonicalOutstandingCents = invoice.status === "ISSUED" ? Math.max(0, invoice.totalAmountCents - canonicalPaidCents) : 0;
  const canonicalPaymentStatus = canonicalPaidCents === 0 ? "UNPAID" as const : canonicalOutstandingCents === 0 ? "PAID" as const : "PARTIALLY_PAID" as const;
  return {
    ...invoice,
    canonicalPaidCents,
    canonicalOutstandingCents,
    canonicalPaymentStatus,
    overdue: invoice.status === "ISSUED" && canonicalOutstandingCents > 0 && invoice.dueDate < dateOnly(new Date()),
  };
}

function canonicalPaidAmount(payments: Array<{ status: string; amountCents: number; reversal?: unknown | null }>) {
  return payments.filter(row => row.status === "COMPLETED" && !row.reversal).reduce((sum, row) => sum + row.amountCents, 0);
}

async function nextSequence(tx: BillingTransaction, field: "invoiceSequence" | "paymentSequence") {
  const sequence = await tx.commercialBillingSequence.upsert({
    where: { id: "GLOBAL" },
    create: { id: "GLOBAL", [field]: 1001 },
    update: { [field]: { increment: 1 } },
    select: { [field]: true },
  });
  return sequence[field];
}

async function idempotent<T extends { id: string }>(
  operationKey: string,
  commandType: string,
  actor: AppSession,
  work: (tx: BillingTransaction) => Promise<T>,
): Promise<T> {
  if (!operationKey.trim() || operationKey.length > 180) {
    throw new SubscriptionBillingError("SUBSCRIPTION_BILLING_OPERATION_KEY_INVALID");
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        const existing = await tx.commercialCommand.findUnique({ where: { operationKey } });
        if (existing && existing.commandType !== commandType) {
          throw new SubscriptionBillingError("SUBSCRIPTION_BILLING_OPERATION_KEY_CONFLICT");
        }
        if (existing?.resultId) {
          const replayResult = await replayBillingCommand(tx, commandType, existing.resultId);
          if (replayResult) return replayResult as unknown as T;
        }
        if (!existing) await tx.commercialCommand.create({ data: { operationKey, commandType, actorUserId: actor.userId } });
        const result = await work(tx);
        await tx.commercialCommand.update({ where: { operationKey }, data: { resultId: result.id } });
        return result;
      }, SERIALIZABLE);
    } catch (error) {
      if (attempt < 3 && isRetryable(error)) continue;
      throw error;
    }
  }
  throw new SubscriptionBillingError("SUBSCRIPTION_BILLING_RETRY_EXHAUSTED");
}

async function replayBillingCommand(tx: BillingTransaction, commandType: string, resultId: string) {
  if (["CREATE_SUBSCRIPTION_INVOICE", "ISSUE_SUBSCRIPTION_INVOICE", "VOID_SUBSCRIPTION_INVOICE", "RENEW_SUBSCRIPTION_WITH_INVOICE"].includes(commandType)) {
    return tx.subscriptionInvoice.findUnique({ where: { id: resultId }, include: { lines: true, payments: { include: { reversal: true } } } });
  }
  if (["RECORD_SUBSCRIPTION_PAYMENT", "REVERSE_SUBSCRIPTION_PAYMENT"].includes(commandType)) {
    return tx.subscriptionPayment.findUnique({ where: { id: resultId }, include: { reversal: true } });
  }
  return null;
}

async function audit(tx: BillingTransaction, actor: AppSession, action: string, entityType: string, entityId: string, after: Prisma.InputJsonValue, subscriptionId: string) {
  await tx.commercialAuditEvent.create({ data: { action, entityType, entityId, actorUserId: actor.userId, subscriptionId, after } });
}

async function assertReadScope(actor: AppSession, invoice: { businessId: string | null; groupId: string | null }, businessId?: string, groupId?: string) {
  if (actor.role === "PLATFORM_ADMIN") return;
  if (businessId && invoice.businessId === businessId && actor.activeBusinessId === businessId) return;
  if (groupId && invoice.groupId === groupId && await prisma.businessGroupUser.count({ where: { userId: actor.userId, groupId, role: "GROUP_OWNER", status: "ACTIVE" } }) === 1) return;
  throw new SubscriptionBillingError("SUBSCRIPTION_BILLING_SCOPE_DENIED");
}

function priceFor(version: { monthlyListPriceCents: number | null; annualListPriceCents: number | null }, interval: CommercialBillingInterval) {
  return interval === "MONTHLY" ? version.monthlyListPriceCents : version.annualListPriceCents;
}

function validateInvoiceDates(input: CreateSubscriptionInvoiceInput) {
  for (const date of [input.billingPeriodStart, input.billingPeriodEnd, input.invoiceDate, input.dueDate]) {
    if (!Number.isFinite(date.getTime())) throw new SubscriptionBillingError("SUBSCRIPTION_INVOICE_DATE_INVALID");
  }
  if (input.billingPeriodEnd <= input.billingPeriodStart || input.dueDate < input.invoiceDate) {
    throw new SubscriptionBillingError("SUBSCRIPTION_INVOICE_PERIOD_INVALID");
  }
}

function positiveCents(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new SubscriptionBillingError("SUBSCRIPTION_PAYMENT_AMOUNT_INVALID");
}

function requiredReason(value: string) {
  const result = value.trim();
  if (result.length < 5 || result.length > 500) throw new SubscriptionBillingError("SUBSCRIPTION_BILLING_REASON_INVALID");
  return result;
}

function clean(value: string | null | undefined, max: number) {
  const result = value?.trim();
  return result ? result.slice(0, max) : null;
}

function dateOnly(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addInterval(value: Date, interval: CommercialBillingInterval) {
  const result = new Date(value);
  if (interval === "MONTHLY") result.setUTCMonth(result.getUTCMonth() + 1);
  else result.setUTCFullYear(result.getUTCFullYear() + 1);
  return result;
}

function addDays(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

async function lock(tx: BillingTransaction, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

function isRetryable(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "P2034";
}
