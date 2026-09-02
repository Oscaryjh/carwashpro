import type { PaymentMethod, Prisma } from "@prisma/client";
import {
  getBusinessDayRange,
  type BusinessDayRange,
} from "@/lib/business-day";
import { addDaysToDateValue } from "@/lib/business-time";
import { calculateFinancialMetrics } from "@/lib/financial-metrics";
import { prisma } from "@/lib/prisma";
import { toCents } from "@/lib/validation/pos";

const DEFAULT_PAYMENT_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  CARD: "Card",
  DUITNOW: "DuitNow",
  EWALLET: "E-wallet",
  BANK_TRANSFER: "Bank transfer",
  FOREIGN_CURRENCY: "Foreign currency",
  CRYPTO: "Crypto asset",
  PACKAGE: "Package use",
};

type ReadDatabase = Pick<
  Prisma.TransactionClient,
  "invoice" | "payment" | "paymentRefund"
>;

export type DailySalesInvoiceSource = {
  id: string;
  branchId: string | null;
  issuedAt: Date;
  totalCents: number;
  tipCents: number;
  discountCents: number;
  loyaltyDiscountCents: number;
  packageVoucherCents: number;
  balanceCents?: number;
  status?: string;
};

export type DailySalesPaymentSource = {
  id: string;
  branchId: string | null;
  invoiceId: string | null;
  paidAt: Date;
  amountCents: number;
  isPackage: boolean;
  label: string;
  invoiceNumber?: string | null;
  customerName?: string | null;
};

export type DailySalesRefundSource = {
  id: string;
  branchId: string | null;
  invoiceId: string | null;
  refundedAt: Date;
  amountCents: number;
  isPackage: boolean;
  label: string;
  invoiceNumber?: string | null;
  customerName?: string | null;
  reason?: string | null;
  processorName?: string | null;
};

export type PaymentCollectionRow = {
  label: string;
  paymentCount: number;
  grossCents: number;
  refundCents: number;
  netCents: number;
  sharePercent: number;
};

export type DailySalesRow = {
  dateValue: string;
  grossSalesCents: number;
  netSalesCents: number;
  transactionCount: number;
  averageSaleCents: number;
  refundsCents: number;
  discountsCents: number;
  grossCollectionsCents: number;
  netCollectionsCents: number;
  paymentMethods: PaymentCollectionRow[];
};

export type DailySalesSummary = Omit<DailySalesRow, "dateValue" | "paymentMethods">;

export type DailySalesTransaction = {
  id: string;
  invoiceNumber: string;
  issuedAt: Date;
  customerName: string;
  staffName: string;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  paymentLabel: string;
  status: string;
};

export type PaymentMethodDetailRow = {
  id: string;
  kind: "PAYMENT" | "REFUND";
  occurredAt: Date;
  invoiceId: string | null;
  invoiceNumber: string | null;
  customerName: string;
  grossCents: number;
  refundCents: number;
  netCents: number;
  reason: string | null;
  processorName: string | null;
};

export type DailySalesReport = {
  range: BusinessDayRange;
  summary: DailySalesSummary;
  days: DailySalesRow[];
  paymentMethods: PaymentCollectionRow[];
  selectedDay: {
    dateValue: string;
    transactions: DailySalesTransaction[];
  } | null;
  selectedPaymentMethod: (PaymentCollectionRow & {
    rows: PaymentMethodDetailRow[];
  }) | null;
};

export function resolveReportBranchScope(input: {
  canViewAllBranches: boolean;
  requestedBranchId?: string;
  staffBranchId: string | null;
  activeBranchIds: readonly string[];
}) {
  const activeIds = new Set(input.activeBranchIds);
  if (!input.canViewAllBranches) {
    return {
      branchId:
        input.staffBranchId && activeIds.has(input.staffBranchId)
          ? input.staffBranchId
          : null,
      hasAccess: Boolean(
        input.staffBranchId && activeIds.has(input.staffBranchId),
      ),
      includesAllBranches: false,
    };
  }

  const requested = input.requestedBranchId?.trim();
  return {
    branchId: requested && activeIds.has(requested) ? requested : null,
    hasAccess: true,
    includesAllBranches: !(requested && activeIds.has(requested)),
  };
}

