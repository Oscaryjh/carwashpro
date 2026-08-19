import { createHash } from "node:crypto";

export const SABAH_LEAVE_RULE_PACK_VERSION = "MY-SABAH-LEAVE-2025-05";
export const SABAH_LEAVE_JURISDICTION = "MY-SABAH";
export const SABAH_LEAVE_EFFECTIVE_FROM = "2025-05-01";

export const SABAH_LEAVE_OFFICIAL_SOURCES = [
  {
    title: "Labour Ordinance of Sabah (Amendment) Act 2025 [Act A1753]",
    url: "https://www.jtksabah.gov.my/web/images/warta_2025/A1753_-Labour_Ordinance_of_Sabah_Amendment_Act_2025.pdf",
    section: "Sections 1(2), 2 and 83; paragraph 104E(1)(ab); section 104EA",
    retrievedAt: "2026-08-17T00:00:00.000Z",
    contentHash: "0393FB6576935DBF339ECFB260DF04F372EDD37CF0DF4934A907297BABAC053F",
  },
  {
    title: "Jabatan Tenaga Kerja Sabah - Soalan Lazim Akta A1753",
    url: "https://www.jtksabah.gov.my/web/images/warta_2025/SOALAN_LAZIM.pdf",
    section: "Commencement, coverage, maternity, sick, hospitalisation and paternity implementation guidance",
    retrievedAt: "2026-08-17T00:00:00.000Z",
    contentHash: "6DF898040DDD0867A67DED10083396C5AD4B9C628A1360E4BA8BF91669A52299",
  },
  {
    title: "Labour Ordinance (Sabah Cap. 67)",
    url: "https://sagc.sabah.gov.my/sites/default/files/law/LabourLawCap67.pdf",
    section: "Sections 83, 84 [deleted], 87, 104D and 104E read with Act A1753",
    retrievedAt: "2026-08-17T00:00:00.000Z",
    contentHash: "9A31CB6DE91A2858B86EAAF382A30A7B7BCFAD3DCBFA929CB61E0757F21A8150",
  },
] as const;

