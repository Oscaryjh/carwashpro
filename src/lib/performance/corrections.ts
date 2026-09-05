import { FinancialOperationType, type PrismaClient } from "@prisma/client";
import { runFinancialOperation } from "@/lib/financial-idempotency";
import { prisma } from "@/lib/prisma";
import { performanceEnabled } from "./input";
import { allocateSales, apportion, integer, type SaleShare } from "./money";
import { addAllocation, createAttribution, netEventRecipients } from "./service";
import { assertPerformanceActor, type PerformanceActor } from "./scope";

type CorrectionInput = PerformanceActor & {
  invoiceId: string;
  component: "SALE" | "TIP";
  paymentId?: string;
  shares: SaleShare[];
  expectedRevision: number;
  reason: string;
  operationKey: string;
};

/** SALE scope = this invoice and linked receipts/refunds; TIP scope = one original payment only. */
export async function correctPerformanceAttribution(input: CorrectionInput, database: PrismaClient = prisma) {
  if (!performanceEnabled()) throw new Error("Performance phase 1 is not enabled.");
  if (input.reason.trim().length < 5 || input.reason.length > 500) throw new Error("An explicit correction reason is required.");
  if ((input.component === "TIP" && (!input.paymentId || input.shares.length > 1)) || (input.component === "SALE" && input.paymentId)) throw new Error("Specify a separate, explicit sales or tip correction scope.");
  // Re-check before the idempotent replay fast path as well as inside the write transaction.
  await assertPerformanceActor(database, input, input.component === "SALE" ? "PERFORMANCE_CORRECT_SALES" : "PERFORMANCE_CORRECT_TIP");
  const { operationKey, ...payload } = input;
  return runFinancialOperation({ ...input, operationKey,
    operationType: input.component === "SALE" ? FinancialOperationType.PERFORMANCE_SALES_CORRECTION : FinancialOperationType.PERFORMANCE_TIP_CORRECTION,
    payload,
    execute: async (tx) => {
      await assertPerformanceActor(tx, input, input.component === "SALE" ? "PERFORMANCE_CORRECT_SALES" : "PERFORMANCE_CORRECT_TIP");
      const invoice = await tx.invoice.findFirstOrThrow({ where: { id: input.invoiceId, businessId: input.businessId, branchId: input.branchId } });
      const events = await tx.performanceReceipt.findMany({ where: { invoiceId: invoice.id, businessId: input.businessId, branchId: input.branchId,
        ...(input.paymentId ? { paymentId: input.paymentId } : {}), kind: { in: ["PAYMENT", "REFUND"] } },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }], include: { payment: { include: { performanceIssues: true, refunds: { include: { performanceReceipt: true } } } } } });
      const payments = events.filter((event) => event.kind === "PAYMENT");
      if (!payments.length) throw new Error("No captured payment exists in this correction scope.");
      if (events.some((event) => event.unresolvedCents !== 0n || event.payment.status === "VOID" || event.payment.performanceIssues.length || event.payment.refunds.some((refund) => !refund.performanceReceipt || refund.performanceReceipt.unresolvedCents !== 0n))) throw new Error("Review unresolved or voided source evidence before correcting attribution.");
      const attribution = await createAttribution(tx, input, { invoiceId: invoice.id, paymentId: input.paymentId,
        component: input.component, shares: input.shares, expectedRevision: input.expectedRevision, reason: input.reason.trim(), historical: true,
        at: payments[0].occurredAt, evidence: { operationKey, scope: input.component === "SALE" ? "INVOICE_SALES_ONLY" : "PAYMENT_TIP_ONLY", sourcePaymentIds: payments.map((event) => event.paymentId), teamDeltaCents: 0, commissionAndPayrollUnchanged: true } });
      let changedEntries = 0;
      const deltas: { eventId: string; recipientKey: string; amountCents: number }[] = [];
      for (const payment of payments) {
        const amount = integer(Number(input.component === "SALE" ? payment.salesCents : payment.tipCents));
        const target = allocateSales(amount, input.shares);
        const outstanding = { ...target };
        const targets = [{ event: payment, amounts: target }];
        for (const refund of events.filter((event) => event.kind === "REFUND" && event.paymentId === payment.paymentId)) {
          const refundAmount = -integer(Number(input.component === "SALE" ? refund.salesCents : refund.tipCents));
          const allocation = apportion(refundAmount, Object.entries(outstanding).map(([key, weight]) => ({ key, weight })));
          for (const [key, value] of Object.entries(allocation)) outstanding[key] -= value;
          targets.push({ event: refund, amounts: Object.fromEntries(Object.entries(allocation).map(([key, value]) => [key, -value])) });
        }
        for (const { event, amounts } of targets) {
          const previous = await netEventRecipients(tx, event.id, input.component);
          const delta = Object.fromEntries([...new Set([...Object.keys(previous), ...Object.keys(amounts)])].map((key) => [key, integer((amounts[key] ?? 0) - (previous[key] ?? 0))]));
          if (Object.values(delta).reduce((a, b) => a + b, 0) !== 0) throw new Error("A correction must not change team performance.");
          await addAllocation(tx, event, attribution, input.component, delta);
          for (const [recipientKey, amountCents] of Object.entries(delta)) if (amountCents) { deltas.push({ eventId: event.id, recipientKey, amountCents }); changedEntries++; }
        }
      }
      return { attributionId: attribution.id, revision: attribution.revision, component: input.component, changedEntries, teamDeltaCents: 0, deltas };
    },
  }, database);
}
