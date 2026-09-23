import { Prisma, type PerformanceReceipt } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { performanceEnabled, type PerformanceInput } from "./input";
import { allocateSales, apportion, cents, emptyComponents, integer, PERFORMANCE_POLICY_VERSION, receiveComponents, subtractComponents, sum, validateShares, type Components, type SaleShare } from "./money";
import { assertPerformanceActor, validatePerformanceRecipients, type PerformanceActor } from "./scope";
import { localPerformanceDate, performanceTimezone } from "./time";

type Tx = Prisma.TransactionClient;
type Attribution = Prisma.PerformanceAttributionGetPayload<{ include: { shares: true } }>;
export type CaptureOptions = {
  businessId: string; actorUserId: string; input: PerformanceInput | null;
  exact?: Components;
  purpose?: "SALE" | "DEPOSIT_UNVERIFIED_DATE" | "PACKAGE_REDEMPTION";
  pendingPaymentIds?: string[];
};

export function eventComponents(event: Pick<PerformanceReceipt, "salesCents" | "taxCents" | "tipCents" | "unresolvedCents">, sign = 1): Components {
  return { sales: integer(Number(event.salesCents) * sign), tax: integer(Number(event.taxCents) * sign), tip: integer(Number(event.tipCents) * sign), unresolved: integer(Number(event.unresolvedCents) * sign) };
}

export async function latestAttribution(tx: Tx, businessId: string, scopeKey: string) {
  return tx.performanceAttribution.findFirst({ where: { businessId, scopeKey }, orderBy: { revision: "desc" }, include: { shares: true } });
}

export async function createAttribution(tx: Tx, context: PerformanceActor, value: {
  invoiceId: string; paymentId?: string; component: "SALE" | "TIP"; shares: SaleShare[];
  reason: string; evidence: Prisma.InputJsonValue; at: Date; historical?: boolean; expectedRevision?: number;
}) {
  validateShares(value.shares);
  if (value.component === "TIP" && (value.shares.length > 1 || !value.paymentId)) throw new Error("A tip must have one recipient and an explicit payment scope.");
  const scopeKey = `${value.component}:${value.paymentId ?? value.invoiceId}`;
  const previous = await latestAttribution(tx, context.businessId, scopeKey);
  if (value.expectedRevision !== undefined && (previous?.revision ?? 0) !== value.expectedRevision) throw new Error("Performance attribution changed. Refresh the correction preview.");
  const members = await validatePerformanceRecipients(tx, context, value.shares, value.at, value.historical);
  const attribution = await tx.performanceAttribution.create({ data: {
    businessId: context.businessId, branchId: context.branchId, actorUserId: context.actorUserId,
    invoiceId: value.invoiceId, paymentId: value.paymentId, component: value.component, scopeKey,
    revision: (previous?.revision ?? 0) + 1, reason: value.reason, evidence: value.evidence,
    shares: { create: value.shares.map((share) => {
      const member = members.find((item) => item.id === share.membershipId)!;
      return { businessId: context.businessId, ...share, employeeName: member.fullName, employeeCode: member.employeeCode };
    }) },
  }, include: { shares: true } });
  const actor = await tx.user.findUniqueOrThrow({ where: { id: context.actorUserId } });
  await writeAuditLog({ businessId: context.businessId, branchId: context.branchId,
    actor: { userId: actor.id, name: actor.name ?? "User", email: actor.email ?? "" }, action: "PERFORMANCE_ATTRIBUTION_VERSION", entityType: "PerformanceAttribution", entityId: attribution.id,
    summary: value.reason, before: previous, after: attribution,
  }, tx);
  return attribution;
}