export const SABAH_STATUTORY_LEAVE_RULES = [
  {
    category: "ANNUAL_LEAVE",
    statutorySection: "Labour Ordinance (Sabah Cap. 67), section 104D",
    entitlementSemantics: "PERIOD_BALANCE",
    entitlementPeriodType: "SERVICE_ANNIVERSARY",
    prorationMethod: "COMPLETED_MONTHS",
    entitlementRounding: "STATUTORY_WHOLE_DAY",
    requiresDocument: false,
    carryForwardAllowed: true,
    tiers: [
      { minServiceMonths: 0, maxServiceMonths: 23, entitlementUnits: 8 },
      { minServiceMonths: 24, maxServiceMonths: 59, entitlementUnits: 12 },
      { minServiceMonths: 60, maxServiceMonths: null, entitlementUnits: 16 },
    ],
    eventRules: {
      periodBasis: "SERVICE_ANNIVERSARY",
      additionalRestAndPublicHolidayTreatment: "STATUTORY_RULE_APPLIES",
      terminationProrationBasis: "COMPLETED_MONTHS",
    },
    reviewMarkers: {
      unauthorisedAbsenceThreshold: 0.1,
      thresholdOutcome: "REVIEW_REQUIRED",
      overlapOutcome: "REVIEW_REQUIRED",
    },
  },
  {
    category: "SICK_LEAVE",
    statutorySection: "Labour Ordinance (Sabah Cap. 67), section 104E as amended by Act A1753",
    entitlementSemantics: "PERIOD_BALANCE",
    entitlementPeriodType: "CALENDAR_YEAR",
    prorationMethod: "NONE",
    entitlementRounding: "STATUTORY_WHOLE_DAY",
    requiresDocument: true,
    carryForwardAllowed: false,
    tiers: [
      { minServiceMonths: 0, maxServiceMonths: 23, entitlementUnits: 14 },
      { minServiceMonths: 24, maxServiceMonths: 59, entitlementUnits: 18 },
      { minServiceMonths: 60, maxServiceMonths: null, entitlementUnits: 22 },
    ],
    eventRules: { medicalCertificationRequired: true, separateFromHospitalisation: true },
    reviewMarkers: { lateNotificationOutcome: "REVIEW_REQUIRED", noAutomaticRejection: true },
  },
  {
    category: "HOSPITALISATION_LEAVE",
    statutorySection: "Labour Ordinance (Sabah Cap. 67), section 104E as amended by Act A1753",
    entitlementSemantics: "PERIOD_BALANCE",
    entitlementPeriodType: "CALENDAR_YEAR",
    prorationMethod: "NONE",
    entitlementRounding: "STATUTORY_WHOLE_DAY",
    requiresDocument: true,
    carryForwardAllowed: false,
    tiers: [{ minServiceMonths: 0, maxServiceMonths: null, entitlementUnits: 60 }],
    eventRules: { medicalCertificationRequired: true, separateBucket: true },
    reviewMarkers: { lateNotificationOutcome: "REVIEW_REQUIRED", noAutomaticRejection: true },
  },
  {
    category: "MATERNITY_LEAVE",
    statutorySection: "Labour Ordinance (Sabah Cap. 67), section 83 as amended by Act A1753 and section 87; section 84 deleted",
    entitlementSemantics: "EVENT_BASED",
    entitlementPeriodType: "CALENDAR_YEAR",
    prorationMethod: "NONE",
    entitlementRounding: "STATUTORY_WHOLE_DAY",
    requiresDocument: true,
    carryForwardAllowed: false,
    tiers: [],
    eventRules: {
      durationCalendarDays: 98,
      eligiblePeriodDefinitionSource: "ACT_A1753_SECTION_2",
      leaveEntitlementSource: "SECTION_83_1_2",
      leaveCommencementSource: "SECTION_83_3_4",
      allowanceEligibilitySource: "SECTION_83_5_6",
      noticeSource: "SECTION_87",
      leaveEligibilitySeparateFromAllowanceEligibility: true,
      allowanceEligibilityNotInferredFromPaidFlag: true,
      allowanceEmploymentLookbackMonths: 4,
      allowanceMinimumEmploymentDays: 90,
      allowanceMeasurementWindowMonths: 9,
      allowanceMaximumSurvivingChildren: 4,
      startWindowAndMedicalExceptionEvidenceRequired: true,
      monetaryAllowanceCalculation: "DEFERRED_TO_PAYROLL",
      earlyReturn: "DEFERRED",
    },
    reviewMarkers: {
      missingAllowanceEligibilityEvidence: "REVIEW_REQUIRED",
      lateNotificationOutcome: "REVIEW_REQUIRED",
    },
  },
  {
    category: "PATERNITY_LEAVE",
    statutorySection: "Labour Ordinance (Sabah Cap. 67), section 104EA inserted by Act A1753",
    entitlementSemantics: "EVENT_BASED",
    entitlementPeriodType: "CALENDAR_YEAR",
    prorationMethod: "NONE",
    entitlementRounding: "STATUTORY_WHOLE_DAY",
    requiresDocument: true,
    carryForwardAllowed: false,
    tiers: [],
    eventRules: {
      durationCalendarDays: 7,
      consecutive: true,
      includesRestAndPublicHolidays: true,
      marriedMaleEmployee: true,
      minimumImmediateServiceMonths: 12,
      maximumConfinements: 5,
      startsOnConfinementDate: true,
      minimumPregnancyWeeks: 22,
      birthOutcome: ["LIVE_BIRTH", "STILLBIRTH"],
      notice: "30_DAYS_OR_AS_SOON_AS_POSSIBLE",
    },
    reviewMarkers: { unknownEligibilityEvidence: "REVIEW_REQUIRED" },
  },
  {
    category: "UNPAID_LEAVE",
    statutorySection: "Company policy; not a statutory paid-leave entitlement",
    entitlementSemantics: "NON_ACCRUAL",
    entitlementPeriodType: "CALENDAR_YEAR",
    prorationMethod: "NONE",
    entitlementRounding: "NONE",
    requiresDocument: false,
    carryForwardAllowed: false,
    tiers: [],
    eventRules: { payTreatment: "UNPAID", balanceTracked: false },
    reviewMarkers: {},
  },
] as const;

export type SabahStatutoryLeaveCategory = typeof SABAH_STATUTORY_LEAVE_RULES[number]["category"];

export function sabahRulePackDigest() {
  return createHash("sha256").update(JSON.stringify({
    version: SABAH_LEAVE_RULE_PACK_VERSION,
    jurisdiction: SABAH_LEAVE_JURISDICTION,
    effectiveFrom: SABAH_LEAVE_EFFECTIVE_FROM,
    sources: SABAH_LEAVE_OFFICIAL_SOURCES,
    rules: SABAH_STATUTORY_LEAVE_RULES,
  })).digest("hex").toUpperCase();
}

