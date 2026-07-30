import type {
  AnalyticsRefreshTrigger,
  PaymentMethod,
} from "@prisma/client";
import {
  ANALYTICS_BUSINESS_DAY_DEFINITION_VERSION,
  ANALYTICS_METRIC_DEFINITION_VERSION,
  MAX_ANALYTICS_REFRESH_DAYS,
} from "@/lib/analytics/constants";
import {
  addDaysToDateValue,
  dateValueToUtcDate,
  isValidDateValue,
} from "@/lib/business-time";
import {
  getBusinessDayRange,
  getCurrentBusinessDateValue,
} from "@/lib/business-day";
import { moneyToCents } from "@/lib/business-groups/all-stores-kpi";
import { DAILY_CLOSING_PAYMENT_METHODS } from "@/lib/daily-closing/types";
import {
  calculateFinancialMetrics,
  type FinancialMetrics,
} from "@/lib/financial-metrics";
import { prisma } from "@/lib/prisma";

export {
  ANALYTICS_BUSINESS_DAY_DEFINITION_VERSION,
  ANALYTICS_METRIC_DEFINITION_VERSION,
  MAX_ANALYTICS_REFRESH_DAYS,
} from "@/lib/analytics/constants";

type AnalyticsDatabase = Pick<
  typeof prisma,
  | "analyticsDailyPaymentMethodSummary"
  | "analyticsDailyStoreSummary"
  | "analyticsRefreshRun"
  | "business"
  | "invoice"
  | "payment"
  | "paymentRefund"
  | "$transaction"
>;

export type AnalyticsPaymentMethodMetric = {
  method: (typeof DAILY_CLOSING_PAYMENT_METHODS)[number];
  grossCollectionsCents: number;
  refundsCents: number;
  netCollectionsCents: number;
};

export type DailyStoreSummaryCandidate = FinancialMetrics & {
  businessId: string;
  businessDate: string;
  timezone: string;
  businessDayCutoffTime: string;
  metricDefinitionVersion: number;
  businessDayDefinitionVersion: number;
  sourceFrom: Date;
  sourceToExclusive: Date;
  sourceWatermark: Date | null;
  computedAt: Date;
  paymentMethods: AnalyticsPaymentMethodMetric[];
};

type SourceInvoice = {
  balance: unknown;
  discountAmount: unknown;
  loyaltyDiscountAmount: unknown;
  payments: Array<{ amount: unknown; status: string; updatedAt: Date }>;
  status: string;
  tipAmount: unknown;
  total: unknown;
  updatedAt: Date;
};

type SourcePayment = {
  amount: unknown;
  invoice: { status: string } | null;
  method: PaymentMethod;
  status: string;
  updatedAt: Date;
};

type SourceRefund = {
  amount: unknown;
  invoice: { status: string } | null;
  method: PaymentMethod;
  updatedAt: Date;
};

export type DailyStoreSummarySource = {
  invoices: SourceInvoice[];
  payments: SourcePayment[];
  refunds: SourceRefund[];
};

export type RefreshDailyStoreSummariesInput = {
  fromDate: string;
  toDate: string;
  businessIds?: string[];
  trigger?: AnalyticsRefreshTrigger;
};

export type RefreshDailyStoreSummariesResult = {
  runId: string;
  businessCount: number;
  summaryCount: number;
  sourceWatermark: Date | null;
};

export type AnalyticsSummaryDifference = {
  field: string;
  expected: number | null;
  actual: number | null;
};

export type AnalyticsSummaryComparison = {
  status: "MATCHED" | "MISMATCH" | "MISSING";
  businessId: string;
  businessDate: string;
  differences: AnalyticsSummaryDifference[];
  rawSourceWatermark: Date | null;
  storedSourceWatermark: Date | null;
};

export type AnalyticsSummaryRangeComparison = {
  status: "MATCHED" | "HAS_ISSUES";
  fromDate: string;
  toDate: string;
  businessCount: number;
  dayCount: number;
  comparisonCount: number;
  matchedCount: number;
  mismatchCount: number;
  missingCount: number;
  issues: AnalyticsSummaryComparison[];
};

