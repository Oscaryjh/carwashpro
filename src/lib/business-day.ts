import {
  addDaysToDateValue,
  dateValueToUtcDate,
  isValidDateValue,
} from "@/lib/business-time";

export const DEFAULT_BUSINESS_TIME_ZONE = "Asia/Kuching";
export const DEFAULT_BUSINESS_DAY_CUTOFF_TIME = "02:00";
export const MAX_BUSINESS_DAY_RANGE_DAYS = 31;

export type BusinessTimeSettings = {
  timezone: string;
  businessDayCutoffTime: string;
};

export type BusinessDayRange = {
  fromDateValue: string;
  toDateValue: string;
  fromDate: Date;
  toDateExclusive: Date;
  dayCount: number;
  timezone: string;
  businessDayCutoffTime: string;
};

export type BusinessDayRangeWithPrevious = {
  current: BusinessDayRange;
  previous: BusinessDayRange;
};

export function isValidIanaTimeZone(timezone: string) {
  if (!timezone.trim()) return false;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export function isValidBusinessDayCutoffTime(value: string) {
  return /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
}

export function getBusinessDayRange(
  input: {
    fromDateValue: string;
    toDateValue: string;
  } & BusinessTimeSettings,
): BusinessDayRange {
  validateSettings(input);

  if (
    !isValidDateValue(input.fromDateValue) ||
    !isValidDateValue(input.toDateValue)
  ) {
    throw new Error("Business date range is invalid.");
  }

  const fromDateOnly = dateValueToUtcDate(input.fromDateValue);
  const toDateOnly = dateValueToUtcDate(input.toDateValue);
  const dayCount =
    Math.round(
      (toDateOnly.getTime() - fromDateOnly.getTime()) / 86_400_000,
    ) + 1;

  if (dayCount < 1) {
    throw new Error("Business date range must start on or before its end.");
  }
  if (dayCount > MAX_BUSINESS_DAY_RANGE_DAYS) {
    throw new Error(
      `Business date range cannot exceed ${MAX_BUSINESS_DAY_RANGE_DAYS} days.`,
    );
  }

  return {
    fromDateValue: input.fromDateValue,
    toDateValue: input.toDateValue,
    fromDate: businessWallClockToUtc(
      input.fromDateValue,
      input.businessDayCutoffTime,
      input.timezone,
    ),
    toDateExclusive: businessWallClockToUtc(
      addDaysToDateValue(input.toDateValue, 1),
      input.businessDayCutoffTime,
      input.timezone,
    ),
    dayCount,
    timezone: input.timezone,
    businessDayCutoffTime: input.businessDayCutoffTime,
  };
}

export function getBusinessDayRangeWithPrevious(
  input: {
    fromDateValue: string;
    toDateValue: string;
  } & BusinessTimeSettings,
): BusinessDayRangeWithPrevious {
  const current = getBusinessDayRange(input);
  const previousToDateValue = addDaysToDateValue(
    current.fromDateValue,
    -1,
  );
  const previousFromDateValue = addDaysToDateValue(
    current.fromDateValue,
    -current.dayCount,
  );

  return {
    current,
    previous: getBusinessDayRange({
      fromDateValue: previousFromDateValue,
      toDateValue: previousToDateValue,
      timezone: current.timezone,
      businessDayCutoffTime: current.businessDayCutoffTime,
    }),
  };
}

export function getBusinessDayRangeForBusiness(
  business: BusinessTimeSettings,
  input: {
    fromDateValue: string;
    toDateValue: string;
  },
) {
  return getBusinessDayRange({
    ...input,
    timezone: business.timezone,
    businessDayCutoffTime: business.businessDayCutoffTime,
  });
}

export function getCurrentBusinessDateValue(
  now: Date,
  timezone: string,
  businessDayCutoffTime: string,
) {
  validateSettings({ timezone, businessDayCutoffTime });

  const parts = new Map(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const dateValue = `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`;
  const timeValue = `${parts.get("hour")}:${parts.get("minute")}`;

  return timeValue < businessDayCutoffTime
    ? addDaysToDateValue(dateValue, -1)
    : dateValue;
}

export function businessWallClockToUtc(
  dateValue: string,
  timeValue: string,
  timezone: string,
) {
  if (!isValidDateValue(dateValue) || !isValidBusinessDayCutoffTime(timeValue)) {
    throw new Error("Business date or cutoff time is invalid.");
  }
  if (!isValidIanaTimeZone(timezone)) {
    throw new Error("Business timezone is invalid.");
  }

  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  const requestedWallEpoch = Date.UTC(year, month - 1, day, hour, minute);
  const offsetSamples = [
    requestedWallEpoch - 36 * 60 * 60 * 1000,
    requestedWallEpoch,
    requestedWallEpoch + 36 * 60 * 60 * 1000,
  ];
  const offsets = new Set(
    offsetSamples.map((sample) =>
      getTimeZoneOffsetMilliseconds(new Date(sample), timezone),
    ),
  );
  const candidates = [...offsets]
    .map((offset) => new Date(requestedWallEpoch - offset))
    .sort((left, right) => left.getTime() - right.getTime());
  const exact = candidates.find(
    (candidate) =>
      wallClockEpoch(candidate, timezone) === requestedWallEpoch,
  );

  if (exact) {
    // During a repeated DST hour, use the earlier valid instant.
    return exact;
  }

  // During a skipped DST hour, use Temporal-compatible forward
  // disambiguation: preserve minutes and move forward by the gap.
  const shiftedForward = candidates
    .map((candidate) => ({
      candidate,
      difference:
        wallClockEpoch(candidate, timezone) - requestedWallEpoch,
    }))
    .filter(({ difference }) => difference > 0)
    .sort(
      (left, right) =>
        left.difference - right.difference ||
        left.candidate.getTime() - right.candidate.getTime(),
    )[0];

  if (!shiftedForward) {
    throw new Error("Business date or cutoff time cannot be resolved.");
  }

  return shiftedForward.candidate;
}

function validateSettings(settings: BusinessTimeSettings) {
  if (!isValidIanaTimeZone(settings.timezone)) {
    throw new Error("Business timezone is invalid.");
  }
  if (!isValidBusinessDayCutoffTime(settings.businessDayCutoffTime)) {
    throw new Error("Business day cutoff time must use HH:mm.");
  }
}

function getTimeZoneOffsetMilliseconds(date: Date, timezone: string) {
  return (
    wallClockEpoch(date, timezone) -
    Math.floor(date.getTime() / 1000) * 1000
  );
}

function wallClockEpoch(date: Date, timezone: string) {
  const parts = new Map(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return Date.UTC(
    parts.get("year")!,
    parts.get("month")! - 1,
    parts.get("day")!,
    parts.get("hour")!,
    parts.get("minute")!,
    parts.get("second")!,
  );
}
