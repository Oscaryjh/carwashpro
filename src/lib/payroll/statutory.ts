export const STATUTORY_RULE_SOURCES = {
  epf: {
    version: "KWSP_THIRD_SCHEDULE_2025_10",
    effectiveFrom: "2025-10-01",
    url: "https://www.kwsp.gov.my/en/epf-act-1991-third-schedule",
  },
  socso: {
    version: "PERKESO_ACT4_SKBBK_2026_06",
    effectiveFrom: "2026-06-01",
    url: "https://www.perkeso.gov.my/en/rate-of-contribution.html",
  },
  eis: {
    version: "PERKESO_ACT800_2024_10",
    effectiveFrom: "2024-10-01",
    url: "https://www.perkeso.gov.my/en/rate-of-contribution.html",
  },
} as const;

type StatutoryNationality =
  | "MALAYSIAN"
  | "PERMANENT_RESIDENT"
  | "NON_MALAYSIAN";
type SocsoCategory = "FIRST" | "SECOND";

export type EmployeeStatutoryProfile = {
  dateOfBirth: Date | null;
  statutoryNationality: StatutoryNationality | null;
  epfEnabled: boolean;
  epfMemberBeforeAug1998: boolean;
  socsoEnabled: boolean;
  socsoCategory: SocsoCategory | null;
  eisEnabled: boolean;
  eisPreviouslyContributed: boolean;
  lindung24OptIn: boolean;
};

export type StatutoryContributionResult = {
  status: "NOT_CONFIGURED" | "AUTO_CALCULATED" | "REVIEW_REQUIRED";
  ruleVersion: string | null;
  warnings: string[];
  epfEmployeeCents: number;
  employerEpfCents: number;
  socsoEmployeeCents: number;
  employerSocsoCents: number;
  eisEmployeeCents: number;
  employerEisCents: number;
  lindung24EmployeeCents: number;
};

type PerkesoBand = readonly [
  employerFirstCents: number,
  employeeFirstCents: number,
  lindung24EmployeeCents: number,
  employerSecondCents: number,
];

const PERKESO_WAGE_MAX_CENTS = [
  3_000, 5_000, 7_000, 10_000, 14_000, 20_000,
  ...Array.from({ length: 58 }, (_, index) => (300 + index * 100) * 100),
  Number.POSITIVE_INFINITY,
] as const;

// Explicit Act 4 schedule amounts in sen. Columns are First Category employer,
// First Category employee, LINDUNG 24 Jam employee and Second Category employer.
const SOCSO_BANDS: readonly PerkesoBand[] = [
  [40, 10, 20, 30], [70, 20, 30, 50], [110, 30, 50, 80],
  [150, 40, 65, 110], [210, 60, 90, 150], [295, 85, 125, 210],
  [435, 125, 185, 310], [615, 175, 265, 440], [785, 225, 335, 560],
  [965, 275, 415, 690], [1135, 325, 485, 810], [1315, 375, 565, 940],
  [1485, 425, 635, 1060], [1665, 475, 715, 1190], [1835, 525, 785, 1310],
  [2015, 575, 865, 1440], [2185, 625, 935, 1560], [2365, 675, 1015, 1690],
  [2535, 725, 1085, 1810], [2715, 775, 1165, 1940], [2885, 825, 1235, 2060],
  [3065, 875, 1315, 2190], [3235, 925, 1385, 2310], [3415, 975, 1465, 2440],
  [3585, 1025, 1535, 2560], [3765, 1075, 1615, 2690], [3935, 1125, 1685, 2810],
  [4115, 1175, 1765, 2940], [4285, 1225, 1835, 3060], [4465, 1275, 1915, 3190],
  [4635, 1325, 1985, 3310], [4815, 1375, 2065, 3440], [4985, 1425, 2135, 3560],
  [5165, 1475, 2215, 3690], [5335, 1525, 2285, 3810], [5515, 1575, 2365, 3940],
  [5685, 1625, 2435, 4060], [5865, 1675, 2515, 4190], [6035, 1725, 2585, 4310],
  [6215, 1775, 2665, 4440], [6385, 1825, 2735, 4560], [6565, 1875, 2815, 4690],
  [6735, 1925, 2885, 4810], [6915, 1975, 2965, 4940], [7085, 2025, 3035, 5060],
  [7265, 2075, 3115, 5190], [7435, 2125, 3185, 5310], [7615, 2175, 3265, 5440],
  [7785, 2225, 3335, 5560], [7965, 2275, 3415, 5690], [8135, 2325, 3485, 5810],
  [8315, 2375, 3565, 5940], [8485, 2425, 3635, 6060], [8665, 2475, 3715, 6190],
  [8835, 2525, 3785, 6310], [9015, 2575, 3865, 6440], [9185, 2625, 3935, 6560],
  [9365, 2675, 4015, 6690], [9535, 2725, 4085, 6810], [9715, 2775, 4165, 6940],
  [9885, 2825, 4235, 7060], [10065, 2875, 4315, 7190], [10235, 2925, 4385, 7310],
  [10415, 2975, 4465, 7440], [10415, 2975, 4465, 7440],
];

