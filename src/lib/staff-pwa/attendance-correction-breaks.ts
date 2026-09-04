export const STANDARD_ATTENDANCE_CORRECTION_BREAK_LIMIT_MINUTES = 180;
export const ABSOLUTE_ATTENDANCE_CORRECTION_BREAK_LIMIT_MINUTES = 480;

export type AttendanceCorrectionBreakRecord = Readonly<{
  status: "NONE" | "COMPLETE" | "INCOMPLETE";
  recordedMinutes: number;
  periods: ReadonlyArray<Readonly<{
    startAt: string | null;
    endAt: string | null;
  }>>;
}>;

export function summarizeAttendanceCorrectionBreakPunches(
  punches: ReadonlyArray<Readonly<{
    type: string;
    serverTimestamp: Date | string;
  }>>,
): AttendanceCorrectionBreakRecord {
  const ordered = punches
    .map((punch) => ({
      type: punch.type,
      serverTimestamp: new Date(punch.serverTimestamp),
    }))
    .filter((punch) => Number.isFinite(punch.serverTimestamp.getTime()))
    .sort((left, right) =>
      left.serverTimestamp.getTime() - right.serverTimestamp.getTime(),
    );
  if (!ordered.length) {
    return { status: "NONE", recordedMinutes: 0, periods: [] };
  }

  const periods: Array<{ startAt: string | null; endAt: string | null }> = [];
  let openStart: Date | null = null;
  let recordedMilliseconds = 0;
  let incomplete = false;

  for (const punch of ordered) {
    if (punch.type !== "BREAK_START" && punch.type !== "BREAK_END") continue;
    if (punch.type === "BREAK_START") {
      if (openStart) {
        periods.push({ startAt: openStart.toISOString(), endAt: null });
        incomplete = true;
      }
      openStart = punch.serverTimestamp;
      continue;
    }

    if (!openStart) {
      periods.push({ startAt: null, endAt: punch.serverTimestamp.toISOString() });
      incomplete = true;
      continue;
    }
    periods.push({
      startAt: openStart.toISOString(),
      endAt: punch.serverTimestamp.toISOString(),
    });
    recordedMilliseconds += punch.serverTimestamp.getTime() - openStart.getTime();
    openStart = null;
  }

  if (openStart) {
    periods.push({ startAt: openStart.toISOString(), endAt: null });
    incomplete = true;
  }

  return {
    status: incomplete ? "INCOMPLETE" : "COMPLETE",
    recordedMinutes: Math.max(0, Math.floor(recordedMilliseconds / 60_000)),
    periods,
  };
}

export function getAttendanceCorrectionBreakLimit(input: {
  elapsedMinutes: number | null;
  recommendedBreakMinutes: number | null | undefined;
}) {
  const recommended = normalizeRecommendedBreakMinutes(
    input.recommendedBreakMinutes,
  );
  const policyLimit = Math.min(
    ABSOLUTE_ATTENDANCE_CORRECTION_BREAK_LIMIT_MINUTES,
    Math.max(STANDARD_ATTENDANCE_CORRECTION_BREAK_LIMIT_MINUTES, recommended),
  );
  if (input.elapsedMinutes === null || !Number.isFinite(input.elapsedMinutes)) {
    return policyLimit;
  }
  return Math.max(0, Math.min(Math.floor(input.elapsedMinutes), policyLimit));
}

export function getLocalCorrectionElapsedMinutes(
  clockInLocal: string,
  clockOutLocal: string,
) {
  const clockIn = localDateTimeValue(clockInLocal);
  const clockOut = localDateTimeValue(clockOutLocal);
  if (clockIn === null || clockOut === null || clockOut <= clockIn) return null;
  return Math.floor((clockOut - clockIn) / 60_000);
}

function normalizeRecommendedBreakMinutes(value: number | null | undefined) {
  if (!Number.isFinite(value) || value === null || value === undefined) return 60;
  return Math.max(
    0,
    Math.min(
      Math.floor(value),
      ABSOLUTE_ATTENDANCE_CORRECTION_BREAK_LIMIT_MINUTES,
    ),
  );
}

function localDateTimeValue(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  return Number.isFinite(timestamp) ? timestamp : null;
}
