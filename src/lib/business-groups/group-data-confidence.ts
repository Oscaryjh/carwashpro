import type { Prisma } from "@prisma/client";
import {
  addDaysToDateValue,
  dateValueToUtcDate,
} from "@/lib/business-time";
import {
  getBusinessDayRange,
} from "@/lib/business-day";
import {
  buildBusinessPeriods,
  getAllStoresKpiReport,
  normalizeRange,
  validateCustomRange,
  type AllStoresBusinessKpi,
  type AllStoresKpi,
  type AllStoresKpiReport,
} from "@/lib/business-groups/all-stores-kpi";
import {
  resolveAuthorizedGroupReportingScope,
  type AuthorizedGroupBusiness,
} from "@/lib/business-groups/all-stores-access";
import {
  buildGroupClosingExpectations,
  classifyIntervalCoverage,
} from "@/lib/business-groups/group-closing-expectations";
import {
  getGroupClosingReport,
  type GroupClosingRow,
} from "@/lib/business-groups/group-closing-report";
import {
  getReportingBusinesses,
  hasMembershipOverlap,
} from "@/lib/business-groups/historical-membership";
import {
  DAILY_CLOSING_BUSINESS_DAY_DEFINITION_VERSION,
  DAILY_CLOSING_METRIC_DEFINITION_VERSION,
  isDailyClosingSnapshotPayload,
} from "@/lib/daily-closing/snapshot";
import { prisma } from "@/lib/prisma";

export const GROUP_DATA_CONFIDENCE_VERSION = 1;

export type GroupDataConfidenceStatus =
  | "MATCHED"
  | "MISMATCH"
  | "INCOMPLETE"
  | "INVALID_SNAPSHOT"
  | "LEGACY_DEFINITION"
  | "NOT_COMPARABLE"
  | "NOT_APPLICABLE";

export type GroupReconciliationMetric = {
  key: "grossSales" | "netSales" | "netCollections" | "refunds";
  label: string;
  analyticsCents: number;
  closingCents: number;
  differenceCents: number;
  matches: boolean;
};

export type MissingGroupClosing = {
  businessId: string;
  businessName: string;
  branchId: string;
  branchName: string;
  businessDate: string;
};

export type GroupClosingDefinitionIssue = {
  snapshotId: string;
  businessId: string;
  businessName: string;
  branchName: string;
  businessDate: string;
  expectedMetricDefinitionVersion: number;
  actualMetricDefinitionVersion: number | null;
  expectedBusinessDayDefinitionVersion: number;
  actualBusinessDayDefinitionVersion: number | null;
  expectedCutoffTime: string;
  actualCutoffTime: string | null;
};

export type GroupStoreDataConfidence = {
  businessId: string;
  businessName: string;
  status: GroupDataConfidenceStatus;
  expectedClosingCount: number;
  capturedClosingCount: number;
  missingClosingCount: number;
  invalidSnapshotCount: number;
  definitionIssueCount: number;
  metrics: GroupReconciliationMetric[];
};

export type GroupDataConfidenceReport = {
  version: number;
  groupId: string;
  groupName: string;
  status: GroupDataConfidenceStatus;
  checkedAt: Date;
  metricDefinitionVersion: number;
  businessDayDefinitionVersion: number;
  expectedClosingCount: number;
  capturedClosingCount: number;
  closingCoveragePercent: number | null;
  reconciliationApplicable: boolean;
  invalidSnapshotCount: number;
  definitionIssueCount: number;
  latestClosingAt: Date | null;
  metrics: GroupReconciliationMetric[];
  missingClosings: MissingGroupClosing[];
  definitionIssues: GroupClosingDefinitionIssue[];
  stores: GroupStoreDataConfidence[];
};

type GroupDataConfidenceInput = {
  userId: string;
  groupId: string;
  activeBusinessId: string;
  range?: string;
  from?: string;
  to?: string;
};

type GroupDataConfidenceDatabase = Pick<
  Prisma.TransactionClient,
  "branch" | "dailyClosingSnapshot"
>;

type GroupDataConfidenceDependencies = {
  now?: Date;
  kpiReport?: AllStoresKpiReport | Promise<AllStoresKpiReport | null>;
  getKpiReport?: typeof getAllStoresKpiReport;
  getClosingReport?: typeof getGroupClosingReport;
  resolveScope?: typeof resolveAuthorizedGroupReportingScope;
};

type ActiveBranch = {
  id: string;
  businessId: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
  createdAt: Date;
};