const EIS_EMPLOYEE_OR_EMPLOYER_CENTS = [
  5, 10, 15, 20, 25, 35, 50, 70, 90,
  ...Array.from({ length: 55 }, (_, index) => 110 + index * 20),
  1190,
] as const;

export function calculateStatutoryContributions(input: {
  profile: EmployeeStatutoryProfile;
  payrollPeriodEnd: Date;
  epfWageCents: number;
  perkesoWageCents: number;
}): StatutoryContributionResult {
  const empty = emptyResult();
  const profile = input.profile;
  if (!profile.epfEnabled && !profile.socsoEnabled && !profile.eisEnabled) {
    return empty;
  }

  const warnings: string[] = [];
  if (!profile.dateOfBirth) warnings.push("Date of birth is required.");
  if (!profile.statutoryNationality) warnings.push("Statutory nationality is required.");
  if (profile.socsoEnabled && !profile.socsoCategory) {
    warnings.push("SOCSO contribution category is required.");
  }
  if (warnings.length || !profile.dateOfBirth || !profile.statutoryNationality) {
    return { ...empty, status: "REVIEW_REQUIRED", warnings };
  }

  const age = ageAtPeriodEnd(profile.dateOfBirth, input.payrollPeriodEnd);
  const versions: string[] = [];
  let epfEmployeeCents = 0;
  let employerEpfCents = 0;
  let socsoEmployeeCents = 0;
  let employerSocsoCents = 0;
  let eisEmployeeCents = 0;
  let employerEisCents = 0;
  let lindung24EmployeeCents = 0;

  if (profile.epfEnabled && age < 75) {
    const epf = lookupEpfSchedule({
      age,
      nationality: profile.statutoryNationality,
      memberBeforeAug1998: profile.epfMemberBeforeAug1998,
      wageCents: input.epfWageCents,
    });
    epfEmployeeCents = epf.employeeCents;
    employerEpfCents = epf.employerCents;
    versions.push(STATUTORY_RULE_SOURCES.epf.version);
  }

  if (profile.socsoEnabled && profile.socsoCategory) {
    const band = lookupPerkesoBand(input.perkesoWageCents);
    if (band) {
      employerSocsoCents =
        profile.socsoCategory === "FIRST" ? band[0] : band[3];
      socsoEmployeeCents =
        profile.socsoCategory === "FIRST" ? band[1] : 0;
      const lindungRequired = profile.statutoryNationality === "NON_MALAYSIAN";
      lindung24EmployeeCents =
        lindungRequired || profile.lindung24OptIn ? band[2] : 0;
    }
    versions.push(STATUTORY_RULE_SOURCES.socso.version);
  }

  const eisAgeEligible =
    age >= 18 && age < 60 && (age < 57 || profile.eisPreviouslyContributed);
  const eisNationalityEligible =
    profile.statutoryNationality !== "NON_MALAYSIAN";
  if (profile.eisEnabled && eisAgeEligible && eisNationalityEligible) {
    const bandIndex = findPerkesoBandIndex(input.perkesoWageCents);
    if (bandIndex !== null) {
      eisEmployeeCents = EIS_EMPLOYEE_OR_EMPLOYER_CENTS[bandIndex] ?? 0;
      employerEisCents = eisEmployeeCents;
    }
    versions.push(STATUTORY_RULE_SOURCES.eis.version);
  }

  return {
    status: "AUTO_CALCULATED",
    ruleVersion: versions.join(",") || null,
    warnings,
    epfEmployeeCents,
    employerEpfCents,
    socsoEmployeeCents,
    employerSocsoCents,
    eisEmployeeCents,
    employerEisCents,
    lindung24EmployeeCents,
  };
}

