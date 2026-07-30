export const FINANCIAL_METRIC_DEFINITION_VERSION = 1;

export const FINANCIAL_METRIC_DEFINITIONS = {
  grossSalesCents: {
    eventDate: "invoice.issuedAt",
    formula:
      "invoice total - tips - package vouchers + invoice and loyalty discounts",
    label: "Gross sales",
  },
  discountsCents: {
    eventDate: "invoice.issuedAt",
    formula: "invoice discount + loyalty discount",
    label: "Discounts",
  },
  refundsCents: {
    eventDate: "refund.refundedAt",
    formula: "monetary refunds; package-use restorations are excluded",
    label: "Refunds",
  },
  netSalesCents: {
    eventDate: "invoice.issuedAt and refund.refundedAt",
    formula: "recognized sales after discounts - monetary refunds",
    label: "Net sales",
  },
  grossCollectionsCents: {
    eventDate: "payment.paidAt",
    formula: "active monetary payments before refunds",
    label: "Gross collections",
  },
  netCollectionsCents: {
    eventDate: "payment.paidAt and refund.refundedAt",
    formula: "gross collections - monetary refunds",
    label: "Net collections",
  },
  outstandingCents: {
    eventDate: "calculation time",
    formula: "current balance of unpaid and partially paid invoices in scope",
    label: "Outstanding",
  },
} as const;

export type FinancialMetricInvoice = {
  balanceCents?: number;
  discountCents: number;
  loyaltyDiscountCents: number;
  packageVoucherCents: number;
  status?: string;
  tipCents: number;
  totalCents: number;
};

export type FinancialMetricPayment = {
  amountCents: number;
  isPackage: boolean;
};

export type FinancialMetricRefund = {
  amountCents: number;
  isPackage: boolean;
};

export type InvoiceFinancialMetrics = {
  discountsCents: number;
  grossSalesCents: number;
  outstandingCents: number;
  packageVoucherCents: number;
  recognizedSalesCents: number;
  tipsCents: number;
};

export type FinancialMetrics = InvoiceFinancialMetrics & {
  averageTransactionValueCents: number | null;
  grossCollectionsCents: number;
  netCollectionsCents: number;
  netSalesCents: number;
  refundsCents: number;
  transactionCount: number;
};

export function calculateInvoiceFinancialMetrics(
  invoice: FinancialMetricInvoice,
): InvoiceFinancialMetrics {
  assertCents(invoice.totalCents, "Invoice total");
  assertCents(invoice.tipCents, "Invoice tip");
  assertCents(invoice.packageVoucherCents, "Package voucher");
  assertCents(invoice.discountCents, "Invoice discount");
  assertCents(invoice.loyaltyDiscountCents, "Loyalty discount");
  assertCents(invoice.balanceCents ?? 0, "Invoice balance");

  const discountsCents =
    invoice.discountCents + invoice.loyaltyDiscountCents;
  const recognizedSalesCents =
    invoice.totalCents - invoice.tipCents - invoice.packageVoucherCents;

  return {
    discountsCents,
    grossSalesCents: recognizedSalesCents + discountsCents,
    outstandingCents:
      invoice.status === "UNPAID" || invoice.status === "PARTIAL"
        ? invoice.balanceCents ?? 0
        : 0,
    packageVoucherCents: invoice.packageVoucherCents,
    recognizedSalesCents,
    tipsCents: invoice.tipCents,
  };
}

export function calculateFinancialMetrics(input: {
  invoices: FinancialMetricInvoice[];
  payments: FinancialMetricPayment[];
  refunds: FinancialMetricRefund[];
}): FinancialMetrics {
  const invoiceMetrics = input.invoices.map(calculateInvoiceFinancialMetrics);
  const invoiceTotals = invoiceMetrics.reduce<InvoiceFinancialMetrics>(
    (total, invoice) => ({
      discountsCents: total.discountsCents + invoice.discountsCents,
      grossSalesCents: total.grossSalesCents + invoice.grossSalesCents,
      outstandingCents: total.outstandingCents + invoice.outstandingCents,
      packageVoucherCents:
        total.packageVoucherCents + invoice.packageVoucherCents,
      recognizedSalesCents:
        total.recognizedSalesCents + invoice.recognizedSalesCents,
      tipsCents: total.tipsCents + invoice.tipsCents,
    }),
    {
      discountsCents: 0,
      grossSalesCents: 0,
      outstandingCents: 0,
      packageVoucherCents: 0,
      recognizedSalesCents: 0,
      tipsCents: 0,
    },
  );
  const grossCollectionsCents = input.payments.reduce((sum, payment) => {
    assertCents(payment.amountCents, "Payment amount");
    return sum + (payment.isPackage ? 0 : payment.amountCents);
  }, 0);
  const refundsCents = input.refunds.reduce((sum, refund) => {
    assertCents(refund.amountCents, "Refund amount");
    return sum + (refund.isPackage ? 0 : refund.amountCents);
  }, 0);
  const transactionCount = input.invoices.length;
  const netSalesCents = invoiceTotals.recognizedSalesCents - refundsCents;

  return {
    ...invoiceTotals,
    averageTransactionValueCents:
      transactionCount > 0
        ? Math.round(netSalesCents / transactionCount)
        : null,
    grossCollectionsCents,
    netCollectionsCents: grossCollectionsCents - refundsCents,
    netSalesCents,
    refundsCents,
    transactionCount,
  };
}

function assertCents(value: number, label: string) {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be an integer number of cents.`);
  }
}
