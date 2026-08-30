import type { AttendanceHistoryItem } from "@/lib/staff-pwa/types";

export type MissingClockOutCorrectionState =
  | "ACTIONABLE"
  | "PENDING"
  | "NOT_ACTIONABLE";

export function getMissingClockOutCorrectionState(
  item: Pick<
    AttendanceHistoryItem,
    "approvalStatus" | "clockOutAt" | "requiresApproval" | "status"
  >,
): MissingClockOutCorrectionState {
  if (item.clockOutAt || item.status !== "INCOMPLETE") {
    return "NOT_ACTIONABLE";
  }

  if (item.requiresApproval && item.approvalStatus === "PENDING") {
    return "PENDING";
  }

  return "ACTIONABLE";
}
