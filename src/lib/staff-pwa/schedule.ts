export type StaffScheduleAssignment = Readonly<{
  id: string;
  kind: "WORK_SHIFT" | "REST_DAY" | "NOT_SCHEDULED";
  shiftNameSnapshot: string | null;
  startAt: Date | null;
  endAt: Date | null;
  breakMinutes: number;
  breakPaidSnapshot: boolean;
  timezoneSnapshot: string;
  branch: Readonly<{ id: string; name: string }>;
}>;

export type StaffScheduleLeave = Readonly<{ label: string }>;

export type StaffScheduleHoliday = Readonly<{
  name: string;
  branchName?: string;
}>;

export type StaffScheduleShiftView = Readonly<{
  id: string;
  label: string;
  timeLabel: string;
  branchName: string;
  breakLabel: string | null;
  expectedWorkingTime: string;
  overnight: boolean;
}>;

export type StaffScheduleDayView = Readonly<{
  status: "SHIFT" | "REST_DAY" | "NOT_SCHEDULED" | "APPROVED_LEAVE" | "PUBLIC_HOLIDAY";
  title: string;
  timeLabel: string | null;
  supportingLabel: string | null;
  branches: string[];
  holidayLabel: string | null;
  shifts: StaffScheduleShiftView[];
}>;

export function buildStaffScheduleDay(input: {
  assignments: readonly StaffScheduleAssignment[];
  leaves?: readonly StaffScheduleLeave[];
  holidays?: readonly StaffScheduleHoliday[];
}): StaffScheduleDayView {
  const leaves = unique(input.leaves?.map((leave) => leave.label.trim()).filter(Boolean) ?? []);
  const holidays = unique(input.holidays?.map((holiday) => holiday.name.trim()).filter(Boolean) ?? []);
  const shifts = input.assignments
    .filter((assignment) => assignment.kind === "WORK_SHIFT" && assignment.startAt && assignment.endAt)
    .sort((left, right) => left.startAt!.getTime() - right.startAt!.getTime())
    .map(buildShiftView);
  const branches = unique(shifts.map((shift) => shift.branchName));
  const holidayLabel = holidays.length ? holidays.join(" · ") : null;

  if (leaves.length) {
    return {
      status: "APPROVED_LEAVE",
      title: leaves.join(" · "),
      timeLabel: null,
      supportingLabel: "Approved",
      branches,
      holidayLabel,
      shifts,
    };
  }

  if (shifts.length) {
    const first = shifts[0];
    const last = shifts.at(-1)!;
    return {
      status: "SHIFT",
      title: shifts.length === 1 ? first.label : `${shifts.length} shifts`,
      timeLabel: shifts.length === 1
        ? first.timeLabel
        : `${first.timeLabel.split(" – ")[0]} – ${last.timeLabel.split(" – ").at(-1)}`,
      supportingLabel: branches.join(" · ") || null,
      branches,
      holidayLabel,
      shifts,
    };
  }

  if (holidayLabel) {
    return {
      status: "PUBLIC_HOLIDAY",
      title: "Public Holiday",
      timeLabel: null,
      supportingLabel: holidayLabel,
      branches: [],
      holidayLabel,
      shifts: [],
    };
  }

  if (input.assignments.some((assignment) => assignment.kind === "REST_DAY")) {
    return {
      status: "REST_DAY",
      title: "Rest Day",
      timeLabel: null,
      supportingLabel: "No shift scheduled",
      branches: [],
      holidayLabel: null,
      shifts: [],
    };
  }

  return {
    status: "NOT_SCHEDULED",
    title: "Not Scheduled",
    timeLabel: null,
    supportingLabel: null,
    branches: [],
    holidayLabel: null,
    shifts: [],
  };
}

export function formatScheduleTime(value: Date, timezone: string) {
  return value.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  });
}

function buildShiftView(assignment: StaffScheduleAssignment): StaffScheduleShiftView {
  const startAt = assignment.startAt!;
  const endAt = assignment.endAt!;
  const durationMinutes = Math.max(0, Math.round((endAt.getTime() - startAt.getTime()) / 60_000));
  const expectedMinutes = Math.max(
    0,
    durationMinutes - (assignment.breakPaidSnapshot ? 0 : assignment.breakMinutes),
  );
  return {
    id: assignment.id,
    label: assignment.shiftNameSnapshot?.trim() || "Work Shift",
    timeLabel: `${formatScheduleTime(startAt, assignment.timezoneSnapshot)} – ${formatScheduleTime(endAt, assignment.timezoneSnapshot)}`,
    branchName: assignment.branch.name,
    breakLabel: assignment.breakMinutes
      ? `${humanDuration(assignment.breakMinutes)} ${assignment.breakPaidSnapshot ? "paid" : "unpaid"}`
      : null,
    expectedWorkingTime: humanDuration(expectedMinutes),
    overnight: localDayKey(startAt, assignment.timezoneSnapshot) !== localDayKey(endAt, assignment.timezoneSnapshot),
  };
}

function localDayKey(value: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: timezone,
  }).format(value);
}

function humanDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} min`;
  if (!remainder) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${hours}h ${remainder}m`;
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

