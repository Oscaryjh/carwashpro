import assert from "node:assert/strict";
import test from "node:test";
import { getBusinessDayRangeWithPrevious } from "../../src/lib/business-day";
import {
  getGroupDataConfidenceReport,
  type GroupDataConfidenceStatus,
} from "../../src/lib/business-groups/group-data-confidence";
import type { AllStoresKpi, AllStoresKpiReport } from "../../src/lib/business-groups/all-stores-kpi";
import type {
  GroupClosingReport,
  GroupClosingRow,
} from "../../src/lib/business-groups/group-closing-report";

const businessId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const groupId = "33333333-3333-4333-8333-333333333333";
const now = new Date("2026-07-02T10:00:00.000Z");
const periods = getBusinessDayRangeWithPrevious({
  fromDateValue: "2026-07-01",
  toDateValue: "2026-07-01",
  timezone: "UTC",
  businessDayCutoffTime: "00:00",
});
const periodsWithOpenDay = getBusinessDayRangeWithPrevious({
  fromDateValue: "2026-07-01",
  toDateValue: "2026-07-02",
  timezone: "UTC",
  businessDayCutoffTime: "00:00",
});

test("marks exact cent-level dashboard and closing values as reconciled", async () => {
  const report = await reconcile({
    kpi: kpiReport(),
    closing: closingReport([validClosingRow()]),
  });

  assert.equal(report?.status, "MATCHED");
  assert.equal(report?.closingCoveragePercent, 100);
  assert.equal(report?.capturedClosingCount, 1);
  assert.equal(report?.missingClosings.length, 0);
  assert.equal(report?.definitionIssueCount, 0);
  assert.equal(report?.invalidSnapshotCount, 0);
  assert.equal(report?.metrics.every((metric) => metric.matches), true);
});

test("lists an expected branch-date when Daily Closing is missing", async () => {
  const report = await reconcile({
    kpi: kpiReport({
      grossSalesCents: 0,
      netSalesCents: 0,
      paymentsCollectedCents: 0,
      refundsCents: 0,
      transactionCount: 0,
      averageTransactionValueCents: null,
    }),
    closing: closingReport([]),
  });

  assert.equal(report?.status, "INCOMPLETE");
  assert.equal(report?.closingCoveragePercent, 0);
  assert.deepEqual(report?.missingClosings, [
    {
      businessId,
      businessName: "QA Store",
      branchId,
      branchName: "Main Branch",
      businessDate: "2026-07-01",
    },
  ]);
});

test("excludes unexpected snapshots from financial reconciliation", async () => {
  const report = await reconcile({
    kpi: kpiReport({
      grossSalesCents: 0,
      netSalesCents: 0,
      paymentsCollectedCents: 0,
      refundsCents: 0,
      transactionCount: 0,
      averageTransactionValueCents: null,
    }),
    closing: closingReport([
      validClosingRow({
        id: "55555555-5555-4555-8555-555555555555",
        branchId: "66666666-6666-4666-8666-666666666666",
        branchName: "Unexpected Branch",
      }),
    ]),
  });

  assert.equal(report?.status, "INCOMPLETE");
  assert.equal(report?.capturedClosingCount, 0);
  assert.equal(report?.missingClosings.length, 1);
  assert.equal(
    report?.metrics.find((metric) => metric.key === "grossSales")
      ?.closingCents,
    0,
  );
});

test("does not claim reconciliation while a selected business day is open", async () => {
  const kpi = kpiReport({
    grossSalesCents: 15_000,
    netSalesCents: 14_000,
    paymentsCollectedCents: 12_000,
    refundsCents: 500,
    transactionCount: 2,
    averageTransactionValueCents: 7_000,
  });
  kpi.customTo = "2026-07-02";
  kpi.businesses[0] = {
    ...kpi.businesses[0],
    currentRange: periodsWithOpenDay.current,
    previousRange: periodsWithOpenDay.previous,
  };

  const report = await reconcile({
    kpi,
    closing: closingReport([validClosingRow()]),
  });

  assert.equal(report?.status, "NOT_COMPARABLE");
  assert.equal(report?.reconciliationApplicable, false);
  assert.equal(report?.expectedClosingCount, 1);
  assert.equal(report?.capturedClosingCount, 1);
  assert.equal(report?.closingCoveragePercent, 100);
  assert.equal(
    report?.metrics.some((metric) => !metric.matches),
    true,
  );
});

test("returns not applicable instead of 100% before the business day is due", async () => {
  const report = await reconcile({
    kpi: kpiReport({
      grossSalesCents: 0,
      netSalesCents: 0,
      paymentsCollectedCents: 0,
      refundsCents: 0,
      transactionCount: 0,
      averageTransactionValueCents: null,
    }),
    closing: closingReport([]),
    now: new Date("2026-07-01T12:00:00.000Z"),
  });

  assert.equal(report?.status, "NOT_APPLICABLE");
  assert.equal(report?.expectedClosingCount, 0);
  assert.equal(report?.capturedClosingCount, 0);
  assert.equal(report?.closingCoveragePercent, null);
  assert.deepEqual(report?.missingClosings, []);
});