export function validateAnalyticsRefreshRange(fromDate: string, toDate: string) {
  if (!isValidDateValue(fromDate) || !isValidDateValue(toDate)) {
    throw new Error("Analytics refresh requires valid YYYY-MM-DD dates.");
  }

  const from = dateValueToUtcDate(fromDate);
  const to = dateValueToUtcDate(toDate);
  const dayCount =
    Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;

  if (dayCount < 1) {
    throw new Error("Analytics refresh start date must be on or before its end date.");
  }
  if (dayCount > MAX_ANALYTICS_REFRESH_DAYS) {
    throw new Error(
      `Analytics refresh cannot exceed ${MAX_ANALYTICS_REFRESH_DAYS} days.`,
    );
  }

  return { dayCount };
}

export function listDateValues(fromDate: string, toDate: string) {
  const { dayCount } = validateAnalyticsRefreshRange(fromDate, toDate);
  return Array.from({ length: dayCount }, (_, index) =>
    addDaysToDateValue(fromDate, index),
  );
}

export function calculateDailyStoreSummaryCandidate(input: {
  businessId: string;
  businessDate: string;
  timezone: string;
  businessDayCutoffTime: string;
  range: { fromDate: Date; toDateExclusive: Date };
  source: DailyStoreSummarySource;
  computedAt?: Date;
}): DailyStoreSummaryCandidate {
  const activeInvoices = input.source.invoices.filter(
    (invoice) => invoice.status !== "VOID",
  );
  const activePayments = input.source.payments.filter(
    (payment) =>
      payment.status === "ACTIVE" &&
      payment.method !== "PACKAGE" &&
      payment.invoice?.status !== "VOID",
  );
  const activeRefunds = input.source.refunds.filter(
    (refund) =>
      refund.method !== "PACKAGE" && refund.invoice?.status !== "VOID",
  );
  const metrics = calculateFinancialMetrics({
    invoices: activeInvoices.map((invoice) => ({
      balanceCents: moneyToCents(invoice.balance),
      discountCents: moneyToCents(invoice.discountAmount),
      loyaltyDiscountCents: moneyToCents(invoice.loyaltyDiscountAmount),
      packageVoucherCents: invoice.payments
        .filter((payment) => payment.status === "ACTIVE")
        .reduce((sum, payment) => sum + moneyToCents(payment.amount), 0),
      status: invoice.status,
      tipCents: moneyToCents(invoice.tipAmount),
      totalCents: moneyToCents(invoice.total),
    })),
    payments: activePayments.map((payment) => ({
      amountCents: moneyToCents(payment.amount),
      isPackage: false,
    })),
    refunds: activeRefunds.map((refund) => ({
      amountCents: moneyToCents(refund.amount),
      isPackage: false,
    })),
  });
  const paymentMethods = DAILY_CLOSING_PAYMENT_METHODS.map((method) => {
    const grossCollectionsCents = activePayments
      .filter((payment) => payment.method === method)
      .reduce((sum, payment) => sum + moneyToCents(payment.amount), 0);
    const refundsCents = activeRefunds
      .filter((refund) => refund.method === method)
      .reduce((sum, refund) => sum + moneyToCents(refund.amount), 0);

    return {
      method,
      grossCollectionsCents,
      refundsCents,
      netCollectionsCents: grossCollectionsCents - refundsCents,
    };
  });
  const sourceWatermark = maxDate([
    ...input.source.invoices.flatMap((invoice) => [
      invoice.updatedAt,
      ...invoice.payments.map((payment) => payment.updatedAt),
    ]),
    ...input.source.payments.map((payment) => payment.updatedAt),
    ...input.source.refunds.map((refund) => refund.updatedAt),
  ]);

  return {
    ...metrics,
    businessId: input.businessId,
    businessDate: input.businessDate,
    timezone: input.timezone,
    businessDayCutoffTime: input.businessDayCutoffTime,
    metricDefinitionVersion: ANALYTICS_METRIC_DEFINITION_VERSION,
    businessDayDefinitionVersion:
      ANALYTICS_BUSINESS_DAY_DEFINITION_VERSION,
    sourceFrom: input.range.fromDate,
    sourceToExclusive: input.range.toDateExclusive,
    sourceWatermark,
    computedAt: input.computedAt ?? new Date(),
    paymentMethods,
  };
}