export function buildDailySalesReport(input: {
  branchId?: string | null;
  range: BusinessDayRange;
  invoices: readonly DailySalesInvoiceSource[];
  payments: readonly DailySalesPaymentSource[];
  refunds: readonly DailySalesRefundSource[];
}) {
  const branchInvoices = input.branchId
    ? input.invoices.filter((row) => row.branchId === input.branchId)
    : input.invoices;
  const branchPayments = input.branchId
    ? input.payments.filter((row) => row.branchId === input.branchId)
    : input.payments;
  const branchRefunds = input.branchId
    ? input.refunds.filter((row) => row.branchId === input.branchId)
    : input.refunds;
  const invoicesInScope = branchInvoices.filter((row) =>
    isInRange(row.issuedAt, input.range),
  );
  const paymentsInScope = branchPayments.filter((row) =>
    isInRange(row.paidAt, input.range),
  );
  const refundsInScope = branchRefunds.filter((row) =>
    isInRange(row.refundedAt, input.range),
  );
  const days: DailySalesRow[] = [];
  for (
    let dateValue = input.range.fromDateValue;
    dateValue <= input.range.toDateValue;
    dateValue = addDaysToDateValue(dateValue, 1)
  ) {
    const dayRange = getBusinessDayRange({
      fromDateValue: dateValue,
      toDateValue: dateValue,
      timezone: input.range.timezone,
      businessDayCutoffTime: input.range.businessDayCutoffTime,
    });
    const invoices = invoicesInScope.filter((row) =>
      isInRange(row.issuedAt, dayRange),
    );
    const payments = paymentsInScope.filter((row) =>
      isInRange(row.paidAt, dayRange),
    );
    const refunds = refundsInScope.filter((row) =>
      isInRange(row.refundedAt, dayRange),
    );
    const metrics = calculateFinancialMetrics({
      invoices: invoices.map(toFinancialInvoice),
      payments: payments.map((row) => ({
        amountCents: row.amountCents,
        isPackage: row.isPackage,
      })),
      refunds: refunds.map((row) => ({
        amountCents: row.amountCents,
        isPackage: row.isPackage,
      })),
    });

    days.push({
      dateValue,
      grossSalesCents: metrics.grossSalesCents,
      netSalesCents: metrics.netSalesCents,
      transactionCount: metrics.transactionCount,
      averageSaleCents: metrics.averageTransactionValueCents ?? 0,
      refundsCents: metrics.refundsCents,
      discountsCents: metrics.discountsCents,
      grossCollectionsCents: metrics.grossCollectionsCents,
      netCollectionsCents: metrics.netCollectionsCents,
      paymentMethods: buildPaymentCollections(payments, refunds),
    });
  }

  const summaryMetrics = calculateFinancialMetrics({
    invoices: invoicesInScope.map(toFinancialInvoice),
    payments: paymentsInScope.map((row) => ({
      amountCents: row.amountCents,
      isPackage: row.isPackage,
    })),
    refunds: refundsInScope.map((row) => ({
      amountCents: row.amountCents,
      isPackage: row.isPackage,
    })),
  });

  return {
    summary: {
      grossSalesCents: summaryMetrics.grossSalesCents,
      netSalesCents: summaryMetrics.netSalesCents,
      transactionCount: summaryMetrics.transactionCount,
      averageSaleCents: summaryMetrics.averageTransactionValueCents ?? 0,
      refundsCents: summaryMetrics.refundsCents,
      discountsCents: summaryMetrics.discountsCents,
      grossCollectionsCents: summaryMetrics.grossCollectionsCents,
      netCollectionsCents: summaryMetrics.netCollectionsCents,
    },
    days,
    paymentMethods: buildPaymentCollections(paymentsInScope, refundsInScope),
  };
}

