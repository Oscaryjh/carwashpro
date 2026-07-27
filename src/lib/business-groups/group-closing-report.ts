import type { Prisma } from "@prisma/client";
import { z } from "zod";
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
  addDaysToDateValue,
  dateValueToUtcDate,
} from "@/lib/business-time";
import {
  isDailyClosingSnapshotPayload,
  type DailyClosingSnapshotPayload,
} from "@/lib/daily-closing/snapshot";
import { prisma } from "@/lib/prisma";

export type GroupClosingFilters = {
  range: AllStoresRange;
  from: string | null;
  to: string | null;
  storeId: string | null;
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
  expectedCashCents: number;
  actualCashCents: number;
  cashDifferenceCents: number;
  closingNote: string | null;
  closedAt: Date;
  closedByName: string;
  reportVersion: number;
  financial: DailyClosingSnapshotPayload["report"]["financial"] | null;
  whatsappStatus: string;
};

export type GroupClosingReport = {
  groupId: string;
  groupName: string;
  role: AuthorizedGroupReportingContext["role"];
  authorizedBusinesses: AuthorizedGroupReportingContext["businesses"];
  filters: GroupClosingFilters;
  summary: GroupClosingSummary;
  rows: GroupClosingRow[];
};

type GroupClosingDatabase = Pick<
  Prisma.TransactionClient,
  "dailyClosingSnapshot"
>;

type GroupClosingInput = {
  userId: string;
  groupId: string;
  activeBusinessId: string;
  range?: string;
  from?: string;
  to?: string;
  store?: string;
};

type GroupClosingDependencies = {
  now?: Date;
  resolveScope?: typeof resolveAuthorizedGroupReportingScope;
};

export class GroupClosingInputError extends Error {}

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

  const filters = parseGroupClosingFilters(input, scope);
  const businesses = filters.storeId
    ? scope.businesses.filter((business) => business.id === filters.storeId)
    : scope.businesses;
  const now = dependencies.now ?? new Date();
  const businessRanges = businesses.map((business) => {
    const period = buildBusinessPeriods({
      range: filters.range,
      from: filters.from,
      to: filters.to,
      now,
      timezone: business.timezone,
      businessDayCutoffTime: business.businessDayCutoffTime,
    }).current;
    return {
      businessId: business.id,
      gte: dateValueToUtcDate(period.fromDateValue),
      lt: dateValueToUtcDate(addDaysToDateValue(period.toDateValue, 1)),
    };
  });
  const snapshots = await database.dailyClosingSnapshot.findMany({
    where: {
      OR: businessRanges.map(({ businessId, gte, lt }) => ({
        businessId,
        businessDate: { gte, lt },
      })),
    },
    orderBy: [
      { businessDate: "desc" },
      { business: { name: "asc" } },
      { branch: { name: "asc" } },
      { id: "asc" },
    ],
    select: {
      id: true,
      businessId: true,
      branchId: true,
      businessDate: true,
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
  });
  const rows = snapshots.map(toGroupClosingRow);

  return {
    groupId: scope.groupId,
    groupName: scope.groupName,
    role: scope.role,
    authorizedBusinesses: scope.businesses,
    filters,
    summary: summarizeGroupClosings(rows),
    rows,
  };
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
  return {
    range,
    from: customRange?.from ?? null,
    to: customRange?.to ?? null,
    storeId: store && store !== "all" ? store : null,
  };
}

type SnapshotRow = Prisma.DailyClosingSnapshotGetPayload<{
  select: {
    id: true;
    businessId: true;
    branchId: true;
    businessDate: true;
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
    expectedCashCents: snapshot.expectedCashCents,
    actualCashCents: snapshot.actualCashCents,
    cashDifferenceCents: snapshot.cashDifferenceCents,
    closingNote: snapshot.closingNote,
    closedAt: snapshot.closedAt,
    closedByName: snapshot.closedBy.name,
    reportVersion: snapshot.reportVersion,
    financial: payload?.report.financial ?? null,
    whatsappStatus: snapshot.closingWhatsAppSends[0]?.status ?? "NOT_QUEUED",
  };
}
