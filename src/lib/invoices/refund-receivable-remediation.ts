import { resolveInvoiceSettlementFromPayments } from "./settlement";

export type RefundReceivableCategory =
  | "NO_REFUND"
  | "FULLY_PAID_PARTIAL_REFUND"
  | "FULLY_PAID_FULL_REFUND"
  | "PARTIAL_PAID_REFUND";

type RefundReceivablePayment = {
  amount: unknown;
  id: string;
  status?: string | null;
  refunds?: Array<{ amount: unknown; id?: string }>;
};

export function evaluateRefundReceivableRecord(input: {
  currentBalanceCents: number;
  currentPaidAmountCents: number;
  currentStatus: string;
  payments: RefundReceivablePayment[];
  totalCents: number;
}) {
  const settlement = resolveInvoiceSettlementFromPayments({
    payments: input.payments,
    totalCents: input.totalCents,
  });
  const activePayments = input.payments.filter(
    (payment) => payment.status !== "VOID",
  );
  const refundCount = activePayments.reduce(
    (count, payment) => count + (payment.refunds?.length ?? 0),
    0,
  );
  const category = classify({
    refundCount,
    settledObligationCents: settlement.settledObligationCents,
    refundLifecycle: settlement.refundLifecycle,
    totalCents: input.totalCents,
  });

  return {
    canonical: settlement,
    category,
    complex: activePayments.length > 1 || refundCount > 1,
    differsFromCanonical:
      input.currentPaidAmountCents !== settlement.settledObligationCents ||
      input.currentBalanceCents !== settlement.outstandingCents ||
      input.currentStatus !== settlement.status,
    paymentCount: activePayments.length,
    refundCount,
  };
}

function classify(input: {
  refundCount: number;
  refundLifecycle: "NONE" | "PARTIAL" | "FULL";
  settledObligationCents: number;
  totalCents: number;
}): RefundReceivableCategory {
  if (input.refundCount === 0) return "NO_REFUND";
  if (input.settledObligationCents < input.totalCents) {
    return "PARTIAL_PAID_REFUND";
  }
  return input.refundLifecycle === "FULL"
    ? "FULLY_PAID_FULL_REFUND"
    : "FULLY_PAID_PARTIAL_REFUND";
}
