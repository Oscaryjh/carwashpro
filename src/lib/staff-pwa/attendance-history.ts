export type StaffAttendanceIssue = Readonly<{
  type: string;
  status: string;
  label: string;
  description: string;
}>;

export type StaffAttendancePrimaryStatus = Readonly<{
  key:
    | "COMPLETED"
    | "IN_PROGRESS"
    | "NEEDS_REVIEW"
    | "MISSING_PUNCH"
    | "ADJUSTED"
    | "RESOLVED"
    | "CANCELLED"
    | "FINAL_RESULT";
  label: string;
  tone: "complete" | "progress" | "attention" | "adjusted" | "neutral";
}>;

export type StaffAttendanceStatusInput = Readonly<{
  sessionStatuses: readonly string[];
  issues: readonly StaffAttendanceIssue[];
  finalOutcome: string | null;
  adjusted: boolean;
  resolved: boolean;
}>;

export function buildStaffAttendancePrimaryStatus(
  input: StaffAttendanceStatusInput,
): StaffAttendancePrimaryStatus {
  const issue = input.issues[0];
  if (issue) {
    return {
      key: isMissingPunchIssue(issue.type) ? "MISSING_PUNCH" : "NEEDS_REVIEW",
      label: issue.label,
      tone: "attention",
    };
  }

  if (
    input.sessionStatuses.some(
      (status) => status === "OPEN" || status === "ON_BREAK",
    )
  ) {
    return { key: "IN_PROGRESS", label: "In progress", tone: "progress" };
  }

  if (input.finalOutcome) {
    return {
      key: "FINAL_RESULT",
      label: finalOutcomeLabel(input.finalOutcome),
      tone: finalOutcomeTone(input.finalOutcome),
    };
  }

  if (input.adjusted) {
    return { key: "ADJUSTED", label: "Adjusted", tone: "adjusted" };
  }

  if (input.resolved) {
    return { key: "RESOLVED", label: "Resolved", tone: "complete" };
  }

  if (input.sessionStatuses.some((status) => status === "INCOMPLETE")) {
    return {
      key: "NEEDS_REVIEW",
      label: "Review required",
      tone: "attention",
    };
  }

  if (input.sessionStatuses.length > 0 && input.sessionStatuses.every((status) => status === "CANCELLED")) {
    return { key: "CANCELLED", label: "Cancelled", tone: "neutral" };
  }

  return { key: "COMPLETED", label: "Completed", tone: "complete" };
}

export function staffAttendanceIssueCopy(type: string): Omit<StaffAttendanceIssue, "type" | "status"> {
  switch (type) {
    case "MISSING_CLOCK_IN":
    case "FORGOT_CLOCK_IN":
      return {
        label: "Missing clock-in",
        description: "A clock-in needs to be confirmed.",
      };
    case "MISSING_CLOCK_OUT":
    case "FORGOT_CLOCK_OUT":
      return {
        label: "Missing clock-out",
        description: "A clock-out needs to be confirmed.",
      };
    case "NO_ATTENDANCE_RECORDED":
    case "SUSPECTED_NO_SHOW":
      return {
        label: "Missing attendance",
        description: "Attendance for this scheduled day needs review.",
      };
    case "LATE_ARRIVAL":
      return {
        label: "Late arrival",
        description: "The difference from the scheduled start is being reviewed.",
      };
    case "EARLY_DEPARTURE":
      return {
        label: "Short attendance",
        description: "The difference from the scheduled end is being reviewed.",
      };
    case "LEAVE_ATTENDANCE_CONFLICT":
      return {
        label: "Attendance and leave conflict",
        description: "Attendance and approved leave need manager review.",
      };
    case "GPS_INACCURATE":
    case "GPS_UNAVAILABLE":
    case "OUTSIDE_GEOFENCE":
      return {
        label: "Location evidence review",
        description: "The punch was recorded; its location evidence needs review.",
      };
    default:
      return {
        label: "Review required",
        description: "This attendance item is still being reviewed.",
      };
  }
}

export function finalOutcomeLabel(outcome: string) {
  switch (outcome) {
    case "PRESENT":
    case "PRESENT_LATE_AUTHORIZED":
    case "PRESENT_LATE_UNAUTHORIZED":
    case "PRESENT_EARLY_AUTHORIZED":
    case "PRESENT_EARLY_UNAUTHORIZED":
      return "Present";
    case "AUTHORIZED_ABSENCE":
      return "Authorized absence";
    case "UNAUTHORIZED_ABSENCE":
      return "Unauthorized absence";
    case "APPROVED_PAID_LEAVE":
      return "Approved paid leave";
    case "APPROVED_UNPAID_LEAVE":
      return "Approved unpaid leave";
    case "AUTHORIZED_EMERGENCY_LEAVE":
      return "Emergency leave";
    case "NOT_SCHEDULED":
      return "Not scheduled";
    case "REST_DAY":
      return "Rest day";
    case "PUBLIC_HOLIDAY":
      return "Public holiday";
    case "EXCLUDED":
      return "Excluded";
    default:
      return "Resolved";
  }
}

export function isMissingPunchIssue(type: string) {
  return type === "MISSING_CLOCK_IN" ||
    type === "MISSING_CLOCK_OUT" ||
    type === "FORGOT_CLOCK_IN" ||
    type === "FORGOT_CLOCK_OUT" ||
    type === "NO_ATTENDANCE_RECORDED" ||
    type === "SUSPECTED_NO_SHOW";
}

function finalOutcomeTone(outcome: string): StaffAttendancePrimaryStatus["tone"] {
  return outcome === "UNAUTHORIZED_ABSENCE" ? "attention" :
    outcome === "EXCLUDED" || outcome === "NOT_SCHEDULED" ? "neutral" :
      "complete";
}