export async function computeDailyStoreSummary(
  input: {
    businessId: string;
    businessDate: string;
    timezone: string;
    businessDayCutoffTime: string;
    computedAt?: Date;
  },
  database: AnalyticsDatabase = prisma,
) {
  const range = getBusinessDayRange({
    fromDateValue: input.businessDate,
    toDateValue: input.businessDate,
    timezone: input.timezone,
    businessDayCutoffTime: input.businessDayCutoffTime,
  });
  const [invoices, payments, refunds] = await Promise.all([
    database.invoice.findMany({
      where: {
        businessId: input.businessId,
        issuedAt: { gte: range.fromDate, lt: range.toDateExclusive },
      },
      select: {
        balance: true,
        discountAmount: true,
        loyaltyDiscountAmount: true,
        payments: {
          where: { method: "PACKAGE" },
          select: { amount: true, status: true, updatedAt: true },
        },
        status: true,
        tipAmount: true,
        total: true,
        updatedAt: true,
      },
    }),
    database.payment.findMany({
      where: {
        businessId: input.businessId,
        paidAt: { gte: range.fromDate, lt: range.toDateExclusive },
      },
      select: {
        amount: true,
        invoice: { select: { status: true } },
        method: true,
        status: true,
        updatedAt: true,
      },
    }),
    database.paymentRefund.findMany({
      where: {
        businessId: input.businessId,
        refundedAt: { gte: range.fromDate, lt: range.toDateExclusive },
      },
      select: {
        amount: true,
        invoice: { select: { status: true } },
        method: true,
        updatedAt: true,
      },
    }),
  ]);

  return calculateDailyStoreSummaryCandidate({
    ...input,
    range,
    source: {
      invoices: invoices as SourceInvoice[],
      payments: payments as SourcePayment[],
      refunds: refunds as SourceRefund[],
    },
  });
}

export async function refreshDailyStoreSummaries(
  input: RefreshDailyStoreSummariesInput,
  database: AnalyticsDatabase = prisma,
): Promise<RefreshDailyStoreSummariesResult> {
  const dateValues = listDateValues(input.fromDate, input.toDate);
  const uniqueBusinessIds = input.businessIds
    ? [...new Set(input.businessIds.filter(Boolean))]
    : null;
  const businesses = await database.business.findMany({
    where: uniqueBusinessIds
      ? { id: { in: uniqueBusinessIds } }
      : { status: "active" },
    select: {
      id: true,
      timezone: true,
      businessDayCutoffTime: true,
    },
    orderBy: { id: "asc" },
  });

  if (uniqueBusinessIds && businesses.length !== uniqueBusinessIds.length) {
    const found = new Set(businesses.map((business) => business.id));
    const missing = uniqueBusinessIds.filter((id) => !found.has(id));
    throw new Error(`Analytics refresh businesses not found: ${missing.join(", ")}`);
  }

  const run = await database.analyticsRefreshRun.create({
    data: {
      trigger: input.trigger ?? "MANUAL",
      requestedFromDate: dateValueToUtcDate(input.fromDate),
      requestedToDate: dateValueToUtcDate(input.toDate),
      metricDefinitionVersion: ANALYTICS_METRIC_DEFINITION_VERSION,
      businessDayDefinitionVersion:
        ANALYTICS_BUSINESS_DAY_DEFINITION_VERSION,
      businessCount: businesses.length,
    },
    select: { id: true },
  });
  let summaryCount = 0;
  let sourceWatermark: Date | null = null;

  try {
    for (const business of businesses) {
      for (const businessDate of dateValues) {
        const candidate = await computeDailyStoreSummary(
          {
            businessId: business.id,
            timezone: business.timezone,
            businessDayCutoffTime: business.businessDayCutoffTime,
            businessDate,
          },
          database,
        );
        await persistDailyStoreSummary(candidate, run.id, database);
        summaryCount += 1;
        sourceWatermark = maxDate([
          sourceWatermark,
          candidate.sourceWatermark,
        ]);
      }
    }

    await database.analyticsRefreshRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCEEDED",
        summaryCount,
        sourceWatermark,
        completedAt: new Date(),
      },
    });
  } catch (error) {
    await database.analyticsRefreshRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        summaryCount,
        sourceWatermark,
        completedAt: new Date(),
        errorMessage: toErrorMessage(error),
      },
    });
    throw error;
  }

  return {
    runId: run.id,
    businessCount: businesses.length,
    summaryCount,
    sourceWatermark,
  };
}