test("invalid snapshots take priority over amount differences", async () => {
  const invalid = validClosingRow({
    financial: null,
    metricDefinitionVersion: null,
    businessDayDefinitionVersion: null,
    businessDayCutoffTime: null,
  });
  const report = await reconcile({
    kpi: kpiReport(),
    closing: closingReport([invalid]),
  });

  assert.equal(report?.status, "INVALID_SNAPSHOT");
  assert.equal(report?.invalidSnapshotCount, 1);
  assert.equal(report?.capturedClosingCount, 1);
});

test("separates legacy definitions from valid but mismatched amounts", async () => {
  const legacy = await reconcile({
    kpi: kpiReport(),
    closing: closingReport([
      validClosingRow({
        metricDefinitionVersion: null,
        businessDayDefinitionVersion: null,
        businessDayCutoffTime: null,
      }),
    ]),
  });
  assert.equal(legacy?.status, "LEGACY_DEFINITION");
  assert.equal(legacy?.definitionIssueCount, 1);

  const mismatch = await reconcile({
    kpi: kpiReport(),
    closing: closingReport([
      validClosingRow({
        financial: {
          grossSalesCents: 10_000,
          netSalesCents: 8_500,
          collectedCents: 7_500,
          outstandingCents: 1_000,
          refundsCents: 500,
          discountsCents: 1_000,
        },
      }),
    ]),
  });
  assert.equal(mismatch?.status, "MISMATCH");
  assert.equal(
    mismatch?.metrics.find((metric) => metric.key === "netSales")
      ?.differenceCents,
    500,
  );
});

