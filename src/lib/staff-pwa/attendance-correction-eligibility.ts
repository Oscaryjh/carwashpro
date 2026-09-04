import type { AttendanceHistoryItem } from "@/lib/staff-pwa/types";

export type MissingClockOutCorrectionState =
  | "ACTIONABLE"
  | "PENDING"
  | "NOT_ACTIONABLE";

export function getMissingClockOutCorrectionState(
  item: Pick<AttendanceHistoryItem, "locked" | "primaryStatus" | "sessions"> & {
    approvalStatus?: string;
    clockOutAt?: string | null;
    requiresApproval?: boolean;
    status?: string;
    resolutionCaseId?: string | null;
    resolutionCaseStatus?:
      | "OPEN"
      | "UNDER_REVIEW"
      | "RETURNED_FOR_CORRECTION"
      | "RESOLVED"
      | "SUPERSEDED"
      | null;
  },
): MissingClockOutCorrectionState {
  if (item.locked) {
    return "NOT_ACTIONABLE";
  }

  const missingClockOutSession = item.sessions.find(
    (session) =>
      !session.clockOutAt &&
      session.punchStatus !== "COMPLETED" &&
      session.punchStatus !== "CANCELLED",
  );

  const compatibilityMissingClockOut =
    item.status === "INCOMPLETE" && !item.clockOutAt;

  const canonicalMissingClockOut = Boolean(missingClockOutSession) &&
    (item.primaryStatus.key === "MISSING_PUNCH" ||
      item.primaryStatus.key === "NEEDS_REVIEW");

  if (!canonicalMissingClockOut && !compatibilityMissingClockOut) {
    return "NOT_ACTIONABLE";
  }

  if (item.resolutionCaseId) {
    return item.resolutionCaseStatus === "UNDER_REVIEW"
      ? "PENDING"
      : "ACTIONABLE";
  }

  const approvalLabel = missingClockOutSession?.approvalLabel?.toLowerCase();
  if (
    approvalLabel?.includes("pending") ||
    (item.requiresApproval === true && item.approvalStatus === "PENDING")
  ) {
    return "PENDING";
  }

  return "ACTIONABLE";
}

export function getMissingClockOutCorrectionHref(
  item: Pick<AttendanceHistoryItem, "resolutionCaseId">,
) {
  return item.resolutionCaseId
    ? "/staff#attendance-issues"
    : "/staff/history/records#attendance-correction";
}