export async function getDailySalesReport(
  input: {
    businessId: string;
    branchId: string | null;
    range: BusinessDayRange;
    selectedDay?: string;
    selectedPaymentMethod?: string;
  },
  database: ReadDatabase = prisma,
): Promise<DailySalesReport> {
  const branchFilter = input.branchId ? { branchId: input.branchId } : {};
  const eventWindow = {
    gte: input.range.fromDate,
    lt: input.range.toDateExclusive,
  };
  const [invoiceRows, paymentRows, refundRows] = await Promise.all([
    database.invoice.findMany({
      where: {
        businessId: input.businessId,
        ...branchFilter,
        status: { not: "VOID" },
        issuedAt: eventWindow,
      },
      select: {
        id: true,
        branchId: true,
        issuedAt: true,
        total: true,
        tipAmount: true,
        discountAmount: true,
        loyaltyDiscountAmount: true,
        balance: true,
        status: true,
        payments: {
          where: { method: "PACKAGE", status: "ACTIVE" },
          select: { amount: true },
        },
      },
    }),
    database.payment.findMany({
      where: {
        businessId: input.businessId,
        ...branchFilter,
        status: "ACTIVE",
        method: { not: "PACKAGE" },
        paidAt: eventWindow,
        OR: [{ invoiceId: null }, { invoice: { status: { not: "VOID" } } }],
      },
      select: {
        id: true,
        branchId: true,
        invoiceId: true,
        paidAt: true,
        amount: true,
        method: true,
        paymentMethodLabel: true,
        businessPaymentMethod: { select: { label: true } },
        invoice: {
          select: {
            invoiceNumber: true,
            customer: { select: { name: true } },
          },
        },
      },
    }),
    database.paymentRefund.findMany({
      where: {
        businessId: input.businessId,
        ...branchFilter,
        method: { not: "PACKAGE" },
        refundedAt: eventWindow,
        OR: [{ invoiceId: null }, { invoice: { status: { not: "VOID" } } }],
      },
      select: {
        id: true,
        branchId: true,
        invoiceId: true,
        refundedAt: true,
        amount: true,
        method: true,
        reason: true,
        processedBy: { select: { name: true } },
        invoice: {
          select: {
            invoiceNumber: true,
            customer: { select: { name: true } },
          },
        },
        payment: {
          select: {
            paymentMethodLabel: true,
            businessPaymentMethod: { select: { label: true } },
          },
        },
      },
    }),
  ]);

  const invoices: DailySalesInvoiceSource[] = invoiceRows.map((row) => ({
    id: row.id,
    branchId: row.branchId,
    issuedAt: row.issuedAt,
    totalCents: toCents(row.total),
    tipCents: toCents(row.tipAmount),
    discountCents: toCents(row.discountAmount),
    loyaltyDiscountCents: toCents(row.loyaltyDiscountAmount),
    packageVoucherCents: row.payments.reduce(
      (sum, payment) => sum + toCents(payment.amount),
      0,
    ),
    balanceCents: toCents(row.balance),
    status: row.status,
  }));
  const payments: DailySalesPaymentSource[] = paymentRows.map((row) => ({
    id: row.id,
    branchId: row.branchId,
    invoiceId: row.invoiceId,
    paidAt: row.paidAt,
    amountCents: toCents(row.amount),
    isPackage: false,
    label: paymentLabel(row),
    invoiceNumber: row.invoice?.invoiceNumber ?? null,
    customerName: row.invoice?.customer?.name ?? null,
  }));
  const refunds: DailySalesRefundSource[] = refundRows.map((row) => ({
    id: row.id,
    branchId: row.branchId,
    invoiceId: row.invoiceId,
    refundedAt: row.refundedAt,
    amountCents: toCents(row.amount),
    isPackage: false,
    label: paymentLabel({
      method: row.method,
      paymentMethodLabel: row.payment.paymentMethodLabel,
      businessPaymentMethod: row.payment.businessPaymentMethod,
    }),
    invoiceNumber: row.invoice?.invoiceNumber ?? null,
    customerName: row.invoice?.customer?.name ?? null,
    reason: row.reason,
    processorName: row.processedBy?.name ?? null,
  }));
  const built = buildDailySalesReport({
    branchId: input.branchId,
    range: input.range,
    invoices,
    payments,
    refunds,
  });

  const selectedDay =
    input.selectedDay &&
    input.selectedDay >= input.range.fromDateValue &&
    input.selectedDay <= input.range.toDateValue
      ? await loadDayTransactions(
          {
            businessId: input.businessId,
            branchId: input.branchId,
            dateValue: input.selectedDay,
            timezone: input.range.timezone,
            businessDayCutoffTime: input.range.businessDayCutoffTime,
          },
          database,
        )
      : null;
  const selectedPaymentMethod = input.selectedPaymentMethod
    ? built.paymentMethods.find(
        (method) => method.label === input.selectedPaymentMethod,
      ) ?? null
    : null;

  return {
    range: input.range,
    ...built,
    selectedDay,
    selectedPaymentMethod: selectedPaymentMethod
      ? {
          ...selectedPaymentMethod,
          rows: buildPaymentMethodDetails(
            selectedPaymentMethod.label,
            payments,
            refunds,
          ),
        }
      : null,
  };
}