export function validateSabahStatutoryRulePack() {
  const failures: string[] = [];
  const categories = new Set<string>();
  for (const rule of SABAH_STATUTORY_LEAVE_RULES) {
    const category: string = rule.category;
    const semantics: string = rule.entitlementSemantics;
    const carryForwardAllowed: boolean = rule.carryForwardAllowed;
    if (categories.has(category)) failures.push(`Duplicate category ${category}.`);
    categories.add(category);
    if (!rule.statutorySection.trim()) failures.push(`${category} has no statutory section.`);
    if (semantics === "EVENT_BASED" && carryForwardAllowed) failures.push(`${category} event leave cannot carry forward.`);
    if (semantics === "NON_ACCRUAL" && rule.tiers.length) failures.push(`${category} non-accrual leave cannot create a balance bucket.`);
    let expectedMin = 0;
    for (const tier of rule.tiers) {
      if (tier.minServiceMonths !== expectedMin) failures.push(`${category} service tiers contain a gap or overlap.`);
      expectedMin = tier.maxServiceMonths == null ? Number.POSITIVE_INFINITY : tier.maxServiceMonths + 1;
    }
    if (rule.tiers.length && expectedMin !== Number.POSITIVE_INFINITY) failures.push(`${category} final tier must be open-ended.`);
  }
  for (const source of SABAH_LEAVE_OFFICIAL_SOURCES) {
    if (!source.section.trim() || !/^https:\/\//.test(source.url)) failures.push(`Invalid official source ${source.title}.`);
    if (!/^[A-F0-9]{64}$/.test(source.contentHash)) failures.push(`Invalid source digest for ${source.title}.`);
  }
  const amendmentSource = SABAH_LEAVE_OFFICIAL_SOURCES.find((source) => source.title.includes("Act A1753"));
  if (!amendmentSource || /\b104D\b/.test(amendmentSource.section)) {
    failures.push("Act A1753 source mapping must not claim that the Act amended section 104D.");
  }
  const maternityRule = SABAH_STATUTORY_LEAVE_RULES.find((rule) => rule.category === "MATERNITY_LEAVE");
  if (!maternityRule || !/section 83/i.test(maternityRule.statutorySection) || !/section 87/i.test(maternityRule.statutorySection)) {
    failures.push("Maternity leave must map leave rules to section 83 and notice rules to section 87.");
  }
  if (!maternityRule || !/section 84 deleted/i.test(maternityRule.statutorySection) || /sections 83[-–]84/i.test(maternityRule.statutorySection)) {
    failures.push("Maternity leave source mapping must record that section 84 is deleted.");
  }
  return { valid: failures.length === 0, failures } as const;
}

export function statutoryWholeDayRound(value: number) {
  const whole = Math.floor(value);
  return whole + (value - whole >= 0.5 ? 1 : 0);
}

export function evaluatePaternityEligibility(input: {
  marriedMaleEmployee?: boolean;
  immediateServiceMonths?: number;
  priorConfinements?: number;
  pregnancyWeeks?: number;
  birthOutcome?: "LIVE_BIRTH" | "STILLBIRTH";
  noticeRecorded?: boolean;
}) {
  const requiredEvidence = [
    input.marriedMaleEmployee,
    input.immediateServiceMonths,
    input.priorConfinements,
    input.pregnancyWeeks,
    input.birthOutcome,
    input.noticeRecorded,
  ];
  if (requiredEvidence.some((value) => value === undefined)) return "REVIEW_REQUIRED" as const;
  if (!input.marriedMaleEmployee || input.immediateServiceMonths! < 12 || input.priorConfinements! >= 5 || input.pregnancyWeeks! < 22) return "NOT_ELIGIBLE" as const;
  return input.noticeRecorded ? "ELIGIBLE" as const : "REVIEW_REQUIRED" as const;
}

export function evaluateMaternityEvidence(input: {
  confinementDate?: string;
  serviceLookbackCaptured?: boolean;
  survivingChildrenCaptured?: boolean;
  noticeRecorded?: boolean;
  allowanceEvidenceCaptured?: boolean;
}) {
  const leaveEligibility = input.confinementDate ? "ELIGIBLE" : "REVIEW_REQUIRED";
  const allowanceEligibility = input.serviceLookbackCaptured && input.survivingChildrenCaptured && input.noticeRecorded && input.allowanceEvidenceCaptured
    ? "READY_FOR_REVIEW"
    : "REVIEW_REQUIRED";
  return { leaveEligibility, allowanceEligibility } as const;
}
