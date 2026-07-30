import {
  DEFAULT_BUSINESS_DAY_CUTOFF_TIME,
  DEFAULT_BUSINESS_TIME_ZONE,
  getBusinessDayRangeForBusiness,
  getCurrentBusinessDateValue,
  type BusinessTimeSettings,
} from "@/lib/business-day";

export const LEGACY_DAILY_CLOSING_CUTOFF_TIME = "00:00";

export function getDailyClosingRange(
  now = new Date(),
  requestedDate?: string,
  settings: BusinessTimeSettings = {
    timezone: DEFAULT_BUSINESS_TIME_ZONE,
    businessDayCutoffTime: DEFAULT_BUSINESS_DAY_CUTOFF_TIME,
  },
) {
  const dateValue =
    requestedDate ??
    getCurrentBusinessDateValue(
      now,
      settings.timezone,
      settings.businessDayCutoffTime,
    );
  const range = getBusinessDayRangeForBusiness(settings, {
    fromDateValue: dateValue,
    toDateValue: dateValue,
  });

  return {
    dateValue,
    fromDate: range.fromDate,
    timeZone: range.timezone,
    businessDayCutoffTime: range.businessDayCutoffTime,
    toDateExclusive: range.toDateExclusive,
  };
}