async function loadDayTransactions(
  input: {
    businessId: string;
    branchId: string | null;
    dateValue: string;
    timezone: string;
    businessDayCutoffTime: string;
  },
  database: ReadDatabase,
) {
  const dayRange = getBusinessDayRange({
    fromDateValue: input.dateValue,
    toDateValue: input.dateValue,
    timezone: input.timezone,
    businessDayCutoffTime: input.businessDayCutoffTime,
  });
  const rows = await database.invoice.findMany({
    where: {
      businessId: input.businessId,
      ...(input.branchId ? { branchId: input.branchId } : {}),
      status: { not: "VOID" },
      issuedAt: { gte: dayRange.fromDate, lt: dayRange.toDateExclusive },
    },
    orderBy: { issuedAt: "desc" },
    select: {
      id: true,
      invoiceNumber: true,
      issuedAt: true,
      subtotal: true,
      discountAmount: true,
      total: true,
      status: true,
      customer: { select: { name: true } },
      appointment: {
        select: { assignedStaff: { select: { name: true } } },
      },
      payments: {
        where: { status: "ACTIVE", method: { not: "PACKAGE" } },
        orderBy: { paidAt: "asc" },
        select: {
          method: true,
          paymentMethodLabel: true,
          businessPaymentMethod: { select: { label: true } },
        },
      },
    },
  });

  return {
    dateValue: input.dateValue,
    transactions: rows.map((row) => ({
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      issuedAt: row.issuedAt,
      customerName: row.customer?.name ?? "Walk-in customer",
      staffName: row.appointment?.assignedStaff?.name ?? "Unassigned",
      subtotalCents: toCents(row.subtotal),
      discountCents: toCents(row.discountAmount),
      totalCents: toCents(row.total),
      paymentLabel:
        [...new Set(row.payments.map(paymentLabel))].join(" + ") || "Unpaid",
      status: row.status,
    })),
  };
}

export function buildPaymentMethodDetails(
  label: string,
  payments: readonly DailySalesPaymentSource[],
  refunds: readonly DailySalesRefundSource[],
): PaymentMethodDetailRow[] {
  return [
    ...payments
      .filter((payment) => !payment.isPackage && payment.label === label)
      .map((payment) => ({
        id: payment.id,
        kind: "PAYMENT" as const,
        occurredAt: payment.paidAt,
        invoiceId: payment.invoiceId,
        invoiceNumber: payment.invoiceNumber ?? null,
        customerName: payment.customerName?.trim() || "No customer",
        grossCents: payment.amountCents,
        refundCents: 0,
        netCents: payment.amountCents,
        reason: null,
        processorName: null,
      })),
    ...refunds
      .filter((refund) => !refund.isPackage && refund.label === label)
      .map((refund) => ({
        id: refund.id,
        kind: "REFUND" as const,
        occurredAt: refund.refundedAt,
        invoiceId: refund.invoiceId,
        invoiceNumber: refund.invoiceNumber ?? null,
        customerName: refund.customerName?.trim() || "No customer",
        grossCents: 0,
        refundCents: refund.amountCents,
        netCents: -refund.amountCents,
        reason: refund.reason ?? null,
        processorName: refund.processorName ?? null,
      })),
  ].sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime());
}

function buildPaymentCollections(
  payments: readonly DailySalesPaymentSource[],
  refunds: readonly DailySalesRefundSource[],
) {
  const rows = new Map<
    string,
    Omit<PaymentCollectionRow, "sharePercent" | "netCents">
  >();
  for (const payment of payments) {
    if (payment.isPackage) continue;
    const current = rows.get(payment.label) ?? {
      label: payment.label,
      paymentCount: 0,
      grossCents: 0,
      refundCents: 0,
    };
    current.paymentCount += 1;
    current.grossCents += payment.amountCents;
    rows.set(payment.label, current);
  }
  for (const refund of refunds) {
    if (refund.isPackage) continue;
    const current = rows.get(refund.label) ?? {
      label: refund.label,
      paymentCount: 0,
      grossCents: 0,
      refundCents: 0,
    };
    current.refundCents += refund.amountCents;
    rows.set(refund.label, current);
  }
  const netTotal = [...rows.values()].reduce(
    (sum, row) => sum + row.grossCents - row.refundCents,
    0,
  );

  return [...rows.values()]
    .map((row) => {
      const netCents = row.grossCents - row.refundCents;
      return {
        ...row,
        netCents,
        sharePercent:
          netTotal > 0 ? Math.round((netCents / netTotal) * 1000) / 10 : 0,
      };
    })
    .sort(
      (left, right) =>
        right.netCents - left.netCents || left.label.localeCompare(right.label),
    );
}

function toFinancialInvoice(row: DailySalesInvoiceSource) {
  return {
    totalCents: row.totalCents,
    tipCents: row.tipCents,
    discountCents: row.discountCents,
    loyaltyDiscountCents: row.loyaltyDiscountCents,
    packageVoucherCents: row.packageVoucherCents,
    balanceCents: row.balanceCents,
    status: row.status,
  };
}

function isInRange(value: Date, range: BusinessDayRange) {
  return value >= range.fromDate && value < range.toDateExclusive;
}

function paymentLabel(input: {
  method: PaymentMethod;
  paymentMethodLabel: string | null;
  businessPaymentMethod: { label: string } | null;
}) {
  return (
    input.businessPaymentMethod?.label.trim() ||
    input.paymentMethodLabel?.trim() ||
    DEFAULT_PAYMENT_LABELS[input.method]
  );
}
