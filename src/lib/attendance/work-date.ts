import { AttendanceApiError } from "@/lib/attendance/api-error";
import { isValidIanaTimeZone } from "@/lib/business-day";

export type BranchLocalDateParts = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}>;

function getPart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): number {
  const value = Number(parts.find((part) => part.type === type)?.value);
  if (!Number.isInteger(value)) {
    throw new AttendanceApiError(
      "INTERNAL_ERROR",
      "Unable to resolve the branch local time.",
    );
  }
  return value;
}

export function getBranchLocalDateParts(
  instant: Date,
  timeZone: string,
): BranchLocalDateParts {
  if (!Number.isFinite(instant.getTime()) || !isValidIanaTimeZone(timeZone)) {
    throw new AttendanceApiError(
      "INTERNAL_ERROR",
      "Branch timezone configuration is invalid.",
    );
  }

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);

  return {
    year: getPart(parts, "year"),
    month: getPart(parts, "month"),
    day: getPart(parts, "day"),
    hour: getPart(parts, "hour"),
    minute: getPart(parts, "minute"),
    second: getPart(parts, "second"),
  };
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function getBranchLocalDateKey(
  instant: Date,
  timeZone: string,
): string {
  const parts = getBranchLocalDateParts(instant, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function getAttendanceWorkDate(
  clockInAt: Date,
  timeZone: string,
): Date {
  const parts = getBranchLocalDateParts(clockInAt, timeZone);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

export function formatBranchLocalDateTime(
  instant: Date,
  timeZone: string,
): string {
  const parts = getBranchLocalDateParts(instant, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(
    parts.hour,
  )}:${pad(parts.minute)}:${pad(parts.second)}`;
}

export function parseBranchLocalDateTime(
  value: string,
  timeZone: string,
): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match || !isValidIanaTimeZone(timeZone)) {
    throw new AttendanceApiError(
      "VALIDATION_ERROR",
      "Enter a valid branch-local date and time.",
    );
  }

  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const localEpoch = Date.UTC(year, month - 1, day, hour, minute);
  let result = new Date(localEpoch);
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = getBranchLocalDateParts(result, timeZone);
    const zonedEpoch = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const offset = zonedEpoch - Math.floor(result.getTime() / 1000) * 1000;
    result = new Date(localEpoch - offset);
  }

  if (formatBranchLocalDateTime(result, timeZone).slice(0, 16) !== value) {
    throw new AttendanceApiError(
      "VALIDATION_ERROR",
      "The branch-local date and time does not exist.",
    );
  }
  return result;
}
