import { businessWallClockToUtc } from "@/lib/business-day";

/** Branch has no operating-timezone field: explicitly inherit Business, never attendance settings. */
export function performanceTimezone(businessTimezone: string) {
  if (!businessTimezone || /^[+-]/.test(businessTimezone)) throw new Error("Invalid operating IANA timezone.");
  return new Intl.DateTimeFormat("en", { timeZone: businessTimezone }).resolvedOptions().timeZone;
}

export function localPerformanceDate(at: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const part = (name: string) => parts.find((value) => value.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function performancePeriod(year: number, timezone: string, month?: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2200 || (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12))) throw new Error("Invalid performance period.");
  const start = `${year}-${String(month ?? 1).padStart(2, "0")}-01`;
  const end = month && month < 12 ? `${year}-${String(month + 1).padStart(2, "0")}-01` : `${year + 1}-01-01`;
  return {
    from: businessWallClockToUtc(start, "00:00", timezone),
    toExclusive: businessWallClockToUtc(end, "00:00", timezone),
    timezone,
  };
}
