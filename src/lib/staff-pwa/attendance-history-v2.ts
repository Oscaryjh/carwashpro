import { getMissingClockOutCorrectionState } from "@/lib/staff-pwa/attendance-correction-eligibility";
import type { AttendanceHistoryItem } from "@/lib/staff-pwa/types";

export type AttendanceHistoryV2Status = {
  label: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
  correctionState: ReturnType<typeof getMissingClockOutCorrectionState>;
};

export function getAttendanceHistoryV2Status(
  item: AttendanceHistoryItem,
): AttendanceHistoryV2Status {
  const correctionState = getMissingClockOutCorrectionState(item);

  if (correctionState === "ACTIONABLE") {
    return { label: "Action needed", tone: "warning", correctionState };
  }
  if (correctionState === "PENDING") {
    return { label: "Waiting for manager", tone: "info", correctionState };
  }
  if (item.status === "COMPLETED") {
    return { label: "Completed", tone: "success", correctionState };
  }
  if (item.status === "OPEN") {
    return { label: "In progress", tone: "info", correctionState };
  }
  if (item.status === "ON_BREAK") {
    return { label: "On break", tone: "warning", correctionState };
  }
  if (item.status === "CANCELLED") {
    return { label: "Cancelled", tone: "neutral", correctionState };
  }

  return { label: "Review required", tone: "warning", correctionState };
}

export function attendanceHistoryStatusFilterLabel(status: string) {
  if (status === "OPEN") return "In progress";
  if (status === "ON_BREAK") return "On break";
  if (status === "COMPLETED") return "Completed";
  if (status === "INCOMPLETE") return "Incomplete records";
  if (status === "CANCELLED") return "Cancelled records";
  return "All statuses";
}

export function attendanceHistoryPeriodLabel(from: string, to: string) {
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  const monthFormatter = new Intl.DateTimeFormat("en-MY", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  if (
    fromDate.getUTCFullYear() === toDate.getUTCFullYear() &&
    fromDate.getUTCMonth() === toDate.getUTCMonth() &&
    fromDate.getUTCDate() === 1 &&
    toDate.getUTCDate() === new Date(
      Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth() + 1, 0),
    ).getUTCDate()
  ) {
    return monthFormatter.format(toDate);
  }

  const fromLabel = new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    ...(fromDate.getUTCFullYear() === toDate.getUTCFullYear()
      ? {}
      : { year: "numeric" as const }),
    timeZone: "UTC",
  }).format(fromDate);
  const toLabel = new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(toDate);
  return `${fromLabel} – ${toLabel}`;
}
