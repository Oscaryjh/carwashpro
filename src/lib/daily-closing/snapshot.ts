import type { BusinessIndustry } from "@prisma/client";
import { dateValueToUtcDate } from "@/lib/business-time";
import {
  formatDailyClosingGeneratedAt,
  formatMoneyFromCents,
} from "./format";
import { DAILY_CLOSING_TIME_ZONE } from "./range";
import type { DailyClosingReport } from "./types";

export const DAILY_CLOSING_REPORT_VERSION = 1;

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
  report: DailyClosingReport;
  timezone: string;
  version: number;
};

export function getExpectedCashCents(report: DailyClosingReport) {
  return (
    report.paymentMethods.find((payment) => payment.method === "CASH")?.netCents ??
    0
  );
}

export function normalizeBusinessDate(dateValue: string) {
  return dateValueToUtcDate(dateValue);
}

export function buildDailyClosingSnapshotPayload(input: {
  actualCashCents: number;
  branch: DailyClosingSnapshotPayload["branch"];
  business: DailyClosingSnapshotPayload["business"];
  businessDate: string;
  businessType: BusinessIndustry;
  closedAt: Date;
  closedBy: DailyClosingSnapshotPayload["closedBy"];
  closingNote: string | null;
  expectedCashCents: number;
  generatedAt: Date;
  report: DailyClosingReport;
}) {
  return {
    branch: input.branch,
    business: input.business,
    businessDate: input.businessDate,
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
    report: input.report,
    timezone: DAILY_CLOSING_TIME_ZONE,
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
    `Closed at: ${formatDailyClosingGeneratedAt(new Date(closedAt))}`,
  ].join("\n");
}

export function isDailyClosingSnapshotPayload(
  value: unknown,
): value is DailyClosingSnapshotPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<DailyClosingSnapshotPayload>;

  return (
    payload.version === DAILY_CLOSING_REPORT_VERSION &&
    typeof payload.businessDate === "string" &&
    typeof payload.timezone === "string" &&
    !!payload.report &&
    typeof payload.report === "object" &&
    !!payload.cash &&
    typeof payload.cash.actualCents === "number" &&
    typeof payload.cash.expectedCents === "number" &&
    typeof payload.cash.differenceCents === "number"
  );
}
