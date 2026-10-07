import { Prisma, type CustomerPackage, type CustomerPackageServiceBalance } from "@prisma/client";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { activityInputSchema, activityEntryKey, derivePackageChange, serviceChangesSchema, type ActivityInput } from "./activity-types";

type Tx = Prisma.TransactionClient;
type Snapshot = { tx: Tx; cp: CustomerPackage; balances: CustomerPackageServiceBalance[]; sequence: number; occurredAt: Date; appended: boolean };
const captures = new WeakMap<object, Snapshot>();
const pending = new WeakMap<object, Set<string>>();
export interface PackageActivityCapture { readonly customerPackageId: string; readonly businessId: string }
const idSchema = z.object({ businessId: z.string().uuid(), customerPackageId: z.string().uuid() }).strict();
function requireTransaction(tx: Tx) {
  if ("$transaction" in tx) throw new Error("Package activity requires a transaction client.");
}
function requireFact(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Package activity: ${message}`);
}

/** Capture immediately before EACH mutation, even inside one command.
 * Caller owns the transaction and all financial mutations. No balance writes occur here.
 * Multi-entitlement commands must lock entitlement IDs in sorted order before capture.
 */
export async function captureCustomerPackageActivityBefore(tx: Tx, input: PackageActivityCapture): Promise<PackageActivityCapture> {
  requireTransaction(tx);
  const ids = idSchema.parse(input);
  const active = pending.get(tx) ?? new Set<string>();
  requireFact(!active.has(ids.customerPackageId), "previous capture has not been appended");
  const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM customer_packages WHERE id = ${ids.customerPackageId}::uuid AND business_id = ${ids.businessId}::uuid FOR UPDATE`);
  requireFact(locked.length === 1, "entitlement not in Business");
  await tx.$queryRaw(Prisma.sql`SELECT id FROM customer_package_service_balances WHERE customer_package_id = ${ids.customerPackageId}::uuid ORDER BY id FOR UPDATE`);
  const cp = await tx.customerPackage.findUniqueOrThrow({ where: { id: ids.customerPackageId } });
  const balances = await tx.customerPackageServiceBalance.findMany({ where: { customerPackageId: cp.id }, orderBy: { id: "asc" } });
  requireFact(balances.every(b => b.businessId === cp.businessId), "balance tenant mismatch");
  const services = await tx.service.count({ where: { businessId: cp.businessId, id: { in: balances.map(b => b.serviceId) } } });
  requireFact(services === new Set(balances.map(b => b.serviceId)).size, "service tenant mismatch");
  const last = await tx.customerPackageActivity.findFirst({ where: { customerPackageId: cp.id }, orderBy: { sequence: "desc" }, select: { sequence: true } });
  const token = Object.freeze({ ...ids });
  captures.set(token, { tx, cp, balances, sequence: (last?.sequence ?? 0) + 1, occurredAt: new Date(), appended: false });
  active.add(cp.id); pending.set(tx, active);
  return token;
}

