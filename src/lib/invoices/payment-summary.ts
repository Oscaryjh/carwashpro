type InvoicePaymentLike = {
  amount: unknown;
  method: string;
  status?: string | null;
};

export function getInvoicePaymentSummary(payments: InvoicePaymentLike[]) {
  const activePayments = payments.filter((payment) => payment.status !== "VOID");
  const packageVoucherAmount = sumPayments(
    activePayments.filter((payment) => payment.method === "PACKAGE"),
  );
  const cashPaidAmount = sumPayments(
    activePayments.filter((payment) => payment.method !== "PACKAGE"),
  );

  return {
    cashPaidAmount,
    hasPackageVoucher: packageVoucherAmount > 0,
    packageVoucherAmount,
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
  return payments.reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);
}