export async function compareDailyStoreSummary(
  input: { businessId: string; businessDate: string },
  database: AnalyticsDatabase = prisma,
): Promise<AnalyticsSummaryComparison> {
  const business = await database.business.findUniqueOrThrow({
    where: { id: input.businessId },
    select: {
      id: true,
      timezone: true,
      businessDayCutoffTime: true,
    },
  });
  const raw = await computeDailyStoreSummary(
    {
      businessId: business.id,
      timezone: business.timezone,
      businessDayCutoffTime: business.businessDayCutoffTime,
      businessDate: input.businessDate,
    },
    database,
  );
  const stored = await database.analyticsDailyStoreSummary.findUnique({
    where: {
      businessId_businessDate_metricDefinitionVersion_businessDayDefinitionVersion:
        {
          businessId: input.businessId,
          businessDate: dateValueToUtcDate(input.businessDate),
          metricDefinitionVersion: ANALYTICS_METRIC_DEFINITION_VERSION,
          businessDayDefinitionVersion:
            ANALYTICS_BUSINESS_DAY_DEFINITION_VERSION,
        },
    },
    include: { paymentMethods: true },
  });

  if (!stored) {
    return {
      status: "MISSING",
      businessId: input.businessId,
      businessDate: input.businessDate,
      differences: [],
      rawSourceWatermark: raw.sourceWatermark,
      storedSourceWatermark: null,
    };
  }

  const differences: AnalyticsSummaryDifference[] = [];
  const metricFields = [
    "grossSalesCents",
    "discountsCents",
    "netSalesCents",
    "grossCollectionsCents",
    "netCollectionsCents",
    "refundsCents",
    "outstandingCents",
    "tipsCents",
    "packageVoucherCents",
    "transactionCount",
    "averageTransactionValueCents",
  ] as const;
  for (const field of metricFields) {
    if (raw[field] !== stored[field]) {
      differences.push({
        field,
        expected: raw[field],
        actual: stored[field],
      });
    }
  }
  const storedMethods = new Map(
    stored.paymentMethods.map((item) => [item.method, item]),
  );
  for (const expected of raw.paymentMethods) {
    const actual = storedMethods.get(expected.method);
    for (const field of [
      "grossCollectionsCents",
      "refundsCents",
      "netCollectionsCents",
    ] as const) {
      if (expected[field] !== (actual?.[field] ?? null)) {
        differences.push({
          field: `paymentMethods.${expected.method}.${field}`,
          expected: expected[field],
          actual: actual?.[field] ?? null,
        });
      }
    }
  }

  return {
    status: differences.length === 0 ? "MATCHED" : "MISMATCH",
    businessId: input.businessId,
    businessDate: input.businessDate,
    differences,
    rawSourceWatermark: raw.sourceWatermark,
    storedSourceWatermark: stored.sourceWatermark,
  };
}

