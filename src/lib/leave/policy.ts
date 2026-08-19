import type {
  LeaveCountMode,
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
  statutoryCategory: z.enum(["ANNUAL_LEAVE", "SICK_LEAVE", "HOSPITALISATION_LEAVE", "MATERNITY_LEAVE", "PATERNITY_LEAVE"]).or(z.literal("")).optional(),
  entitlementPeriodType: z.enum(["CALENDAR_YEAR", "SERVICE_ANNIVERSARY", "CUSTOM_YEAR"]).default("CALENDAR_YEAR"),
  customYearStartMonth: z.union([z.literal(""), z.coerce.number().int().min(1).max(12)]).optional(),
  customYearStartDay: z.union([z.literal(""), z.coerce.number().int().min(1).max(31)]).optional(),
  prorationMethod: z.enum(["NONE", "CALENDAR_DAY_RATIO"]).default("NONE"),
  entitlementRounding: z.enum(["NONE", "DOWN_TO_HALF_DAY", "NEAREST_HALF_DAY", "UP_TO_HALF_DAY"]).default("NONE"),
  eligibleEmploymentTypes: z.array(z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "DAILY", "HOURLY"])).default([]),
  carryForwardEnabled: z.coerce.boolean().default(false),
  carryForwardLimitUnits: z.union([z.literal(""), z.coerce.number().min(0).max(366)]).optional(),
  carryForwardExpiryRule: z.enum(["NO_EXPIRY", "DAYS_AFTER_ROLLOVER", "MONTHS_AFTER_ROLLOVER", "FIXED_DATE_IN_DESTINATION_PERIOD"]).default("NO_EXPIRY"),
  carryForwardExpiryValue: z.string().trim().max(10).optional(),
  consumptionPriority: z.enum(["EARLIEST_EXPIRY_FIRST", "OLDEST_ENTITLEMENT_FIRST"]).default("EARLIEST_EXPIRY_FIRST"),
  reason: z.string().trim().min(3).max(500),
}).superRefine((value, context) => {
  if (value.payTreatment === "UNPAID" && value.balanceTracked) {
    context.addIssue({ code: "custom", path: ["balanceTracked"], message: "Unpaid leave must not consume a paid-leave balance." });
  }
  if (value.entitlementPeriodType === "CUSTOM_YEAR" && (!value.customYearStartMonth || !value.customYearStartDay)) {
    context.addIssue({ code: "custom", path: ["customYearStartMonth"], message: "Custom year requires a start month and day." });
  }
  if (!value.carryForwardEnabled) return;
  if (["DAYS_AFTER_ROLLOVER", "MONTHS_AFTER_ROLLOVER"].includes(value.carryForwardExpiryRule)) {
    const amount = Number(value.carryForwardExpiryValue);
    if (!Number.isInteger(amount) || amount < 1) {
      context.addIssue({ code: "custom", path: ["carryForwardExpiryValue"], message: "Enter a positive whole-number expiry period." });
    }
  }
  if (value.carryForwardExpiryRule === "FIXED_DATE_IN_DESTINATION_PERIOD" && !/^\d{2}-\d{2}$/.test(value.carryForwardExpiryValue ?? "")) {
    context.addIssue({ code: "custom", path: ["carryForwardExpiryValue"], message: "Enter the expiry date as MM-DD." });
  }
});

export const leavePolicyCreateInputSchema = z.object({
  effectiveFrom: dateValue,
  name: z.string().trim().min(2).max(120),
  payTreatment: z.enum(["PAID", "UNPAID"]),
  countMode: z.enum(["WEEKDAYS", "CALENDAR_DAYS"]),
  balanceTracked: z.coerce.boolean(),
  defaultEntitlementDays: z.union([z.literal(""), z.coerce.number().min(0).max(366)]).optional(),
  requiresDocument: z.coerce.boolean(),
  allowNegativeBalance: z.coerce.boolean(),
  reason: z.string().trim().min(3).max(500),
}).superRefine((value, context) => {
  if (value.payTreatment === "UNPAID" && value.balanceTracked) {
    context.addIssue({ code: "custom", path: ["balanceTracked"], message: "Unpaid leave must not consume a paid-leave balance." });
  }
});

export const SYSTEM_LEAVE_POLICY_CODES = [
  "ANNUAL",
  "SICK",
  "HOSPITALISATION",
  "MATERNITY",
  "PATERNITY",
  "UNPAID",
  "COMPASSIONATE",
  "OTHER",
] as const;

export type SystemLeavePolicyCode = (typeof SYSTEM_LEAVE_POLICY_CODES)[number];

export type LeavePolicyStarter = Readonly<{
  code: SystemLeavePolicyCode;
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

export function leavePolicyCodeLabel(code: string) {
  const labels: Record<SystemLeavePolicyCode, string> = {
    ANNUAL: "Annual",
    SICK: "Sick",
    HOSPITALISATION: "Hospitalisation",
    MATERNITY: "Maternity",
    PATERNITY: "Paternity",
    UNPAID: "Unpaid",
    COMPASSIONATE: "Compassionate",
    OTHER: "Other",
  };
  return code in labels ? labels[code as SystemLeavePolicyCode] : "Custom";
}
