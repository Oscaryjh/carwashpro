import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { getBusinessDayRange } from "@/lib/business-day";
import {
  buildBusinessPeriods,
  normalizeRange,
  validateCustomRange,
  type AllStoresRange,
} from "@/lib/business-groups/all-stores-kpi";
import {
  resolveAuthorizedGroupReportingScope,
  type AuthorizedGroupReportingContext,
} from "@/lib/business-groups/all-stores-access";
import {
  buildGroupClosingExpectations,
  classifyIntervalCoverage,
  type GroupClosingExpectationBusiness,
  type GroupClosingExpectationRow,
  type GroupClosingExpectationSummary,
} from "@/lib/business-groups/group-closing-expectations";
import { getReportingBusinesses } from "@/lib/business-groups/historical-membership";
import {
  addDaysToDateValue,
  dateValueToUtcDate,
} from "@/lib/business-time";
import {
  isDailyClosingSnapshotPayload,
  type DailyClosingSnapshotPayload,
} from "@/lib/daily-closing/snapshot";
import { prisma } from "@/lib/prisma";

export const GROUP_CLOSING_PAGE_SIZE = 25;
export const GROUP_CLOSING_EXPORT_LIMIT = 5_000;
export const GROUP_CLOSING_REPORT_LIMIT = 10_000;

export type GroupClosingAuditStatus = "COMPLETE" | "MISSING";

export type GroupClosingFilters = {
  range: AllStoresRange;
  from: string | null;
  to: string | null;
  storeId: string | null;
  auditStatus: GroupClosingAuditStatus | null;
  page: number;
  auditPage: number;
};

export type GroupClosingSummary = {
  snapshotCount: number;
  storeCount: number;
  branchCount: number;
  invalidReportCount: number;
  grossSalesCents: number;
  netSalesCents: number;
  collectedCents: number;
  outstandingCents: number;
  refundsCents: number;
  expectedCashCents: number;
  actualCashCents: number;
  cashDifferenceCents: number;
  balancedCount: number;
  overCount: number;
  shortCount: number;
};

export type GroupClosingRow = {
  id: string;
  businessId: string;
  businessName: string;
  branchId: string;
  branchName: string;
  businessDate: string;
  timezone: string;
  expectedCashCents: number;
  actualCashCents: number;
  cashDifferenceCents: number;
  closingNote: string | null;
  closedAt: Date;
  closedByName: string;
  reportVersion: number;
  generatedAt: Date | null;
  businessDayCutoffTime: string | null;
  businessDayDefinitionVersion: number | null;
  metricDefinitionVersion: number | null;
  financial: DailyClosingSnapshotPayload["report"]["financial"] | null;
  whatsappStatus: string;
};

export type GroupClosingAudit = GroupClosingExpectationSummary & {
  checkedAt: Date;
  rows: GroupClosingExpectationRow[];
  totalRows: number;
  totalPages: number;
  page: number;
};

export type GroupClosingReport = {
  groupId: string;
  groupName: string;
  role: AuthorizedGroupReportingContext["role"];
  authorizedBusinesses: AuthorizedGroupReportingContext["businesses"];
  filters: GroupClosingFilters;
  summary: GroupClosingSummary;
  audit: GroupClosingAudit;
  rows: GroupClosingRow[];
  totalRows: number;
  totalPages: number;
};

type GroupClosingDatabase = Pick<
  Prisma.TransactionClient,
  "branch" | "dailyClosingSnapshot"
>;

type GroupClosingInput = {
  userId: string;
  groupId: string;
  activeBusinessId: string;
  range?: string;
  from?: string;
  to?: string;
  store?: string;
  status?: string;
  page?: string;
  auditPage?: string;
};

type GroupClosingDependencies = {
  now?: Date;
  resolveScope?: typeof resolveAuthorizedGroupReportingScope;
  pageSize?: number;
  auditPageSize?: number;
  maxRows?: number;
  limitKind?: "REPORT" | "EXPORT";
};

export class GroupClosingInputError extends Error {}
export class GroupClosingExportLimitError extends Error {}