export async function compareDailyStoreSummaryRange(
  input: {
    fromDate: string;
    toDate: string;
    businessIds?: string[];
  },
  database: AnalyticsDatabase = prisma,
): Promise<AnalyticsSummaryRangeComparison> {
  const dateValues = listDateValues(input.fromDate, input.toDate);
  const uniqueBusinessIds = input.businessIds
    ? [...new Set(input.businessIds.filter(Boolean))]
    : null;
  const businesses = await database.business.findMany({
    where: uniqueBusinessIds
      ? { id: { in: uniqueBusinessIds } }
      : { status: "active" },
    select: { id: true },
    orderBy: { id: "asc" },
  });

  if (uniqueBusinessIds && businesses.length !== uniqueBusinessIds.length) {
    const found = new Set(businesses.map((business) => business.id));
    const missing = uniqueBusinessIds.filter((id) => !found.has(id));
    throw new Error(
      `Analytics comparison businesses not found: ${missing.join(", ")}`,
    );
  }

  const comparisons: AnalyticsSummaryComparison[] = [];
  for (const business of businesses) {
    for (const businessDate of dateValues) {
      comparisons.push(
        await compareDailyStoreSummary(
          { businessId: business.id, businessDate },
          database,
        ),
      );
    }
  }

  return summarizeAnalyticsComparisons({
    fromDate: input.fromDate,
    toDate: input.toDate,
    businessCount: businesses.length,
    dayCount: dateValues.length,
    comparisons,
  });
}

export function summarizeAnalyticsComparisons(input: {
  fromDate: string;
  toDate: string;
  businessCount: number;
  dayCount: number;
  comparisons: AnalyticsSummaryComparison[];
}): AnalyticsSummaryRangeComparison {
  const mismatchCount = input.comparisons.filter(
    (comparison) => comparison.status === "MISMATCH",
  ).length;
  const missingCount = input.comparisons.filter(
    (comparison) => comparison.status === "MISSING",
  ).length;
  const matchedCount = input.comparisons.length - mismatchCount - missingCount;

  return {
    status:
      mismatchCount === 0 && missingCount === 0 ? "MATCHED" : "HAS_ISSUES",
    fromDate: input.fromDate,
    toDate: input.toDate,
    businessCount: input.businessCount,
    dayCount: input.dayCount,
    comparisonCount: input.comparisons.length,
    matchedCount,
    mismatchCount,
    missingCount,
    issues: input.comparisons.filter(
      (comparison) => comparison.status !== "MATCHED",
    ),
  };
}

export type EnsureAnalyticsDailyCoverageOptions = {
  businessIds?: string[];
  days?: number;
};

type AnalyticsCoverageBusiness = {
  id: string;
  createdAt: Date;
  timezone: string;
  businessDayCutoffTime: string;
};

type AnalyticsCoverageSummary = {
  businessId: string;
  businessDate: Date;
  timezone: string;
  businessDayCutoffTime: string;
  sourceFrom: Date;
  sourceToExclusive: Date;
};

