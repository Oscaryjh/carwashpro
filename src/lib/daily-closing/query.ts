import type {
  BusinessIndustry,
  InvoiceStatus,
  PaymentMethod,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toCents } from "@/lib/validation/pos";
import { calculateDailyClosingReport } from "./calculator";
import {
  buildDailyClosingWhatsAppPreview,
  formatDailyClosingGeneratedAt,
} from "./format";
import { getDailyClosingRange } from "./range";
import type {
  DailyClosingIndustry,
  DailyClosingPaymentMethod,
  DailyClosingSourceData,
} from "./types";

type GetDailyClosingReportInput = {
  branchId: string;
  businessId: string;
  dateValue?: string;
  industryType: BusinessIndustry;
  now?: Date;
};

export type DailyClosingDatabase = Pick<
  Prisma.TransactionClient,
  | "appointment"
  | "branch"
  | "business"
  | "cashierShift"
  | "customerPackage"
  | "invoice"
  | "payment"
  | "paymentRefund"
  | "workOrder"
>;

export async function getDailyClosingReport(
  input: GetDailyClosingReportInput,
  database: DailyClosingDatabase = prisma,
) {
  const now = input.now ?? new Date();
  const range = getDailyClosingRange(now, input.dateValue);
  const branchScope = {
    branchId: input.branchId,
    businessId: input.businessId,
  };

  const [
    business,
    branch,
    invoices,
    payments,
    refunds,
    appointments,
    workOrders,
    packagePurchases,
    shifts,
  ] = await Promise.all([
    database.business.findUniqueOrThrow({
      where: { id: input.businessId },
      select: { name: true },
    }),
    database.branch.findFirstOrThrow({
      where: {
        id: input.branchId,
        businessId: input.businessId,
      },
      select: { name: true },
    }),
    database.invoice.findMany({
      where: {
        ...branchScope,
        issuedAt: { gte: range.fromDate, lt: range.toDateExclusive },
        status: { not: "VOID" },
      },
      select: {
        appointment: { select: { status: true } },
        balance: true,
        customerId: true,
        discountAmount: true,
        id: true,
        items: {
          select: {
            lineTotal: true,
            name: true,
            quantity: true,
            serviceId: true,
            taxAmount: true,
          },
        },
        loyaltyDiscountAmount: true,
        payments: {
          where: { method: "PACKAGE", status: "ACTIVE" },
          select: { amount: true },
        },
        status: true,
        total: true,
        workOrder: { select: { status: true } },
      },
    }),
    database.payment.findMany({
      where: {
        ...branchScope,
        paidAt: { gte: range.fromDate, lt: range.toDateExclusive },
        status: "ACTIVE",
      },
      select: {
        amount: true,
        method: true,
        packageUses: true,
      },
    }),
    database.paymentRefund.findMany({
      where: {
        ...branchScope,
        refundedAt: { gte: range.fromDate, lt: range.toDateExclusive },
      },
      select: {
        amount: true,
        method: true,
        packageUsesRestored: true,
      },
    }),
    input.industryType === "SALON_BEAUTY"
      ? database.appointment.findMany({
          where: {
            ...branchScope,
            OR: [
              {
                completedAt: { gte: range.fromDate, lt: range.toDateExclusive },
                status: "COMPLETED",
              },
              {
                cancelledAt: { gte: range.fromDate, lt: range.toDateExclusive },
                status: "CANCELLED",
              },
            ],
          },
          select: {
            customer: { select: { createdAt: true, id: true } },
            customerId: true,
            status: true,
          },
        })
      : Promise.resolve([]),
    input.industryType === "AUTO_DETAILING"
      ? database.workOrder.findMany({
          where: {
            ...branchScope,
            OR: [
              {
                pickedUpAt: { gte: range.fromDate, lt: range.toDateExclusive },
                status: "COMPLETED",
              },
              {
                createdAt: { gte: range.fromDate, lt: range.toDateExclusive },
                status: "CANCELLED",
              },
            ],
          },
          select: {
            customer: { select: { createdAt: true, id: true } },
            customerId: true,
            status: true,
            vehicleId: true,
          },
        })
      : Promise.resolve([]),
    database.customerPackage.findMany({
      where: {
        ...branchScope,
        purchasedAt: { gte: range.fromDate, lt: range.toDateExclusive },
        status: { in: ["ACTIVE", "USED_UP"] },
        invoice: { status: { not: "VOID" } },
      },
      select: {
        id: true,
        invoiceItems: {
          select: {
            lineTotal: true,
            taxAmount: true,
          },
        },
        purchasePrice: true,
      },
    }),
    database.cashierShift.findMany({
      where: {
        ...branchScope,
        OR: [
          { startedAt: { gte: range.fromDate, lt: range.toDateExclusive } },
          { endedAt: { gte: range.fromDate, lt: range.toDateExclusive } },
          { status: "OPEN" },
        ],
      },
      select: {
        cashDifference: true,
        status: true,
      },
    }),
  ]);

  const source: DailyClosingSourceData = {
    appointments: appointments.map((appointment) => ({
      customerId: appointment.customerId,
      status: appointment.status as "COMPLETED" | "CANCELLED",
    })),
    customers: uniqueCustomers([
      ...appointments.map((appointment) => appointment.customer),
      ...workOrders.map((workOrder) => workOrder.customer),
    ]),
    invoices: invoices.map((invoice) => ({
      balanceCents: toCents(invoice.balance),
      customerId: invoice.customerId,
      discountCents: toCents(invoice.discountAmount),
      id: invoice.id,
      items: invoice.items.map((item) => ({
        completedOperation:
          invoice.appointment?.status === "COMPLETED" ||
          invoice.workOrder?.status === "COMPLETED",
        name: item.name,
        quantity: item.quantity,
        salesCents: toCents(item.lineTotal) + toCents(item.taxAmount),
        serviceId: item.serviceId,
      })),
      loyaltyDiscountCents: toCents(invoice.loyaltyDiscountAmount),
      packageVoucherCents: invoice.payments.reduce(
        (sum, payment) => sum + toCents(payment.amount),
        0,
      ),
      status: invoice.status as Exclude<InvoiceStatus, "VOID">,
      totalCents: toCents(invoice.total),
    })),
    packagePurchases: packagePurchases.map((purchase) => ({
      amountCents:
        purchase.invoiceItems.length > 0
          ? purchase.invoiceItems.reduce(
              (sum, item) => sum + toCents(item.lineTotal) + toCents(item.taxAmount),
              0,
            )
          : toCents(purchase.purchasePrice),
      id: purchase.id,
    })),
    payments: payments.map((payment) => ({
      amountCents: toCents(payment.amount),
      method: asDailyClosingPaymentMethod(payment.method),
      packageUses: payment.packageUses,
    })),
    refunds: refunds.map((refund) => ({
      amountCents: toCents(refund.amount),
      method: asDailyClosingPaymentMethod(refund.method),
      packageUsesRestored: refund.packageUsesRestored,
    })),
    shifts: shifts.map((shift) => ({
      cashDifferenceCents:
        shift.cashDifference === null ? null : toCents(shift.cashDifference),
      isOpen: shift.status === "OPEN",
    })),
    workOrders: workOrders.map((workOrder) => ({
      customerId: workOrder.customerId,
      status: workOrder.status as "COMPLETED" | "CANCELLED",
      vehicleId: workOrder.vehicleId,
    })),
  };
  const report = calculateDailyClosingReport(source, range.fromDate);
  const industry = input.industryType as DailyClosingIndustry;

  return {
    branchId: input.branchId,
    branchName: branch.name,
    businessName: business.name,
    dateValue: range.dateValue,
    fromDate: range.fromDate,
    generatedAt: now,
    generatedAtLabel: formatDailyClosingGeneratedAt(now),
    industry,
    preview: buildDailyClosingWhatsAppPreview({
      branchName: branch.name,
      businessName: business.name,
      dateValue: range.dateValue,
      industry,
      report,
    }),
    report,
    timeZone: range.timeZone,
    toDateExclusive: range.toDateExclusive,
  };
}

function uniqueCustomers(customers: { createdAt: Date; id: string }[]) {
  return [...new Map(customers.map((customer) => [customer.id, customer])).values()];
}

function asDailyClosingPaymentMethod(
  method: PaymentMethod,
): DailyClosingPaymentMethod | "PACKAGE" {
  return method;
}
