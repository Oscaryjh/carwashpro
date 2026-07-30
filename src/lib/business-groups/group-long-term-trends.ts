import {
  analyticsBusinessDateValue,
  readAuthorizedDailyStoreSummaries,
  type AnalyticsDailyRow,
  type DailySummaryDateWindow,
  type DailySummaryReadDatabase,
  type DailySummaryReadFailureReason,
} from "@/lib/analytics/daily-summary-read";
import {
  getBusinessDayRange,
  getCurrentBusinessDateValue,
} from "@/lib/business-day";
import {
  resolveAuthorizedGroupReportingScope,
  type AuthorizedGroupBusiness,
  type AuthorizedGroupReportingContext,
} from "@/lib/business-groups/all-stores-access";
import {
  compareKpiValues,
  dailyRowToKpi,
  sumKpis,
  type AllStoresKpi,
  type AllStoresKpiComparison,
} from "@/lib/business-groups/all-stores-kpi";
import {
  getReportingBusinesses,
  hasMembershipOverlap,
} from "@/lib/business-groups/historical-membership";
import {
  addDaysToDateValue,
  dateValueToUtcDate,
  utcDateToDateValue,
} from "@/lib/business-time";
import { prisma } from "@/lib/prisma";

export type GroupLongTermTrendPreset = "month" | "ytd" | "12months";
export type GroupLongTermTrendResolution = "DAY" | "MONTH";

export type GroupTrendWindow = {
  fromDateValue: string;
  toDateValue: string;
};

export type GroupTrendComparisonPlan = {
  key: "MOM" | "YOY";
  label: string;
  current: GroupTrendWindow;
  previous: GroupTrendWindow;
};

export type GroupTrendBusinessPlan = {
  currentBusinessDateValue: string;
  display: GroupTrendWindow;
  comparisons: GroupTrendComparisonPlan[];
};

export type GroupLongTermTrendPoint = AllStoresKpi & {
  key: string;
  fromDateValue: string;
  toDateValue: string;
  storeCount: number;
  hasCoverage: boolean;
  isPartial: boolean;
};

export type GroupLongTermTrendComparison = {
  key: GroupTrendComparisonPlan["key"];
  label: string;
  currentNetSalesCents: number;
  previousNetSalesCents: number;
  comparison: AllStoresKpiComparison;
};

type GroupLongTermTrendBase = {
  groupId: string;
  groupName: string;
  role: AuthorizedGroupReportingContext["role"];
  preset: GroupLongTermTrendPreset;
  presetLabel: string;
  authorizedBusinessCount: number;
  checkedAt: Date;
};

export type GroupLongTermTrendReadyReport = GroupLongTermTrendBase & {
  status: "READY";
  dataSource: "DAILY_SUMMARY";
  resolution: GroupLongTermTrendResolution;
  fromDateValue: string;
  toDateValue: string;
  current: AllStoresKpi;
  comparisons: GroupLongTermTrendComparison[];
  points: GroupLongTermTrendPoint[];
  scopeChanged: boolean;
  displaySummaryCount: number;
  expectedSummaryCount: number;
  oldestComputedAt: Date | null;
  newestComputedAt: Date | null;
};

export type GroupLongTermTrendUnavailableReport = GroupLongTermTrendBase & {
  status: "UNAVAILABLE";
  reason: DailySummaryReadFailureReason;
};

export type GroupLongTermTrendReport =
  | GroupLongTermTrendReadyReport
  | GroupLongTermTrendUnavailableReport;

type ResolveScope = typeof resolveAuthorizedGroupReportingScope;
type ReadSummaries = typeof readAuthorizedDailyStoreSummaries;

export type GroupLongTermTrendDependencies = {
  cacheTtlMs?: number;
  now?: Date;
  resolveScope?: ResolveScope;
  readSummaries?: ReadSummaries;
};

type GroupTrendSummaryReadResult = Awaited<ReturnType<ReadSummaries>>;

const DEFAULT_GROUP_TREND_CACHE_TTL_MS = 30_000;
const MAX_GROUP_TREND_CACHE_ENTRIES = 100;
const groupTrendSummaryCache = new Map<
  string,
  { expiresAt: number; value: Promise<GroupTrendSummaryReadResult> }
>();