type GroupConfidenceClosingRow = Pick<
  GroupClosingRow,
  | "id"
  | "businessId"
  | "businessName"
  | "branchId"
  | "branchName"
  | "businessDate"
  | "closedAt"
  | "businessDayCutoffTime"
  | "businessDayDefinitionVersion"
  | "metricDefinitionVersion"
  | "financial"
>;

type GroupConfidenceClosingData = {
  authorizedBusinesses: AuthorizedGroupBusiness[];
  branches: ActiveBranch[] | null;
  rows: GroupConfidenceClosingRow[];
};

export async function getGroupDataConfidenceReport(
  input: GroupDataConfidenceInput,
  database: GroupDataConfidenceDatabase = prisma,
  dependencies: GroupDataConfidenceDependencies = {},
): Promise<GroupDataConfidenceReport | null> {
  const now = dependencies.now ?? new Date();
  const getKpiReport =
    dependencies.getKpiReport ?? getAllStoresKpiReport;
  const reportInput = {
    userId: input.userId,
    groupId: input.groupId,
    activeBusinessId: input.activeBusinessId,
    range: input.range,
    from: input.from,
    to: input.to,
  };
  const reportDependencies = {
    now,
    resolveScope: dependencies.resolveScope,
  };
  const kpiReportLoad = dependencies.kpiReport
    ? Promise.resolve(dependencies.kpiReport)
    : getKpiReport(reportInput, prisma, reportDependencies);
  const closingDataLoad = dependencies.getClosingReport
    ? dependencies
        .getClosingReport(reportInput, prisma, reportDependencies)
        .then((report): GroupConfidenceClosingData | null =>
          report
            ? {
                authorizedBusinesses: report.authorizedBusinesses,
                branches: null,
                rows: report.rows,
              }
            : null,
        )
    : loadGroupConfidenceClosingData(
        reportInput,
        database,
        reportDependencies,
      );
  const [kpiReport, closingData] = await Promise.all([
    kpiReportLoad,
    closingDataLoad,
  ]);
  if (!kpiReport || !closingData) return null;

  const authorizedBusinessById = new Map(
    closingData.authorizedBusinesses.map((business) => [
      business.id,
      business,
    ]),
  );
  const businesses = kpiReport.businesses.filter((business) => {
    const authorizedBusiness = authorizedBusinessById.get(
      business.businessId,
    );
    if (!authorizedBusiness) return false;
    return hasMembershipOverlap(
      authorizedBusiness,
      business.currentRange.fromDate,
      business.currentRange.toDateExclusive,
    );
  });
  const businessIds = businesses.map((business) => business.businessId);
  const activeBranches =
    closingData.branches ??
    (await loadActiveBranches(businessIds, database));
  const expectationResult = buildGroupClosingExpectations({
    businesses: businesses.flatMap((business) => {
      const authorizedBusiness = authorizedBusinessById.get(
        business.businessId,
      );
      return authorizedBusiness
        ? [
            {
              ...authorizedBusiness,
              fromDateValue: business.currentRange.fromDateValue,
              toDateValue: business.currentRange.toDateValue,
            },
          ]
        : [];
    }),
    branches: activeBranches,
    snapshots: closingData.rows.map((row) => ({
      id: row.id,
      businessId: row.businessId,
      branchId: row.branchId,
      businessDate: row.businessDate,
    })),
    now,
  });
  const expectedClosings = expectationResult.rows.map((row) => ({
    businessId: row.businessId,
    businessName: row.businessName,
    branchId: row.branchId,
    branchName: row.branchName,
    businessDate: row.businessDate,
  }));
  const missingClosings = expectationResult.rows
    .filter((row) => row.status === "MISSING")
    .map((row) => ({
      businessId: row.businessId,
      businessName: row.businessName,
      branchId: row.branchId,
      branchName: row.branchName,
      businessDate: row.businessDate,
    }));
  const matchedSnapshotIds = new Set(
    expectationResult.rows.flatMap((row) =>
      row.snapshotId ? [row.snapshotId] : [],
    ),
  );
  const reconciledRows = closingData.rows.filter((row) =>
    matchedSnapshotIds.has(row.id),
  );
  const reconciliationApplicable =
    expectationResult.summary.notDueCount === 0 &&
    expectationResult.summary.notApplicableCount === 0 &&
    expectationResult.summary.unexpectedSnapshotCount === 0;
  const capturedClosingCount = expectationResult.summary.completedCount;
  const definitionIssues = buildDefinitionIssues(
    reconciledRows,
    authorizedBusinessById,
  );
  const invalidSnapshotCount = reconciledRows.filter(
    (row) => !row.financial,
  ).length;
  const metrics = buildReconciliationMetrics(
    kpiReport.current,
    reconciledRows,
  );
  const status = resolveConfidenceStatus({
    metrics,
    missingClosingCount: missingClosings.length,
    invalidSnapshotCount,
    definitionIssueCount: definitionIssues.length,
    expectedClosingCount: expectedClosings.length,
    reconciliationApplicable,
  });
  const rowsByBusiness = groupByBusiness(reconciledRows);
  const expectedByBusiness = groupByBusiness(expectedClosings);
  const missingByBusiness = groupByBusiness(missingClosings);

  return {
    version: GROUP_DATA_CONFIDENCE_VERSION,
    groupId: kpiReport.groupId,
    groupName: kpiReport.groupName,
    status,
    checkedAt: now,
    metricDefinitionVersion: DAILY_CLOSING_METRIC_DEFINITION_VERSION,
    businessDayDefinitionVersion:
      DAILY_CLOSING_BUSINESS_DAY_DEFINITION_VERSION,
    expectedClosingCount: expectedClosings.length,
    capturedClosingCount,
    closingCoveragePercent: expectationResult.summary.completionPercent,
    reconciliationApplicable,
    invalidSnapshotCount,
    definitionIssueCount: definitionIssues.length,
    latestClosingAt: latestDate(reconciledRows.map((row) => row.closedAt)),
    metrics,
    missingClosings,
    definitionIssues,
    stores: businesses.map((business) =>
      buildStoreConfidence({
        business,
        authorizedBusiness: authorizedBusinessById.get(
          business.businessId,
        ),
        closingRows: rowsByBusiness.get(business.businessId) ?? [],
        expectedClosings:
          expectedByBusiness.get(business.businessId) ?? [],
        reconciliationApplicable,
        missingClosings:
          missingByBusiness.get(business.businessId) ?? [],
      }),
    ),
  };
}

