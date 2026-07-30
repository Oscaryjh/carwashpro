import type { Prisma } from "@prisma/client";
import {
  ANALYTICS_BUSINESS_DAY_DEFINITION_VERSION,
  ANALYTICS_METRIC_DEFINITION_VERSION,
  MAX_ANALYTICS_REFRESH_DAYS,
} from "@/lib/analytics/constants";
import {
  getBusinessDayRange,
  getCurrentBusinessDateValue,
} from "@/lib/business-day";
import type { AuthorizedGroupBusiness } from "@/lib/business-groups/all-stores-access";
import { intersectBusinessMemberships } from "@/lib/business-groups/historical-membership";
import {
  addDaysToDateValue,
  dateValueToUtcDate,
  isValidDateValue,
} from "@/lib/business-time";
import { prisma } from "@/lib/prisma";

const MAX_STALE_CHANGE_CANDIDATES = 2_000;

export type DailySummaryDateWindow = {
  fromDateValue: string;
  toDateValue: string;
};

export type AuthorizedBusinessDailySummaryRead = {
  business: AuthorizedGroupBusiness;
  windows: readonly DailySummaryDateWindow[];
};

export type DailySummaryReadFailureReason =
  | "INVALID_RANGE"
  | "INVALID_MEMBERSHIP_CONTEXT"
  | "UNSAFE_MEMBERSHIP"
  | "MISSING_SUMMARIES"
  | "VERSION_MISMATCH"
  | "INVALID_SUMMARIES"
  | "STALE_SUMMARIES";

export type AnalyticsDailyRow = {
  averageTransactionValueCents: number | null;
  businessDate: Date;
  businessDayCutoffTime: string;
  businessDayDefinitionVersion: number;
  businessId: string;
  computedAt: Date;
  discountsCents: number;
  grossCollectionsCents: number;
  grossSalesCents: number;
  metricDefinitionVersion: number;
  netCollectionsCents: number;
  netSalesCents: number;
  outstandingCents: number;
  packageVoucherCents: number;
  refundsCents: number;
  sourceFrom: Date;
  sourceToExclusive: Date;
  sourceWatermark: Date | null;
  timezone: string;
  tipsCents: number;
  transactionCount: number;
};

export type DailySummaryReadResult =
  | {
      ok: true;
      rows: AnalyticsDailyRow[];
      expectedRowCount: number;
      checkedAt: Date;
      oldestComputedAt: Date | null;
      newestComputedAt: Date | null;
    }
  | {
      ok: false;
      reason: DailySummaryReadFailureReason;
      checkedAt: Date;
    };

export type DailySummaryReadDatabase = Pick<
  Prisma.TransactionClient,
  "analyticsDailyStoreSummary" | "invoice" | "payment" | "paymentRefund"
>;

