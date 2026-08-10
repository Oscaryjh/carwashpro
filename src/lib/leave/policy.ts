import type {
  LeaveCountMode,
  LeavePolicyCode,
  LeavePolicyVersion,
} from "@prisma/client";
import { z } from "zod";
import { dateValueToUtcDate, utcDateToDateValue } from "@/lib/business-time";

const dateValue = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const leaveRequestInputSchema = z.object({
  clientRequestId: z.string().uuid(),
  policyId: z.string().uuid(),
  startsOn: dateValue,
  endsOn: dateValue,
  leaveUnit: z.enum(["FULL_DAY", "HALF_DAY_AM", "HALF_DAY_PM"]).default("FULL_DAY"),
  reason: z.string().trim().min(3).max(500),
  documentReference: z.string().trim().max(500).optional().nullable(),
});

export const leaveCancelInputSchema = z.object({
  requestId: z.string().uuid(),
  expectedRevision: z.coerce.number().int().min(0),
  reason: z.string().trim().min(3).max(500),
});

export const leaveReviewInputSchema = z.object({
  requestId: z.string().uuid(),
  expectedRevision: z.coerce.number().int().min(0),
  decision: z.enum(["APPROVED", "REJECTED"]),
  reviewNote: z.string().trim().max(500).optional().nullable(),
}).superRefine((value, context) => {
  if (value.decision === "REJECTED" && (value.reviewNote?.length ?? 0) < 3) {
    context.addIssue({ code: "custom", path: ["reviewNote"], message: "A rejection reason is required." });
  }
});

export const leaveManagerCancelInputSchema = z.object({
  requestId: z.string().uuid(),
  expectedRevision: z.coerce.number().int().min(0),
  reason: z.string().trim().min(3).max(500),
});

export const leaveBalanceInputSchema = z.object({
  membershipId: z.string().uuid(),
  policyId: z.string().uuid(),
  year: z.coerce.number().int().min(2000).max(2200),
  units: z.coerce.number().min(-366).max(366).refine((value) => value !== 0, "Adjustment cannot be zero."),
  reason: z.string().trim().min(3).max(500),
  sourceKey: z.string().uuid(),
});

export const leavePolicyVersionInputSchema = z.object({
  policyId: z.string().uuid(),
  effectiveFrom: dateValue,
  name: z.string().trim().min(2).max(120),
  payTreatment: z.enum(["PAID", "UNPAID"]),
  countMode: z.enum(["WEEKDAYS", "CALENDAR_DAYS"]),
  balanceTracked: z.coerce.boolean(),
  defaultEntitlementDays: z.union([z.literal(""), z.coerce.number().min(0).max(366)]).optional(),
  underTwoYearsDays: z.union([z.literal(""), z.coerce.number().min(0).max(366)]).optional(),
  twoToFiveYearsDays: z.union([z.literal(""), z.coerce.number().min(0).max(366)]).optional(),
  fiveYearsPlusDays: z.union([z.literal(""), z.coerce.number().min(0).max(366)]).optional(),
  requiresDocument: z.coerce.boolean(),
  allowNegativeBalance: z.coerce.boolean(),
  reason: z.string().trim().min(3).max(500),
}).superRefine((value, context) => {
  if (value.payTreatment === "UNPAID" && value.balanceTracked) {
    context.addIssue({ code: "custom", path: ["balanceTracked"], message: "Unpaid leave must not consume a paid-leave balance." });
  }
});

export type LeavePolicyStarter = Readonly<{
  code: LeavePolicyCode;
  name: string;
  payTreatment: "PAID" | "UNPAID";
  countMode: LeaveCountMode;
  balanceTracked: boolean;
  defaultEntitlementDays?: number;
  requiresDocument?: boolean;
}>;

// These are explicitly company-policy starters. They do not assert Malaysia
// statutory minimums. Verified legal rules must arrive through a separately
// certified, source-bound policy version.
export const COMPANY_LEAVE_STARTER: readonly LeavePolicyStarter[] = [
  { code: "ANNUAL", name: "Annual leave (company policy)", payTreatment: "PAID", countMode: "WEEKDAYS", balanceTracked: true, defaultEntitlementDays: 0 },
  { code: "SICK", name: "Medical leave (company policy)", payTreatment: "PAID", countMode: "WEEKDAYS", balanceTracked: true, defaultEntitlementDays: 0, requiresDocument: true },
  { code: "UNPAID", name: "Unpaid leave", payTreatment: "UNPAID", countMode: "WEEKDAYS", balanceTracked: false },
] as const;

export function enumerateCalendarDates(startsOn: string, endsOn: string) {
  const start = dateValueToUtcDate(startsOn);
  const end = dateValueToUtcDate(endsOn);
  if (end < start) throw new Error("Leave end date must be on or after the start date.");
  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    if (dates.length > 366) throw new Error("A leave request cannot exceed 366 days.");
    dates.push(utcDateToDateValue(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function resolveLeaveEntitlementDays(
  policy: Pick<LeavePolicyVersion, "defaultEntitlementDays" | "underTwoYearsDays" | "twoToFiveYearsDays" | "fiveYearsPlusDays">,
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