export async function ensureAnalyticsDailyCoverage(
  at: Date,
  database: AnalyticsDatabase = prisma,
  options: EnsureAnalyticsDailyCoverageOptions = {},
  dependencies: {
    refreshSummaries?: typeof refreshDailyStoreSummaries;
  } = {},
) {
  if (Number.isNaN(at.getTime())) {
    throw new Error("Analytics coverage requires a valid timestamp.");
  }
  const days = options.days ?? 2;
  if (!Number.isSafeInteger(days) || days < 1 || days > 14) {
    throw new Error("Analytics coverage days must be between 1 and 14.");
  }
  if (options.businessIds?.length === 0) return [];

  const businesses = (await database.business.findMany({
    where: {
      status: "active",
      ...(options.businessIds
        ? { id: { in: options.businessIds } }
        : {}),
    },
    select: {
      id: true,
      createdAt: true,
      timezone: true,
      businessDayCutoffTime: true,
    },
  })) as AnalyticsCoverageBusiness[];
  if (businesses.length === 0) return [];

  const datesByBusiness = new Map<string, string[]>();
  for (const business of businesses) {
    const currentBusinessDate = getCurrentBusinessDateValue(
      at,
      business.timezone,
      business.businessDayCutoffTime,
    );
    const requestedFrom = addDaysToDateValue(currentBusinessDate, 1 - days);
    const createdBusinessDate = getCurrentBusinessDateValue(
      business.createdAt,
      business.timezone,
      business.businessDayCutoffTime,
    );
    const fromDate =
      requestedFrom > createdBusinessDate ? requestedFrom : createdBusinessDate;
    datesByBusiness.set(
      business.id,
      fromDate <= currentBusinessDate
        ? listDateValues(fromDate, currentBusinessDate)
        : [],
    );
  }

  const businessesWithDates = businesses.filter(
    (business) => (datesByBusiness.get(business.id)?.length ?? 0) > 0,
  );
  if (businessesWithDates.length === 0) return [];

  const summaries = (await database.analyticsDailyStoreSummary.findMany({
    where: {
      metricDefinitionVersion: ANALYTICS_METRIC_DEFINITION_VERSION,
      businessDayDefinitionVersion:
        ANALYTICS_BUSINESS_DAY_DEFINITION_VERSION,
      OR: businessesWithDates.map((business) => {
        const dates = datesByBusiness.get(business.id)!;
        return {
          businessId: business.id,
          businessDate: {
            gte: dateValueToUtcDate(dates[0]),
            lte: dateValueToUtcDate(dates[dates.length - 1]),
          },
        };
      }),
    },
    select: {
      businessId: true,
      businessDate: true,
      timezone: true,
      businessDayCutoffTime: true,
      sourceFrom: true,
      sourceToExclusive: true,
    },
  })) as AnalyticsCoverageSummary[];
  const summaryByKey = new Map(
    summaries.map((summary) => [
      `${summary.businessId}:${analyticsDateToValue(summary.businessDate)}`,
      summary,
    ]),
  );
  const requests = new Map<string, Set<string>>();

  for (const business of businessesWithDates) {
    const missingDates: string[] = [];
    for (const businessDate of datesByBusiness.get(business.id) ?? []) {
      const summary = summaryByKey.get(`${business.id}:${businessDate}`);
      const range = getBusinessDayRange({
        fromDateValue: businessDate,
        toDateValue: businessDate,
        timezone: business.timezone,
        businessDayCutoffTime: business.businessDayCutoffTime,
      });
      if (
        !summary ||
        summary.timezone !== business.timezone ||
        summary.businessDayCutoffTime !== business.businessDayCutoffTime ||
        summary.sourceFrom.getTime() !== range.fromDate.getTime() ||
        summary.sourceToExclusive.getTime() !==
          range.toDateExclusive.getTime()
      ) {
        missingDates.push(businessDate);
      }
    }
    for (const range of groupAnalyticsRefreshDateRanges(missingDates)) {
      const key = `${range.fromDate}:${range.toDate}`;
      const businessIds = requests.get(key) ?? new Set<string>();
      businessIds.add(business.id);
      requests.set(key, businessIds);
    }
  }

  const refreshSummaries =
    dependencies.refreshSummaries ?? refreshDailyStoreSummaries;
  const results: RefreshDailyStoreSummariesResult[] = [];
  for (const [key, businessIds] of requests) {
    const [fromDate, toDate] = key.split(":");
    results.push(
      await refreshSummaries(
        {
          businessIds: [...businessIds].sort(),
          fromDate,
          toDate,
          trigger: "SCHEDULED",
        },
        database,
      ),
    );
  }
  return results;
}