export async function getGroupLongTermTrendReport(
  input: {
    userId: string;
    groupId: string;
    activeBusinessId: string;
    preset?: string;
  },
  database: DailySummaryReadDatabase = prisma,
  dependencies: GroupLongTermTrendDependencies = {},
): Promise<GroupLongTermTrendReport | null> {
  const resolveScope =
    dependencies.resolveScope ?? resolveAuthorizedGroupReportingScope;
  const scope = await resolveScope(
    input.userId,
    input.groupId,
    input.activeBusinessId,
  );
  if (!scope || !scope.canViewAllStores) return null;

  const preset = normalizeGroupLongTermTrendPreset(input.preset);
  const now = dependencies.now ?? new Date();
  const businesses = getReportingBusinesses(scope);
  const anchorBusinesses =
    scope.businesses.length > 0 ? scope.businesses : businesses;
  const groupBusinessDateValue = anchorBusinesses
    .map((business) =>
      getCurrentBusinessDateValue(
        now,
        business.timezone,
        business.businessDayCutoffTime,
      ),
    )
    .sort()[0];
  const sharedPlan = buildGroupTrendBusinessPlan(
    preset,
    groupBusinessDateValue,
  );
  const plans = new Map(
    businesses.map((business) => [
      business.id,
      sharedPlan,
    ]),
  );
  const checkedAt = new Date();
  const readSummaries =
    dependencies.readSummaries ?? readAuthorizedDailyStoreSummaries;
  const summaryReadInput = {
    reads: businesses.map((business) => ({
      business,
      windows: uniqueWindows(plans.get(business.id)!),
    })),
    checkedAt,
    requireMembershipHistory: true,
  };
  const cacheTtlMs =
    dependencies.cacheTtlMs ??
    (database === prisma ? DEFAULT_GROUP_TREND_CACHE_TTL_MS : 0);
  const summaryRead = await readGroupTrendSummariesWithCache(
    buildGroupTrendCacheKey({
      activeBusinessId: input.activeBusinessId,
      businesses,
      groupBusinessDateValue,
      groupId: input.groupId,
      preset,
      userId: input.userId,
    }),
    cacheTtlMs,
    () => readSummaries(summaryReadInput, database),
  );
  const base = {
    groupId: scope.groupId,
    groupName: scope.groupName,
    role: scope.role,
    preset,
    presetLabel: presetContent[preset].label,
    authorizedBusinessCount: businesses.length,
    checkedAt: summaryRead.checkedAt,
  };
  if (!summaryRead.ok) {
    return {
      ...base,
      status: "UNAVAILABLE",
      reason: summaryRead.reason,
    };
  }

  const rowsByBusiness = groupRowsByBusiness(summaryRead.rows);
  const current = sumKpis(
    businesses.map((business) =>
      sumRowsInWindow(
        rowsByBusiness.get(business.id) ?? [],
        plans.get(business.id)!.display,
      ),
    ),
  );
  const comparisons = buildComparisons(
    businesses,
    plans,
    rowsByBusiness,
  );
  const displayRows = businesses.flatMap((business) =>
    rowsInWindow(
      rowsByBusiness.get(business.id) ?? [],
      plans.get(business.id)!.display,
    ),
  );
  const points = buildTrendPoints(preset, businesses, plans, rowsByBusiness);
  const displayWindows = businesses.map(
    (business) => plans.get(business.id)!.display,
  );

  return {
    ...base,
    status: "READY",
    dataSource: "DAILY_SUMMARY",
    resolution: preset === "month" ? "DAY" : "MONTH",
    fromDateValue: displayWindows
      .map((window) => window.fromDateValue)
      .sort()[0],
    toDateValue: displayWindows
      .map((window) => window.toDateValue)
      .sort()
      .at(-1)!,
    current,
    comparisons,
    points,
    scopeChanged: businesses.some((business) =>
      hasMembershipCompositionChange(
        business,
        plans.get(business.id)!,
      )),
    displaySummaryCount: displayRows.length,
    expectedSummaryCount: summaryRead.expectedRowCount,
    oldestComputedAt: summaryRead.oldestComputedAt,
    newestComputedAt: summaryRead.newestComputedAt,
  };
}

async function readGroupTrendSummariesWithCache(
  key: string,
  ttlMs: number,
  load: () => Promise<GroupTrendSummaryReadResult>,
) {
  if (ttlMs <= 0) return load();

  const now = Date.now();
  const cached = groupTrendSummaryCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  if (cached) groupTrendSummaryCache.delete(key);

  pruneGroupTrendSummaryCache(now);
  const value = load();
  groupTrendSummaryCache.set(key, {
    expiresAt: now + ttlMs,
    value,
  });

  try {
    return await value;
  } catch (error) {
    if (groupTrendSummaryCache.get(key)?.value === value) {
      groupTrendSummaryCache.delete(key);
    }
    throw error;
  }
}

