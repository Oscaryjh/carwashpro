import type { LeaveCountMode, LeavePolicy, LeavePolicyCode } from "@prisma/client";
import { z } from "zod";
import { dateValueToUtcDate, utcDateToDateValue } from "@/lib/business-time";

export const leaveRequestInputSchema = z.object({
  policyId: z.string().uuid(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(3).max(500),
  documentReference: z.string().trim().max(500).optional().nullable(),
});

export const leaveCancelInputSchema = z.object({
  requestId: z.string().uuid(),
});

export const leaveReviewInputSchema = z.object({
  requestId: z.string().uuid(),
  decision: z.enum(["APPROVED", "REJECTED"]),
  reviewNote: z.string().trim().max(500).optional().nullable(),
});

export const leaveBalanceInputSchema = z.object({
  membershipId: z.string().uuid(),
  policyId: z.string().uuid(),
  year: z.coerce.number().int().min(2000).max(2200),
  entitlementOverrideDays: z.union([z.literal(""), z.coerce.number().min(0).max(366)]).optional(),
  carriedForwardDays: z.coerce.number().min(0).max(366).default(0),
  adjustmentDays: z.coerce.number().min(-366).max(366).default(0),
  note: z.string().trim().max(500).optional().nullable(),
});

export type LeavePolicyPreset = Readonly<{
  code: LeavePolicyCode;
  name: string;
  payTreatment: "PAID" | "UNPAID";
  countMode: LeaveCountMode;
  balanceTracked: boolean;
  defaultEntitlementDays?: number;
  underTwoYearsDays?: number;
  twoToFiveYearsDays?: number;
  fiveYearsPlusDays?: number;
  requiresDocument?: boolean;
}>;

// This is an opt-in Peninsular Malaysia/Labuan minimum template. Sabah and
// Sarawak businesses should configure their own policy instead of assuming
// that Employment Act 1955 values apply unchanged.
export const PENINSULAR_LABUAN_LEAVE_PRESET: readonly LeavePolicyPreset[] = [
  { code: "ANNUAL", name: "Annual leave", payTreatment: "PAID", countMode: "WEEKDAYS", balanceTracked: true, underTwoYearsDays: 8, twoToFiveYearsDays: 12, fiveYearsPlusDays: 16 },
  { code: "SICK", name: "Sick leave", payTreatment: "PAID", countMode: "WEEKDAYS", balanceTracked: true, underTwoYearsDays: 14, twoToFiveYearsDays: 18, fiveYearsPlusDays: 22, requiresDocument: true },
  { code: "HOSPITALISATION", name: "Hospitalisation leave", payTreatment: "PAID", countMode: "CALENDAR_DAYS", balanceTracked: true, defaultEntitlementDays: 60, requiresDocument: true },
  { code: "MATERNITY", name: "Maternity leave", payTreatment: "PAID", countMode: "CALENDAR_DAYS", balanceTracked: true, defaultEntitlementDays: 98, requiresDocument: true },
  { code: "PATERNITY", name: "Paternity leave", payTreatment: "PAID", countMode: "CALENDAR_DAYS", balanceTracked: true, defaultEntitlementDays: 7, requiresDocument: true },
  { code: "UNPAID", name: "Unpaid leave", payTreatment: "UNPAID", countMode: "WEEKDAYS", balanceTracked: false },
  { code: "COMPASSIONATE", name: "Compassionate leave", payTreatment: "PAID", countMode: "CALENDAR_DAYS", balanceTracked: true, defaultEntitlementDays: 0 },
] as const;

export function enumerateLeaveDates(startsOn: string, endsOn: string, countMode: LeaveCountMode) {
  const start = dateValueToUtcDate(startsOn);
  const end = dateValueToUtcDate(endsOn);
  if (end < start) throw new Error("Leave end date must be on or after the start date.");

  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    if (dates.length > 366) throw new Error("A leave request cannot exceed 366 days.");
    const day = cursor.getUTCDay();
    if (countMode === "CALENDAR_DAYS" || (day !== 0 && day !== 6)) {
      dates.push(utcDateToDateValue(cursor));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  if (dates.length === 0) throw new Error("The selected period contains no countable leave days.");
  return dates;
}

export function resolveLeaveEntitlementDays(
  policy: Pick<LeavePolicy, "defaultEntitlementDays" | "underTwoYearsDays" | "twoToFiveYearsDays" | "fiveYearsPlusDays">,
  joinedAt: Date,
  year: number,
) {
  const serviceDate = new Date(Date.UTC(year, 11, 31));
  let years = serviceDate.getUTCFullYear() - joinedAt.getUTCFullYear();
  const anniversary = new Date(Date.UTC(serviceDate.getUTCFullYear(), joinedAt.getUTCMonth(), joinedAt.getUTCDate()));
  if (serviceDate < anniversary) years -= 1;

  const tier = years < 2
    ? policy.underTwoYearsDays
    : years < 5
      ? policy.twoToFiveYearsDays
      : policy.fiveYearsPlusDays;
  return Number(tier ?? policy.defaultEntitlementDays ?? 0);
}

export function leavePolicyCodeLabel(code: LeavePolicyCode) {
  const labels: Record<LeavePolicyCode, string> = {
    ANNUAL: "Annual",
    SICK: "Sick",
    HOSPITALISATION: "Hospitalisation",
    MATERNITY: "Maternity",
    PATERNITY: "Paternity",
    UNPAID: "Unpaid",
    COMPASSIONATE: "Compassionate",
    OTHER: "Other",
  };
  return labels[code];
}