async function loadGroupConfidenceClosingData(
  input: GroupDataConfidenceInput,
  database: GroupDataConfidenceDatabase,
  dependencies: {
    now: Date;
    resolveScope?: typeof resolveAuthorizedGroupReportingScope;
  },
): Promise<GroupConfidenceClosingData | null> {
  const resolveScope =
    dependencies.resolveScope ?? resolveAuthorizedGroupReportingScope;
  const scope = await resolveScope(
    input.userId,
    input.groupId,
    input.activeBusinessId,
  );
  if (!scope?.canViewAllStores) return null;

  const authorizedBusinesses = getReportingBusinesses(scope);
  const range = normalizeRange(input.range);
  const customRange = validateCustomRange(range, input.from, input.to);
  const businessRanges = authorizedBusinesses.map((business) => {
    const period = buildBusinessPeriods({
      range,
      from: customRange?.from ?? null,
      to: customRange?.to ?? null,
      now: dependencies.now,
      timezone: business.timezone,
      businessDayCutoffTime: business.businessDayCutoffTime,
    }).current;
    return {
      businessId: business.id,
      gte: dateValueToUtcDate(period.fromDateValue),
      lt: dateValueToUtcDate(addDaysToDateValue(period.toDateValue, 1)),
    };
  });
  const businessIds = authorizedBusinesses.map((business) => business.id);
  const [branches, snapshots] = await Promise.all([
    loadActiveBranches(businessIds, database),
    database.dailyClosingSnapshot.findMany({
      where: {
        OR: businessRanges.map(
          ({ businessId, gte, lt }) => ({
            businessId,
            businessDate: { gte, lt },
          }),
        ),
      },
      orderBy: [{ businessDate: "desc" }, { id: "asc" }],
      select: {
        id: true,
        businessId: true,
        branchId: true,
        businessDate: true,
        closedAt: true,
        reportDataJson: true,
      },
    }),
  ]);
  const businessNameById = new Map(
    authorizedBusinesses.map((business) => [business.id, business.name]),
  );
  const branchNameById = new Map(
    branches.map((branch) => [branch.id, branch.name]),
  );
  const authorizedBusinessById = new Map(
    authorizedBusinesses.map((business) => [business.id, business]),
  );

  return {
    authorizedBusinesses,
    branches,
    rows: snapshots
      .map((snapshot) =>
        toGroupConfidenceClosingRow(
          snapshot,
          businessNameById,
          branchNameById,
        ),
      )
      .filter((row) => {
        const business = authorizedBusinessById.get(row.businessId);
        if (!business) return false;
        const day = getBusinessDayRange({
          fromDateValue: row.businessDate,
          toDateValue: row.businessDate,
          timezone: business.timezone,
          businessDayCutoffTime: business.businessDayCutoffTime,
        });
        return (
          classifyIntervalCoverage(
            { from: day.fromDate, toExclusive: day.toDateExclusive },
            (business.membershipPeriods ?? []).map((membership) => ({
              from: membership.joinedAt,
              toExclusive: membership.removedAt,
            })),
          ) === "FULL"
        );
      }),
  };
}

