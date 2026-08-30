import type {
  AttendancePunchType,
  EmployeeAttendanceStatus,
} from "@prisma/client";
import { AttendanceApiError } from "@/lib/attendance/api-error";

export type ActiveAttendanceStatus =
  | Extract<EmployeeAttendanceStatus, "OPEN" | "ON_BREAK">
  | null;

const ALLOWED_ACTIONS: Record<
  "NONE" | Extract<EmployeeAttendanceStatus, "OPEN" | "ON_BREAK">,
  readonly AttendancePunchType[]
> = {
  NONE: ["CLOCK_IN"],
  OPEN: ["BREAK_START", "CLOCK_OUT"],
  ON_BREAK: ["BREAK_END"],
};

export function getAllowedAttendanceActions(
  status: ActiveAttendanceStatus,
): readonly AttendancePunchType[] {
  return ALLOWED_ACTIONS[status ?? "NONE"];
}

export function getNextAttendanceStatus(
  currentStatus: ActiveAttendanceStatus,
  action: AttendancePunchType,
): EmployeeAttendanceStatus {
  if (!getAllowedAttendanceActions(currentStatus).includes(action)) {
    throw new AttendanceApiError(
      "INVALID_ATTENDANCE_STATE",
      invalidStateMessage(currentStatus, action),
    );
  }

  switch (action) {
    case "CLOCK_IN":
    case "BREAK_END":
      return "OPEN";
    case "BREAK_START":
      return "ON_BREAK";
    case "CLOCK_OUT":
      return "COMPLETED";
  }
}

function invalidStateMessage(
  currentStatus: ActiveAttendanceStatus,
  action: AttendancePunchType,
) {
  if (action === "CLOCK_OUT" && currentStatus === "ON_BREAK") {
    return "End the current break before clocking out.";
  }
  return `Attendance action ${action} is not allowed while status is ${
    currentStatus ?? "NONE"
  }.`;
}

export type BreakPunch = Readonly<{
  type: Extract<AttendancePunchType, "BREAK_START" | "BREAK_END">;
  serverTimestamp: Date;
}>;

export type AttendanceDurationResult = Readonly<{
  totalBreakMilliseconds: number;
  totalBreakMinutes: number;
  totalWorkedMilliseconds: number;
  totalWorkedMinutes: number;
  openBreakStartedAt: Date | null;
}>;

export function calculateAttendanceDurations(input: {
  clockInAt: Date;
  endAt: Date;
  breakPunches: readonly BreakPunch[];
  includeOpenBreakUntilEnd?: boolean;
}): AttendanceDurationResult {
  const clockInMilliseconds = input.clockInAt.getTime();
  const endMilliseconds = input.endAt.getTime();
  if (
    !Number.isFinite(clockInMilliseconds) ||
    !Number.isFinite(endMilliseconds) ||
    endMilliseconds < clockInMilliseconds
  ) {
    throw new AttendanceApiError(
      "INVALID_ATTENDANCE_STATE",
      "Attendance timestamps are invalid.",
    );
  }

  const orderedPunches = [...input.breakPunches].sort(
    (left, right) =>
      left.serverTimestamp.getTime() - right.serverTimestamp.getTime(),
  );
  let breakStartedAt: Date | null = null;
  let totalBreakMilliseconds = 0;

  for (const punch of orderedPunches) {
    const punchMilliseconds = punch.serverTimestamp.getTime();
    if (
      !Number.isFinite(punchMilliseconds) ||
      punchMilliseconds < clockInMilliseconds ||
      punchMilliseconds > endMilliseconds
    ) {
      throw new AttendanceApiError(
        "INVALID_ATTENDANCE_STATE",
        "Break punch timestamps are invalid.",
      );
    }

    if (punch.type === "BREAK_START") {
      if (breakStartedAt !== null) {
        throw new AttendanceApiError(
          "INVALID_ATTENDANCE_STATE",
          "Break punch order is invalid.",
        );
      }
      breakStartedAt = punch.serverTimestamp;
      continue;
    }

    if (breakStartedAt === null) {
      throw new AttendanceApiError(
        "INVALID_ATTENDANCE_STATE",
        "Break punch order is invalid.",
      );
    }
    totalBreakMilliseconds +=
      punchMilliseconds - breakStartedAt.getTime();
    breakStartedAt = null;
  }

  if (breakStartedAt && input.includeOpenBreakUntilEnd) {
    totalBreakMilliseconds +=
      endMilliseconds - breakStartedAt.getTime();
  }

  const elapsedMilliseconds = endMilliseconds - clockInMilliseconds;
  totalBreakMilliseconds = Math.min(
    elapsedMilliseconds,
    Math.max(0, totalBreakMilliseconds),
  );
  const totalWorkedMilliseconds = Math.max(
    0,
    elapsedMilliseconds - totalBreakMilliseconds,
  );

  return {
    totalBreakMilliseconds,
    totalBreakMinutes: Math.floor(totalBreakMilliseconds / 60_000),
    totalWorkedMilliseconds,
    totalWorkedMinutes: Math.floor(totalWorkedMilliseconds / 60_000),
    openBreakStartedAt: breakStartedAt,
  };
}
