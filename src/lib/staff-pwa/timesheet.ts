export type StaffTimesheetOutcome =
  | "PRESENT"
  | "PRESENT_LATE_AUTHORIZED"
  | "PRESENT_LATE_UNAUTHORIZED"
  | "PRESENT_EARLY_AUTHORIZED"
  | "PRESENT_EARLY_UNAUTHORIZED"
  | "AUTHORIZED_ABSENCE"
  | "UNAUTHORIZED_ABSENCE"
  | "APPROVED_PAID_LEAVE"
  | "APPROVED_UNPAID_LEAVE"
  | "AUTHORIZED_EMERGENCY_LEAVE"
  | "NOT_SCHEDULED"
  | "REST_DAY"
  | "PUBLIC_HOLIDAY"
  | "EXCLUDED";

export type StaffTimesheetDay = Readonly<{
  id: string;
  workDate: Date;
  outcome: StaffTimesheetOutcome;
  expectedDayKind: "WORKDAY" | "NOT_SCHEDULED" | "REST_DAY" | "PUBLIC_HOLIDAY" | null;
  leaveName: string | null;
  leaveDayFraction: number | null;
  expectedStartAt: Date | null;
  expectedEndAt: Date | null;
  actualClockInAt: Date | null;
  actualClockOutAt: Date | null;
  timezone: string;
  totalBreakMinutes: number;
  totalWorkedMinutes: number;
  potentialOtMinutes: number;
  approvedOtMinutes: number;
  otApprovalStatus: string;
  version: number;
  locked: boolean;
}>;

export type StaffTimesheetDayView = Readonly<{
  label: string;
  supportingLabel: string | null;
  timeLabel: string | null;
  tone: "present" | "neutral" | "leave" | "holiday" | "issue";
  approvedOtLabel: string | null;
}>;

export function buildStaffTimesheetDayView(day: StaffTimesheetDay): StaffTimesheetDayView {
  const worked = day.totalWorkedMinutes > 0;
  if (worked && day.expectedDayKind === "PUBLIC_HOLIDAY") {
    return base("Public Holiday Worked", "holiday", day);
  }
  if (worked && day.expectedDayKind === "REST_DAY") {
    return base("Rest Day Worked", "holiday", day);
  }

  switch (day.outcome) {
    case "PRESENT_LATE_AUTHORIZED":
    case "PRESENT_LATE_UNAUTHORIZED":
      return base("Present", "present", day, "Late");
    case "PRESENT_EARLY_AUTHORIZED":
    case "PRESENT_EARLY_UNAUTHORIZED":
      return base("Present", "present", day, "Early leave");
    case "PRESENT":
      return base("Present", "present", day);
    case "APPROVED_PAID_LEAVE":
    case "APPROVED_UNPAID_LEAVE":
    case "AUTHORIZED_EMERGENCY_LEAVE":
      return base(day.leaveName || leaveFallback(day.outcome), "leave", day, "Approved");
    case "AUTHORIZED_ABSENCE":
      return base("Authorized absence", "leave", day);
    case "UNAUTHORIZED_ABSENCE":
      return base("Unauthorized absence", "issue", day, "Final result");
    case "REST_DAY":
      return base("Rest Day", "neutral", day);
    case "PUBLIC_HOLIDAY":
      return base("Public Holiday", "holiday", day);
    case "NOT_SCHEDULED":
      return base("Not Scheduled", "neutral", day);
    case "EXCLUDED":
      return base("Excluded", "neutral", day);
  }
}

export function summarizeStaffTimesheet(days: readonly StaffTimesheetDay[]) {
  const workedDays = days.filter((day) => day.totalWorkedMinutes > 0).length;
  const totalWorkedMinutes = sum(days, (day) => day.totalWorkedMinutes);
  const approvedOtMinutes = sum(days, (day) => day.approvedOtMinutes);
  const leaveDays = days.reduce((total, day) => (
    isLeaveOutcome(day.outcome) ? total + (day.leaveDayFraction ?? 1) : total
  ), 0);
  return {
    workedDays,
    regularMinutes: Math.max(0, totalWorkedMinutes - approvedOtMinutes),
    approvedOtMinutes,
    leaveDays,
    restDayWorked: days.filter((day) => day.totalWorkedMinutes > 0 && day.expectedDayKind === "REST_DAY").length,
    publicHolidayWorked: days.filter((day) => day.totalWorkedMinutes > 0 && day.expectedDayKind === "PUBLIC_HOLIDAY").length,
  };
}

export function staffTimesheetAttention(type: string) {
  switch (type) {
    case "MISSING_CLOCK_IN":
      return { label: "Missing clock-in", description: "No confirmed clock-in is available." };
    case "MISSING_CLOCK_OUT":
      return { label: "Missing clock-out", description: "No confirmed clock-out is available." };
    case "NO_ATTENDANCE_RECORDED":
    case "SUSPECTED_NO_SHOW":
      return { label: "Missing attendance", description: "No confirmed clock-in or clock-out is available." };
    case "LATE_ARRIVAL":
      return { label: "Late arrival", description: "This attendance item is still being reviewed." };
    case "EARLY_DEPARTURE":
      return { label: "Early leave", description: "This attendance item is still being reviewed." };
    case "LEAVE_ATTENDANCE_CONFLICT":
      return { label: "Attendance and leave conflict", description: "This item needs manager review." };
    default:
      return { label: "Attendance issue", description: "This attendance item is still being reviewed." };
  }
}

export function formatStaffTimesheetTime(value: Date | null, timezone: string) {
  return value?.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }) ?? "—";
}

export function formatStaffTimesheetDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder}m`;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function base(
  label: string,
  tone: StaffTimesheetDayView["tone"],
  day: StaffTimesheetDay,
  supportingLabel: string | null = null,
): StaffTimesheetDayView {
  const hasTime = day.actualClockInAt || day.actualClockOutAt;
  return {
    label,
    supportingLabel,
    timeLabel: hasTime
      ? `${formatStaffTimesheetTime(day.actualClockInAt, day.timezone)} – ${formatStaffTimesheetTime(day.actualClockOutAt, day.timezone)}`
      : null,
    tone,
    approvedOtLabel: day.approvedOtMinutes > 0
      ? `OT ${formatStaffTimesheetDuration(day.approvedOtMinutes)}`
      : null,
  };
}

function leaveFallback(outcome: StaffTimesheetOutcome) {
  if (outcome === "APPROVED_PAID_LEAVE") return "Paid Leave";
  if (outcome === "APPROVED_UNPAID_LEAVE") return "Unpaid Leave";
  return "Emergency Leave";
}

function isLeaveOutcome(outcome: StaffTimesheetOutcome) {
  return outcome === "APPROVED_PAID_LEAVE" ||
    outcome === "APPROVED_UNPAID_LEAVE" ||
    outcome === "AUTHORIZED_EMERGENCY_LEAVE";
}

function sum(days: readonly StaffTimesheetDay[], getValue: (day: StaffTimesheetDay) => number) {
  return days.reduce((total, day) => total + getValue(day), 0);
}