async function loadActiveBranches(
  businessIds: string[],
  database: GroupDataConfidenceDatabase,
): Promise<ActiveBranch[]> {
  if (!businessIds.length) return [];
  const branches = await database.branch.findMany({
    where: {
      businessId: { in: businessIds },
    },
    orderBy: [
      { business: { name: "asc" } },
      { name: "asc" },
      { id: "asc" },
    ],
    select: {
      id: true,
      businessId: true,
      name: true,
      status: true,
      createdAt: true,
    },
  });
  return branches;
}

function toGroupConfidenceClosingRow(
  snapshot: {
    id: string;
    businessId: string;
    branchId: string;
    businessDate: Date;
    closedAt: Date;
    reportDataJson: unknown;
  },
  businessNameById: Map<string, string>,
  branchNameById: Map<string, string>,
): GroupConfidenceClosingRow {
  const payload = isDailyClosingSnapshotPayload(snapshot.reportDataJson)
    ? snapshot.reportDataJson
    : null;
  return {
    id: snapshot.id,
    businessId: snapshot.businessId,
    businessName:
      payload?.business.name ??
      businessNameById.get(snapshot.businessId) ??
      "Unknown store",
    branchId: snapshot.branchId,
    branchName:
      payload?.branch.name ??
      branchNameById.get(snapshot.branchId) ??
      "Unknown branch",
    businessDate: snapshot.businessDate.toISOString().slice(0, 10),
    closedAt: snapshot.closedAt,
    businessDayCutoffTime: payload?.businessDayCutoffTime ?? null,
    businessDayDefinitionVersion:
      payload?.businessDayDefinitionVersion ?? null,
    metricDefinitionVersion: payload?.metricDefinitionVersion ?? null,
    financial: payload?.report.financial ?? null,
  };
}


function buildDefinitionIssues(
  rows: GroupConfidenceClosingRow[],
  authorizedBusinessById: Map<string, AuthorizedGroupBusiness>,
): GroupClosingDefinitionIssue[] {
  return rows.flatMap((row) => {
    const business = authorizedBusinessById.get(row.businessId);
    const expectedCutoffTime =
      business?.businessDayCutoffTime ?? row.businessDayCutoffTime ?? "00:00";
    const matches =
      row.metricDefinitionVersion ===
        DAILY_CLOSING_METRIC_DEFINITION_VERSION &&
      row.businessDayDefinitionVersion ===
        DAILY_CLOSING_BUSINESS_DAY_DEFINITION_VERSION &&
      row.businessDayCutoffTime === expectedCutoffTime;
    if (matches || !row.financial) return [];

    return [
      {
        snapshotId: row.id,
        businessId: row.businessId,
        businessName: row.businessName,
        branchName: row.branchName,
        businessDate: row.businessDate,
        expectedMetricDefinitionVersion:
          DAILY_CLOSING_METRIC_DEFINITION_VERSION,
        actualMetricDefinitionVersion: row.metricDefinitionVersion,
        expectedBusinessDayDefinitionVersion:
          DAILY_CLOSING_BUSINESS_DAY_DEFINITION_VERSION,
        actualBusinessDayDefinitionVersion:
          row.businessDayDefinitionVersion,
        expectedCutoffTime,
        actualCutoffTime: row.businessDayCutoffTime,
      },
    ];
  });
}