test("reads lightweight snapshot scalars while the KPI promise is pending", async () => {
  let resolveKpi:
    | ((report: AllStoresKpiReport | null) => void)
    | undefined;
  const pendingKpi = new Promise<AllStoresKpiReport | null>((resolve) => {
    resolveKpi = resolve;
  });
  let snapshotSelect: Record<string, unknown> | undefined;
  let snapshotReadStarted = false;
  const database = {
    branch: {
      findMany: async () => [
        {
          id: branchId,
          businessId,
          name: "Main Branch",
          status: "ACTIVE",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
    },
    dailyClosingSnapshot: {
      findMany: async (args: {
        select: Record<string, unknown>;
      }) => {
        snapshotReadStarted = true;
        snapshotSelect = args.select;
        return [];
      },
    },
  } as never;
  const load = getGroupDataConfidenceReport(
    {
      userId: "owner",
      groupId,
      activeBusinessId: businessId,
      range: "custom",
      from: "2026-07-01",
      to: "2026-07-01",
    },
    database,
    {
      now,
      kpiReport: pendingKpi,
      resolveScope: (async () => ({
        groupId,
        groupName: "QA Group",
        role: "GROUP_OWNER",
        canViewAllStores: true,
        businesses: closingReport([]).authorizedBusinesses,
      })) as never,
    },
  );

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(snapshotReadStarted, true);
  assert.deepEqual(Object.keys(snapshotSelect ?? {}).sort(), [
    "branchId",
    "businessDate",
    "businessId",
    "closedAt",
    "id",
    "reportDataJson",
  ]);
  assert.equal("business" in (snapshotSelect ?? {}), false);
  assert.equal("branch" in (snapshotSelect ?? {}), false);
  assert.equal("closedBy" in (snapshotSelect ?? {}), false);
  assert.equal("closingWhatsAppSends" in (snapshotSelect ?? {}), false);

  resolveKpi?.(kpiReport());
  const report = await load;
  assert.equal(report?.status, "INCOMPLETE");
});

async function reconcile(input: {
  kpi: AllStoresKpiReport;
  closing: GroupClosingReport;
  now?: Date;
}) {
  const database = {
    branch: {
      findMany: async () => [
        {
          id: branchId,
          businessId,
          name: "Main Branch",
          status: "ACTIVE",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
    },
  } as never;
  return getGroupDataConfidenceReport(
    {
      userId: "owner",
      groupId,
      activeBusinessId: businessId,
      range: "custom",
      from: "2026-07-01",
      to: "2026-07-01",
    },
    database,
    {
      now: input.now ?? now,
      kpiReport: input.kpi,
      getClosingReport: (async () => input.closing) as never,
    },
  );
}

function kpiReport(
  values: AllStoresKpi = {
    grossSalesCents: 10_000,
    netSalesCents: 9_000,
    paymentsCollectedCents: 8_000,
    refundsCents: 500,
    transactionCount: 1,
    averageTransactionValueCents: 9_000,
  },
): AllStoresKpiReport {
  const current = withComparisons(values);
  const previous = {
    grossSalesCents: 0,
    netSalesCents: 0,
    paymentsCollectedCents: 0,
    refundsCents: 0,
    transactionCount: 0,
    averageTransactionValueCents: null,
  };
  return {
    groupId,
    groupName: "QA Group",
    role: "GROUP_OWNER",
    range: "custom",
    customFrom: "2026-07-01",
    customTo: "2026-07-01",
    authorizedBusinessCount: 1,
    dataSource: "RAW",
    analyticsFallbackReason: "DISABLED",
    current,
    previous,
    businesses: [
      {
        businessId,
        businessName: "QA Store",
        industryType: "AUTO_DETAILING",
        logoUrl: null,
        timezone: "UTC",
        businessDayCutoffTime: "00:00",
        currentRange: periods.current,
        previousRange: periods.previous,
        current,
        previous,
      },
    ],
  };
}

function closingReport(rows: GroupClosingRow[]): GroupClosingReport {
  const validRows = rows.filter(
    (
      row,
    ): row is GroupClosingRow & {
      financial: NonNullable<GroupClosingRow["financial"]>;
    } => Boolean(row.financial),
  );
  return {
    groupId,
    groupName: "QA Group",
    role: "GROUP_OWNER",
    authorizedBusinesses: [
      {
        id: businessId,
        name: "QA Store",
        industryType: "AUTO_DETAILING",
        logoUrl: null,
        timezone: "UTC",
        businessDayCutoffTime: "00:00",
        isCurrent: true,
        membershipPeriods: [
          {
            joinedAt: new Date("2026-01-01T00:00:00.000Z"),
            removedAt: null,
          },
        ],
      },
    ],
    filters: {
      range: "custom",
      from: "2026-07-01",
      to: "2026-07-01",
      storeId: null,
      auditStatus: null,
      page: 1,
      auditPage: 1,
    },
    summary: {
      snapshotCount: rows.length,
      storeCount: rows.length ? 1 : 0,
      branchCount: rows.length ? 1 : 0,
      invalidReportCount: rows.length - validRows.length,
      grossSalesCents: sumFinancial(
        validRows,
        "grossSalesCents",
      ),
      netSalesCents: sumFinancial(validRows, "netSalesCents"),
      collectedCents: sumFinancial(validRows, "collectedCents"),
      outstandingCents: sumFinancial(
        validRows,
        "outstandingCents",
      ),
      refundsCents: sumFinancial(validRows, "refundsCents"),
      expectedCashCents: 0,
      actualCashCents: 0,
      cashDifferenceCents: 0,
      balancedCount: rows.length,
      overCount: 0,
      shortCount: 0,
    },
    audit: {
      checkedAt: now,
      requiredCount: 1,
      completedCount: rows.length ? 1 : 0,
      missingCount: rows.length ? 0 : 1,
      completionPercent: rows.length ? 100 : 0,
      notDueCount: 0,
      notApplicableCount: 0,
      partialMembershipCount: 0,
      branchNotOpenCount: 0,
      branchHistoryUnknownCount: 0,
      unsupportedIndustryCount: 0,
      unexpectedSnapshotCount: 0,
      rows: [],
      totalRows: 0,
      totalPages: 1,
      page: 1,
    },
    rows,
    totalRows: rows.length,
    totalPages: 1,
  };
}

function validClosingRow(
  overrides: Partial<GroupClosingRow> = {},
): GroupClosingRow {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    businessId,
    businessName: "QA Store",
    branchId,
    branchName: "Main Branch",
    businessDate: "2026-07-01",
    timezone: "UTC",
    expectedCashCents: 0,
    actualCashCents: 0,
    cashDifferenceCents: 0,
    closingNote: null,
    closedAt: new Date("2026-07-01T18:00:00.000Z"),
    closedByName: "QA Owner",
    reportVersion: 2,
    generatedAt: new Date("2026-07-01T18:00:00.000Z"),
    businessDayCutoffTime: "00:00",
    businessDayDefinitionVersion: 1,
    metricDefinitionVersion: 1,
    financial: {
      grossSalesCents: 10_000,
      netSalesCents: 9_000,
      collectedCents: 7_500,
      outstandingCents: 1_000,
      refundsCents: 500,
      discountsCents: 1_000,
    },
    whatsappStatus: "NOT_QUEUED",
    ...overrides,
  };
}

function withComparisons(values: {
  grossSalesCents: number;
  netSalesCents: number;
  paymentsCollectedCents: number;
  refundsCents: number;
  transactionCount: number;
  averageTransactionValueCents: number | null;
}) {
  const noChange = { kind: "NO_CHANGE" as const };
  return {
    ...values,
    comparisons: {
      grossSalesCents: noChange,
      netSalesCents: noChange,
      paymentsCollectedCents: noChange,
      refundsCents: noChange,
      transactionCount: noChange,
      averageTransactionValueCents: noChange,
    },
  };
}

function sumFinancial(
  rows: Array<
    GroupClosingRow & {
      financial: NonNullable<GroupClosingRow["financial"]>;
    }
  >,
  key:
    | "grossSalesCents"
    | "netSalesCents"
    | "collectedCents"
    | "outstandingCents"
    | "refundsCents",
) {
  return rows.reduce(
    (total, row) => total + row.financial[key],
    0,
  );
}

const statuses: GroupDataConfidenceStatus[] = [
  "MATCHED",
  "MISMATCH",
  "INCOMPLETE",
  "INVALID_SNAPSHOT",
  "LEGACY_DEFINITION",
  "NOT_COMPARABLE",
  "NOT_APPLICABLE",
];
void statuses;