async function getSaleAttribution(tx: Tx, context: PerformanceActor, invoiceId: string, options: CaptureOptions, at: Date) {
  const existing = await latestAttribution(tx, context.businessId, `SALE:${invoiceId}`);
  if (existing) {
    if (options.input?.sales) {
      const signature = (shares: SaleShare[]) => JSON.stringify(shares.map(({ membershipId, basisPoints }) => ({ membershipId, basisPoints })).sort((a, b) => a.membershipId.localeCompare(b.membershipId)));
      if (signature(options.input.sales) !== signature(existing.shares)) throw new Error("This order already has sales attribution. Use the protected sales correction service.");
    }
    return existing;
  }
  const shares = options.input?.sales ?? [];
  await requireAssignedOrException(tx, context, shares.length > 0, options.input);
  return createAttribution(tx, context, { invoiceId, component: "SALE", shares, at,
    reason: shares.length ? "Confirmed sales attribution at checkout" : options.input?.unassignedReason ?? "LEGACY_CLIENT_NO_PERFORMANCE_FIELD",
    evidence: { source: options.input ? "CHECKOUT_V1" : "LEGACY_CLIENT", independentFromCashierServiceAndCommission: true },
  });
}

async function requireAssignedOrException(tx: Tx, context: PerformanceActor, assigned: boolean, input: PerformanceInput | null) {
  if (assigned) return;
  if (!input) {
    if (process.env.TETAMU_PERFORMANCE_LEGACY_COMPAT === "false") throw new Error("Legacy unassigned checkout is disabled. Update the client or use an authorized explicit exception.");
    return;
  }
  if (!input.unassignedReason) throw new Error("Select the performance employee or give an authorized unassigned reason.");
  await assertPerformanceActor(tx, context, "PERFORMANCE_UNASSIGNED");
}

async function addAllocation(tx: Tx, event: PerformanceReceipt, attribution: Attribution, component: "SALE" | "TIP", amounts: Record<string, number>) {
  for (const [recipientKey, amountCents] of Object.entries(amounts)) {
    if (!amountCents) continue;
    await tx.performanceContribution.create({ data: { businessId: event.businessId, eventId: event.id, attributionId: attribution.id,
      component, membershipId: recipientKey === "UNASSIGNED" ? null : recipientKey, recipientKey, amountCents: BigInt(integer(amountCents)) } });
  }
}

async function receiptData(tx: Tx, paymentId: string, businessId: string) {
  const payment = await tx.payment.findFirstOrThrow({ where: { id: paymentId, businessId },
    include: { invoice: true, business: { select: { timezone: true } }, branch: { select: { businessId: true } } } });
  if (payment.branch && payment.branch.businessId !== businessId) throw new Error("Performance payment branch scope mismatch.");
  if (payment.invoice && (payment.invoice.businessId !== businessId || payment.invoice.branchId !== payment.branchId)) throw new Error("Performance invoice scope mismatch.");
  return payment;
}