export async function readAuthorizedDailyStoreSummaries(
  input: {
    reads: readonly AuthorizedBusinessDailySummaryRead[];
    checkedAt?: Date;
    requireMembershipHistory?: boolean;
  },
  database: DailySummaryReadDatabase = prisma,
): Promise<DailySummaryReadResult> {
  const checkedAt = input.checkedAt ?? new Date();
  if (input.reads.length === 0) {
    return {
      ok: true,
      rows: [],
      expectedRowCount: 0,
      checkedAt,
      oldestComputedAt: null,
      newestComputedAt: null,
    };
  }

  const normalizedReads = normalizeReads(input.reads);
  if (!normalizedReads) {
    return { ok: false, reason: "INVALID_RANGE", checkedAt };
  }
  if (
    input.requireMembershipHistory &&
    normalizedReads.some(
      ({ business }) => !business.membershipPeriods?.length,
    )
  ) {
    return {
      ok: false,
      reason: "INVALID_MEMBERSHIP_CONTEXT",
      checkedAt,
    };
  }

  const allWindows = normalizedReads.flatMap((read) => read.windows);
  const earliestDateValue = allWindows
    .map((window) => window.fromDateValue)
    .sort()[0];
  const latestDateValue = allWindows
    .map((window) => window.toDateValue)
    .sort()
    .at(-1)!;
  const spanDays = dateDifferenceDays(
    earliestDateValue,
    latestDateValue,
  ) + 1;
  if (spanDays > MAX_ANALYTICS_REFRESH_DAYS) {
    return { ok: false, reason: "INVALID_RANGE", checkedAt };
  }

  const queryWindows = mergeDateWindows(allWindows);
  const expectedDates = new Map<string, string[]>();
  const unauthorizedRanges: Array<{
    businessId: string;
    gte: Date;
    lt: Date;
  }> = [];
  for (const { business, windows } of normalizedReads) {
    const includedDates: string[] = [];
    for (const businessDate of listWindowDateValues(windows)) {
      const range = getBusinessDayRange({
        fromDateValue: businessDate,
        toDateValue: businessDate,
        timezone: business.timezone,
        businessDayCutoffTime: business.businessDayCutoffTime,
      });
      const intersections = intersectBusinessMemberships(
        business,
        range.fromDate,
        range.toDateExclusive,
      );
      if (intersections.length === 0) continue;
      includedDates.push(businessDate);
      if (
        !isRangeFullyAuthorized(
          business,
          range.fromDate,
          range.toDateExclusive,
        )
      ) {
        unauthorizedRanges.push(
          ...subtractAuthorizedRanges(
            business.id,
            range.fromDate,
            range.toDateExclusive,
            intersections,
          ),
        );
      }
    }
    expectedDates.set(business.id, includedDates);
  }

  if (
    unauthorizedRanges.length > 0 &&
    (await hasFinancialEventsInRanges(unauthorizedRanges, database))
  ) {
    return { ok: false, reason: "UNSAFE_MEMBERSHIP", checkedAt };
  }

  const expectedRowCount = [...expectedDates.values()].reduce(
    (total, dates) => total + dates.length,
    0,
  );
  if (expectedRowCount === 0) {
    return {
      ok: true,
      rows: [],
      expectedRowCount,
      checkedAt,
      oldestComputedAt: null,
      newestComputedAt: null,
    };
  }

  const rows = (await database.analyticsDailyStoreSummary.findMany({
    where: {
      businessId: {
        in: normalizedReads.map(({ business }) => business.id),
      },
      OR: queryWindows.map((window) => ({
        businessDate: {
          gte: dateValueToUtcDate(window.fromDateValue),
          lte: dateValueToUtcDate(window.toDateValue),
        },
      })),
    },
    select: {
      averageTransactionValueCents: true,
      businessDate: true,
      businessDayCutoffTime: true,
      businessDayDefinitionVersion: true,
      businessId: true,
      computedAt: true,
      discountsCents: true,
      grossCollectionsCents: true,
      grossSalesCents: true,
      metricDefinitionVersion: true,
      netCollectionsCents: true,
      netSalesCents: true,
      outstandingCents: true,
      packageVoucherCents: true,
      refundsCents: true,
      sourceFrom: true,
      sourceToExclusive: true,
      sourceWatermark: true,
      timezone: true,
      tipsCents: true,
      transactionCount: true,
    },
  })) as AnalyticsDailyRow[];
  const rowsByKey = new Map<string, AnalyticsDailyRow[]>();
  for (const row of rows) {
    const key = analyticsDailyKey(
      row.businessId,
      analyticsBusinessDateValue(row),
    );
    const existing = rowsByKey.get(key) ?? [];
    existing.push(row);
    rowsByKey.set(key, existing);
  }

  const authorizedRows: AnalyticsDailyRow[] = [];
  for (const { business } of normalizedReads) {
    for (const businessDate of expectedDates.get(business.id) ?? []) {
      const candidates =
        rowsByKey.get(analyticsDailyKey(business.id, businessDate)) ?? [];
      const row = candidates.find(
        (candidate) =>
          candidate.metricDefinitionVersion ===
            ANALYTICS_METRIC_DEFINITION_VERSION &&
          candidate.businessDayDefinitionVersion ===
            ANALYTICS_BUSINESS_DAY_DEFINITION_VERSION,
      );
      if (!row) {
        return {
          ok: false,
          reason:
            candidates.length > 0
              ? "VERSION_MISMATCH"
              : "MISSING_SUMMARIES",
          checkedAt,
        };
      }
      const expectedRange = getBusinessDayRange({
        fromDateValue: businessDate,
        toDateValue: businessDate,
        timezone: business.timezone,
        businessDayCutoffTime: business.businessDayCutoffTime,
      });
      if (
        row.timezone !== business.timezone ||
        row.businessDayCutoffTime !== business.businessDayCutoffTime ||
        row.sourceFrom.getTime() !== expectedRange.fromDate.getTime() ||
        row.sourceToExclusive.getTime() !==
          expectedRange.toDateExclusive.getTime()
      ) {
        return { ok: false, reason: "INVALID_SUMMARIES", checkedAt };
      }
      authorizedRows.push(row);
    }
  }

  if (
    await hasSourceChangesAfterSummary(
      authorizedRows,
      normalizedReads.map(({ business }) => business),
      database,
    )
  ) {
    return { ok: false, reason: "STALE_SUMMARIES", checkedAt };
  }

  authorizedRows.sort(
    (left, right) =>
      left.businessDate.getTime() - right.businessDate.getTime() ||
      left.businessId.localeCompare(right.businessId),
  );
  const computedTimes = authorizedRows.map((row) => row.computedAt.getTime());
  return {
    ok: true,
    rows: authorizedRows,
    expectedRowCount,
    checkedAt,
    oldestComputedAt: new Date(Math.min(...computedTimes)),
    newestComputedAt: new Date(Math.max(...computedTimes)),
  };
}

