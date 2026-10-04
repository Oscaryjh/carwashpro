import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { planVoidLoyalty } from "./void-plan";

/** Internal only: execute inside the existing serializable INVOICE_VOID
 * FinancialOperation, after its unchanged invoice/refund eligibility guards. */
export async function compensateInvoiceVoidLoyalty(tx: Prisma.TransactionClient, input: {
  businessId: string; invoiceId: string; paymentIds: string[]; operationKey: string; actorUserId: string;
}) {
  const invoice = await tx.invoice.findFirstOrThrow({ where: { id: input.invoiceId, businessId: input.businessId }, include: {
    workOrder: { select: { businessId: true, customerId: true } },
    appointment: { select: { businessId: true, customerId: true } },
  } });
  const payments = await tx.payment.findMany({ where: { id: { in: input.paymentIds }, businessId: input.businessId, status: "ACTIVE" } });
  if (payments.length !== new Set(input.paymentIds).size || payments.some(payment =>
    payment.invoiceId !== invoice.id &&
    !(invoice.workOrderId && payment.workOrderId === invoice.workOrderId) &&
    !(invoice.appointmentId && payment.appointmentId === invoice.appointmentId))) {
    throw new Error("Loyalty VOID payment source mismatch.");
  }
  const facts = await tx.loyaltyTransaction.findMany({
    where: { businessId: input.businessId, paymentId: { in: input.paymentIds } }, orderBy: { id: "asc" },
  });
  if (!facts.length) {
    if (invoice.loyaltyPointsRedeemed > 0) throw new Error("Loyalty VOID redemption evidence is missing.");
    return;
  }
  const membershipId = facts[0].membershipId;
  // Legacy POS work-order invoices keep the customer on the work order.
  const customerId = invoice.customerId ?? invoice.workOrder?.customerId ?? invoice.appointment?.customerId;
  if (!customerId || [invoice.workOrder,invoice.appointment].some(source => source &&
      (source.businessId !== input.businessId || source.customerId !== customerId)) ||
      facts.some(fact => fact.membershipId !== membershipId || fact.customerId !== customerId)) {
    throw new Error("Loyalty VOID membership source mismatch.");
  }
  const operation = await tx.financialOperation.findFirstOrThrow({ where: {
    businessId: input.businessId, operationKey: input.operationKey, operationType: "INVOICE_VOID",
    state: "IN_PROGRESS", actorUserId: input.actorUserId,
  } });
  if (await tx.auditLog.count({ where: { businessId: input.businessId, entityId: invoice.id, action: "LOYALTY_INVOICE_VOID_COMPENSATED" } })) {
    throw new Error("Loyalty VOID was already compensated.");
  }
  const membership = await tx.customerMembership.findFirstOrThrow({ where: {
    id: membershipId, businessId: input.businessId, customerId,
  } });
  const plan = planVoidLoyalty(membership.pointsBalance, facts);
  if (invoice.loyaltyPointsRedeemed > 0 && plan.restored !== invoice.loyaltyPointsRedeemed) {
    throw new Error("Loyalty VOID redemption evidence mismatch.");
  }
  // Serializable transaction + compare-and-update: concurrent checkout/VOID
  // retries from fresh membership facts, never overwrites a newer balance.
  const updated = await tx.customerMembership.updateMany({
    where: { id: membership.id, businessId: input.businessId, pointsBalance: membership.pointsBalance },
    data: { pointsBalance: plan.balance, lifetimePointsReversed: { increment: plan.reversed } },
  });
  if (updated.count !== 1) throw new Error("Loyalty balance changed. Retry the original VOID request.");
  const transactionIds: string[] = [];
  for (const row of plan.rows) {
    const transaction = await tx.loyaltyTransaction.create({ data: {
      businessId: input.businessId, branchId: invoice.branchId, membershipId: membership.id,
      customerId, paymentId: row.paymentId, createdById: input.actorUserId,
      type: row.type, points: row.points,
      description: row.type === "REDEMPTION_REFUND" ? "Points restored after invoice void" : "Points reversed after invoice void",
    } });
    transactionIds.push(transaction.id);
  }
  // LoyaltyTransaction has no operation/invoice columns. Existing Audit linkage
  // preserves original source IDs and the VOID operation without a schema change.
  // The existing audit sanitizer retains at most 50 array entries. Batch the
  // linkage rather than silently dropping evidence for multi-payment invoices.
  for (let start = 0; start < transactionIds.length; start += 50) await writeAuditLog({ businessId: input.businessId, branchId: invoice.branchId,
    action: "LOYALTY_INVOICE_VOID_COMPENSATED", entityType: "Invoice", entityId: invoice.id,
    summary: "Invoice void loyalty compensation", metadata: {
      version: 1, operationId: operation.id, invoiceId: invoice.id, actorUserId: input.actorUserId,
      membershipId: membership.id, customerId,
      batchIndex: start / 50, batchCount: Math.ceil(transactionIds.length / 50),
      sourceTransactionIds: facts.slice(start,start+50).map(fact => fact.id), transactionIds: transactionIds.slice(start,start+50),
      restored: plan.restored, reversed: plan.reversed, beforeBalance: membership.pointsBalance, afterBalance: plan.balance,
    },
  }, tx);
}
