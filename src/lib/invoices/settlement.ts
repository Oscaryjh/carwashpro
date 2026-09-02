export type InvoiceSettlementStatus =
  | "UNPAID"
  | "PARTIAL"
  | "PAID"
  | "REFUNDED";

export type InvoiceRefundLifecycle = "NONE" | "PARTIAL" | "FULL";

type AppliedPayment = {
  amount: unknown;
  method?: string | null;
  status?: string | null;
  refunds?: Array<{ amount: unknown }>;
};

export type InvoiceSettlement = {
  outstandingCents: number;
  refundLifecycle: InvoiceRefundLifecycle;
  refundedCents: number;
  settledObligationCents: number;
  status: InvoiceSettlementStatus;
};

/**
 * Resolves the contractual settlement independently from refund cash flow.
 * A refund reduces net collections, but it does not recreate customer debt.
 */
export function resolveInvoiceSettlement(input: {
  refundedCents: number;
  settledObligationCents: number;
  totalCents: number;
}): InvoiceSettlement {
  assertCents(input.totalCents, "Invoice total");
  assertCents(input.settledObligationCents, "Settled obligation");
  assertCents(input.refundedCents, "Refunded amount");

  const settledObligationCents = Math.min(
    input.totalCents,
    input.settledObligationCents,
  );
  const outstandingCents = Math.max(
    input.totalCents - settledObligationCents,
    0,
  );
  const refundLifecycle = resolveRefundLifecycle(
    settledObligationCents,
    input.refundedCents,
  );
  const status = resolveSettlementStatus({
    outstandingCents,
    refundLifecycle,
    settledObligationCents,
    totalCents: input.totalCents,
  });

  return {
    outstandingCents,
    refundLifecycle,
    refundedCents: input.refundedCents,
    settledObligationCents,
    status,
  };
}

export function resolveInvoiceSettlementFromPayments(input: {
  payments: AppliedPayment[];
  totalCents: number;
}) {
  const activePayments = input.payments.filter(
    (payment) => payment.status !== "VOID",
  );
  const grossAppliedCents = activePayments.reduce(
    (sum, payment) => sum + toCents(payment.amount),
    0,
  );
  const refundedCents = activePayments.reduce(
    (sum, payment) =>
      sum +
      (payment.refunds ?? []).reduce(
        (refundSum, refund) => refundSum + toCents(refund.amount),
        0,
      ),
    0,
  );

  return resolveInvoiceSettlement({
    refundedCents,
    settledObligationCents: grossAppliedCents,
    totalCents: input.totalCents,
  });
}

function resolveRefundLifecycle(
  settledObligationCents: number,
  refundedCents: number,
): InvoiceRefundLifecycle {
  if (refundedCents <= 0) return "NONE";
  return settledObligationCents > 0 && refundedCents >= settledObligationCents
    ? "FULL"
    : "PARTIAL";
}

function resolveSettlementStatus(input: {
  outstandingCents: number;
  refundLifecycle: InvoiceRefundLifecycle;
  settledObligationCents: number;
  totalCents: number;
}): InvoiceSettlementStatus {
  if (
    input.outstandingCents === 0 &&
    input.totalCents > 0 &&
    input.refundLifecycle === "FULL"
  ) {
    return "REFUNDED";
  }
  if (input.settledObligationCents <= 0) return "UNPAID";
  return input.outstandingCents > 0 ? "PARTIAL" : "PAID";
}

function toCents(value: unknown) {
  return Math.round(Number(value ?? 0) * 100);
}

function assertCents(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer number of cents.`);
  }
}
