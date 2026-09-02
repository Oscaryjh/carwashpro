import type { AttendanceToday } from "@/lib/staff-pwa/types";

export type StaffHomeAttendanceTone = "neutral" | "success" | "warning";
export type StaffHomeAttendanceFact = "clockIn" | "clockOut" | "break" | "worked";

export type StaffHomeAttendanceViewState = {
  headline: string;
  badgeLabel: string | null;
  tone: StaffHomeAttendanceTone;
  facts: StaffHomeAttendanceFact[];
};

export function getStaffHomeAttendanceViewState(
  today: Pick<
    AttendanceToday,
    | "status"
    | "sessionCount"
    | "clockInAt"
    | "currentSession"
    | "totalCompletedBreakMinutes"
    | "currentWorkedMinutes"
  >,
): StaffHomeAttendanceViewState {
  const facts: StaffHomeAttendanceFact[] = [];
  if (today.clockInAt) facts.push("clockIn");
  if (today.currentSession?.clockOutAt) facts.push("clockOut");
  if (today.status || today.totalCompletedBreakMinutes > 0) facts.push("break");
  if (today.status || today.currentWorkedMinutes > 0) facts.push("worked");

  return {
    badgeLabel: today.sessionCount > 1 ? `Shift ${today.sessionCount}` : null,
    facts,
    headline: today.status === "OPEN"
      ? "You are currently working"
      : today.status === "ON_BREAK"
        ? "Your break is in progress"
        : today.status === "COMPLETED"
          ? "You have clocked out for today"
          : "Ready to start your day",
    tone: today.status === "ON_BREAK"
      ? "warning"
      : today.status === "OPEN" || today.status === "COMPLETED"
        ? "success"
        : "neutral",
  };
}
