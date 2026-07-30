import type { Prisma } from "@prisma/client";
import {
  analyticsBusinessDateValue,
  readAuthorizedDailyStoreSummaries,
  type AnalyticsDailyRow,
  type DailySummaryReadFailureReason,
} from "@/lib/analytics/daily-summary-read";
import {
  addDaysToDateValue,
  dateValueToUtcDate,
  isValidDateValue,
  startOfBusinessMonth,
} from "@/lib/business-time";
import {
  getCurrentBusinessDateValue,
  getBusinessDayRange,
  getBusinessDayRangeWithPrevious,
  MAX_BUSINESS_DAY_RANGE_DAYS,
  type BusinessDayRange,
} from "@/lib/business-day";
import {
  resolveAuthorizedGroupReportingScope,
  type AuthorizedGroupBusiness,
  type AuthorizedGroupReportingContext,
} from "@/lib/business-groups/all-stores-access";
import {
  getReportingBusinesses,
  intersectBusinessMemberships,
  isEventWithinAuthorizedMembership,
} from "@/lib/business-groups/historical-membership";
import {
  calculateFinancialMetrics,
  type FinancialMetricInvoice,
  type FinancialMetricPayment,
  type FinancialMetricRefund,
} from "@/lib/financial-metrics";
import { prisma } from "@/lib/prisma";

export type AllStoresRange = "today" | "7days" | "month" | "custom";

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
  dataSource: "DAILY_SUMMARY" | "RAW";
  analyticsFallbackReason: AllStoresAnalyticsFallbackReason;
  current: AllStoresKpiWithComparisons;
  previous: AllStoresKpi;
  businesses: AllStoresBusinessKpi[];
};

export type AllStoresAnalyticsReadMode = "OFF" | "SHADOW" | "PRIMARY";
export type AllStoresAnalyticsFallbackReason =
  | "DISABLED"
  | "SHADOW_MODE"
  | "UNSAFE_MEMBERSHIP"
  | "MISSING_SUMMARIES"
  | "STALE_SUMMARIES"
  | "INVALID_SUMMARIES"
  | "UNSUPPORTED_FILTERS"
  | null;

type ReportingDatabase = Pick<
  Prisma.TransactionClient,
  "analyticsDailyStoreSummary" | "invoice" | "payment" | "paymentRefund"
>;

type ResolveScope = typeof resolveAuthorizedGroupReportingScope;