export async function refreshLateAnalyticsEvents(
  since: Date,
  database: AnalyticsDatabase = prisma,
  options: { businessIds?: string[]; until?: Date } = {},
) {
  if (Number.isNaN(since.getTime())) {
    throw new Error("Late-event refresh requires a valid timestamp.");
  }
  if (options.until && Number.isNaN(options.until.getTime())) {
    throw new Error("Late-event refresh requires a valid upper timestamp.");
  }
  const [invoices, payments, refunds] = await Promise.all([
    database.invoice.findMany({
      where: {
        updatedAt: {
          gt: since,
          ...(options.until ? { lte: options.until } : {}),
        },
        ...(options.businessIds ? { businessId: { in: options.businessIds } } : {}),
      },
      select: {
        businessId: true,
        issuedAt: true,
        payments: { select: { paidAt: true } },
        refunds: { select: { refundedAt: true } },
      },
    }),
    database.payment.findMany({
      where: {
        updatedAt: {
          gt: since,
          ...(options.until ? { lte: options.until } : {}),
        },
        ...(options.businessIds ? { businessId: { in: options.businessIds } } : {}),
      },
      select: {
        businessId: true,
        paidAt: true,
        invoice: { select: { issuedAt: true } },
      },
    }),
    database.paymentRefund.findMany({
      where: {
        updatedAt: {
          gt: since,
          ...(options.until ? { lte: options.until } : {}),
        },
        ...(options.businessIds ? { businessId: { in: options.businessIds } } : {}),
      },
      select: {
        businessId: true,
        refundedAt: true,
        invoice: { select: { issuedAt: true } },
      },
    }),
  ]);
  const events = [
    ...invoices.map((invoice) => ({
      businessId: invoice.businessId,
      dates: [
        invoice.issuedAt,
        ...invoice.payments.map((payment) => payment.paidAt),
        ...invoice.refunds.map((refund) => refund.refundedAt),
      ],
    })),
    ...payments.map((payment) => ({
      businessId: payment.businessId,
      dates: [payment.paidAt, payment.invoice?.issuedAt].filter(
        (date): date is Date => Boolean(date),
      ),
    })),
    ...refunds.map((refund) => ({
      businessId: refund.businessId,
      dates: [refund.refundedAt, refund.invoice?.issuedAt].filter(
        (date): date is Date => Boolean(date),
      ),
    })),
  ];
  const businessIds = [...new Set(events.map((event) => event.businessId))];
  if (businessIds.length === 0) return [];

  const businesses = await database.business.findMany({
    where: { id: { in: businessIds } },
    select: { id: true, timezone: true, businessDayCutoffTime: true },
  });
  const settings = new Map(businesses.map((business) => [business.id, business]));
  const datesByBusiness = new Map<string, Set<string>>();
  for (const event of events) {
    const business = settings.get(event.businessId);
    if (!business) continue;
    const dates = datesByBusiness.get(event.businessId) ?? new Set<string>();
    for (const date of event.dates) {
      dates.add(
        getCurrentBusinessDateValue(
          date,
          business.timezone,
          business.businessDayCutoffTime,
        ),
      );
    }
    datesByBusiness.set(event.businessId, dates);
  }

  const results: RefreshDailyStoreSummariesResult[] = [];
  for (const [businessId, dateSet] of datesByBusiness) {
    for (const range of groupAnalyticsRefreshDateRanges([...dateSet])) {
      results.push(
        await refreshDailyStoreSummaries(
          {
            businessIds: [businessId],
            fromDate: range.fromDate,
            toDate: range.toDate,
            trigger: "LATE_EVENT",
          },
          database,
        ),
      );
    }
  }
  return results;
}