async function validateSources(tx: Tx, snapshot: Snapshot, input: ActivityInput, delta: number) {
  const { cp } = snapshot, businessId = cp.businessId;
  const operation = await tx.financialOperation.findFirst({ where: { id: input.financialOperationId, businessId, actorUserId: input.actorUserId } });
  requireFact(operation, "operation/actor scope mismatch");
  requireFact(operation.state === "IN_PROGRESS" || snapshot.appended, "new fact requires an in-progress operation");
  const expectedOperations = input.sourceType === "INVOICE_VOID" ? ["INVOICE_VOID"] : input.sourceType === "PAYMENT_REFUND" ? ["PAYMENT_REFUND"] : ["CASHIER_CHECKOUT", "PACKAGE_PURCHASE", "PACKAGE_REDEMPTION", "SALON_APPOINTMENT_PAYMENT"];
  requireFact(expectedOperations.includes(operation.operationType), "operation source mismatch");
  const actor = await tx.user.findUnique({ where: { id: input.actorUserId }, select: { businessId: true } });
  requireFact(actor, "actor missing");
  if (actor.businessId !== businessId) {
    const grant = await tx.businessGroupUser.findFirst({ where: {
      userId: input.actorUserId, status: "ACTIVE", revokedAt: null,
      group: { status: "ACTIVE", members: { some: { businessId, status: "ACTIVE", removedAt: null } } },
      OR: [{ accessScope: "ALL_GROUP_BUSINESSES" }, { businessAccesses: { some: { businessId } } }],
    } });
    requireFact(grant, "actor not authorized in Business");
  }
  if (input.branchId) requireFact(await tx.branch.findFirst({ where: { id: input.branchId, businessId } }), "branch tenant mismatch");
  requireFact(input.invoiceId, "invoice source required");
  const invoice = await tx.invoice.findFirst({ where: { id: input.invoiceId, businessId }, include: { items: { select: { id: true, businessId: true, customerPackageId: true, kind: true, serviceId: true } } } });
  requireFact(invoice, "invoice tenant mismatch");
  requireFact(!invoice.customerId || invoice.customerId === cp.customerId, "invoice customer mismatch");
  // Legacy invoices may omit customerId. Their persisted parent still supplies
  // authoritative customer identity even if the caller omits the optional ref.
  if (invoice.appointmentId) {
    requireFact(await tx.appointment.findFirst({ where: { id: invoice.appointmentId, businessId, customerId: cp.customerId } }), "appointment customer mismatch");
  }
  if (invoice.workOrderId) {
    requireFact(await tx.workOrder.findFirst({ where: { id: invoice.workOrderId, businessId, customerId: cp.customerId } }), "work order customer mismatch");
  }
  requireFact(invoice.customerId || invoice.appointmentId || invoice.workOrderId, "invoice customer identity missing");
  if (input.appointmentId) {
    const visit = await tx.appointment.findFirst({ where: { id: input.appointmentId, businessId } });
    requireFact(visit && invoice.appointmentId === visit.id && visit.customerId === cp.customerId, "appointment source mismatch");
  }
  if (input.workOrderId) {
    const order = await tx.workOrder.findFirst({ where: { id: input.workOrderId, businessId } });
    requireFact(order && invoice.workOrderId === order.id && order.customerId === cp.customerId, "work order source mismatch");
  }
  if (input.assignedStaffId) {
    requireFact(await tx.user.findFirst({ where: { id: input.assignedStaffId, businessId } }), "staff tenant mismatch");
    const visitId = input.appointmentId ?? invoice.appointmentId;
    requireFact(visitId && await tx.appointment.findFirst({ where: { id: visitId, businessId, assignedStaffId: input.assignedStaffId, customerId: cp.customerId } }), "assigned staff lacks service source");
  }
  if (input.customerPackageServiceBalanceId) {
    const balance = snapshot.balances.find(b => b.id === input.customerPackageServiceBalanceId);
    requireFact(balance && balance.serviceId === input.serviceId, "balance/service source mismatch");
  } else requireFact(!input.serviceId, "service identity requires balance identity");
  const purchase = input.eventType === "PURCHASED" || input.eventType === "CANCELLED";
  const mapping = input.purchaseSourceMapping;
  if (mapping) requireFact(purchase, "purchase mapping only belongs to purchase or cancellation");
  if (input.eventType === "PURCHASED") {
    if (mapping) requireFact(mapping.customerPackageId === cp.id && mapping.invoiceId === invoice.id
      && (!input.invoiceItemId || input.invoiceItemId === mapping.invoiceItemId), "purchase source mapping mismatch");
    const itemId = mapping?.invoiceItemId ?? input.invoiceItemId;
    const item = itemId ? invoice.items.find(i => i.id === itemId)
      : invoice.items.find(i => i.businessId === businessId && i.customerPackageId === cp.id && i.kind === "PACKAGE_PURCHASE");
    requireFact(item && item.businessId === businessId, "purchase source item missing or foreign");
    requireFact(item.kind === "PACKAGE_PURCHASE" || (item.kind === null && mapping), "purchase source kind requires exact writer mapping");
    // Old POS has a known purchase line but no item-level CP FK. Require the
    // independent original external Payment relation as well as its invoice parent.
    const parentPurchase = item.customerPackageId === null && invoice.customerPackageId === cp.id && !!mapping
      && !!input.paymentId && await tx.payment.findFirst({ where: { id: input.paymentId, businessId,
        invoiceId: invoice.id, customerPackageId: cp.id, status: "ACTIVE", packageUses: 0, method: { not: "PACKAGE" } } });
    requireFact(item.customerPackageId === cp.id || parentPurchase, "purchase source entitlement mismatch");
  } else if (input.eventType === "CANCELLED") {
    if (mapping) requireFact(mapping.customerPackageId === cp.id && mapping.invoiceId === invoice.id
      && (!input.invoiceItemId || input.invoiceItemId === mapping.invoiceItemId), "purchase source mapping mismatch");
    const purchased = await tx.customerPackageActivity.findFirst({ where: {
      businessId, customerPackageId: cp.id, eventType: "PURCHASED",
    } });
    // A prior fact is evidence, not permission to cancel, and contradictory refs
    // must never be replaced by a caller's fallback mapping.
    if (purchased) {
      requireFact(purchased.sourceType === "CHECKOUT" && (!purchased.invoiceId || purchased.invoiceId === invoice.id), "purchase invoice source mismatch");
      requireFact(purchased.invoiceId || mapping, "nullable purchase source requires exact mapping");
      requireFact(!purchased.invoiceItemId || ((!mapping || mapping.invoiceItemId === purchased.invoiceItemId)
        && (!input.invoiceItemId || input.invoiceItemId === purchased.invoiceItemId)), "purchase item source conflict");
      const refs = purchased.additionalSourceRefs == null ? null
        : activityInputSchema.shape.additionalSourceRefs.parse(purchased.additionalSourceRefs);
      const ids = [...new Set([purchased.paymentId, ...(refs?.paymentIds ?? [])].filter((id): id is string => !!id))];
      requireFact(!purchased.paymentRefundId && !(refs?.refundIds.length), "purchase refund source conflict");
      const sources = await tx.payment.findMany({ where: { id: { in: ids }, businessId } });
      requireFact(sources.length === ids.length && sources.every(payment => payment.invoiceId === invoice.id
        || (!payment.invoiceId && ((!!invoice.workOrderId && payment.workOrderId === invoice.workOrderId)
          || (!!invoice.appointmentId && payment.appointmentId === invoice.appointmentId)))), "purchase payment source mismatch");
      requireFact(!purchased.appointmentId || purchased.appointmentId === invoice.appointmentId, "purchase appointment source mismatch");
      requireFact(!purchased.workOrderId || purchased.workOrderId === invoice.workOrderId, "purchase work order source mismatch");
    }
    const itemId = purchased?.invoiceItemId ?? mapping?.invoiceItemId ?? input.invoiceItemId;
    const item = itemId ? invoice.items.find(i => i.id === itemId)
      : invoice.items.find(i => i.businessId === businessId && i.customerPackageId === cp.id && i.kind === "PACKAGE_PURCHASE");
    if (!item && !itemId && !mapping && !purchased) {
      // Old POS has no persisted line identity. Do not select or invent a line.
      // A contradictory explicit line cannot be bypassed by payment evidence.
      requireFact(!invoice.items.some(i => i.customerPackageId === cp.id)
        && invoice.items.filter(i => i.customerPackageId === null).every(i => i.businessId === businessId && i.kind === null),
      "legacy purchase evidence conflicts with explicit line identity/kind");
      const sources = await tx.payment.findMany({ where: { businessId, invoiceId: invoice.id,
        customerPackageId: cp.id, status: "ACTIVE", method: { not: "PACKAGE" }, packageUses: 0,
        customerPackageServiceBalanceId: null }, orderBy: { id: "asc" } });
      requireFact(sources.length > 0, "legacy purchase Payment evidence missing");
      // Every candidate already proves this exact CP; ordering selects only the
      // display/source pointer, never an entitlement or invoice-item identity.
      const source = sources.find(p => p.id === input.paymentId) ?? sources[0];
      input.additionalSourceRefs = {
        paymentIds: [...new Set([...(input.additionalSourceRefs?.paymentIds ?? []),
          ...(input.paymentId ? [input.paymentId] : []), ...sources.map(p => p.id)])],
        refundIds: [...new Set([...(input.additionalSourceRefs?.refundIds ?? []),
          ...(input.paymentRefundId ? [input.paymentRefundId] : [])])],
      };
      input.paymentId = source.id;
      input.invoiceItemId = null;
    } else {
      requireFact(item && item.businessId === businessId, "purchase evidence item missing or foreign");
      requireFact(item.kind === "PACKAGE_PURCHASE" || (item.kind === null && (mapping || purchased?.invoiceItemId)), "purchase kind lacks authoritative evidence");
      const parentPurchase = item.customerPackageId === null && invoice.customerPackageId === cp.id
        && !!(mapping || purchased?.invoiceItemId) && await tx.payment.findFirst({ where: {
          businessId, invoiceId: invoice.id, customerPackageId: cp.id, packageUses: 0, method: { not: "PACKAGE" },
        } });
      requireFact(item.customerPackageId === cp.id || parentPurchase, "purchase entitlement source mismatch");
      input.invoiceItemId = item.id;
    }
  }
  if (input.invoiceItemId) {
    const item = invoice.items.find(i => i.id === input.invoiceItemId);
    requireFact(item, "invoice item mismatch");
    requireFact(item.businessId === businessId, "invoice item tenant mismatch");
    if (purchase) { /* Exact purchase evidence was validated above. */ }
    else {
      requireFact(item.kind !== "PRODUCT" && item.kind !== "PACKAGE_PURCHASE", "service item mismatch");
      if (input.serviceId) requireFact(item.serviceId === input.serviceId, "service item mismatch");
    }
    // An item can be covered by multiple entitlements: never equate its single CP ref to all coverage.
  }
  if (input.eventType === "PURCHASED") requireFact(invoice.status === "PAID", "purchase is not paid");
  const paymentIds = [...new Set([input.paymentId, ...(input.additionalSourceRefs?.paymentIds ?? [])].filter((id): id is string => !!id))];
  const refundIds = [...new Set([input.paymentRefundId, ...(input.additionalSourceRefs?.refundIds ?? [])].filter((id): id is string => !!id))];
  const payments = await tx.payment.findMany({ where: { id: { in: paymentIds }, businessId } });
  requireFact(payments.length === paymentIds.length, "payment tenant mismatch");
  for (const payment of payments) {
    const linked = payment.invoiceId === invoice.id || (!payment.invoiceId && ((!!invoice.workOrderId && payment.workOrderId === invoice.workOrderId) || (!!invoice.appointmentId && payment.appointmentId === invoice.appointmentId)));
    requireFact(linked, "payment invoice source mismatch");
    if (!purchase) requireFact(payment.method === "PACKAGE" && payment.customerPackageId === cp.id && payment.packageUses > 0 && payment.customerPackageServiceBalanceId === (input.customerPackageServiceBalanceId ?? null), "payment entitlement mismatch");
  }
  if (!purchase) {
    requireFact(input.paymentId, "package payment required");
    requireFact(paymentIds.length === 1, "one consumption/restoration source per event");
    const payment = payments[0];
    if (input.eventType === "USED") requireFact(-delta === payment.packageUses && payment.status === "ACTIVE", "consumed uses do not match payment");
    if (input.eventType === "RESTORED") requireFact(delta <= payment.packageUses && (input.requestedUses == null || input.requestedUses === payment.packageUses), "restored uses exceed source");
    if (input.sourceType === "INVOICE_VOID") requireFact(payment.status === "VOID", "original payment is not void");
  }
  const refunds = await tx.paymentRefund.findMany({ where: { id: { in: refundIds }, businessId }, include: { payment: true } });
  requireFact(refunds.length === refundIds.length, "refund tenant mismatch");
  for (const refund of refunds) {
    const linked = refund.invoiceId === invoice.id || (!refund.invoiceId && !!invoice.workOrderId && refund.workOrderId === invoice.workOrderId);
    requireFact(linked && refund.payment.businessId === businessId, "refund invoice source mismatch");
    if (purchase) {
      requireFact(refund.payment.method !== "PACKAGE", "purchase refund cannot restore usage");
      requireFact(refund.payment.invoiceId === invoice.id || (!refund.payment.invoiceId && !!invoice.workOrderId && refund.payment.workOrderId === invoice.workOrderId), "refund payment source mismatch");
    } else requireFact(refund.paymentId === input.paymentId && refund.packageUsesRestored >= delta, "refund restoration mismatch");
  }
  if (input.sourceType === "PAYMENT_REFUND") requireFact(refunds.length > 0, "refund source required");
  else requireFact(refundIds.length === 0, "unexpected refund source");
  if (input.originalUseActivityId) {
    requireFact(input.eventType === "RESTORED", "original use only belongs to restore");
    requireFact(await tx.customerPackageActivity.findFirst({ where: { id: input.originalUseActivityId, businessId, customerPackageId: cp.id, eventType: "USED", paymentId: input.paymentId, customerPackageServiceBalanceId: input.customerPackageServiceBalanceId ?? null } }), "original use source mismatch");
  }
}