export async function capturePerformancePayment(tx: Tx, paymentId: string, options: CaptureOptions) {
  if (!performanceEnabled()) return null;
  const existing = await tx.performanceReceipt.findUnique({ where: { businessId_sourceKey: { businessId: options.businessId, sourceKey: `PAYMENT:${paymentId}` } } });
  if (existing) return existing;
  const payment = await receiptData(tx, paymentId, options.businessId);
  if (payment.branchId) await assertPerformanceActor(tx, { businessId: options.businessId, branchId: payment.branchId, actorUserId: options.actorUserId });
  const amount = cents(payment.amount);
  const timezone = performanceTimezone(payment.business.timezone);
  let parts: Components = { ...emptyComponents(), unresolved: amount };
  let quality = "REVIEW_COMPONENTS";
  let evidence: Prisma.InputJsonObject = { purpose: options.purpose ?? "SALE", method: "UNRESOLVED", policy: PERFORMANCE_POLICY_VERSION };
  const invoice = payment.invoice;
  const isPackage = payment.method === "PACKAGE";
  if (invoice && payment.branchId) {
    const context = { businessId: options.businessId, branchId: payment.branchId, actorUserId: options.actorUserId };
    await assertPerformanceActor(tx, context);
    const invoicePool = { sales: cents(invoice.total) - cents(invoice.taxAmount) - cents(invoice.tipAmount), tax: cents(invoice.taxAmount), tip: cents(invoice.tipAmount), unresolved: 0 };
    if (Object.values(invoicePool).some((value) => value < 0)) throw new Error("Invalid invoice performance components.");
    const allPayments = await tx.payment.findMany({ where: { businessId: options.businessId, status: "ACTIVE", OR: [{ invoiceId: invoice.id }, ...(invoice.workOrderId ? [{ workOrderId: invoice.workOrderId }] : [])] }, orderBy: [{ paidAt: "asc" }, { id: "asc" }], include: { performanceReceipts: { where: { kind: { in: ["PAYMENT", "PACKAGE"] } } } } });
    // Consume trustworthy prior snapshots first. Virtual old receipts are never persisted/backfilled.
    let remaining = invoicePool;
    let legacyBasis = false;
    const previous = allPayments.filter((row) => row.id !== payment.id && (!options.pendingPaymentIds?.includes(row.id) || row.performanceReceipts.length > 0));
    for (const row of previous.filter((row) => row.method === "PACKAGE")) {
      const captured = row.performanceReceipts[0];
      const coverage = captured ? eventComponents(captured) : receiveComponents(cents(row.amount), { ...remaining, tip: 0 });
      remaining = subtractComponents(remaining, coverage);
      if (!captured) legacyBasis = true;
    }
    for (const row of previous.filter((row) => row.method !== "PACKAGE")) {
      const captured = row.performanceReceipts[0];
      if (captured && !captured.unresolvedCents) remaining = subtractComponents(remaining, eventComponents(captured));
      else { remaining = subtractComponents(remaining, receiveComponents(cents(row.amount), remaining)); legacyBasis = true; }
    }
    parts = receiveComponents(amount, isPackage ? { ...remaining, tip: 0 } : remaining, options.exact);
    quality = isPackage ? "EXCLUDED_PACKAGE" : legacyBasis ? "REVIEW_LEGACY_BASIS" : options.purpose === "DEPOSIT_UNVERIFIED_DATE" ? "REVIEW_DEPOSIT_DATE" : "VERIFIED";
    evidence = { ...evidence, method: options.exact ? "EXACT_SOURCE_COMPONENTS" : "REMAINING_COMPONENT_PRO_RATA_V1", remaining, invoiceTotalCents: cents(invoice.total), legacyBasis };
  }
  const event = await tx.performanceReceipt.create({ data: { businessId: payment.businessId, branchId: payment.branchId, invoiceId: payment.invoiceId, paymentId: payment.id,
    sourceKey: `PAYMENT:${payment.id}`, kind: isPackage ? "PACKAGE" : "PAYMENT", quality,
    rawCents: BigInt(amount), salesCents: BigInt(parts.sales), taxCents: BigInt(parts.tax), tipCents: BigInt(parts.tip), unresolvedCents: BigInt(parts.unresolved),
    occurredAt: payment.paidAt, timezone, localDate: localPerformanceDate(payment.paidAt, timezone), policyVersion: PERFORMANCE_POLICY_VERSION, evidence } });
  if (!isPackage && invoice && payment.branchId && (parts.sales || parts.tip)) {
    const context = { businessId: payment.businessId, branchId: payment.branchId, actorUserId: options.actorUserId };
    if (parts.sales) {
      const attribution = await getSaleAttribution(tx, context, invoice.id, options, payment.paidAt);
      await addAllocation(tx, event, attribution, "SALE", allocateSales(parts.sales, attribution.shares));
    }
    if (parts.tip) {
      const member = options.input?.tipMembershipId;
      await requireAssignedOrException(tx, context, !!member, options.input);
      const attribution = await createAttribution(tx, context, { invoiceId: invoice.id, paymentId: payment.id, component: "TIP", shares: member ? [{ membershipId: member, basisPoints: 10_000 }] : [], at: payment.paidAt,
        reason: member ? "Confirmed this receipt's tip recipient (not a payout)" : options.input?.unassignedReason ?? "LEGACY_CLIENT_NO_TIP_RECIPIENT", evidence: { independentTipRecipient: true, payoutChanged: false } });
      await addAllocation(tx, event, attribution, "TIP", { [member ?? "UNASSIGNED"]: parts.tip });
    }
  }
  return event;
}