export async function getGroupClosingReport(
  input: GroupClosingInput,
  database: GroupClosingDatabase = prisma,
  dependencies: GroupClosingDependencies = {},
): Promise<GroupClosingReport | null> {
  const resolveScope =
    dependencies.resolveScope ?? resolveAuthorizedGroupReportingScope;
  const scope = await resolveScope(
    input.userId,
    input.groupId,
    input.activeBusinessId,
  );
  if (!scope?.canViewAllStores) return null;

  const reportingBusinesses = getReportingBusinesses(scope);
  const reportingScope = { ...scope, businesses: reportingBusinesses };
  const filters = parseGroupClosingFilters(input, reportingScope);
  const businesses = filters.storeId
    ? reportingBusinesses.filter((business) => business.id === filters.storeId)
    : reportingBusinesses;
  const now = dependencies.now ?? new Date();
  const auditBusinesses = businesses.map((business) => {
    const period = buildBusinessPeriods({
      range: filters.range,
      from: filters.from,
      to: filters.to,
      now,
      timezone: business.timezone,
      businessDayCutoffTime: business.businessDayCutoffTime,
    }).current;
    return {
      ...business,
      fromDateValue: period.fromDateValue,
      toDateValue: period.toDateValue,
    };
  });
  const pageSize = positivePageSize(
    dependencies.pageSize ?? GROUP_CLOSING_PAGE_SIZE,
  );
  const auditPageSize = positivePageSize(
    dependencies.auditPageSize ?? GROUP_CLOSING_PAGE_SIZE,
  );
  const maxRows = positivePageSize(
    dependencies.maxRows ?? GROUP_CLOSING_REPORT_LIMIT,
  );
  const snapshotWhere = buildSnapshotWhere(auditBusinesses);
  const businessIds = businesses.map((business) => business.id);
  const [branches, totalRows] = await Promise.all([
    database.branch.findMany({
      where: { businessId: { in: businessIds } },
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
    }),
    database.dailyClosingSnapshot.count({ where: snapshotWhere }),
  ]);
  assertClosingRowLimit(totalRows, maxRows, dependencies.limitKind);
  const pageOffset = safePageOffset(filters.page, pageSize);
  const [summarySnapshots, pageSnapshots] = await Promise.all([
    database.dailyClosingSnapshot.findMany({
      where: snapshotWhere,
      take: maxRows,
      select: {
        id: true,
        businessId: true,
        branchId: true,
        businessDate: true,
        expectedCashCents: true,
        actualCashCents: true,
        cashDifferenceCents: true,
        reportDataJson: true,
      },
    }),
    database.dailyClosingSnapshot.findMany({
      where: snapshotWhere,
      orderBy: [
        { businessDate: "desc" },
        { business: { name: "asc" } },
        { branch: { name: "asc" } },
        { id: "asc" },
      ],
      skip: pageOffset,
      take: pageSize,
      select: {
        id: true,
        businessId: true,
        branchId: true,
        businessDate: true,
        timezone: true,
        expectedCashCents: true,
        actualCashCents: true,
        cashDifferenceCents: true,
        closingNote: true,
        closedAt: true,
        reportVersion: true,
        reportDataJson: true,
        business: { select: { name: true } },
        branch: { select: { name: true } },
        closedBy: { select: { name: true } },
        closingWhatsAppSends: {
          orderBy: { requestedAt: "desc" },
          select: { status: true },
          take: 1,
        },
      },
    }),
  ]);
  const expectationResult = buildGroupClosingExpectations({
    businesses: auditBusinesses,
    branches,
    snapshots: summarySnapshots.map((snapshot) => ({
      id: snapshot.id,
      businessId: snapshot.businessId,
      branchId: snapshot.branchId,
      businessDate: snapshot.businessDate.toISOString().slice(0, 10),
    })),
    now,
  });
  const filteredAuditRows = filters.auditStatus
    ? expectationResult.rows.filter(
        (row) => row.status === filters.auditStatus,
      )
    : expectationResult.rows;
  const totalAuditRows = filteredAuditRows.length;
  assertClosingRowLimit(totalAuditRows, maxRows, dependencies.limitKind);

  return {
    groupId: scope.groupId,
    groupName: scope.groupName,
    role: scope.role,
    authorizedBusinesses: reportingBusinesses,
    filters,
    summary: summarizeSnapshotRows(summarySnapshots),
    audit: {
      ...expectationResult.summary,
      checkedAt: now,
      rows: paginate(filteredAuditRows, filters.auditPage, auditPageSize),
      totalRows: totalAuditRows,
      totalPages: Math.max(1, Math.ceil(totalAuditRows / auditPageSize)),
      page: filters.auditPage,
    },
    rows: pageSnapshots.map(toGroupClosingRow),
    totalRows,
    totalPages: Math.max(1, Math.ceil(totalRows / pageSize)),
  };
}

