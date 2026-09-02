type InvoicePaymentLike = {
  amount: unknown;
  method: string;
  status?: string | null;
  refunds?: Array<{
    amount: unknown;
  }>;
};

export function getInvoicePaymentSummary(payments: InvoicePaymentLike[]) {
  const activePayments = payments.filter((payment) => payment.status !== "VOID");
  const grossPaidAmount = sumPayments(activePayments);
  const totalRefundedAmount = sumRefunds(activePayments);
  const monetaryPayments = activePayments.filter(
    (payment) => payment.method !== "PACKAGE",
  );
  const grossMonetaryCollectionAmount = sumPayments(monetaryPayments);
  const monetaryRefundedAmount = sumRefunds(monetaryPayments);
  const netCollectedAmount = Math.max(
    0,
    grossMonetaryCollectionAmount - monetaryRefundedAmount,
  );
  const packageVoucherAmount = sumNetPayments(
    activePayments.filter((payment) => payment.method === "PACKAGE"),
  );
  const cashPaidAmount = sumNetPayments(
    activePayments.filter((payment) => payment.method !== "PACKAGE"),
  );

  return {
    cashPaidAmount,
    grossMonetaryCollectionAmount,
    grossPaidAmount,
    hasPackageVoucher: packageVoucherAmount > 0,
    monetaryRefundedAmount,
    netCollectedAmount,
    packageVoucherAmount,
    totalRefundedAmount,
  };
}

export function formatInvoicePaymentStatus(
  invoiceStatus: string,
  summary: ReturnType<typeof getInvoicePaymentSummary>,
) {
  if (!summary.hasPackageVoucher) {
    return invoiceStatus.toLowerCase().replaceAll("_", " ");
  }

  return summary.cashPaidAmount > 0
    ? "paid by package voucher and cash"
    : "paid by package voucher";
}

function sumPayments(payments: InvoicePaymentLike[]) {
  return fromCents(
    payments.reduce((sum, payment) => sum + toCents(payment.amount), 0),
  );
}

function sumRefunds(payments: InvoicePaymentLike[]) {
  return fromCents(
    payments.reduce(
      (sum, payment) =>
        sum +
        (payment.refunds ?? []).reduce(
          (refundSum, refund) => refundSum + toCents(refund.amount),
          0,
        ),
      0,
    ),
  );
}

function sumNetPayments(payments: InvoicePaymentLike[]) {
  return fromCents(
    payments.reduce((sum, payment) => {
      const refundedCents = (payment.refunds ?? []).reduce(
        (refundSum, refund) => refundSum + toCents(refund.amount),
        0,
      );

      return sum + Math.max(0, toCents(payment.amount) - refundedCents);
    }, 0),
  );
}

function toCents(value: unknown) {
  return Math.round(Number(value ?? 0) * 100);
}

function fromCents(value: number) {
  return value / 100;
}
