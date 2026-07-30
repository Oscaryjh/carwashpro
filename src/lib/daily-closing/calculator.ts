import { calculateFinancialMetrics } from "@/lib/financial-metrics";
import {
  DAILY_CLOSING_PAYMENT_METHODS,
  type DailyClosingPaymentMethod,
  type DailyClosingReport,
  type DailyClosingSourceData,
} from "./types";

export function calculateDailyClosingReport(
  source: DailyClosingSourceData,
  fromDate: Date,
): DailyClosingReport {
  const financialMetrics = calculateFinancialMetrics({
    invoices: source.invoices.map((invoice) => ({
      balanceCents: invoice.balanceCents,
      discountCents: invoice.discountCents,
      loyaltyDiscountCents: invoice.loyaltyDiscountCents,
      packageVoucherCents: invoice.packageVoucherCents,
      status: invoice.status,
      tipCents: invoice.tipCents,
      totalCents: invoice.totalCents,
    })),
    payments: source.payments.map((payment) => ({
      amountCents: payment.amountCents,
      isPackage: payment.method === "PACKAGE",
    })),
    refunds: source.refunds.map((refund) => ({
      amountCents: refund.amountCents,
      isPackage: refund.method === "PACKAGE",
    })),
  });
  const {
    discountsCents,
    grossSalesCents,
    netSalesCents,
    outstandingCents,
    refundsCents,
  } = financialMetrics;
  const collectedCents = financialMetrics.netCollectionsCents;

  const invoiceCounts = {
    paid: source.invoices.filter((invoice) => invoice.status === "PAID").length,
    partial: source.invoices.filter((invoice) => invoice.status === "PARTIAL").length,
    refunded: source.invoices.filter((invoice) => invoice.status === "REFUNDED").length,
    total: source.invoices.length,
    unpaid: source.invoices.filter((invoice) => invoice.status === "UNPAID").length,
  };

  const paymentMethods = DAILY_CLOSING_PAYMENT_METHODS.map((method) => {
    const grossCents = sumPaymentMethod(source, method);
    const refundCents = sumRefundMethod(source, method);
    return {
      grossCents,
      method,
      netCents: grossCents - refundCents,
      refundCents,
    };
  });

  const serviceTotals = new Map<
    string,
    { name: string; quantity: number; salesCents: number; serviceId: string }
  >();
  for (const invoice of source.invoices) {
    for (const item of invoice.items) {
      if (!item.completedOperation || !item.serviceId) continue;
      const current = serviceTotals.get(item.serviceId) ?? {
        name: item.name,
        quantity: 0,
        salesCents: 0,
        serviceId: item.serviceId,
      };
      current.quantity += item.quantity;
      current.salesCents += item.salesCents;
      serviceTotals.set(item.serviceId, current);
    }
  }
  const topServices = [...serviceTotals.values()]
    .sort(
      (left, right) =>
        right.salesCents - left.salesCents ||
        right.quantity - left.quantity ||
        left.name.localeCompare(right.name),
    )
    .slice(0, 3);

  const completedAppointments = source.appointments.filter(
    (appointment) => appointment.status === "COMPLETED",
  );
  const completedWorkOrders = source.workOrders.filter(
    (workOrder) => workOrder.status === "COMPLETED",
  );
  const servedCustomerIds = new Set([
    ...completedAppointments.map((appointment) => appointment.customerId),
    ...completedWorkOrders.map((workOrder) => workOrder.customerId),
  ]);
  const newCustomerIds = new Set(
    source.customers
      .filter((customer) => customer.createdAt >= fromDate)
      .map((customer) => customer.id),
  );
  const newCustomers = [...servedCustomerIds].filter((id) => newCustomerIds.has(id)).length;
  const completed = completedAppointments.length + completedWorkOrders.length;
  const cancelled =
    source.appointments.filter((appointment) => appointment.status === "CANCELLED").length +
    source.workOrders.filter((workOrder) => workOrder.status === "CANCELLED").length;

  const packageUses =
    source.payments.reduce(
      (sum, payment) => sum + (payment.method === "PACKAGE" ? payment.packageUses : 0),
      0,
    ) -
    source.refunds.reduce(
      (sum, refund) => sum + (refund.method === "PACKAGE" ? refund.packageUsesRestored : 0),
      0,
    );

  const alerts = buildAlerts(source, invoiceCounts, refundsCents);

  return {
    alerts,
    financial: {
      collectedCents,
      discountsCents,
      grossSalesCents,
      netSalesCents,
      outstandingCents,
      refundsCents,
    },
    invoiceCounts,
    operations: {
      averageSpendCents: completed > 0 ? Math.round(netSalesCents / completed) : 0,
      cancelled,
      completed,
      customersServed: servedCustomerIds.size,
      newCustomers,
      returningCustomers: Math.max(0, servedCustomerIds.size - newCustomers),
      vehiclesServed: new Set(
        completedWorkOrders.map((workOrder) => workOrder.vehicleId),
      ).size,
    },
    packages: {
      amountCents: source.packagePurchases.reduce(
        (sum, purchase) => sum + purchase.amountCents,
        0,
      ),
      redemptions: Math.max(0, packageUses),
      sold: source.packagePurchases.length,
    },
    paymentMethods,
    topServices,
  };
}

function sumPaymentMethod(source: DailyClosingSourceData, method: DailyClosingPaymentMethod) {
  return source.payments.reduce(
    (sum, payment) => sum + (payment.method === method ? payment.amountCents : 0),
    0,
  );
}

function sumRefundMethod(source: DailyClosingSourceData, method: DailyClosingPaymentMethod) {
  return source.refunds.reduce(
    (sum, refund) => sum + (refund.method === method ? refund.amountCents : 0),
    0,
  );
}

function buildAlerts(
  source: DailyClosingSourceData,
  invoiceCounts: DailyClosingReport["invoiceCounts"],
  refundsCents: number,
) {
  const alerts: DailyClosingReport["alerts"] = [];
  const unsettled = invoiceCounts.unpaid + invoiceCounts.partial;
  const openShifts = source.shifts.filter((shift) => shift.isOpen).length;
  const cashDifferences = source.shifts.filter(
    (shift) => shift.cashDifferenceCents !== null && shift.cashDifferenceCents !== 0,
  );

  if (unsettled > 0) {
    alerts.push({
      level: "warning",
      message: `${unsettled} invoice${unsettled === 1 ? "" : "s"} remain unpaid or partially paid.`,
    });
  }
  if (refundsCents > 0) {
    alerts.push({
      level: "warning",
      message: "Refund activity was recorded during this business day.",
    });
  }
  if (cashDifferences.length > 0) {
    alerts.push({
      level: "warning",
      message: `${cashDifferences.length} closed shift${cashDifferences.length === 1 ? "" : "s"} have a cash difference.`,
    });
  }
  if (openShifts > 0) {
    alerts.push({
      level: "info",
      message: `${openShifts} cashier shift${openShifts === 1 ? " is" : "s are"} still open.`,
    });
  }
  if (alerts.length === 0) {
    alerts.push({
      level: "info",
      message: "No exceptions detected for this business day.",
    });
  }

  return alerts;
}