function normalizeReads(
  reads: readonly AuthorizedBusinessDailySummaryRead[],
): AuthorizedBusinessDailySummaryRead[] | null {
  const normalized: AuthorizedBusinessDailySummaryRead[] = [];
  const businessIds = new Set<string>();
  for (const read of reads) {
    if (businessIds.has(read.business.id) || read.windows.length === 0) {
      return null;
    }
    businessIds.add(read.business.id);
    const windows = read.windows.map((window) => ({ ...window }));
    for (const window of windows) {
      if (
        !isValidDateValue(window.fromDateValue) ||
        !isValidDateValue(window.toDateValue) ||
        window.fromDateValue > window.toDateValue
      ) {
        return null;
      }
    }
    normalized.push({ business: read.business, windows });
  }
  return normalized;
}

function listWindowDateValues(windows: readonly DailySummaryDateWindow[]) {
  const values = new Set<string>();
  for (const window of windows) {
    const count =
      dateDifferenceDays(window.fromDateValue, window.toDateValue) + 1;
    for (let index = 0; index < count; index += 1) {
      values.add(addDaysToDateValue(window.fromDateValue, index));
    }
  }
  return [...values].sort();
}

function mergeDateWindows(
  windows: readonly DailySummaryDateWindow[],
) {
  const merged: DailySummaryDateWindow[] = [];
  for (const window of [...windows].sort(
    (left, right) =>
      left.fromDateValue.localeCompare(right.fromDateValue) ||
      left.toDateValue.localeCompare(right.toDateValue),
  )) {
    const previous = merged.at(-1);
    if (
      previous &&
      window.fromDateValue <=
        addDaysToDateValue(previous.toDateValue, 1)
    ) {
      if (window.toDateValue > previous.toDateValue) {
        previous.toDateValue = window.toDateValue;
      }
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

function dateDifferenceDays(fromDateValue: string, toDateValue: string) {
  return Math.round(
    (dateValueToUtcDate(toDateValue).getTime() -
      dateValueToUtcDate(fromDateValue).getTime()) /
      86_400_000,
  );
}

function subtractAuthorizedRanges(
  businessId: string,
  gte: Date,
  lt: Date,
  authorized: Array<{ gte: Date; lt: Date }>,
) {
  const ranges: Array<{ businessId: string; gte: Date; lt: Date }> = [];
  let cursor = gte;
  for (const range of [...authorized].sort(
    (left, right) => left.gte.getTime() - right.gte.getTime(),
  )) {
    if (range.gte > cursor) {
      ranges.push({ businessId, gte: cursor, lt: range.gte });
    }
    if (range.lt > cursor) cursor = range.lt;
  }
  if (cursor < lt) ranges.push({ businessId, gte: cursor, lt });
  return ranges;
}

async function hasFinancialEventsInRanges(
  ranges: Array<{ businessId: string; gte: Date; lt: Date }>,
  database: DailySummaryReadDatabase,
) {
  const [invoice, payment, refund] = await Promise.all([
    database.invoice.findFirst({
      where: {
        status: { not: "VOID" },
        OR: ranges.map(({ businessId, gte, lt }) => ({
          businessId,
          issuedAt: { gte, lt },
        })),
      },
      select: { id: true },
    }),
    database.payment.findFirst({
      where: {
        status: "ACTIVE",
        method: { not: "PACKAGE" },
        AND: [
          {
            OR: ranges.map(({ businessId, gte, lt }) => ({
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
      select: { id: true },
    }),
    database.paymentRefund.findFirst({
      where: {
        method: { not: "PACKAGE" },
        AND: [
          {
            OR: ranges.map(({ businessId, gte, lt }) => ({
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
      select: { id: true },
    }),
  ]);
  return Boolean(invoice || payment || refund);
}

async function hasSourceChangesAfterSummary(
  rows: AnalyticsDailyRow[],
  businesses: AuthorizedGroupBusiness[],
  database: DailySummaryReadDatabase,
) {
  if (rows.length === 0) return false;
  const oldestComputedAt = new Date(
    Math.min(...rows.map((row) => row.computedAt.getTime())),
  );
  const businessIds = businesses.map((business) => business.id);
  const eventRanges = mergeSourceRanges(rows);
  const invoiceEventFilters = eventRanges.map(
    ({ businessId, gte, lt }) => ({
      businessId,
      issuedAt: { gte, lt },
    }),
  );
  const paymentEventFilters = [
    ...eventRanges.map(({ businessId, gte, lt }) => ({
      businessId,
      paidAt: { gte, lt },
    })),
    ...eventRanges.map(({ businessId, gte, lt }) => ({
      businessId,
      invoice: { issuedAt: { gte, lt } },
    })),
  ];
  const refundEventFilters = [
    ...eventRanges.map(({ businessId, gte, lt }) => ({
      businessId,
      refundedAt: { gte, lt },
    })),
    ...eventRanges.map(({ businessId, gte, lt }) => ({
      businessId,
      invoice: { issuedAt: { gte, lt } },
    })),
  ];
  const [invoices, payments, refunds] = await Promise.all([
    database.invoice.findMany({
      where: {
        businessId: { in: businessIds },
        updatedAt: { gt: oldestComputedAt },
        OR: invoiceEventFilters,
      },
      select: {
        businessId: true,
        issuedAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: MAX_STALE_CHANGE_CANDIDATES + 1,
    }),
    database.payment.findMany({
      where: {
        businessId: { in: businessIds },
        updatedAt: { gt: oldestComputedAt },
        OR: paymentEventFilters,
      },
      select: {
        businessId: true,
        paidAt: true,
        updatedAt: true,
        invoice: { select: { issuedAt: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: MAX_STALE_CHANGE_CANDIDATES + 1,
    }),
    database.paymentRefund.findMany({
      where: {
        businessId: { in: businessIds },
        updatedAt: { gt: oldestComputedAt },
        OR: refundEventFilters,
      },
      select: {
        businessId: true,
        refundedAt: true,
        updatedAt: true,
        invoice: { select: { issuedAt: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: MAX_STALE_CHANGE_CANDIDATES + 1,
    }),
  ]);
  if (
    invoices.length > MAX_STALE_CHANGE_CANDIDATES ||
    payments.length > MAX_STALE_CHANGE_CANDIDATES ||
    refunds.length > MAX_STALE_CHANGE_CANDIDATES
  ) {
    return true;
  }
  const businessById = new Map(
    businesses.map((business) => [business.id, business]),
  );
  const rowByKey = new Map(
    rows.map((row) => [
      analyticsDailyKey(row.businessId, analyticsBusinessDateValue(row)),
      row,
    ]),
  );
  const changes = [
    ...invoices.map((invoice) => ({
      businessId: invoice.businessId,
      updatedAt: invoice.updatedAt,
      eventDates: [invoice.issuedAt],
    })),
    ...payments.map((payment) => ({
      businessId: payment.businessId,
      updatedAt: payment.updatedAt,
      eventDates: [payment.paidAt, payment.invoice?.issuedAt].filter(
        (date): date is Date => Boolean(date),
      ),
    })),
    ...refunds.map((refund) => ({
      businessId: refund.businessId,
      updatedAt: refund.updatedAt,
      eventDates: [refund.refundedAt, refund.invoice?.issuedAt].filter(
        (date): date is Date => Boolean(date),
      ),
    })),
  ];

  return changes.some((change) => {
    const business = businessById.get(change.businessId);
    if (!business) return false;
    return change.eventDates.some((eventDate) => {
      const businessDate = getCurrentBusinessDateValue(
        eventDate,
        business.timezone,
        business.businessDayCutoffTime,
      );
      const row = rowByKey.get(
        analyticsDailyKey(change.businessId, businessDate),
      );
      return Boolean(row && change.updatedAt > row.computedAt);
    });
  });
}

function mergeSourceRanges(rows: AnalyticsDailyRow[]) {
  const rangesByBusiness = new Map<
    string,
    Array<{ businessId: string; gte: Date; lt: Date }>
  >();
  for (const row of rows) {
    const ranges = rangesByBusiness.get(row.businessId) ?? [];
    ranges.push({
      businessId: row.businessId,
      gte: row.sourceFrom,
      lt: row.sourceToExclusive,
    });
    rangesByBusiness.set(row.businessId, ranges);
  }
  return [...rangesByBusiness.values()].flatMap((ranges) => {
    const merged: Array<{ businessId: string; gte: Date; lt: Date }> = [];
    for (const range of ranges.sort(
      (left, right) => left.gte.getTime() - right.gte.getTime(),
    )) {
      const previous = merged.at(-1);
      if (previous && range.gte <= previous.lt) {
        if (range.lt > previous.lt) previous.lt = range.lt;
      } else {
        merged.push({ ...range });
      }
    }
    return merged;
  });
}

export function isRangeFullyAuthorized(
  business: AuthorizedGroupBusiness,
  gte: Date,
  lt: Date,
) {
  const intersections = intersectBusinessMemberships(business, gte, lt).sort(
    (left, right) => left.gte.getTime() - right.gte.getTime(),
  );
  let cursor = gte;
  for (const intersection of intersections) {
    if (intersection.gte > cursor) return false;
    if (intersection.lt > cursor) cursor = intersection.lt;
    if (cursor >= lt) return true;
  }
  return false;
}

export function analyticsBusinessDateValue(row: Pick<AnalyticsDailyRow, "businessDate">) {
  return row.businessDate.toISOString().slice(0, 10);
}

function analyticsDailyKey(businessId: string, businessDate: string) {
  return `${businessId}:${businessDate}`;
}
