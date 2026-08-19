export type OfficialHolidayCatalogEntry = {
  workDate: string;
  name: string;
  officialReference: string;
};

export type OfficialHolidayCatalog = {
  countryCode: "MY";
  stateCode: "SBH";
  year: number;
  jurisdictionLabel: string;
  sourceLabel: string;
  sourceUrl: string;
  entries: readonly OfficialHolidayCatalogEntry[];
};

const SABAH_PUBLIC_HOLIDAYS_URL = "https://sabah.gov.my/public-holidays";
const SABAH_ADDITIONAL_HOLIDAY_URL = "https://cm.sabah.gov.my/siaran-media/6439";

const sabah2026 = {
  countryCode: "MY",
  stateCode: "SBH",
  year: 2026,
  jurisdictionLabel: "Sabah",
  sourceLabel: "Sabah State Government",
  sourceUrl: SABAH_PUBLIC_HOLIDAYS_URL,
  entries: [
    { workDate: "2026-01-01", name: "New Year's Day", officialReference: SABAH_PUBLIC_HOLIDAYS_URL },
    { workDate: "2026-02-17", name: "Chinese New Year", officialReference: SABAH_PUBLIC_HOLIDAYS_URL },
    { workDate: "2026-02-18", name: "Chinese New Year (Day 2)", officialReference: SABAH_PUBLIC_HOLIDAYS_URL },
    { workDate: "2026-03-20", name: "Additional Hari Raya Aidilfitri Holiday", officialReference: SABAH_ADDITIONAL_HOLIDAY_URL },
    { workDate: "2026-03-21", name: "Hari Raya Aidilfitri", officialReference: SABAH_PUBLIC_HOLIDAYS_URL },
    { workDate: "2026-03-22", name: "Hari Raya Aidilfitri (Day 2)", officialReference: SABAH_PUBLIC_HOLIDAYS_URL },
    { workDate: "2026-03-30", name: "Sabah Governor's Birthday", officialReference: SABAH_PUBLIC_HOLIDAYS_URL },
    { workDate: "2026-04-03", name: "Good Friday", officialReference: SABAH_PUBLIC_HOLIDAYS_URL },
    { workDate: "2026-05-01", name: "Labour Day", officialReference: SABAH_PUBLIC_HOLIDAYS_URL },
    { workDate: "2026-05-27", name: "Hari Raya Haji", officialReference: SABAH_PUBLIC_HOLIDAYS_URL },
    { workDate: "2026-05-30", name: "Harvest Festival", officialReference: SABAH_PUBLIC_HOLIDAYS_URL },
    { workDate: "2026-05-31", name: "Harvest Festival (Day 2)", officialReference: SABAH_PUBLIC_HOLIDAYS_URL },
    { workDate: "2026-05-31", name: "Wesak Day", officialReference: SABAH_PUBLIC_HOLIDAYS_URL },
    { workDate: "2026-06-01", name: "King's Birthday", officialReference: SABAH_PUBLIC_HOLIDAYS_URL },
    { workDate: "2026-06-17", name: "Awal Muharam", officialReference: SABAH_PUBLIC_HOLIDAYS_URL },
    { workDate: "2026-08-25", name: "Prophet Muhammad's Birthday", officialReference: SABAH_PUBLIC_HOLIDAYS_URL },
    { workDate: "2026-08-31", name: "National Day", officialReference: SABAH_PUBLIC_HOLIDAYS_URL },
    { workDate: "2026-09-16", name: "Malaysia Day", officialReference: SABAH_PUBLIC_HOLIDAYS_URL },
    { workDate: "2026-11-08", name: "Deepavali", officialReference: SABAH_PUBLIC_HOLIDAYS_URL },
    { workDate: "2026-12-24", name: "Christmas Eve", officialReference: SABAH_PUBLIC_HOLIDAYS_URL },
    { workDate: "2026-12-25", name: "Christmas Day", officialReference: SABAH_PUBLIC_HOLIDAYS_URL },
  ],
} as const satisfies OfficialHolidayCatalog;

export function getOfficialHolidayCatalog(args: {
  countryCode: string;
  stateCode: string | null;
  year: number;
}): OfficialHolidayCatalog | null {
  if (args.countryCode === "MY" && args.stateCode === "SBH" && args.year === 2026) return sabah2026;
  return null;
}

export function officialHolidayKey(workDate: Date | string, name: string) {
  const date = typeof workDate === "string" ? workDate : workDate.toISOString().slice(0, 10);
  return `${date}:${name.trim().toLocaleLowerCase("en-MY").replace(/\s+/g, " ")}`;
}
