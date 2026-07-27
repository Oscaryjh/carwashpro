import assert from "node:assert/strict";
import test from "node:test";
import {
  businessWallClockToUtc,
  getBusinessDayRange,
  getBusinessDayRangeForBusiness,
  getBusinessDayRangeWithPrevious,
  isValidBusinessDayCutoffTime,
  isValidIanaTimeZone,
} from "../../src/lib/business-day";

test("builds the requested Asia/Kuching seven-day UTC range", () => {
  const range = getBusinessDayRange({
    fromDateValue: "2026-07-01",
    toDateValue: "2026-07-07",
    timezone: "Asia/Kuching",
    businessDayCutoffTime: "02:00",
  });

  assert.equal(range.dayCount, 7);
  assert.equal(range.fromDate.toISOString(), "2026-06-30T18:00:00.000Z");
  assert.equal(
    range.toDateExclusive.toISOString(),
    "2026-07-07T18:00:00.000Z",
  );
});

test("builds the requested Asia/Tokyo seven-day UTC range", () => {
  const range = getBusinessDayRangeForBusiness(
    {
      timezone: "Asia/Tokyo",
      businessDayCutoffTime: "04:00",
    },
    {
      fromDateValue: "2026-07-01",
      toDateValue: "2026-07-07",
    },
  );

  assert.equal(range.fromDate.toISOString(), "2026-06-30T19:00:00.000Z");
  assert.equal(
    range.toDateExclusive.toISOString(),
    "2026-07-07T19:00:00.000Z",
  );
});

test("supports UTC and both cutoff boundaries", () => {
  const midnight = getBusinessDayRange({
    fromDateValue: "2026-01-01",
    toDateValue: "2026-01-01",
    timezone: "UTC",
    businessDayCutoffTime: "00:00",
  });
  const late = getBusinessDayRange({
    fromDateValue: "2026-01-01",
    toDateValue: "2026-01-01",
    timezone: "UTC",
    businessDayCutoffTime: "23:59",
  });

  assert.equal(midnight.fromDate.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(late.fromDate.toISOString(), "2026-01-01T23:59:00.000Z");
  assert.equal(late.toDateExclusive.toISOString(), "2026-01-02T23:59:00.000Z");
});

test("handles month, year, and leap-day boundaries", () => {
  const crossMonth = getBusinessDayRange({
    fromDateValue: "2026-01-31",
    toDateValue: "2026-02-01",
    timezone: "UTC",
    businessDayCutoffTime: "00:00",
  });
  const crossYear = getBusinessDayRange({
    fromDateValue: "2025-12-31",
    toDateValue: "2026-01-01",
    timezone: "UTC",
    businessDayCutoffTime: "00:00",
  });
  const leapDay = getBusinessDayRange({
    fromDateValue: "2024-02-28",
    toDateValue: "2024-03-01",
    timezone: "UTC",
    businessDayCutoffTime: "00:00",
  });

  assert.equal(crossMonth.dayCount, 2);
  assert.equal(crossYear.dayCount, 2);
  assert.equal(leapDay.dayCount, 3);
});

test("uses compatible DST-forward and earlier DST-backward disambiguation", () => {
  assert.equal(
    businessWallClockToUtc(
      "2026-03-08",
      "02:30",
      "America/New_York",
    ).toISOString(),
    "2026-03-08T07:30:00.000Z",
  );
  assert.equal(
    businessWallClockToUtc(
      "2026-11-01",
      "01:30",
      "America/New_York",
    ).toISOString(),
    "2026-11-01T05:30:00.000Z",
  );
});

test("accepts 31 days and safely rejects larger or reversed ranges", () => {
  assert.equal(
    getBusinessDayRange({
      fromDateValue: "2026-01-01",
      toDateValue: "2026-01-31",
      timezone: "UTC",
      businessDayCutoffTime: "00:00",
    }).dayCount,
    31,
  );
  assert.throws(
    () =>
      getBusinessDayRange({
        fromDateValue: "2026-01-01",
        toDateValue: "2026-02-01",
        timezone: "UTC",
        businessDayCutoffTime: "00:00",
      }),
    /cannot exceed 31 days/,
  );
  assert.throws(
    () =>
      getBusinessDayRange({
        fromDateValue: "2026-02-01",
        toDateValue: "2026-01-31",
        timezone: "UTC",
        businessDayCutoffTime: "00:00",
      }),
    /start on or before/,
  );
});

test("builds the adjacent previous period with the same day count", () => {
  const ranges = getBusinessDayRangeWithPrevious({
    fromDateValue: "2026-07-01",
    toDateValue: "2026-07-07",
    timezone: "Asia/Kuching",
    businessDayCutoffTime: "02:00",
  });

  assert.equal(ranges.previous.fromDateValue, "2026-06-24");
  assert.equal(ranges.previous.toDateValue, "2026-06-30");
  assert.equal(ranges.previous.dayCount, 7);
  assert.equal(
    ranges.previous.toDateExclusive.toISOString(),
    ranges.current.fromDate.toISOString(),
  );
});

test("rejects invalid timezone and HH:mm values", () => {
  assert.equal(isValidIanaTimeZone("Asia/Kuching"), true);
  assert.equal(isValidIanaTimeZone("Not/A_Timezone"), false);
  assert.equal(isValidBusinessDayCutoffTime("00:00"), true);
  assert.equal(isValidBusinessDayCutoffTime("23:59"), true);
  assert.equal(isValidBusinessDayCutoffTime("24:00"), false);

  assert.throws(
    () =>
      getBusinessDayRange({
        fromDateValue: "2026-01-01",
        toDateValue: "2026-01-01",
        timezone: "Not/A_Timezone",
        businessDayCutoffTime: "02:00",
      }),
    /timezone is invalid/,
  );
  assert.throws(
    () =>
      getBusinessDayRange({
        fromDateValue: "2026-01-01",
        toDateValue: "2026-01-01",
        timezone: "UTC",
        businessDayCutoffTime: "2:00",
      }),
    /must use HH:mm/,
  );
});
