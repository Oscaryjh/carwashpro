import type { Prisma } from "@prisma/client";
import {
  addDaysToDateValue,
  dateValueToUtcDate,
  isValidDateValue,
} from "@/lib/business-time";
import {
  getBusinessDayRangeWithPrevious,
  isValidBusinessDayCutoffTime,
  isValidIanaTimeZone,
  MAX_BUSINESS_DAY_RANGE_DAYS,
  type BusinessDayRange,
} from "@/lib/business-day";
import {
  resolveAuthorizedGroupReportingScope,
  type AuthorizedGroupReportingContext,
} from "@/lib/business-groups/all-stores-access";
import { prisma } from "@/lib/prisma";

export type AllStoresRange = "today" | "7days" | "30days" | "custom";

export type AllStoresKpi = {
  grossSalesCents: number;
  netSalesCents: number;
  paymentsCollectedCents: number;
  refundsCents: number;
  transactionCount: number;
  averageTransactionValueCents: number | null;
};

export type AllStoresKpiComparison =
  | { kind: "NEW" }
  | { kind: "NO_CHANGE" }
  | { kind: "CHANGE"; direction: "UP" | "DOWN" }
  | { kind: "PERCENT"; percentage: number };

export type AllStoresKpiWithComparisons = AllStoresKpi & {
  comparisons: Record<keyof AllStoresKpi, AllStoresKpiComparison>;
};

export type AllStoresBusinessKpi = {
  businessId: string;
  businessName: string;
  industryType: AuthorizedGroupReportingContext["businesses"][number]["industryType"];
  logoUrl: string | null;
  timezone: string;
  businessDayCutoffTime: string;
  currentRange: BusinessDayRange;
  previousRange: BusinessDayRange;
  current: AllStoresKpiWithComparisons;
  previous: AllStoresKpi;
};

export type AllStoresKpiReport = {
  groupId: string;
  groupName: string;
  role: AuthorizedGroupReportingContext["role"];
  range: AllStoresRange;
  customFrom: string | null;
  customTo: string | null;
  authorizedBusinessCount: number;
  current: AllStoresKpiWithComparisons;
  previous: AllStoresKpi;
  businesses: AllStoresBusinessKpi[];
};

type ReportingDatabase = Pick<
  Prisma.TransactionClient,
  "invoice" | "payment" | "paymentRefund"
>;

type ResolveScope = typeof resolveAuthorizedGroupReportingScope;

type AllStoresKpiDependencies = {
  now?: Date;
  resolveScope?: ResolveScope;
};

type AllStoresKpiInput = {
  userId: string;
  groupId: string;
  activeBusinessId: string;
  range?: string;
  from?: string;
  to?: string;
};

type PeriodPair = {
  current: BusinessDayRange;
  previous: BusinessDayRange;
};

type InvoiceRow = {
  businessId: string;
  discountAmount: unknown;
  id: string;
  issuedAt: Date;
  loyaltyDiscountAmount: unknown;
  payments: Array<{ amount: unknown }>;
  tipAmount: unknown;
  total: unknown;
};

type PaymentRow = {
  amount: unknown;
  businessId: string;
  paidAt: Date;
};

type RefundRow = {
  amount: unknown;
  businessId: string;
  refundedAt: Date;
};

export class AllStoresKpiRangeError extends Error {}