function pruneGroupTrendSummaryCache(now: number) {
  for (const [key, entry] of groupTrendSummaryCache) {
    if (entry.expiresAt <= now) groupTrendSummaryCache.delete(key);
  }
  while (groupTrendSummaryCache.size >= MAX_GROUP_TREND_CACHE_ENTRIES) {
    const oldestKey = groupTrendSummaryCache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    groupTrendSummaryCache.delete(oldestKey);
  }
}

function buildGroupTrendCacheKey(input: {
  activeBusinessId: string;
  businesses: AuthorizedGroupBusiness[];
  groupBusinessDateValue: string;
  groupId: string;
  preset: GroupLongTermTrendPreset;
  userId: string;
}) {
  return JSON.stringify({
    activeBusinessId: input.activeBusinessId,
    businesses: [...input.businesses]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((business) => ({
        businessDayCutoffTime: business.businessDayCutoffTime,
        id: business.id,
        membershipPeriods: [...(business.membershipPeriods ?? [])]
          .sort(
            (left, right) =>
              left.joinedAt.getTime() - right.joinedAt.getTime(),
          )
          .map((period) => ({
            joinedAt: period.joinedAt.toISOString(),
            removedAt: period.removedAt?.toISOString() ?? null,
          })),
        timezone: business.timezone,
      })),
    groupBusinessDateValue: input.groupBusinessDateValue,
    groupId: input.groupId,
    preset: input.preset,
    userId: input.userId,
  });
}

export function clearGroupLongTermTrendCacheForTests() {
  groupTrendSummaryCache.clear();
}

export function normalizeGroupLongTermTrendPreset(
  value: string | undefined,
): GroupLongTermTrendPreset {
  if (value === "ytd" || value === "12months") return value;
  return "month";
}

export function buildGroupTrendBusinessPlan(
  preset: GroupLongTermTrendPreset,
  currentBusinessDateValue: string,
): GroupTrendBusinessPlan {
  const currentMonthStart = startOfMonth(currentBusinessDateValue);
  const previousMonthStart = shiftMonthStart(currentMonthStart, -1);
  const currentDay = dateValueToUtcDate(currentBusinessDateValue).getUTCDate();
  const monthToDate = {
    fromDateValue: currentMonthStart,
    toDateValue: currentBusinessDateValue,
  };
  const previousMonthToDate = {
    fromDateValue: previousMonthStart,
    toDateValue: clampDayToMonth(previousMonthStart, currentDay),
  };
  const sameMonthLastYear = {
    fromDateValue: shiftMonthStart(currentMonthStart, -12),
    toDateValue: shiftYearsClamped(currentBusinessDateValue, -1),
  };

  if (preset === "month") {
    return {
      currentBusinessDateValue,
      display: monthToDate,
      comparisons: [
        {
          key: "MOM",
          label: "vs previous month-to-date",
          current: monthToDate,
          previous: previousMonthToDate,
        },
        {
          key: "YOY",
          label: "vs same month last year",
          current: monthToDate,
          previous: sameMonthLastYear,
        },
      ],
    };
  }

  if (preset === "ytd") {
    const yearToDate = {
      fromDateValue: `${currentBusinessDateValue.slice(0, 4)}-01-01`,
      toDateValue: currentBusinessDateValue,
    };
    const priorYearToDate = {
      fromDateValue: `${Number(currentBusinessDateValue.slice(0, 4)) - 1}-01-01`,
      toDateValue: shiftYearsClamped(currentBusinessDateValue, -1),
    };
    return {
      currentBusinessDateValue,
      display: yearToDate,
      comparisons: [
        {
          key: "MOM",
          label: "current month vs previous month-to-date",
          current: monthToDate,
          previous: previousMonthToDate,
        },
        {
          key: "YOY",
          label: "vs prior year-to-date",
          current: yearToDate,
          previous: priorYearToDate,
        },
      ],
    };
  }

  const rollingTwelveMonths = {
    fromDateValue: shiftMonthStart(currentMonthStart, -11),
    toDateValue: currentBusinessDateValue,
  };
  const previousTwelveMonths = {
    fromDateValue: shiftMonthStart(currentMonthStart, -23),
    toDateValue: shiftYearsClamped(currentBusinessDateValue, -1),
  };
  return {
    currentBusinessDateValue,
    display: rollingTwelveMonths,
    comparisons: [
      {
        key: "MOM",
        label: "current month vs previous month-to-date",
        current: monthToDate,
        previous: previousMonthToDate,
      },
      {
        key: "YOY",
        label: "vs previous 12-month window",
        current: rollingTwelveMonths,
        previous: previousTwelveMonths,
      },
    ],
  };
}

