import { z } from "zod";

export const malaysiaStateOptions = [
  ["JHR", "Johor"], ["KDH", "Kedah"], ["KTN", "Kelantan"], ["MLK", "Melaka"],
  ["NSN", "Negeri Sembilan"], ["PHG", "Pahang"], ["PNG", "Penang"], ["PRK", "Perak"],
  ["PLS", "Perlis"], ["SBH", "Sabah"], ["SWK", "Sarawak"], ["SGR", "Selangor"],
  ["TRG", "Terengganu"], ["KUL", "Kuala Lumpur"], ["LBN", "Labuan"], ["PJY", "Putrajaya"],
] as const;

export const holidayInputSchema = z.object({
  branchId: z.string().uuid().optional().nullable(),
  workDate: z.coerce.date(),
  name: z.string().trim().min(2).max(160),
  holidayType: z.enum(["PUBLIC_HOLIDAY", "COMPANY_HOLIDAY", "SPECIAL_CLOSURE"]),
  source: z.enum(["OFFICIAL", "CUSTOM"]),
  scope: z.enum(["NATIONAL", "STATE", "BUSINESS", "BRANCH"]),
  countryCode: z.string().trim().toUpperCase().length(2).default("MY"),
  stateCode: z.string().trim().toUpperCase().max(12).optional().nullable(),
  statutory: z.boolean().default(false),
  officialReference: z.string().trim().url().max(500).optional().nullable(),
  reason: z.string().trim().max(500).optional().nullable(),
}).superRefine((value, context) => {
  if (value.scope === "BRANCH" && !value.branchId) context.addIssue({ code: "custom", path: ["branchId"], message: "Select a branch for a branch holiday." });
  if (value.scope === "STATE" && !value.stateCode) context.addIssue({ code: "custom", path: ["stateCode"], message: "Select a state for a state holiday." });
  if (value.source === "OFFICIAL" && !value.officialReference) context.addIssue({ code: "custom", path: ["officialReference"], message: "Official holidays require a source URL." });
});

export type ResolvedHoliday = {
  id: string;
  workDate: Date;
  name: string;
  holidayType: "PUBLIC_HOLIDAY" | "COMPANY_HOLIDAY" | "SPECIAL_CLOSURE";
  source: "OFFICIAL" | "CUSTOM" | "LEGACY_PAYROLL";
  scope: "NATIONAL" | "STATE" | "BUSINESS" | "BRANCH";
  revision: number;
  statutory: boolean;
  officialReference: string | null;
  legacyPayrollHolidayId: string | null;
};

export type HolidayApplicability = {
  scope: "NATIONAL" | "STATE" | "BUSINESS" | "BRANCH";
  countryCode: string;
  stateCode: string | null;
  branchId: string | null;
};

export type HolidayBranchJurisdiction = {
  id: string;
  countryCode: string;
  stateCode: string | null;
};

export function holidayAppliesToBranch(
  holiday: HolidayApplicability,
  branch: HolidayBranchJurisdiction,
) {
  if (holiday.scope === "BUSINESS") return true;
  if (holiday.scope === "BRANCH") return holiday.branchId === branch.id;
  if (holiday.countryCode !== branch.countryCode) return false;
  if (holiday.scope === "NATIONAL") return true;
  return Boolean(branch.stateCode && holiday.stateCode === branch.stateCode);
}

export function holidayContext(holiday: ResolvedHoliday | undefined) {
  if (!holiday) return null;
  return {
    holidayOccurrenceId: holiday.source === "LEGACY_PAYROLL" ? null : holiday.id,
    payrollHolidayId: holiday.legacyPayrollHolidayId,
    name: holiday.name,
    holidayType: holiday.holidayType,
    source: holiday.source,
    scope: holiday.scope,
    revision: holiday.revision,
    statutory: holiday.statutory,
    officialReference: holiday.officialReference,
  };
}