export async function getGroupClosingExportData(
  input: GroupClosingInput,
  database: GroupClosingDatabase = prisma,
  dependencies: GroupClosingDependencies = {},
) {
  const report = await getGroupClosingReport(
    { ...input, page: "1", auditPage: "1" },
    database,
    {
      ...dependencies,
      pageSize: GROUP_CLOSING_EXPORT_LIMIT + 1,
      auditPageSize: GROUP_CLOSING_EXPORT_LIMIT + 1,
      maxRows: GROUP_CLOSING_EXPORT_LIMIT,
      limitKind: "EXPORT",
    },
  );
  if (
    report &&
    (report.totalRows > GROUP_CLOSING_EXPORT_LIMIT ||
      report.audit.totalRows > GROUP_CLOSING_EXPORT_LIMIT)
  ) {
    throw new GroupClosingExportLimitError(
      `Export is limited to ${GROUP_CLOSING_EXPORT_LIMIT.toLocaleString("en-MY")} closing or audit rows. Narrow the filters and try again.`,
    );
  }
  return report;
}

export function summarizeGroupClosings(
  rows: GroupClosingRow[],
): GroupClosingSummary {
  const stores = new Set<string>();
  const branches = new Set<string>();
  const summary: GroupClosingSummary = {
    snapshotCount: rows.length,
    storeCount: 0,
    branchCount: 0,
    invalidReportCount: 0,
    grossSalesCents: 0,
    netSalesCents: 0,
    collectedCents: 0,
    outstandingCents: 0,
    refundsCents: 0,
    expectedCashCents: 0,
    actualCashCents: 0,
    cashDifferenceCents: 0,
    balancedCount: 0,
    overCount: 0,
    shortCount: 0,
  };
  for (const row of rows) {
    stores.add(row.businessId);
    branches.add(`${row.businessId}:${row.branchId}`);
    summary.expectedCashCents += row.expectedCashCents;
    summary.actualCashCents += row.actualCashCents;
    summary.cashDifferenceCents += row.cashDifferenceCents;
    if (row.cashDifferenceCents === 0) summary.balancedCount += 1;
    else if (row.cashDifferenceCents > 0) summary.overCount += 1;
    else summary.shortCount += 1;
    if (!row.financial) {
      summary.invalidReportCount += 1;
      continue;
    }
    summary.grossSalesCents += row.financial.grossSalesCents;
    summary.netSalesCents += row.financial.netSalesCents;
    summary.collectedCents += row.financial.collectedCents;
    summary.outstandingCents += row.financial.outstandingCents;
    summary.refundsCents += row.financial.refundsCents;
  }
  summary.storeCount = stores.size;
  summary.branchCount = branches.size;
  return summary;
}

type SummarySnapshotRow = {
  id: string;
  businessId: string;
  branchId: string;
  businessDate: Date;
  expectedCashCents: number;
  actualCashCents: number;
  cashDifferenceCents: number;
  reportDataJson: unknown;
};

function summarizeSnapshotRows(
  rows: SummarySnapshotRow[],
): GroupClosingSummary {
  return summarizeGroupClosings(
    rows.map((row) => {
      const payload = isDailyClosingSnapshotPayload(row.reportDataJson)
        ? row.reportDataJson
        : null;
      return {
        id: row.id,
        businessId: row.businessId,
        businessName: "",
        branchId: row.branchId,
        branchName: "",
        businessDate: row.businessDate.toISOString().slice(0, 10),
        timezone: "UTC",
        expectedCashCents: row.expectedCashCents,
        actualCashCents: row.actualCashCents,
        cashDifferenceCents: row.cashDifferenceCents,
        closingNote: null,
        closedAt: row.businessDate,
        closedByName: "",
        reportVersion: 0,
        generatedAt: null,
        businessDayCutoffTime: payload?.businessDayCutoffTime ?? null,
        businessDayDefinitionVersion:
          payload?.businessDayDefinitionVersion ?? null,
        metricDefinitionVersion: payload?.metricDefinitionVersion ?? null,
        financial: payload?.report.financial ?? null,
        whatsappStatus: "NOT_QUEUED",
      };
    }),
  );
}

function buildSnapshotWhere(
  businesses: GroupClosingExpectationBusiness[],
): Prisma.DailyClosingSnapshotWhereInput {
  const dateFilters = businesses.flatMap((business) => {
    const dates: Date[] = [];
    for (
      let businessDate = business.fromDateValue;
      businessDate <= business.toDateValue;
      businessDate = addDaysToDateValue(businessDate, 1)
    ) {
      const day = getBusinessDayRange({
        fromDateValue: businessDate,
        toDateValue: businessDate,
        timezone: business.timezone,
        businessDayCutoffTime: business.businessDayCutoffTime,
      });
      const membershipCoverage = classifyIntervalCoverage(
        { from: day.fromDate, toExclusive: day.toDateExclusive },
        (business.membershipPeriods ?? []).map((membership) => ({
          from: membership.joinedAt,
          toExclusive: membership.removedAt,
        })),
      );
      if (membershipCoverage === "FULL") {
        dates.push(dateValueToUtcDate(businessDate));
      }
    }
    return dates.length
      ? [{ businessId: business.id, businessDate: { in: dates } }]
      : [];
  });
  return dateFilters.length
    ? { OR: dateFilters }
    : { id: { in: [] } };
}

