import { classifyPaymentFact, classifyRefundFact, type Method, type Purpose } from "./payments/fact-classification";

export const FINANCIAL_METRIC_DEFINITION_VERSION = 2;

export const FINANCIAL_METRIC_DEFINITIONS = {
  grossSalesCents: {
    eventDate: "invoice.issuedAt",
    formula:
      "invoice total - tips - package vouchers + invoice total discount",
    label: "Gross sales",
  },
  discountsCents: {
    eventDate: "invoice.issuedAt",
    formula: "invoice total discount (includes loyalty discount)",
    label: "Discounts",
  },
  refundsCents: {
    eventDate: "refund.refundedAt",
    formula: "sales refunds; top-up reversals and package-use restorations are excluded",
    label: "Refunds",
  },
  netSalesCents: {
    eventDate: "invoice.issuedAt and refund.refundedAt",
    formula: "recognized sales after discounts - monetary refunds",
    label: "Net sales",
  },
  grossCollectionsCents: {
    eventDate: "payment.paidAt",
    formula: "active external payments before external refunds",
    label: "Gross collections",
  },
  netCollectionsCents: {
    eventDate: "payment.paidAt and refund.refundedAt",
    formula: "gross collections - external refunds",
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
  /** Canonical Invoice.discountAmount: manual/catalog plus loyalty, already combined. */
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
  purpose?: Purpose;
  method?: Method;
};

export type FinancialMetricRefund = {
  amountCents: number;
  isPackage: boolean;
  method?: Method;
  originalPayment?: { purpose: Purpose; method: Method };
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
  externalRefundsCents: number;
  topUpPrincipalCents: number;
  topUpReversalsCents: number;
  walletRedemptionsCents: number;
  walletRefundsCents: number;
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

  // Loyalty is a breakdown of the saved total discount, not another discount.
  const discountsCents = invoice.discountCents;
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
  let topUpPrincipalCents = 0, walletRedemptionsCents = 0;
  const grossCollectionsCents = input.payments.reduce((sum, payment) => {
    assertCents(payment.amountCents, "Payment amount");
    const fact = classifyPaymentFact({ purpose: payment.purpose ?? "LEGACY", method: payment.method ?? (payment.isPackage ? "PACKAGE" : "CASH") });
    if (fact.classification === "WALLET_TOP_UP") topUpPrincipalCents += payment.amountCents;
    if (fact.walletMovement === "DEBIT") walletRedemptionsCents += payment.amountCents;
    return sum + (fact.externalCollection ? payment.amountCents : 0);
  }, 0);
  let externalRefundsCents = 0, topUpReversalsCents = 0, walletRefundsCents = 0;
  const refundsCents = input.refunds.reduce((sum, refund) => {
    assertCents(refund.amountCents, "Refund amount");
    const method = refund.method ?? (refund.isPackage ? "PACKAGE" : "CASH");
    const fact = classifyRefundFact({ originalPayment: refund.originalPayment ?? { purpose: "LEGACY", method }, refundMethod: method });
    if (fact.externalRefund) externalRefundsCents += refund.amountCents;
    if (fact.topUpReversal) topUpReversalsCents += refund.amountCents;
    if (fact.walletRefund) walletRefundsCents += refund.amountCents;
    return sum + (fact.salesRefund ? refund.amountCents : 0);
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
    netCollectionsCents: grossCollectionsCents - externalRefundsCents,
    netSalesCents,
    refundsCents,
    transactionCount,
    externalRefundsCents,
    topUpPrincipalCents,
    topUpReversalsCents,
    walletRedemptionsCents,
    walletRefundsCents,
  };
}

function assertCents(value: number, label: string) {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be an integer number of cents.`);
  }
}

export type WalletLedgerMetricFact = {
  type: "TOP_UP_PAID" | "TOP_UP_BONUS" | "REDEMPTION" | "REFUND" | "REVERSAL" | "ADJUSTMENT";
  originalType?: WalletLedgerMetricFact["type"];
  paidCents: number;
  bonusCents: number;
};

/** Wallet activity only: never add these totals to invoice sales or external receipts. */
export function calculateWalletLedgerMetrics(facts: readonly WalletLedgerMetricFact[]) {
  const total = {
    topUpPrincipalCents: 0, topUpBonusCents: 0,
    redemptionPaidCents: 0, redemptionBonusCents: 0,
    refundPaidCents: 0, refundBonusCents: 0,
    reversedPrincipalCents: 0, reversedBonusCents: 0,
    voidRestoredPaidCents: 0, voidRestoredBonusCents: 0,
  };
  for (const fact of facts) {
    assertCents(fact.paidCents, "Wallet paid delta");
    assertCents(fact.bonusCents, "Wallet bonus delta");
    const negative = fact.type === "REDEMPTION" || (fact.type === "REVERSAL" &&
      (fact.originalType === "TOP_UP_PAID" || fact.originalType === "TOP_UP_BONUS"));
    const paid = negative ? -fact.paidCents : fact.paidCents;
    const bonus = negative ? -fact.bonusCents : fact.bonusCents;
    if (paid < 0 || bonus < 0) throw new Error("Wallet ledger sign is inconsistent.");
    switch (fact.type) {
      case "TOP_UP_PAID":
        if (bonus !== 0) throw new Error("Unexpected bonus in principal source.");
        total.topUpPrincipalCents += paid; break;
      case "TOP_UP_BONUS":
        if (paid !== 0) throw new Error("Unexpected principal in bonus source.");
        total.topUpBonusCents += bonus; break;
      case "REDEMPTION":
        total.redemptionPaidCents += paid; total.redemptionBonusCents += bonus; break;
      case "REFUND":
        total.refundPaidCents += paid; total.refundBonusCents += bonus; break;
      case "REVERSAL":
        if (fact.originalType === "REDEMPTION") {
          total.voidRestoredPaidCents += paid; total.voidRestoredBonusCents += bonus;
        } else if (fact.originalType === "TOP_UP_PAID" || fact.originalType === "TOP_UP_BONUS") {
          total.reversedPrincipalCents += paid; total.reversedBonusCents += bonus;
        } else throw new Error("Wallet reversal source is unavailable.");
        break;
      default: throw new Error("Unsupported wallet ledger fact requires reconciliation.");
    }
  }
  return total;
}

export type WalletLedgerMetrics = ReturnType<typeof calculateWalletLedgerMetrics>;