export async function getAllStoresKpiReport(
  input: AllStoresKpiInput,
  database: ReportingDatabase = prisma,
  dependencies: AllStoresKpiDependencies = {},
): Promise<AllStoresKpiReport | null> {
  const resolveScope =
    dependencies.resolveScope ?? resolveAuthorizedGroupReportingScope;
  const scope = await resolveScope(
    input.userId,
    input.groupId,
    input.activeBusinessId,
  );
  if (!scope || !scope.canViewAllStores) {
    return null;
  }

  const range = normalizeRange(input.range);
  const customRange = validateCustomRange(range, input.from, input.to);
  const now = dependencies.now ?? new Date();
  const periods = new Map(
    scope.businesses.map((business) => [
      business.id,
      buildBusinessPeriods({
        range,
        from: customRange?.from ?? null,
        to: customRange?.to ?? null,
        now,
        timezone: business.timezone,
        businessDayCutoffTime: business.businessDayCutoffTime,
      }),
    ]),
  );
  const completeRangeFilters = scope.businesses.map((business) => {
    const period = periods.get(business.id)!;
    return {
      businessId: business.id,
      gte: period.previous.fromDate,
      lt: period.current.toDateExclusive,
    };
  });

  const [invoices, payments, refunds] = await Promise.all([
    database.invoice.findMany({
      where: {
        status: { not: "VOID" },
        OR: completeRangeFilters.map(({ businessId, gte, lt }) => ({
          businessId,
          issuedAt: { gte, lt },
        })),
      },
      select: {
        businessId: true,
        discountAmount: true,
        id: true,
        issuedAt: true,
        loyaltyDiscountAmount: true,
        payments: {
          where: { method: "PACKAGE", status: "ACTIVE" },
          select: { amount: true },
        },
        tipAmount: true,
        total: true,
      },
    }),
    database.payment.findMany({
      where: {
        status: "ACTIVE",
        method: { not: "PACKAGE" },
        AND: [
          {
            OR: completeRangeFilters.map(({ businessId, gte, lt }) => ({
              businessId,
              paidAt: { gte, lt },
            })),
          },
          {
            OR: [
              { invoiceId: null },
              { invoice: { status: { not: "VOID" } } },
            ],
          },
        ],
      },
      select: {
        amount: true,
        businessId: true,
        paidAt: true,
      },
    }),
    database.paymentRefund.findMany({
      where: {
        method: { not: "PACKAGE" },
        AND: [
          {
            OR: completeRangeFilters.map(({ businessId, gte, lt }) => ({
              businessId,
              refundedAt: { gte, lt },
            })),
          },
          {
            OR: [
              { invoiceId: null },
              { invoice: { status: { not: "VOID" } } },
            ],
          },
        ],
      },
      select: {
        amount: true,
        businessId: true,
        refundedAt: true,
      },
    }),
  ]);

  const reportByBusiness = calculateAllStoresKpis({
    businessIds: scope.businesses.map((business) => business.id),
    periods,
    invoices: invoices as InvoiceRow[],
    payments: payments as PaymentRow[],
    refunds: refunds as RefundRow[],
  });
  const totalCurrent = sumKpis(
    [...reportByBusiness.values()].map((item) => item.current),
  );
  const totalPrevious = sumKpis(
    [...reportByBusiness.values()].map((item) => item.previous),
  );

  return {
    groupId: scope.groupId,
    groupName: scope.groupName,
    role: scope.role,
    range,
    customFrom: customRange?.from ?? null,
    customTo: customRange?.to ?? null,
    authorizedBusinessCount: scope.businesses.length,
    current: withComparisons(totalCurrent, totalPrevious),
    previous: totalPrevious,
    businesses: scope.businesses.map((business) => {
      const period = periods.get(business.id)!;
      const result = reportByBusiness.get(business.id)!;
      return {
        businessId: business.id,
        businessName: business.name,
        industryType: business.industryType,
        logoUrl: business.logoUrl,
        timezone: business.timezone,
        businessDayCutoffTime: business.businessDayCutoffTime,
        currentRange: period.current,
        previousRange: period.previous,
        current: withComparisons(result.current, result.previous),
        previous: result.previous,
      };
    }),
  };
}

export function calculateAllStoresKpis(input: {
  businessIds: string[];
  periods: Map<string, PeriodPair>;
  invoices: InvoiceRow[];
  payments: PaymentRow[];
  refunds: RefundRow[];
}) {
  const results = new Map(
    input.businessIds.map((businessId) => [
      businessId,
      { current: emptyKpi(), previous: emptyKpi() },
    ]),
  );

  for (const invoice of input.invoices) {
    const result = results.get(invoice.businessId);
    const period = input.periods.get(invoice.businessId);
    const bucket = period && getPeriodBucket(invoice.issuedAt, period);
    if (!result || !bucket) continue;

    const packageRedemptionCents = invoice.payments.reduce(
      (total, payment) => total + moneyToCents(payment.amount),
      0,
    );
    const invoiceDiscountCents =
      moneyToCents(invoice.discountAmount) +
      moneyToCents(invoice.loyaltyDiscountAmount);
    const discountedSalesCents =
      moneyToCents(invoice.total) -
      moneyToCents(invoice.tipAmount) -
      packageRedemptionCents;
    result[bucket].grossSalesCents +=
      discountedSalesCents + invoiceDiscountCents;
    result[bucket].netSalesCents += discountedSalesCents;
    result[bucket].transactionCount += 1;
  }

  for (const payment of input.payments) {
    const result = results.get(payment.businessId);
    const period = input.periods.get(payment.businessId);
    const bucket = period && getPeriodBucket(payment.paidAt, period);
    if (!result || !bucket) continue;
    result[bucket].paymentsCollectedCents += moneyToCents(payment.amount);
  }

  for (const refund of input.refunds) {
    const result = results.get(refund.businessId);
    const period = input.periods.get(refund.businessId);
    const bucket = period && getPeriodBucket(refund.refundedAt, period);
    if (!result || !bucket) continue;
    const refundCents = moneyToCents(refund.amount);
    result[bucket].refundsCents += refundCents;
    result[bucket].netSalesCents -= refundCents;
  }

  for (const result of results.values()) {
    finalizeAverage(result.current);
    finalizeAverage(result.previous);
  }
  return results;
}

export function compareKpiValues(
  current: number,
  previous: number,
): AllStoresKpiComparison {
  if (previous === 0) {
    if (current === 0) return { kind: "NO_CHANGE" };
    if (current > 0) return { kind: "NEW" };
    return { kind: "CHANGE", direction: "DOWN" };
  }
  return {
    kind: "PERCENT",
    percentage: Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10,
  };
}

export function moneyToCents(value: unknown) {
  const raw =
    typeof value === "object" && value !== null && "toString" in value
      ? String(value)
      : String(value ?? "0");
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) {
    throw new Error("Money value must have at most two decimal places.");
  }
  const cents =
    Number.parseInt(match[2], 10) * 100 +
    Number.parseInt((match[3] ?? "").padEnd(2, "0"), 10);
  return match[1] ? -cents : cents;
}

