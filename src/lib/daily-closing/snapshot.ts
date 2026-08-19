import type { BusinessIndustry } from "@prisma/client";
import { dateValueToUtcDate } from "@/lib/business-time";
import { FINANCIAL_METRIC_DEFINITION_VERSION } from "@/lib/financial-metrics";
import {
  formatDailyClosingGeneratedAt,
  formatMoneyFromCents,
} from "./format";
import {
  LEGACY_DAILY_CLOSING_CUTOFF_TIME,
} from "./range";
import type { DailyClosingReport } from "./types";

export const DAILY_CLOSING_REPORT_VERSION = 2;
export const DAILY_CLOSING_METRIC_DEFINITION_VERSION =
  FINANCIAL_METRIC_DEFINITION_VERSION;
export const DAILY_CLOSING_BUSINESS_DAY_DEFINITION_VERSION = 1;
const LEGACY_DAILY_CLOSING_REPORT_VERSION = 1;

export type DailyClosingSnapshotPayload = {
  branch: {
    id: string;
    name: string;
  };
  business: {
    id: string;
    name: string;
  };
  businessDate: string;
  businessDayCutoffTime?: string;
  businessDayDefinitionVersion?: number;
  businessType: BusinessIndustry;
  cash: {
    actualCents: number;
    differenceCents: number;
    expectedCents: number;
  };
  closedAt: string;
  closedBy: {
    id: string;
    name: string;
  };
  closingNote: string | null;
  generatedAt: string;
  metricDefinitionVersion?: number;
  report: DailyClosingReport;
  timezone: string;
  version: number;
};

export function getExpectedCashCents(report: DailyClosingReport) {
  return (
    report.paymentMethods.find((payment) => payment.method === "CASH")?.netCents ??
    0
  ) - (report.cashDrawer?.expensePayoutCents ?? 0);
}

export function normalizeBusinessDate(dateValue: string) {
  return dateValueToUtcDate(dateValue);
}

export function buildDailyClosingSnapshotPayload(input: {
  actualCashCents: number;
  branch: DailyClosingSnapshotPayload["branch"];
  business: DailyClosingSnapshotPayload["business"];
  businessDate: string;
  businessDayCutoffTime: string;
  businessType: BusinessIndustry;
  closedAt: Date;
  closedBy: DailyClosingSnapshotPayload["closedBy"];
  closingNote: string | null;
  expectedCashCents: number;
  generatedAt: Date;
  report: DailyClosingReport;
  timezone: string;
}) {
  return {
    branch: input.branch,
    business: input.business,
    businessDate: input.businessDate,
    businessDayCutoffTime: input.businessDayCutoffTime,
    businessDayDefinitionVersion:
      DAILY_CLOSING_BUSINESS_DAY_DEFINITION_VERSION,
    businessType: input.businessType,
    cash: {
      actualCents: input.actualCashCents,
      differenceCents: input.actualCashCents - input.expectedCashCents,
      expectedCents: input.expectedCashCents,
    },
    closedAt: input.closedAt.toISOString(),
    closedBy: input.closedBy,
    closingNote: input.closingNote,
    generatedAt: input.generatedAt.toISOString(),
    metricDefinitionVersion: DAILY_CLOSING_METRIC_DEFINITION_VERSION,
    report: input.report,
    timezone: input.timezone,
    version: DAILY_CLOSING_REPORT_VERSION,
  } satisfies DailyClosingSnapshotPayload;
}

export function buildFrozenDailyClosingWhatsAppText(input: {
  baseText: string;
  payload: DailyClosingSnapshotPayload;
}) {
  const { cash, closedAt, closedBy, closingNote } = input.payload;

  return [
    input.baseText,
    "",
    "*Cash reconciliation*",
    `Expected cash: ${formatMoneyFromCents(cash.expectedCents)}`,
    `Actual cash: ${formatMoneyFromCents(cash.actualCents)}`,
    `Difference: ${formatMoneyFromCents(cash.differenceCents)}`,
    ...(closingNote ? [`Note: ${closingNote}`] : []),
    "",
    `Closed by: ${closedBy.name}`,
    `Closed at: ${formatDailyClosingGeneratedAt(
      new Date(closedAt),
      input.payload.timezone,
    )}`,
  ].join("\n");
}

export function getSnapshotBusinessDayCutoffTime(
  payload: DailyClosingSnapshotPayload,
) {
  return payload.businessDayCutoffTime ?? LEGACY_DAILY_CLOSING_CUTOFF_TIME;
}

export function isDailyClosingSnapshotPayload(
  value: unknown,
): value is DailyClosingSnapshotPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<DailyClosingSnapshotPayload>;

  const isSupportedVersion =
    payload.version === LEGACY_DAILY_CLOSING_REPORT_VERSION ||
    payload.version === DAILY_CLOSING_REPORT_VERSION;
  const hasBasePayload =
    isSupportedVersion &&
    typeof payload.businessDate === "string" &&
    typeof payload.timezone === "string" &&
    !!payload.report &&
    typeof payload.report === "object" &&
    !!payload.cash &&
    typeof payload.cash.actualCents === "number" &&
    typeof payload.cash.expectedCents === "number" &&
    typeof payload.cash.differenceCents === "number";

  if (!hasBasePayload) return false;
  if (payload.version === LEGACY_DAILY_CLOSING_REPORT_VERSION) return true;

  return (
    typeof payload.businessDayCutoffTime === "string" &&
    typeof payload.businessDayDefinitionVersion === "number" &&
    typeof payload.metricDefinitionVersion === "number"
  );
}