export function lookupEpfSchedule(input: {
  age: number;
  nationality: StatutoryNationality;
  memberBeforeAug1998: boolean;
  wageCents: number;
}) {
  if (input.wageCents <= 1_000 || input.age >= 75) {
    return { employerCents: 0, employeeCents: 0 };
  }

  if (
    input.nationality === "NON_MALAYSIAN" &&
    !input.memberBeforeAug1998
  ) {
    return {
      employerCents: ceilBasisPointsToRinggit(input.wageCents, 200),
      employeeCents: ceilBasisPointsToRinggit(input.wageCents, 200),
    };
  }

  const scheduledWageCents = epfScheduledWageCents(input.wageCents);
  if (input.age >= 60 && input.nationality === "MALAYSIAN") {
    return {
      employerCents: ceilBasisPointsToRinggit(scheduledWageCents, 400),
      employeeCents: 0,
    };
  }

  if (input.age >= 60) {
    return {
      employerCents: ceilBasisPointsToRinggit(
        scheduledWageCents,
        input.wageCents <= 500_000 ? 650 : 600,
      ),
      employeeCents: ceilBasisPointsToRinggit(scheduledWageCents, 550),
    };
  }

  return {
    employerCents: ceilBasisPointsToRinggit(
      scheduledWageCents,
      input.wageCents <= 500_000 ? 1300 : 1200,
    ),
    employeeCents: ceilBasisPointsToRinggit(scheduledWageCents, 1100),
  };
}

function emptyResult(): StatutoryContributionResult {
  return {
    status: "NOT_CONFIGURED",
    ruleVersion: null,
    warnings: [],
    epfEmployeeCents: 0,
    employerEpfCents: 0,
    socsoEmployeeCents: 0,
    employerSocsoCents: 0,
    eisEmployeeCents: 0,
    employerEisCents: 0,
    lindung24EmployeeCents: 0,
  };
}

function epfScheduledWageCents(actualWageCents: number) {
  if (actualWageCents > 2_000_000) return actualWageCents;
  const bandSizeCents = actualWageCents <= 500_000 ? 2_000 : 10_000;
  return Math.ceil(actualWageCents / bandSizeCents) * bandSizeCents;
}

function ceilBasisPointsToRinggit(wageCents: number, basisPoints: number) {
  return Math.ceil((wageCents * basisPoints) / 1_000_000) * 100;
}

function lookupPerkesoBand(wageCents: number) {
  const index = findPerkesoBandIndex(wageCents);
  return index === null ? null : SOCSO_BANDS[index] ?? null;
}

function findPerkesoBandIndex(wageCents: number) {
  if (wageCents <= 0) return null;
  const index = PERKESO_WAGE_MAX_CENTS.findIndex(
    (maximum) => wageCents <= maximum,
  );
  return index < 0 ? PERKESO_WAGE_MAX_CENTS.length - 1 : index;
}

function ageAtPeriodEnd(dateOfBirth: Date, periodEndExclusive: Date) {
  const at = new Date(periodEndExclusive.getTime() - 1);
  let age = at.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday =
    at.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (at.getUTCMonth() === dateOfBirth.getUTCMonth() &&
      at.getUTCDate() < dateOfBirth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}