function uniqueWindows(plan: GroupTrendBusinessPlan): DailySummaryDateWindow[] {
  const windows = [
    plan.display,
    ...plan.comparisons.flatMap((comparison) => [
      comparison.current,
      comparison.previous,
    ]),
  ];
  return [
    ...new Map(
      windows.map((window) => [
        `${window.fromDateValue}:${window.toDateValue}`,
        window,
      ]),
    ).values(),
  ];
}

function groupRowsByBusiness(rows: AnalyticsDailyRow[]) {
  const result = new Map<string, AnalyticsDailyRow[]>();
  for (const row of rows) {
    const businessRows = result.get(row.businessId) ?? [];
    businessRows.push(row);
    result.set(row.businessId, businessRows);
  }
  return result;
}

function buildComparisons(
  businesses: AuthorizedGroupBusiness[],
  plans: Map<string, GroupTrendBusinessPlan>,
  rowsByBusiness: Map<string, AnalyticsDailyRow[]>,
): GroupLongTermTrendComparison[] {
  const template = plans.get(businesses[0]!.id)!.comparisons;
  return template.map((comparison, comparisonIndex) => {
    const current = sumKpis(
      businesses.map((business) =>
        sumRowsInWindow(
          rowsByBusiness.get(business.id) ?? [],
          plans.get(business.id)!.comparisons[comparisonIndex]!.current,
        ),
      ),
    );
    const previous = sumKpis(
      businesses.map((business) =>
        sumRowsInWindow(
          rowsByBusiness.get(business.id) ?? [],
          plans.get(business.id)!.comparisons[comparisonIndex]!.previous,
        ),
      ),
    );
    return {
      key: comparison.key,
      label: comparison.label,
      currentNetSalesCents: current.netSalesCents,
      previousNetSalesCents: previous.netSalesCents,
      comparison: compareKpiValues(
        current.netSalesCents,
        previous.netSalesCents,
      ),
    };
  });
}

function buildTrendPoints(
  preset: GroupLongTermTrendPreset,
  businesses: AuthorizedGroupBusiness[],
  plans: Map<string, GroupTrendBusinessPlan>,
  rowsByBusiness: Map<string, AnalyticsDailyRow[]>,
): GroupLongTermTrendPoint[] {
  const displayWindows = businesses.map(
    (business) => plans.get(business.id)!.display,
  );
  const earliestDateValue = displayWindows
    .map((window) => window.fromDateValue)
    .sort()[0];
  const latestDateValue = displayWindows
    .map((window) => window.toDateValue)
    .sort()
    .at(-1)!;
  const bucketKeys =
    preset === "month"
      ? listDateValues(earliestDateValue, latestDateValue)
      : listMonthKeys(earliestDateValue, latestDateValue);
  const rowsByBucket = new Map<string, AnalyticsDailyRow[]>();
  const storesByBucket = new Map<string, Set<string>>();

  for (const business of businesses) {
    const display = plans.get(business.id)!.display;
    for (const row of rowsInWindow(
      rowsByBusiness.get(business.id) ?? [],
      display,
    )) {
      const businessDate = analyticsBusinessDateValue(row);
      const bucketKey = preset === "month" ? businessDate : businessDate.slice(0, 7);
      const bucketRows = rowsByBucket.get(bucketKey) ?? [];
      bucketRows.push(row);
      rowsByBucket.set(bucketKey, bucketRows);
      const stores = storesByBucket.get(bucketKey) ?? new Set<string>();
      stores.add(business.id);
      storesByBucket.set(bucketKey, stores);
    }
  }

  return bucketKeys.map((key) => {
    const rows = rowsByBucket.get(key) ?? [];
    const metrics = sumKpis(rows.map(dailyRowToKpi));
    const fromDateValue = preset === "month" ? key : `${key}-01`;
    const toDateValue =
      preset === "month"
        ? key
        : minDateValue(endOfMonth(fromDateValue), latestDateValue);
    return {
      key,
      fromDateValue,
      toDateValue,
      storeCount: storesByBucket.get(key)?.size ?? 0,
      hasCoverage: rows.length > 0,
      isPartial:
        preset !== "month" &&
        key === latestDateValue.slice(0, 7) &&
        latestDateValue < endOfMonth(latestDateValue),
      ...metrics,
    };
  });
}

function rowsInWindow(
  rows: AnalyticsDailyRow[],
  window: GroupTrendWindow,
) {
  return rows.filter((row) => {
    const businessDate = analyticsBusinessDateValue(row);
    return (
      businessDate >= window.fromDateValue &&
      businessDate <= window.toDateValue
    );
  });
}