function buildStoreConfidence(input: {
  business: AllStoresBusinessKpi;
  authorizedBusiness: AuthorizedGroupBusiness | undefined;
  closingRows: GroupConfidenceClosingRow[];
  expectedClosings: MissingGroupClosing[];
  reconciliationApplicable: boolean;
  missingClosings: MissingGroupClosing[];
}): GroupStoreDataConfidence {
  const closingSummary = summarizeClosingRows(input.closingRows);
  const metrics = buildMetricRows(input.business.current, closingSummary);
  const invalidSnapshotCount = input.closingRows.filter(
    (row) => !row.financial,
  ).length;
  const definitionIssueCount = input.closingRows.filter((row) => {
    if (!row.financial) return false;
    return (
      row.metricDefinitionVersion !==
        DAILY_CLOSING_METRIC_DEFINITION_VERSION ||
      row.businessDayDefinitionVersion !==
        DAILY_CLOSING_BUSINESS_DAY_DEFINITION_VERSION ||
      row.businessDayCutoffTime !==
        (input.authorizedBusiness?.businessDayCutoffTime ??
          row.businessDayCutoffTime)
    );
  }).length;

  return {
    businessId: input.business.businessId,
    businessName: input.business.businessName,
    status: resolveConfidenceStatus({
      metrics,
      missingClosingCount: input.missingClosings.length,
      invalidSnapshotCount,
      definitionIssueCount,
      expectedClosingCount: input.expectedClosings.length,
      reconciliationApplicable: input.reconciliationApplicable,
    }),
    expectedClosingCount: input.expectedClosings.length,
    capturedClosingCount:
      input.expectedClosings.length - input.missingClosings.length,
    missingClosingCount: input.missingClosings.length,
    invalidSnapshotCount,
    definitionIssueCount,
    metrics,
  };
}

function buildReconciliationMetrics(
  analytics: AllStoresKpi,
  closingRows: GroupConfidenceClosingRow[],
) {
  return buildMetricRows(analytics, summarizeClosingRows(closingRows));
}

function buildMetricRows(
  analytics: AllStoresKpi,
  closing: {
    grossSalesCents: number;
    netSalesCents: number;
    collectedCents: number;
    refundsCents: number;
  },
): GroupReconciliationMetric[] {
  const values = [
    {
      key: "grossSales" as const,
      label: "Gross sales",
      analyticsCents: analytics.grossSalesCents,
      closingCents: closing.grossSalesCents,
    },
    {
      key: "netSales" as const,
      label: "Net sales",
      analyticsCents: analytics.netSalesCents,
      closingCents: closing.netSalesCents,
    },
    {
      key: "netCollections" as const,
      label: "Net collections",
      analyticsCents:
        analytics.paymentsCollectedCents - analytics.refundsCents,
      closingCents: closing.collectedCents,
    },
    {
      key: "refunds" as const,
      label: "Refunds",
      analyticsCents: analytics.refundsCents,
      closingCents: closing.refundsCents,
    },
  ];
  return values.map((value) => {
    const differenceCents =
      value.analyticsCents - value.closingCents;
    return {
      ...value,
      differenceCents,
      matches: differenceCents === 0,
    };
  });
}

function summarizeClosingRows(rows: GroupConfidenceClosingRow[]) {
  return rows.reduce(
    (summary, row) => {
      if (!row.financial) return summary;
      summary.grossSalesCents += row.financial.grossSalesCents;
      summary.netSalesCents += row.financial.netSalesCents;
      summary.collectedCents += row.financial.collectedCents;
      summary.refundsCents += row.financial.refundsCents;
      return summary;
    },
    {
      grossSalesCents: 0,
      netSalesCents: 0,
      collectedCents: 0,
      refundsCents: 0,
    },
  );
}

function resolveConfidenceStatus(input: {
  metrics: GroupReconciliationMetric[];
  missingClosingCount: number;
  invalidSnapshotCount: number;
  definitionIssueCount: number;
  expectedClosingCount: number;
  reconciliationApplicable: boolean;
}): GroupDataConfidenceStatus {
  if (input.expectedClosingCount === 0) return "NOT_APPLICABLE";
  if (input.invalidSnapshotCount > 0) return "INVALID_SNAPSHOT";
  if (input.missingClosingCount > 0) return "INCOMPLETE";
  if (input.definitionIssueCount > 0) return "LEGACY_DEFINITION";
  if (!input.reconciliationApplicable) return "NOT_COMPARABLE";
  if (input.metrics.some((metric) => !metric.matches)) return "MISMATCH";
  return "MATCHED";
}


function latestDate(values: Date[]) {
  if (!values.length) return null;
  return new Date(Math.max(...values.map((value) => value.getTime())));
}

function groupByBusiness<T extends { businessId: string }>(rows: T[]) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const current = grouped.get(row.businessId) ?? [];
    current.push(row);
    grouped.set(row.businessId, current);
  }
  return grouped;
}
