import { formatDateValue } from "@/lib/business-time";
import { DAILY_CLOSING_TIME_ZONE } from "./range";
import type { DailyClosingIndustry, DailyClosingReport } from "./types";

export function formatMoneyFromCents(cents: number) {
  const sign = cents < 0 ? "-" : "";
  return `${sign}RM${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function formatDailyClosingGeneratedAt(value: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: DAILY_CLOSING_TIME_ZONE,
  }).format(value);
}

export function buildDailyClosingWhatsAppPreview(input: {
  branchName: string;
  businessName: string;
  dateValue: string;
  industry: DailyClosingIndustry;
  report: DailyClosingReport;
}) {
  const { branchName, businessName, dateValue, industry, report } = input;
  const operationLabel = industry === "AUTO_DETAILING" ? "Vehicles served" : "Customers served";
  const operationValue =
    industry === "AUTO_DETAILING"
      ? report.operations.vehiclesServed
      : report.operations.customersServed;
  const topServices =
    report.topServices.length > 0
      ? report.topServices
          .map(
            (service, index) =>
              `${index + 1}. ${service.name} x${service.quantity} (${formatMoneyFromCents(
                service.salesCents,
              )})`,
          )
          .join("\n")
      : "No service sales";
  const paymentMethods = report.paymentMethods
    .filter((payment) => payment.grossCents !== 0 || payment.refundCents !== 0)
    .map(
      (payment) =>
        `${formatPaymentMethod(payment.method)}: ${formatMoneyFromCents(
          payment.netCents,
        )}`,
    );

  return [
    `*Daily Closing - ${businessName}*`,
    `${branchName} | ${formatDateValue(
      dateValue,
      { day: "2-digit", month: "short", year: "numeric" },
      "en-MY",
    )}`,
    "",
    `Gross sales: ${formatMoneyFromCents(report.financial.grossSalesCents)}`,
    `Discounts: -${formatMoneyFromCents(report.financial.discountsCents)}`,
    `Refunds: -${formatMoneyFromCents(report.financial.refundsCents)}`,
    `Net sales: ${formatMoneyFromCents(report.financial.netSalesCents)}`,
    `Collected: ${formatMoneyFromCents(report.financial.collectedCents)}`,
    `Outstanding: ${formatMoneyFromCents(report.financial.outstandingCents)}`,
    "",
    "*Payment methods*",
    ...(paymentMethods.length > 0 ? paymentMethods : ["No payments collected"]),
    "",
    `${operationLabel}: ${operationValue}`,
    `Completed / Cancelled: ${report.operations.completed} / ${report.operations.cancelled}`,
    `New / Returning customers: ${report.operations.newCustomers} / ${report.operations.returningCustomers}`,
    `Average spend: ${formatMoneyFromCents(report.operations.averageSpendCents)}`,
    "",
    "*Top services*",
    topServices,
    "",
    `Packages sold: ${report.packages.sold} (${formatMoneyFromCents(
      report.packages.amountCents,
    )})`,
    `Package redemptions: ${report.packages.redemptions}`,
    "",
    `Alerts: ${report.alerts.map((alert) => alert.message).join(" ")}`,
  ].join("\n");
}

function formatPaymentMethod(method: DailyClosingReport["paymentMethods"][number]["method"]) {
  const labels = {
    BANK_TRANSFER: "Bank transfer",
    CARD: "Card",
    CASH: "Cash",
    DUITNOW: "DuitNow QR",
    EWALLET: "E-wallet",
  } as const;

  return labels[method];
}