function sumRowsInWindow(
  rows: AnalyticsDailyRow[],
  window: GroupTrendWindow,
) {
  return sumKpis(rowsInWindow(rows, window).map(dailyRowToKpi));
}

function listDateValues(fromDateValue: string, toDateValue: string) {
  const count =
    Math.round(
      (dateValueToUtcDate(toDateValue).getTime() -
        dateValueToUtcDate(fromDateValue).getTime()) /
        86_400_000,
    ) + 1;
  return Array.from({ length: count }, (_, index) =>
    addDaysToDateValue(fromDateValue, index),
  );
}

function listMonthKeys(fromDateValue: string, toDateValue: string) {
  const keys: string[] = [];
  let cursor = startOfMonth(fromDateValue);
  const last = startOfMonth(toDateValue);
  while (cursor <= last) {
    keys.push(cursor.slice(0, 7));
    cursor = shiftMonthStart(cursor, 1);
  }
  return keys;
}

function hasMembershipCompositionChange(
  business: AuthorizedGroupBusiness,
  plan: GroupTrendBusinessPlan,
) {
  const windows = [
    plan.display,
    ...plan.comparisons.flatMap((comparison) => [
      comparison.current,
      comparison.previous,
    ]),
  ];
  if (
    windows.some((window) =>
      hasMembershipBoundaryWithinWindow(business, window),
    )
  ) {
    return true;
  }
  return plan.comparisons.some(
    (comparison) =>
      hasMembershipOverlapWithinWindow(business, comparison.current) !==
      hasMembershipOverlapWithinWindow(business, comparison.previous),
  );
}

function hasMembershipOverlapWithinWindow(
  business: AuthorizedGroupBusiness,
  window: GroupTrendWindow,
) {
  const { fromDate, toDateExclusive } = businessWindowBounds(
    business,
    window,
  );
  return hasMembershipOverlap(
    business,
    fromDate,
    toDateExclusive,
  );
}

function hasMembershipBoundaryWithinWindow(
  business: AuthorizedGroupBusiness,
  window: GroupTrendWindow,
) {
  const { fromDate, toDateExclusive } = businessWindowBounds(
    business,
    window,
  );
  return Boolean(
    business.membershipPeriods?.some(
      (period) =>
        (period.joinedAt >= fromDate &&
          period.joinedAt < toDateExclusive) ||
        (period.removedAt !== null &&
          period.removedAt >= fromDate &&
          period.removedAt < toDateExclusive),
    ),
  );
}

function businessWindowBounds(
  business: AuthorizedGroupBusiness,
  window: GroupTrendWindow,
) {
  const fromDate = getBusinessDayRange({
    fromDateValue: window.fromDateValue,
    toDateValue: window.fromDateValue,
    timezone: business.timezone,
    businessDayCutoffTime: business.businessDayCutoffTime,
  }).fromDate;
  const toDateExclusive = getBusinessDayRange({
    fromDateValue: window.toDateValue,
    toDateValue: window.toDateValue,
    timezone: business.timezone,
    businessDayCutoffTime: business.businessDayCutoffTime,
  }).toDateExclusive;
  return { fromDate, toDateExclusive };
}

function startOfMonth(dateValue: string) {
  return `${dateValue.slice(0, 7)}-01`;
}

function shiftMonthStart(monthStart: string, amount: number) {
  const date = dateValueToUtcDate(monthStart);
  date.setUTCMonth(date.getUTCMonth() + amount, 1);
  return utcDateToDateValue(date);
}

function shiftYearsClamped(dateValue: string, amount: number) {
  const date = dateValueToUtcDate(dateValue);
  const targetYear = date.getUTCFullYear() + amount;
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const targetMonthStart = new Date(Date.UTC(targetYear, month, 1));
  const lastDay = new Date(
    Date.UTC(targetYear, month + 1, 0),
  ).getUTCDate();
  targetMonthStart.setUTCDate(Math.min(day, lastDay));
  return utcDateToDateValue(targetMonthStart);
}

function clampDayToMonth(monthStart: string, day: number) {
  const date = dateValueToUtcDate(monthStart);
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return utcDateToDateValue(date);
}

function endOfMonth(dateValue: string) {
  const date = dateValueToUtcDate(dateValue);
  return utcDateToDateValue(
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)),
  );
}

function minDateValue(left: string, right: string) {
  return left < right ? left : right;
}

const presetContent: Record<
  GroupLongTermTrendPreset,
  { label: string }
> = {
  month: { label: "Month to date" },
  ytd: { label: "Year to date" },
  "12months": { label: "Rolling 12 months" },
};
