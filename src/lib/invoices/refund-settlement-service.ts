import type { Prisma } from "@prisma/client";
import { fromCents } from "@/lib/validation/pos";
import { resolveInvoiceSettlementFromPayments } from "@/lib/invoices/settlement";

/**
 * Reconciles the contractual invoice/work-order settlement after a refund.
 * Refunds are cash-flow movements; they do not reverse the customer's
 * already-settled contractual obligation.
 */
export async function reconcileInvoiceSettlementAfterRefund(
  tx: Prisma.TransactionClient,
  input: {
    businessId: string;
    invoiceId: string;
    totalCents: number;
    workOrderId?: string | null;
  },
) {
  const payments = await tx.payment.findMany({
    where: {
      businessId: input.businessId,
      status: "ACTIVE",
      OR: [
        { invoiceId: input.invoiceId },
        ...(input.workOrderId ? [{ workOrderId: input.workOrderId }] : []),
      ],
    },
    select: {
      amount: true,
      refunds: { select: { amount: true } },
      status: true,
    },
  });
  const settlement = resolveInvoiceSettlementFromPayments({
    payments,
    totalCents: input.totalCents,
  });
  const persistedSettlement = {
    balance: fromCents(settlement.outstandingCents),
    paidAmount: fromCents(settlement.settledObligationCents),
  };

  if (input.workOrderId) {
    await tx.workOrder.update({
      where: { id: input.workOrderId },
      data: {
        ...persistedSettlement,
        paymentStatus: settlement.status,
      },
    });
  }

  await tx.invoice.update({
    where: { id: input.invoiceId },
    data: {
      ...persistedSettlement,
      status: settlement.status,
    },
  });

  return settlement;
}