/** Appends observed facts only. It neither mutates balances nor starts a transaction. */
export async function appendCustomerPackageActivity(tx: Tx, capture: PackageActivityCapture, raw: ActivityInput) {
  requireTransaction(tx);
  const snapshot = captures.get(capture);
  requireFact(snapshot && snapshot.tx === tx, "capture must belong to this transaction");
  const input = activityInputSchema.parse(raw);
  const { cp, balances } = snapshot;
  const after = await tx.customerPackage.findUniqueOrThrow({ where: { id: cp.id } });
  requireFact(after.businessId === cp.businessId && after.customerId === cp.customerId && after.packageId === cp.packageId, "entitlement identity changed");
  const change = derivePackageChange(input.eventType, cp, after);
  const afterBalances = await tx.customerPackageServiceBalance.findMany({ where: { customerPackageId: cp.id }, orderBy: { id: "asc" } });
  requireFact(afterBalances.length === balances.length, "service balance identity changed");
  const allChanges = balances.map((before, index) => {
    const next = afterBalances[index];
    requireFact(next.id === before.id && next.businessId === before.businessId && next.serviceId === before.serviceId && next.totalUses === before.totalUses, "service balance identity/capacity changed");
    return { balanceId: before.id, serviceId: before.serviceId, totalUses: before.totalUses, remainingBefore: before.remainingUses, remainingAfter: next.remainingUses, usesDelta: next.remainingUses - before.remainingUses };
  });
  const fullSnapshot = input.eventType === "PURCHASED" || input.eventType === "CANCELLED";
  const serviceChanges = serviceChangesSchema.parse(fullSnapshot ? allChanges : allChanges.filter(row => row.usesDelta !== 0));
  if (!fullSnapshot) requireFact(serviceChanges.every(row => row.balanceId === input.customerPackageServiceBalanceId), "unrelated service balance changed");
  for (const row of serviceChanges) requireFact(input.eventType === "USED" ? row.usesDelta < 0 : input.eventType === "CANCELLED" ? row.usesDelta <= 0 : row.usesDelta >= 0, "service change direction mismatch");
  if (input.eventType === "PURCHASED") requireFact(cp.status === "PENDING_PAYMENT" && after.status === "ACTIVE", "purchase activation transition mismatch");
  if (input.eventType === "USED") requireFact(cp.status === "ACTIVE" && ["ACTIVE", "USED_UP"].includes(after.status), "use transition mismatch");
  if (input.eventType === "RESTORED") requireFact(["ACTIVE", "USED_UP"].includes(cp.status) && after.status === "ACTIVE", "restore transition mismatch");
  if (input.eventType === "CANCELLED") requireFact(cp.status === "ACTIVE" && after.status === "CANCELLED" && after.remainingUses === 0 && afterBalances.every(b => b.remainingUses === 0), "cancel transition mismatch");
  await validateSources(tx, snapshot, input, change.usesDelta);
  const latest = await tx.customerPackageActivity.findFirst({ where: { customerPackageId: cp.id }, orderBy: { sequence: "desc" }, select: { sequence: true } });
  requireFact((latest?.sequence ?? 0) === snapshot.sequence - (snapshot.appended ? 0 : 1), "capture sequence is stale");
  const refs = input.additionalSourceRefs;
  const data = {
    businessId: cp.businessId, customerPackageId: cp.id, sequence: snapshot.sequence,
    eventType: input.eventType, sourceType: input.sourceType, ...change,
    requestedUses: input.requestedUses ?? null,
    customerPackageServiceBalanceId: input.customerPackageServiceBalanceId ?? null, serviceId: input.serviceId ?? null, serviceChanges,
    invoiceId: input.invoiceId ?? null, invoiceItemId: input.invoiceItemId ?? input.purchaseSourceMapping?.invoiceItemId ?? null,
    paymentId: input.paymentId ?? null, paymentRefundId: input.paymentRefundId ?? null,
    appointmentId: input.appointmentId ?? null, workOrderId: input.workOrderId ?? null,
    originalUseActivityId: input.originalUseActivityId ?? null,
    additionalSourceRefs: refs ? { paymentIds: [...refs.paymentIds].sort(), refundIds: [...refs.refundIds].sort() } : null,
    financialOperationId: input.financialOperationId, entryKey: activityEntryKey({ ...input, customerPackageId: cp.id }),
    actorUserId: input.actorUserId, assignedStaffId: input.assignedStaffId ?? null, branchId: input.branchId ?? null,
    reason: input.reason ?? null, occurredAt: input.occurredAt ?? snapshot.occurredAt, contractVersion: 1,
  };
  const existing = await tx.customerPackageActivity.findUnique({ where: { businessId_financialOperationId_entryKey: { businessId: data.businessId, financialOperationId: data.financialOperationId, entryKey: data.entryKey } } });
  if (existing) {
    const comparable = Object.fromEntries(Object.keys(data).map(key => [key, existing[key as keyof typeof existing]]));
    requireFact(isDeepStrictEqual(comparable, data), "idempotency payload conflict");
    return existing;
  }
  requireFact(!snapshot.appended, "capture already consumed");
  const result = await tx.customerPackageActivity.create({ data: { ...data, additionalSourceRefs: data.additionalSourceRefs ?? Prisma.DbNull } });
  snapshot.appended = true;
  pending.get(tx)?.delete(cp.id);
  return result;
}