export async function netEventRecipients(tx: Tx, eventId: string, component: "SALE" | "TIP") {
  const entries = await tx.performanceContribution.findMany({ where: { eventId, component } });
  return entries.reduce<Record<string, number>>((totals, entry) => {
    totals[entry.recipientKey] = integer((totals[entry.recipientKey] ?? 0) + Number(entry.amountCents));
    return totals;
  }, {});
}

export async function capturePerformanceRefund(tx: Tx, refundId: string, options: Omit<CaptureOptions, "input">) {
  if (!performanceEnabled()) return null;
  const refund = await tx.paymentRefund.findFirstOrThrow({ where: { id: refundId, businessId: options.businessId } });
  const existing = await tx.performanceReceipt.findUnique({ where: { businessId_sourceKey: { businessId: options.businessId, sourceKey: `REFUND:${refund.id}` } } });
  if (existing) return existing;
  const payment = await receiptData(tx, refund.paymentId, options.businessId);
  if (payment.branchId) await assertPerformanceActor(tx, { businessId: options.businessId, branchId: payment.branchId, actorUserId: options.actorUserId });
  if (payment.branchId !== refund.branchId) throw new Error("Performance refund branch scope mismatch.");
  const original = await tx.performanceReceipt.findUnique({ where: { businessId_sourceKey: { businessId: options.businessId, sourceKey: `PAYMENT:${payment.id}` } } });
  const older = await tx.paymentRefund.findMany({ where: { paymentId: payment.id, businessId: options.businessId, id: { not: refund.id } }, include: { performanceReceipt: true } });
  const amount = cents(refund.amount);
  let remaining = original ? eventComponents(original) : { ...emptyComponents(), unresolved: cents(payment.amount) };
  let verifiedBasis = !!original && !original.unresolvedCents;
  if (older.some((row) => !row.performanceReceipt || row.performanceReceipt.unresolvedCents !== 0n)) verifiedBasis = false;
  if (!verifiedBasis) {
    remaining = { ...emptyComponents(), unresolved: cents(payment.amount) - sum(older.map((row) => cents(row.amount))) };
  } else {
    for (const row of older) remaining = subtractComponents(remaining, eventComponents(row.performanceReceipt!, -1));
  }
  const parts = receiveComponents(amount, remaining, options.exact);
  const timezone = performanceTimezone(payment.business.timezone);
  const noncash = payment.method === "PACKAGE";
  const event = await tx.performanceReceipt.create({ data: { businessId: refund.businessId, branchId: payment.branchId, invoiceId: payment.invoiceId, paymentId: payment.id, refundId: refund.id,
    sourceKey: `REFUND:${refund.id}`, kind: noncash ? "RESTORE" : "REFUND", quality: noncash ? "EXCLUDED_PACKAGE" : verifiedBasis ? original!.quality : "REVIEW_LEGACY_BASIS",
    rawCents: BigInt(-amount), salesCents: BigInt(-parts.sales), taxCents: BigInt(-parts.tax), tipCents: BigInt(-parts.tip), unresolvedCents: BigInt(-parts.unresolved),
    occurredAt: refund.refundedAt, timezone, localDate: localPerformanceDate(refund.refundedAt, timezone), policyVersion: PERFORMANCE_POLICY_VERSION,
    evidence: { method: options.exact ? "EXACT_REFUND_COMPONENTS" : "REMAINING_REFUND_PRO_RATA_V1", originalEventId: original?.id ?? null, remaining, legacyBasis: !verifiedBasis } } });
  if (!noncash && original && verifiedBasis) {
    for (const component of ["SALE", "TIP"] as const) {
      const amountPart = component === "SALE" ? parts.sales : parts.tip;
      if (!amountPart) continue;
      const remainingRecipients = await netEventRecipients(tx, original.id, component);
      for (const row of older) {
        if (!row.performanceReceipt) continue;
        for (const [key, value] of Object.entries(await netEventRecipients(tx, row.performanceReceipt.id, component))) remainingRecipients[key] = integer((remainingRecipients[key] ?? 0) + value);
      }
      const attribution = await latestAttribution(tx, options.businessId, `${component}:${component === "SALE" ? payment.invoiceId : payment.id}`);
      if (!attribution) throw new Error("Missing original performance attribution.");
      const allocated = apportion(amountPart, Object.entries(remainingRecipients).map(([key, weight]) => ({ key, weight })));
      await addAllocation(tx, event, attribution, component, Object.fromEntries(Object.entries(allocated).map(([key, value]) => [key, -value])));
    }
  }
  return event;
}

