export const BUSINESS_TIME_ZONE = "Asia/Kuala_Lumpur";

type BusinessDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const businessDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function getBusinessDateTimeParts(value: Date | string = new Date()): BusinessDateTimeParts {
  const date = typeof value === "string" ? new Date(value) : value;

  if (Number.isNaN(date.getTime())) {
    throw new Error("Date or time is invalid.");
  }

  const values = new Map(
    businessDateTimeFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const parts = {
    year: values.get("year"),
    month: values.get("month"),
    day: values.get("day"),
    hour: values.get("hour"),
    minute: values.get("minute"),
    second: values.get("second"),
  };

  if (Object.values(parts).some((part) => part === undefined || Number.isNaN(part))) {
    throw new Error("Date or time is invalid.");
  }

  return parts as BusinessDateTimeParts;
}

export function toBusinessDateValue(value: Date | string) {
  const parts = getBusinessDateTimeParts(value);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function toBusinessTimeValue(value: Date | string) {
  const parts = getBusinessDateTimeParts(value);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function getBusinessTodayDateValue(now = new Date()) {
  return toBusinessDateValue(now);
}

export function parseBusinessDateTime(dateValue: string, timeValue: string) {
  const dateParts = parseDateValue(dateValue);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeValue);

  if (!dateParts || !timeMatch) {
    throw new Error("Appointment date or time is invalid.");
  }

  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) {
    throw new Error("Appointment date or time is invalid.");
  }

  const localEpoch = Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    hour,
    minute,
  );
  let result = new Date(localEpoch);

  // Convert the requested wall-clock time into its UTC instant. Recalculate
  // once so this remains correct if the configured zone ever has DST.
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const offset = getTimeZoneOffsetMilliseconds(result);
    result = new Date(localEpoch - offset);
  }

  if (
    toBusinessDateValue(result) !== dateValue ||
    toBusinessTimeValue(result) !== timeValue
  ) {
    throw new Error("Appointment date or time is invalid.");
  }

  return result;
}

export function isValidDateValue(value: string) {
  return parseDateValue(value) !== null;
}

export function addDaysToDateValue(dateValue: string, amount: number) {
  const date = dateValueToUtcDate(dateValue);
  date.setUTCDate(date.getUTCDate() + amount);
  return utcDateToDateValue(date);
}

export function addMonthsToDateValue(dateValue: string, amount: number) {
  const date = dateValueToUtcDate(dateValue);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return utcDateToDateValue(date);
}

export function startOfBusinessWeek(dateValue: string) {
  const date = dateValueToUtcDate(dateValue);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return utcDateToDateValue(date);
}

export function startOfBusinessMonth(dateValue: string) {
  return `${dateValue.slice(0, 7)}-01`;
}

export function formatDateValue(
  dateValue: string,
  options: Intl.DateTimeFormatOptions,
  locale = "en-MY",
) {
  return new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: "UTC",
  }).format(dateValueToUtcDate(dateValue));
}

export function dateValueToUtcDate(dateValue: string) {
  const parts = parseDateValue(dateValue);
  if (!parts) {
    throw new Error("Date is invalid.");
  }

  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

export function utcDateToDateValue(date: Date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function parseDateValue(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function getTimeZoneOffsetMilliseconds(date: Date) {
  const parts = getBusinessDateTimeParts(date);
  const zonedEpoch = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return zonedEpoch - Math.floor(date.getTime() / 1000) * 1000;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
