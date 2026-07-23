import {
  addDaysToDateValue,
  getBusinessTodayDateValue,
  parseBusinessDateTime,
} from "@/lib/business-time";

export const DAILY_CLOSING_TIME_ZONE = "Asia/Kuching";

export function getDailyClosingRange(now = new Date(), requestedDate?: string) {
  const dateValue = requestedDate ?? getBusinessTodayDateValue(now);
  const nextDateValue = addDaysToDateValue(dateValue, 1);

  return {
    dateValue,
    fromDate: parseBusinessDateTime(dateValue, "00:00"),
    timeZone: DAILY_CLOSING_TIME_ZONE,
    toDateExclusive: parseBusinessDateTime(nextDateValue, "00:00"),
  };
}
