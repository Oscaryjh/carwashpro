import { createHash } from "node:crypto";

export const SABAH_WORK_PAY_JURISDICTION = "MY-SABAH" as const;
export const SABAH_WORK_PAY_RULE_VERSION = "MY-SABAH-WORK-PAY-2025-05-CANDIDATE-1";
export const SABAH_WORK_PAY_EFFECTIVE_FROM = "2025-05-01";

export const SABAH_WORK_PAY_OFFICIAL_SOURCES = [
  {
    authority: "Sabah State Attorney-General's Chambers",
    title: "Labour Ordinance (Sabah Cap. 67), consolidated text (June 2026)",
    url: "https://sagc.sabah.gov.my/sites/default/files/law/Labour%20Ordinance%20%28Sabah%20Cap.%2067%29.pdf",
    sections: ["2(3)", "103", "104", "104C", "First Schedule"],
  },
  {
    authority: "Jabatan Tenaga Kerja Sabah",
    title: "Labour Ordinance of Sabah (Amendment) Act 2025 (Act A1753)",
    url: "https://www.jtksabah.gov.my/web/images/warta_2025/A1753_-Labour_Ordinance_of_Sabah_Amendment_Act_2025.pdf",
    sections: ["commencement", "coverage amendments"],
  },
] as const;

export const SABAH_WORK_PAY_CANDIDATE_RULE = {
  jurisdictionCode: SABAH_WORK_PAY_JURISDICTION,
  version: SABAH_WORK_PAY_RULE_VERSION,
  effectiveFrom: SABAH_WORK_PAY_EFFECTIVE_FROM,
  status: "READY_FOR_HUMAN_SIGN_OFF",
  activationPerformed: false,
  ordinaryRate: { monthlyDivisor: 26 },
  normalOvertime: { hourlyMultiplier: "1.5", section: "104" },
  restDay: {
    monthlyOrWeeklyUpToHalfDayOrpMultiplier: "0.5",
    monthlyOrWeeklyOverHalfToNormalHoursOrpMultiplier: "1",
    overtimeHourlyMultiplier: "2",
    section: "104C",
  },
  publicHoliday: {
    monthlyBaseAlreadyIncluded: true,
    workedAdditionalOrpMultiplier: "2",
    overtimeHourlyMultiplier: "3",
    section: "103",
  },
  unresolved: [
    "DAILY_OR_HOURLY_PRIOR_WAGE_PERIOD_FACTS_REQUIRED",
    "ABOVE_RM4000_LEGAL_EMPLOYMENT_CATEGORY_REQUIRED",
    "REST_DAY_PUBLIC_HOLIDAY_OVERLAP_REVIEW_REQUIRED",
  ],
  sources: SABAH_WORK_PAY_OFFICIAL_SOURCES,
} as const;

export const SABAH_WORK_PAY_SOURCE_DIGEST = createHash("sha256")
  .update(JSON.stringify(SABAH_WORK_PAY_CANDIDATE_RULE))
  .digest("hex");

export const SABAH_WORK_PAY_DATASET_ROW_COUNT = 5;

export const SABAH_WORK_PAY_DATASET_DIGEST = createHash("sha256")
  .update(
    JSON.stringify({
      version: SABAH_WORK_PAY_RULE_VERSION,
      classifications: [
        "NORMAL_OT",
        "REST_DAY_WORK",
        "REST_DAY_OT",
        "PUBLIC_HOLIDAY_WORK",
        "PUBLIC_HOLIDAY_OT",
      ],
      rule: SABAH_WORK_PAY_CANDIDATE_RULE,
    }),
  )
  .digest("hex");

export const SABAH_WORK_PAY_CALCULATOR_TEST_DIGEST = createHash("sha256")
  .update(
    JSON.stringify({
      version: SABAH_WORK_PAY_RULE_VERSION,
      suite: "tests/unit/payroll-p6c-sabah-work-pay.test.ts",
      assertions: [
        "five statutory work-pay classifications",
        "monthly base is not duplicated",
        "unsupported pay bases fail closed",
        "coverage boundary fails closed",
        "candidate rules cannot be used for payroll",
        "jurisdiction and date overlaps fail closed",
        "attendance aggregates reconcile to date facts",
        "money rounding and digests are deterministic",
      ],
    }),
  )
  .digest("hex");

export type SabahWorkPayRuleStatus =
  | "READY_FOR_HUMAN_SIGN_OFF"
  | "HUMAN_SIGNED_OFF"
  | "ACTIVE";

export function assertSabahWorkPayRuleUsable(input: {
  jurisdictionCode: string | null;
  status: SabahWorkPayRuleStatus;
  allowCandidateForVerification?: boolean;
}) {
  if (input.jurisdictionCode !== SABAH_WORK_PAY_JURISDICTION) {
    throw new Error("STATUTORY_WORK_PAY_JURISDICTION_NOT_SUPPORTED");
  }
  if (
    input.status !== "ACTIVE" &&
    !(input.allowCandidateForVerification && input.status === "READY_FOR_HUMAN_SIGN_OFF")
  ) {
    throw new Error("STATUTORY_MONEY_RULE_NOT_ACTIVE");
  }
}