export function groupAnalyticsRefreshDateRanges(dateValues: string[]) {
  const sorted = [...new Set(dateValues)].sort();
  for (const dateValue of sorted) {
    if (!isValidDateValue(dateValue)) {
      throw new Error("Analytics refresh grouping requires valid dates.");
    }
  }
  const ranges: Array<{ fromDate: string; toDate: string }> = [];
  let fromDate: string | null = null;
  let previousDate: string | null = null;
  let rangeDayCount = 0;

  for (const dateValue of sorted) {
    const consecutive =
      previousDate !== null &&
      addDaysToDateValue(previousDate, 1) === dateValue &&
      rangeDayCount < MAX_ANALYTICS_REFRESH_DAYS;
    if (!consecutive) {
      if (fromDate && previousDate) {
        ranges.push({ fromDate, toDate: previousDate });
      }
      fromDate = dateValue;
      rangeDayCount = 1;
    } else {
      rangeDayCount += 1;
    }
    previousDate = dateValue;
  }
  if (fromDate && previousDate) {
    ranges.push({ fromDate, toDate: previousDate });
  }
  return ranges;
}

function analyticsDateToValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function persistDailyStoreSummary(
  candidate: DailyStoreSummaryCandidate,
  refreshRunId: string,
  database: AnalyticsDatabase,
) {
  const businessDate = dateValueToUtcDate(candidate.businessDate);
  await database.$transaction(async (transaction) => {
    const summary = await transaction.analyticsDailyStoreSummary.upsert({
      where: {
        businessId_businessDate_metricDefinitionVersion_businessDayDefinitionVersion:
          {
            businessId: candidate.businessId,
            businessDate,
            metricDefinitionVersion: candidate.metricDefinitionVersion,
            businessDayDefinitionVersion:
              candidate.businessDayDefinitionVersion,
          },
      },
      create: summaryData(candidate, businessDate, refreshRunId),
      update: summaryData(candidate, businessDate, refreshRunId),
      select: { id: true },
    });

    for (const method of candidate.paymentMethods) {
      await transaction.analyticsDailyPaymentMethodSummary.upsert({
        where: {
          dailySummaryId_method: {
            dailySummaryId: summary.id,
            method: method.method,
          },
        },
        create: {
          dailySummaryId: summary.id,
          businessId: candidate.businessId,
          businessDate,
          method: method.method,
          metricDefinitionVersion: candidate.metricDefinitionVersion,
          grossCollectionsCents: method.grossCollectionsCents,
          refundsCents: method.refundsCents,
          netCollectionsCents: method.netCollectionsCents,
        },
        update: {
          businessId: candidate.businessId,
          businessDate,
          metricDefinitionVersion: candidate.metricDefinitionVersion,
          grossCollectionsCents: method.grossCollectionsCents,
          refundsCents: method.refundsCents,
          netCollectionsCents: method.netCollectionsCents,
        },
      });
    }
  });
}

function summaryData(
  candidate: DailyStoreSummaryCandidate,
  businessDate: Date,
  refreshRunId: string,
) {
  return {
    businessId: candidate.businessId,
    refreshRunId,
    businessDate,
    timezone: candidate.timezone,
    businessDayCutoffTime: candidate.businessDayCutoffTime,
    businessDayDefinitionVersion:
      candidate.businessDayDefinitionVersion,
    metricDefinitionVersion: candidate.metricDefinitionVersion,
    grossSalesCents: candidate.grossSalesCents,
    discountsCents: candidate.discountsCents,
    netSalesCents: candidate.netSalesCents,
    grossCollectionsCents: candidate.grossCollectionsCents,
    netCollectionsCents: candidate.netCollectionsCents,
    refundsCents: candidate.refundsCents,
    outstandingCents: candidate.outstandingCents,
    tipsCents: candidate.tipsCents,
    packageVoucherCents: candidate.packageVoucherCents,
    transactionCount: candidate.transactionCount,
    averageTransactionValueCents:
      candidate.averageTransactionValueCents,
    sourceFrom: candidate.sourceFrom,
    sourceToExclusive: candidate.sourceToExclusive,
    sourceWatermark: candidate.sourceWatermark,
    computedAt: candidate.computedAt,
  };
}

function maxDate(values: Array<Date | null | undefined>) {
  const timestamps = values
    .filter((value): value is Date => Boolean(value))
    .map((value) => value.getTime());
  return timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null;
}

function toErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 2_000);
}