export async function capturePerformanceVoid(tx: Tx, context: { businessId: string; invoiceId: string; actorUserId: string; reason: string }) {
  if (!performanceEnabled()) return;
  const invoice = await tx.invoice.findFirstOrThrow({ where: { id: context.invoiceId, businessId: context.businessId } });
  const payments = await tx.payment.findMany({ where: { businessId: context.businessId, status: "VOID", OR: [{ invoiceId: invoice.id }, ...(invoice.workOrderId ? [{ workOrderId: invoice.workOrderId }] : []), ...(invoice.appointmentId ? [{ appointmentId: invoice.appointmentId }] : [])] } });
  for (const payment of payments) {
    await tx.performanceSourceIssue.createMany({ data: [{
      businessId: context.businessId, paymentId: payment.id, code: "VOID_WITHOUT_REFUND_EVIDENCE", reason: context.reason,
      evidence: { actorUserId: context.actorUserId, invoiceId: invoice.id, rawCents: cents(payment.amount), voidedAt: payment.voidedAt?.toISOString() ?? null, noRefundFabricated: true },
    }], skipDuplicates: true });
  }
}

export { addAllocation };

/** Called once at the end of each existing financial transaction, before it commits. */
export async function capturePerformanceCheckout(tx: Tx, options: CaptureOptions & { paymentIds: string[]; depositPaymentIds?: string[] }) {
  if (!performanceEnabled()) return;
  const payments = await tx.payment.findMany({ where: { id: { in: options.paymentIds }, businessId: options.businessId },
    include: { customerPackageServiceBalance: true, invoice: { include: { items: true } } } });
  if (payments.length !== new Set(options.paymentIds).size) throw new Error("Performance payment scope mismatch.");
  const ordered = options.paymentIds.map((id) => payments.find((payment) => payment.id === id)!);
  ordered.sort((a, b) => Number(b.method === "PACKAGE") - Number(a.method === "PACKAGE"));
  for (const payment of ordered) {
    let exact: Components | undefined;
    if (payment.method === "PACKAGE" && payment.customerPackageServiceBalance && payment.invoice) {
      const item = payment.invoice.items.find((line) => line.serviceId === payment.customerPackageServiceBalance!.serviceId && line.customerPackageId === payment.customerPackageId);
      if (item) {
        const tax = integer(new Prisma.Decimal(cents(item.taxAmount)).div(item.quantity).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber());
        exact = { sales: cents(payment.amount) - tax, tax, tip: 0, unresolved: 0 };
      }
    }
    await capturePerformancePayment(tx, payment.id, { ...options, pendingPaymentIds: options.paymentIds, exact,
      purpose: payment.method === "PACKAGE" ? "PACKAGE_REDEMPTION" : options.depositPaymentIds?.includes(payment.id) ? "DEPOSIT_UNVERIFIED_DATE" : "SALE" });
  }
}