type AllStoresKpiDependencies = {
  analyticsReadMode?: AllStoresAnalyticsReadMode;
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

export type PeriodPair = {
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
  const reportingBusinesses = getReportingBusinesses(scope);
  const periods = new Map(
    reportingBusinesses.map((business) => [
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
  const completeRangeFilters = reportingBusinesses.flatMap((business) => {
    const period = periods.get(business.id)!;
    return intersectBusinessMemberships(
      business,
      period.previous.fromDate,
      period.current.toDateExclusive,
    );
  });
  const includedBusinessIds = new Set(
    completeRangeFilters.map((item) => item.businessId),
  );
  const businesses = reportingBusinesses.filter((business) =>
    includedBusinessIds.has(business.id),
  );
  const analyticsReadMode = resolveAllStoresAnalyticsReadMode(
    dependencies.analyticsReadMode,
  );
  let analyticsFallbackReason: AllStoresAnalyticsFallbackReason =
    analyticsReadMode === "OFF"
      ? "DISABLED"
      : analyticsReadMode === "SHADOW"
        ? "SHADOW_MODE"
        : null;

  if (analyticsReadMode === "PRIMARY") {
    const summaryResult = await tryLoadAllStoresKpisFromDailySummaries({
      businesses,
      periods,
      database,
    });
    if (summaryResult.ok) {
      return buildAllStoresKpiReport({
        scope,
        range,
        customFrom: customRange?.from ?? null,
        customTo: customRange?.to ?? null,
        businesses,
        periods,
        reportByBusiness: summaryResult.reportByBusiness,
        dataSource: "DAILY_SUMMARY",
        analyticsFallbackReason: null,
      });
    }
    analyticsFallbackReason = summaryResult.reason;
  }

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
  const businessById = new Map(
    businesses.map((business) => [business.id, business]),
  );

  const reportByBusiness = calculateAllStoresKpis({
    businessIds: businesses.map((business) => business.id),
    periods,
    invoices: (invoices as InvoiceRow[]).filter((invoice) => {
      const business = businessById.get(invoice.businessId);
      return Boolean(
        business &&
          isEventWithinAuthorizedMembership(business, invoice.issuedAt),
      );
    }),
    payments: (payments as PaymentRow[]).filter((payment) => {
      const business = businessById.get(payment.businessId);
      return Boolean(
        business &&
          isEventWithinAuthorizedMembership(business, payment.paidAt),
      );
    }),
    refunds: (refunds as RefundRow[]).filter((refund) => {
      const business = businessById.get(refund.businessId);
      return Boolean(
        business &&
          isEventWithinAuthorizedMembership(business, refund.refundedAt),
      );
    }),
  });
  return buildAllStoresKpiReport({
    scope,
    range,
    customFrom: customRange?.from ?? null,
    customTo: customRange?.to ?? null,
    businesses,
    periods,
    reportByBusiness,
    dataSource: "RAW",
    analyticsFallbackReason,
  });
}

function buildAllStoresKpiReport(input: {
  scope: AuthorizedGroupReportingContext;
  range: AllStoresRange;
  customFrom: string | null;
  customTo: string | null;
  businesses: AuthorizedGroupBusiness[];
  periods: Map<string, PeriodPair>;
  reportByBusiness: Map<
    string,
    { current: AllStoresKpi; previous: AllStoresKpi }
  >;
  dataSource: "DAILY_SUMMARY" | "RAW";
  analyticsFallbackReason: AllStoresAnalyticsFallbackReason;
}): AllStoresKpiReport {
  const totalCurrent = sumKpis(
    [...input.reportByBusiness.values()].map((item) => item.current),
  );
  const totalPrevious = sumKpis(
    [...input.reportByBusiness.values()].map((item) => item.previous),
  );

  return {
    groupId: input.scope.groupId,
    groupName: input.scope.groupName,
    role: input.scope.role,
    range: input.range,
    customFrom: input.customFrom,
    customTo: input.customTo,
    authorizedBusinessCount: input.businesses.length,
    dataSource: input.dataSource,
    analyticsFallbackReason: input.analyticsFallbackReason,
    current: withComparisons(totalCurrent, totalPrevious),
    previous: totalPrevious,
    businesses: input.businesses.map((business) => {
      const period = input.periods.get(business.id)!;
      const result = input.reportByBusiness.get(business.id)!;
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

export function resolveAllStoresAnalyticsReadMode(
  override?: AllStoresAnalyticsReadMode,
): AllStoresAnalyticsReadMode {
  if (override) return override;
  const configured =
    process.env.ANALYTICS_DAILY_SUMMARY_READ_MODE?.trim().toUpperCase();
  if (
    configured === "OFF" ||
    configured === "SHADOW" ||
    configured === "PRIMARY"
  ) {
    return configured;
  }
  return process.env.NODE_ENV === "development" ? "PRIMARY" : "OFF";
}

export { isRangeFullyAuthorized } from "@/lib/analytics/daily-summary-read";
export type { AnalyticsDailyRow } from "@/lib/analytics/daily-summary-read";

export async function tryLoadAllStoresKpisFromDailySummaries(input: {
  businesses: AuthorizedGroupBusiness[];
  periods: Map<string, PeriodPair>;
  database: ReportingDatabase;
}): Promise<
  | {
      ok: true;
      reportByBusiness: Map<
        string,
        { current: AllStoresKpi; previous: AllStoresKpi }
      >;
      rows: AnalyticsDailyRow[];
    }
  | {
      ok: false;
      reason: Exclude<AllStoresAnalyticsFallbackReason, null | "DISABLED" | "SHADOW_MODE">;
    }
> {
  const summaryRead = await readAuthorizedDailyStoreSummaries(
    {
      reads: input.businesses.map((business) => {
        const period = input.periods.get(business.id)!;
        return {
          business,
          windows: [
            {
              fromDateValue: period.previous.fromDateValue,
              toDateValue: period.current.toDateValue,
            },
          ],
        };
      }),
      requireMembershipHistory: false,
    },
    input.database,
  );
  if (!summaryRead.ok) {
    return {
      ok: false,
      reason: mapDailySummaryReadFailure(summaryRead.reason),
    };
  }

  const reportByBusiness = new Map<
    string,
    { current: AllStoresKpi; previous: AllStoresKpi }
  >();
  const rowsByBusiness = new Map<string, AnalyticsDailyRow[]>();
  for (const row of summaryRead.rows) {
    const rows = rowsByBusiness.get(row.businessId) ?? [];
    rows.push(row);
    rowsByBusiness.set(row.businessId, rows);
  }
  for (const business of input.businesses) {
    const period = input.periods.get(business.id)!;
    const currentRows: AnalyticsDailyRow[] = [];
    const previousRows: AnalyticsDailyRow[] = [];
    for (const row of rowsByBusiness.get(business.id) ?? []) {
      const businessDate = analyticsBusinessDateValue(row);
      if (
        businessDate >= period.current.fromDateValue &&
        businessDate <= period.current.toDateValue
      ) {
        currentRows.push(row);
      } else if (
        businessDate >= period.previous.fromDateValue &&
        businessDate <= period.previous.toDateValue
      ) {
        previousRows.push(row);
      }
    }
    reportByBusiness.set(business.id, {
      current: sumKpis(currentRows.map(dailyRowToKpi)),
      previous: sumKpis(previousRows.map(dailyRowToKpi)),
    });
  }
  return {
    ok: true,
    reportByBusiness,
    rows: summaryRead.rows,
  };
}

function mapDailySummaryReadFailure(
  reason: DailySummaryReadFailureReason,
): Exclude<
  AllStoresAnalyticsFallbackReason,
  null | "DISABLED" | "SHADOW_MODE"
> {
  if (
    reason === "UNSAFE_MEMBERSHIP" ||
    reason === "MISSING_SUMMARIES" ||
    reason === "STALE_SUMMARIES"
  ) {
    return reason;
  }
  return "INVALID_SUMMARIES";
}

export function dailyRowToKpi(row: AnalyticsDailyRow): AllStoresKpi {
  return {
    averageTransactionValueCents: row.averageTransactionValueCents,
    grossSalesCents: row.grossSalesCents,
    netSalesCents: row.netSalesCents,
    paymentsCollectedCents: row.grossCollectionsCents,
    refundsCents: row.refundsCents,
    transactionCount: row.transactionCount,
  };
}

export function calculateAllStoresKpis(input: {
  businessIds: string[];
  periods: Map<string, PeriodPair>;
  invoices: InvoiceRow[];
  payments: PaymentRow[];
  refunds: RefundRow[];
}) {
  const sources = new Map(
    input.businessIds.map((businessId) => [
      businessId,
      {
        current: emptyFinancialMetricSource(),
        previous: emptyFinancialMetricSource(),
      },
    ]),
  );

  for (const invoice of input.invoices) {
    const source = sources.get(invoice.businessId);
    const period = input.periods.get(invoice.businessId);
    const bucket = period && getPeriodBucket(invoice.issuedAt, period);
    if (!source || !bucket) continue;

    const packageRedemptionCents = invoice.payments.reduce(
      (total, payment) => total + moneyToCents(payment.amount),
      0,
    );
    source[bucket].invoices.push({
      discountCents: moneyToCents(invoice.discountAmount),
      loyaltyDiscountCents: moneyToCents(invoice.loyaltyDiscountAmount),
      packageVoucherCents: packageRedemptionCents,
      tipCents: moneyToCents(invoice.tipAmount),
      totalCents: moneyToCents(invoice.total),
    });
  }

  for (const payment of input.payments) {
    const source = sources.get(payment.businessId);
    const period = input.periods.get(payment.businessId);
    const bucket = period && getPeriodBucket(payment.paidAt, period);
    if (!source || !bucket) continue;
    source[bucket].payments.push({
      amountCents: moneyToCents(payment.amount),
      isPackage: false,
    });
  }

  for (const refund of input.refunds) {
    const source = sources.get(refund.businessId);
    const period = input.periods.get(refund.businessId);
    const bucket = period && getPeriodBucket(refund.refundedAt, period);
    if (!source || !bucket) continue;
    source[bucket].refunds.push({
      amountCents: moneyToCents(refund.amount),
      isPackage: false,
    });
  }

  return new Map(
    [...sources].map(([businessId, source]) => [
      businessId,
      {
        current: toAllStoresKpi(source.current),
        previous: toAllStoresKpi(source.previous),
      },
    ]),
  );
}

type FinancialMetricSource = {
  invoices: FinancialMetricInvoice[];
  payments: FinancialMetricPayment[];
  refunds: FinancialMetricRefund[];
};

function emptyFinancialMetricSource(): FinancialMetricSource {
  return {
    invoices: [],
    payments: [],
    refunds: [],
  };
}

function toAllStoresKpi(source: FinancialMetricSource): AllStoresKpi {
  const metrics = calculateFinancialMetrics(source);
  return {
    averageTransactionValueCents: metrics.averageTransactionValueCents,
    grossSalesCents: metrics.grossSalesCents,
    netSalesCents: metrics.netSalesCents,
    paymentsCollectedCents: metrics.grossCollectionsCents,
    refundsCents: metrics.refundsCents,
    transactionCount: metrics.transactionCount,
  };
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

export function normalizeRange(value: string | undefined): AllStoresRange {
  if (!value || value === "today") return "today";
  if (value === "30days") return "month";
  if (value === "7days" || value === "month" || value === "custom") {
    return value;
  }
  throw new AllStoresKpiRangeError("Select a valid reporting range.");
}

export function validateCustomRange(
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

export function buildBusinessPeriods(input: {
  range: AllStoresRange;
  from: string | null;
  to: string | null;
  now: Date;
  timezone: string;
  businessDayCutoffTime: string;
}) {
  if (input.range === "month") {
    const currentToDateValue = getCurrentBusinessDateValue(
      input.now,
      input.timezone,
      input.businessDayCutoffTime,
    );
    const currentFromDateValue = startOfBusinessMonth(currentToDateValue);
    const previousMonthEndDateValue = addDaysToDateValue(
      currentFromDateValue,
      -1,
    );
    const previousFromDateValue = startOfBusinessMonth(
      previousMonthEndDateValue,
    );
    const currentIsMonthEnd =
      startOfBusinessMonth(addDaysToDateValue(currentToDateValue, 1)) !==
      currentFromDateValue;
    const elapsedCalendarDays = Number.parseInt(
      currentToDateValue.slice(8, 10),
      10,
    );
    const previousSameDayDateValue = addDaysToDateValue(
      previousFromDateValue,
      elapsedCalendarDays - 1,
    );
    const previousToDateValue =
      currentIsMonthEnd ||
      previousSameDayDateValue > previousMonthEndDateValue
        ? previousMonthEndDateValue
        : previousSameDayDateValue;
    const settings = {
      timezone: input.timezone,
      businessDayCutoffTime: input.businessDayCutoffTime,
    };

    return {
      current: getBusinessDayRange({
        ...settings,
        fromDateValue: currentFromDateValue,
        toDateValue: currentToDateValue,
      }),
      previous: getBusinessDayRange({
        ...settings,
        fromDateValue: previousFromDateValue,
        toDateValue: previousToDateValue,
      }),
    };
  }

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

export { getCurrentBusinessDateValue } from "@/lib/business-day";

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

export function sumKpis(values: AllStoresKpi[]) {
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