function assertClosingRowLimit(
  rowCount: number,
  maxRows: number,
  limitKind: "REPORT" | "EXPORT" | undefined,
) {
  if (rowCount <= maxRows) return;
  const message =
    `This closing range contains more than ${maxRows.toLocaleString("en-MY")} rows. ` +
    "Narrow the period or store filter and try again.";
  if (limitKind === "EXPORT") {
    throw new GroupClosingExportLimitError(message);
  }
  throw new GroupClosingInputError(message);
}

function safePageOffset(page: number, pageSize: number) {
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset)) {
    throw new GroupClosingInputError("Select a valid closing records page.");
  }
  return offset;
}

function parseGroupClosingFilters(
  input: Omit<GroupClosingInput, "userId" | "groupId" | "activeBusinessId">,
  scope: AuthorizedGroupReportingContext,
): GroupClosingFilters {
  const range = normalizeRange(input.range);
  const customRange = validateCustomRange(range, input.from, input.to);
  const store = input.store?.trim();
  if (
    store &&
    store !== "all" &&
    (!z.string().uuid().safeParse(store).success ||
      !scope.businesses.some((business) => business.id === store))
  ) {
    throw new GroupClosingInputError("Select an authorized store.");
  }
  const statusValue = input.status?.trim().toUpperCase();
  const auditStatus =
    !statusValue || statusValue === "ALL"
      ? null
      : statusValue === "COMPLETE" || statusValue === "MISSING"
        ? statusValue
        : null;
  if (statusValue && statusValue !== "ALL" && !auditStatus) {
    throw new GroupClosingInputError("Select a valid closing audit status.");
  }
  return {
    range,
    from: customRange?.from ?? null,
    to: customRange?.to ?? null,
    storeId: store && store !== "all" ? store : null,
    auditStatus,
    page: parsePage(input.page, "closing records"),
    auditPage: parsePage(input.auditPage, "closing audit"),
  };
}

function parsePage(value: string | undefined, label: string) {
  const normalized = value?.trim() || "1";
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new GroupClosingInputError(`Select a valid ${label} page.`);
  }
  const page = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(page)) {
    throw new GroupClosingInputError(`Select a valid ${label} page.`);
  }
  return page;
}

function positivePageSize(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Closing page size must be a positive safe integer.");
  }
  return value;
}

function paginate<T>(rows: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

type SnapshotRow = Prisma.DailyClosingSnapshotGetPayload<{
  select: {
    id: true;
    businessId: true;
    branchId: true;
    businessDate: true;
    timezone: true;
    expectedCashCents: true;
    actualCashCents: true;
    cashDifferenceCents: true;
    closingNote: true;
    closedAt: true;
    reportVersion: true;
    reportDataJson: true;
    business: { select: { name: true } };
    branch: { select: { name: true } };
    closedBy: { select: { name: true } };
    closingWhatsAppSends: {
      select: { status: true };
    };
  };
}>;

function toGroupClosingRow(snapshot: SnapshotRow): GroupClosingRow {
  const payload = isDailyClosingSnapshotPayload(snapshot.reportDataJson)
    ? snapshot.reportDataJson
    : null;
  return {
    id: snapshot.id,
    businessId: snapshot.businessId,
    businessName: snapshot.business.name,
    branchId: snapshot.branchId,
    branchName: snapshot.branch.name,
    businessDate: snapshot.businessDate.toISOString().slice(0, 10),
    timezone: snapshot.timezone,
    expectedCashCents: snapshot.expectedCashCents,
    actualCashCents: snapshot.actualCashCents,
    cashDifferenceCents: snapshot.cashDifferenceCents,
    closingNote: snapshot.closingNote,
    closedAt: snapshot.closedAt,
    closedByName: snapshot.closedBy.name,
    reportVersion: snapshot.reportVersion,
    generatedAt: payload ? new Date(payload.generatedAt) : null,
    businessDayCutoffTime: payload?.businessDayCutoffTime ?? null,
    businessDayDefinitionVersion:
      payload?.businessDayDefinitionVersion ?? null,
    metricDefinitionVersion: payload?.metricDefinitionVersion ?? null,
    financial: payload?.report.financial ?? null,
    whatsappStatus: snapshot.closingWhatsAppSends[0]?.status ?? "NOT_QUEUED",
  };
}