function normalizeRange(value: string | undefined): AllStoresRange {
  if (!value || value === "today") return "today";
  if (value === "7days" || value === "30days" || value === "custom") {
    return value;
  }
  throw new AllStoresKpiRangeError("Select a valid reporting range.");
}

function validateCustomRange(
  range: AllStoresRange,
  from: string | undefined,
  to: string | undefined,
) {
  if (range !== "custom") return null;
  if (!from || !to || !isValidDateValue(from) || !isValidDateValue(to)) {
    throw new AllStoresKpiRangeError("Enter a valid custom date range.");
  }
  const dayCount =
    Math.round(
      (dateValueToUtcDate(to).getTime() -
        dateValueToUtcDate(from).getTime()) /
        86_400_000,
    ) + 1;
  if (dayCount < 1) {
    throw new AllStoresKpiRangeError(
      "The start date must be on or before the end date.",
    );
  }
  if (dayCount > MAX_BUSINESS_DAY_RANGE_DAYS) {
    throw new AllStoresKpiRangeError(
      `Custom date range cannot exceed ${MAX_BUSINESS_DAY_RANGE_DAYS} business days.`,
    );
  }
  return { from, to };
}

function buildBusinessPeriods(input: {
  range: AllStoresRange;
  from: string | null;
  to: string | null;
  now: Date;
  timezone: string;
  businessDayCutoffTime: string;
}) {
  let fromDateValue: string;
  let toDateValue: string;
  if (input.range === "custom") {
    fromDateValue = input.from!;
    toDateValue = input.to!;
  } else {
    toDateValue = getCurrentBusinessDateValue(
      input.now,
      input.timezone,
      input.businessDayCutoffTime,
    );
    const dayCount =
      input.range === "today" ? 1 : input.range === "7days" ? 7 : 30;
    fromDateValue = addDaysToDateValue(toDateValue, 1 - dayCount);
  }
  return getBusinessDayRangeWithPrevious({
    fromDateValue,
    toDateValue,
    timezone: input.timezone,
    businessDayCutoffTime: input.businessDayCutoffTime,
  });
}

export function getCurrentBusinessDateValue(
  now: Date,
  timezone: string,
  businessDayCutoffTime: string,
) {
  if (!isValidIanaTimeZone(timezone)) {
    throw new Error("Business timezone is invalid.");
  }
  if (!isValidBusinessDayCutoffTime(businessDayCutoffTime)) {
    throw new Error("Business day cutoff time must use HH:mm.");
  }
  const parts = new Map(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const dateValue = `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`;
  const timeValue = `${parts.get("hour")}:${parts.get("minute")}`;
  return timeValue < businessDayCutoffTime
    ? addDaysToDateValue(dateValue, -1)
    : dateValue;
}

function getPeriodBucket(value: Date, periods: PeriodPair) {
  if (
    value >= periods.current.fromDate &&
    value < periods.current.toDateExclusive
  ) {
    return "current" as const;
  }
  if (
    value >= periods.previous.fromDate &&
    value < periods.previous.toDateExclusive
  ) {
    return "previous" as const;
  }
  return null;
}

function emptyKpi(): AllStoresKpi {
  return {
    grossSalesCents: 0,
    netSalesCents: 0,
    paymentsCollectedCents: 0,
    refundsCents: 0,
    transactionCount: 0,
    averageTransactionValueCents: null,
  };
}

function finalizeAverage(kpi: AllStoresKpi) {
  kpi.averageTransactionValueCents =
    kpi.transactionCount > 0
      ? Math.round(kpi.netSalesCents / kpi.transactionCount)
      : null;
}

function sumKpis(values: AllStoresKpi[]) {
  const result = emptyKpi();
  for (const value of values) {
    result.grossSalesCents += value.grossSalesCents;
    result.netSalesCents += value.netSalesCents;
    result.paymentsCollectedCents += value.paymentsCollectedCents;
    result.refundsCents += value.refundsCents;
    result.transactionCount += value.transactionCount;
  }
  finalizeAverage(result);
  return result;
}

function withComparisons(
  current: AllStoresKpi,
  previous: AllStoresKpi,
): AllStoresKpiWithComparisons {
  return {
    ...current,
    comparisons: {
      grossSalesCents: compareKpiValues(
        current.grossSalesCents,
        previous.grossSalesCents,
      ),
      netSalesCents: compareKpiValues(
        current.netSalesCents,
        previous.netSalesCents,
      ),
      paymentsCollectedCents: compareKpiValues(
        current.paymentsCollectedCents,
        previous.paymentsCollectedCents,
      ),
      refundsCents: compareKpiValues(
        current.refundsCents,
        previous.refundsCents,
      ),
      transactionCount: compareKpiValues(
        current.transactionCount,
        previous.transactionCount,
      ),
      averageTransactionValueCents: compareKpiValues(
        current.averageTransactionValueCents ?? 0,
        previous.averageTransactionValueCents ?? 0,
      ),
    },
  };
}
