import { dateValue } from "@/lib/roster/domain";
import type {
  StaffScheduleAssignment,
  StaffScheduleDayView,
} from "@/lib/staff-pwa/schedule";

export type StaffScheduleV2SourceDay = Readonly<{
  day: Date;
  today: Date;
  view: StaffScheduleDayView;
  assignments: readonly StaffScheduleAssignment[];
  holidayBranches: readonly string[];
}>;

export type StaffScheduleV2ShiftDetail = Readonly<{
  id: string;
  label: string;
  timeLabel: string;
  startsLabel: string | null;
  endsLabel: string | null;
  branchName: string;
  breakLabel: string;
  expectedWorkingTime: string;
  overnight: boolean;
}>;

export type StaffScheduleV2Day = Readonly<{
  key: string;
  weekday: string;
  dayNumber: number;
  dateLabel: string;
  isToday: boolean;
  status: StaffScheduleDayView["status"];
  primary: string;
  secondary: string[];
  branchLabel: string | null;
  holidayLabel: string | null;
  shifts: StaffScheduleV2ShiftDetail[];
  expandable: boolean;
  ariaLabel: string;
}>;

export type StaffScheduleV2Week = Readonly<{
  commonBranch: string | null;
  days: StaffScheduleV2Day[];
}>;

export function buildStaffScheduleV2Week(
  sources: readonly StaffScheduleV2SourceDay[],
): StaffScheduleV2Week {
  const allBranches = unique(sources.flatMap((source) => [
    ...source.view.branches,
    ...source.holidayBranches,
  ]).filter(Boolean));
  const commonBranch = allBranches.length === 1 ? allBranches[0] : null;
  return {
    commonBranch,
    days: sources.map((source) => buildStaffScheduleV2Day(source, commonBranch)),
  };
}

export function buildStaffScheduleV2Day(
  source: StaffScheduleV2SourceDay,
  commonBranch: string | null,
): StaffScheduleV2Day {
  const isToday = dateValue(source.day) === dateValue(source.today);
  const shifts = source.view.shifts.map((shift) => {
    const assignment = source.assignments.find((candidate) => candidate.id === shift.id);
    const timeLabel = assignment?.startAt && assignment.endAt
      ? formatScheduleV2Range(assignment.startAt, assignment.endAt, assignment.timezoneSnapshot)
      : shift.timeLabel;
    return {
      id: shift.id,
      label: shift.label,
      timeLabel,
      startsLabel: shift.overnight && assignment?.startAt
        ? formatScheduleV2DateTime(assignment.startAt, assignment.timezoneSnapshot)
        : null,
      endsLabel: shift.overnight && assignment?.endAt
        ? formatScheduleV2DateTime(assignment.endAt, assignment.timezoneSnapshot)
        : null,
      branchName: shift.branchName,
      breakLabel: shift.breakLabel ? `${shift.breakLabel} break` : "No scheduled break",
      expectedWorkingTime: shift.expectedWorkingTime,
      overnight: shift.overnight,
    } satisfies StaffScheduleV2ShiftDetail;
  });
  const branches = unique([
    ...source.view.branches,
    ...source.holidayBranches,
  ].filter(Boolean));
  const branchLabel = commonBranch
    ? null
    : branches.length > 1
      ? `${branches.length} branches`
      : branches[0] ?? null;
  const secondary: string[] = [];
  let primary: string;

  if (source.view.status === "SHIFT") {
    if (shifts.length > 1) {
      primary = `${shifts.length} shifts`;
      secondary.push(`${firstStart(shifts)} – ${lastEnd(shifts)}`);
    } else {
      const shift = shifts[0];
      primary = shift?.timeLabel ?? source.view.timeLabel ?? "Scheduled shift";
      if (shift) secondary.push(shift.overnight ? `${shift.label} · Ends next day` : shift.label);
    }
    if (source.view.holidayLabel) secondary.push(`Public Holiday · ${source.view.holidayLabel}`);
  } else if (source.view.status === "APPROVED_LEAVE") {
    primary = source.view.title;
    secondary.push("Approved leave");
    if (source.view.holidayLabel) secondary.push(`Public Holiday · ${source.view.holidayLabel}`);
  } else if (source.view.status === "PUBLIC_HOLIDAY") {
    primary = "Public Holiday";
    if (source.view.holidayLabel) secondary.push(source.view.holidayLabel);
  } else if (source.view.status === "REST_DAY") {
    primary = "Rest day";
  } else {
    primary = "No schedule";
    if (isToday) secondary.push("Ask your manager if you expected a shift.");
  }

  if (branchLabel) secondary.push(branchLabel);
  const expandable = shifts.length > 0 || (
    source.view.status === "APPROVED_LEAVE" && Boolean(source.view.holidayLabel)
  );
  const weekday = source.day.toLocaleDateString("en-MY", {
    weekday: "short",
    timeZone: "UTC",
  }).toUpperCase();
  const dateLabel = source.day.toLocaleDateString("en-MY", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const ariaLabel = [
    isToday ? "Today" : null,
    dateLabel,
    primary,
    ...secondary,
    expandable ? "Open details" : null,
  ].filter(Boolean).join(", ");

  return {
    key: dateValue(source.day),
    weekday,
    dayNumber: source.day.getUTCDate(),
    dateLabel,
    isToday,
    status: source.view.status,
    primary,
    secondary,
    branchLabel,
    holidayLabel: source.view.holidayLabel,
    shifts,
    expandable,
    ariaLabel,
  };
}

export function formatScheduleV2Range(startAt: Date, endAt: Date, timezone: string) {
  return `${formatScheduleV2Time(startAt, timezone)} – ${formatScheduleV2Time(endAt, timezone)}`;
}

export function formatScheduleV2Time(value: Date, timezone: string) {
  return value.toLocaleTimeString("en-MY", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone,
  }).toUpperCase();
}

export function formatScheduleV2DateTime(value: Date, timezone: string) {
  return `${value.toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    timeZone: timezone,
  })} · ${formatScheduleV2Time(value, timezone)}`;
}

function firstStart(shifts: readonly StaffScheduleV2ShiftDetail[]) {
  return shifts[0]?.timeLabel.split(" – ")[0] ?? "";
}

function lastEnd(shifts: readonly StaffScheduleV2ShiftDetail[]) {
  return shifts.at(-1)?.timeLabel.split(" – ").at(-1) ?? "";
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}
