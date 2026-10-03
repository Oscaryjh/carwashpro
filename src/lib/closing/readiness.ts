import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentBusinessDateValue } from "@/lib/business-day";
import { isValidDateValue } from "@/lib/business-time";
import { getDailyClosingRange } from "@/lib/daily-closing/range";
import { normalizeBusinessDate } from "@/lib/daily-closing/snapshot";
import { financialReadSnapshot } from "@/lib/reports/financial-read-snapshot";
import { assertNoCrossBusinessDayShiftActivity, CrossBusinessDayShiftReviewRequiredError, type BusinessTimeSettings } from "./shift-control";

export type DailyClosingReadiness =
  | { status: "READY"; businessDate: string; isCurrentBusinessDate: boolean; shiftCount: number }
  | { status: "BLOCKED_OPEN"; businessDate: string; openShiftCount: number }
  | { status: "BLOCKED_REVIEW" | "CLOSED"; businessDate: string }
  | { status: "NO_BRANCH" | "UNAUTHORIZED_BRANCH" | "INVALID_DATE" | "FUTURE_DATE" };

/** Presentation only. Confirm must recheck the existing guards under its scope lock. */
export async function getDailyClosingReadiness(input: {
  businessId: string;
  branchId: string | null;
  authorizedBranchIds: readonly string[];
  dateValue: string;
  settings: BusinessTimeSettings;
  now?: Date;
}, database: PrismaClient | Prisma.TransactionClient = prisma): Promise<DailyClosingReadiness> {
  if (!input.branchId) return { status: "NO_BRANCH" };
  if (!input.authorizedBranchIds.includes(input.branchId)) return { status: "UNAUTHORIZED_BRANCH" };
  if (!isValidDateValue(input.dateValue)) return { status: "INVALID_DATE" };
  const currentDate = getCurrentBusinessDateValue(input.now ?? new Date(), input.settings.timezone, input.settings.businessDayCutoffTime);
  if (input.dateValue > currentDate) return { status: "FUTURE_DATE" };
  const branchId = input.branchId;
  const businessDate = input.dateValue;
  const isCurrentBusinessDate = businessDate === currentDate;
  const { fromDate, toDateExclusive } = getDailyClosingRange(undefined, businessDate, input.settings);
  return financialReadSnapshot(database, async databaseClient => {
    const tx = databaseClient as Prisma.TransactionClient;
    const scope = { businessId: input.businessId, branchId };
    const snapshot = await tx.dailyClosingSnapshot.findUnique({ where: { businessId_branchId_businessDate: { ...scope, businessDate: normalizeBusinessDate(businessDate) } }, select: { id: true } });
    if (snapshot) return { status: "CLOSED", businessDate };
    const startedAt = { gte: fromDate, lt: toDateExclusive };
    const openShiftCount = await tx.cashierShift.count({ where: { ...scope, status: "OPEN", ...(!isCurrentBusinessDate ? { startedAt } : {}) } });
    if (openShiftCount) return { status: "BLOCKED_OPEN", businessDate, openShiftCount };
    try {
      await assertNoCrossBusinessDayShiftActivity(tx, { ...scope, businessDate, settings: input.settings });
    } catch (error) {
      if (!(error instanceof CrossBusinessDayShiftReviewRequiredError)) throw error;
      return { status: "BLOCKED_REVIEW", businessDate };
    }
    const shiftCount = await tx.cashierShift.count({ where: { ...scope, startedAt } });
    return { status: "READY", businessDate, isCurrentBusinessDate, shiftCount };
  });
}
