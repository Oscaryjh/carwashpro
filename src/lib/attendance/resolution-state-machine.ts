import type {
  AttendanceApprovalStatus,
  AttendanceFinalResultDisposition,
  AttendanceFinalResultSource,
  AttendanceResolutionCaseStatus,
  AttendanceResolutionReason,
  EmployeeAttendanceStatus,
} from "@prisma/client";

export type AttendanceResolutionClassification =
  | Readonly<{ kind: "ACTIVE_SESSION" }>
  | Readonly<{
      kind: "ACTION_REQUIRED";
      caseStatus: "OPEN";
      openedReason: AttendanceResolutionReason;
    }>
  | Readonly<{
      kind: "FINAL_RESULT";
      caseStatus: "RESOLVED";
      disposition: AttendanceFinalResultDisposition;
      openedReason: AttendanceResolutionReason;
      source: AttendanceFinalResultSource;
    }>;

export type AttendanceResolutionSessionState = Readonly<{
  status: EmployeeAttendanceStatus;
  approvalStatus: AttendanceApprovalStatus;
  hasAdjustment?: boolean;
  hasCompleteTime?: boolean;
}>;

const allowedTransitions: Readonly<
  Record<AttendanceResolutionCaseStatus, readonly AttendanceResolutionCaseStatus[]>
> = {
  OPEN: ["UNDER_REVIEW", "RETURNED_FOR_CORRECTION", "RESOLVED"],
  UNDER_REVIEW: ["RETURNED_FOR_CORRECTION", "RESOLVED"],
  RETURNED_FOR_CORRECTION: ["UNDER_REVIEW", "RESOLVED"],
  RESOLVED: ["RESOLVED", "SUPERSEDED"],
  SUPERSEDED: [],
};

export function classifyAttendanceSessionForResolution(
  session: AttendanceResolutionSessionState,
): AttendanceResolutionClassification {
  if (session.status === "OPEN" || session.status === "ON_BREAK") {
    return { kind: "ACTIVE_SESSION" };
  }

  if (session.status === "INCOMPLETE") {
    return {
      kind: "ACTION_REQUIRED",
      caseStatus: "OPEN",
      openedReason: "INCOMPLETE_SESSION",
    };
  }

  if (session.status === "COMPLETED" && session.hasCompleteTime === false) {
    return {
      kind: "ACTION_REQUIRED",
      caseStatus: "OPEN",
      openedReason: "INCOMPLETE_SESSION",
    };
  }

  if (session.status === "CANCELLED") {
    return {
      kind: "FINAL_RESULT",
      caseStatus: "RESOLVED",
      disposition: "EXCLUDED",
      openedReason: "CANCELLED_SESSION",
      source: "RAW_SESSION",
    };
  }

  if (session.approvalStatus === "PENDING") {
    return {
      kind: "ACTION_REQUIRED",
      caseStatus: "OPEN",
      openedReason: "APPROVAL_PENDING",
    };
  }

  if (session.approvalStatus === "REJECTED") {
    return {
      kind: "ACTION_REQUIRED",
      caseStatus: "OPEN",
      openedReason: "APPROVAL_REJECTED",
    };
  }

  if (session.hasAdjustment) {
    return {
      kind: "FINAL_RESULT",
      caseStatus: "RESOLVED",
      disposition: "INCLUDED",
      openedReason: "MANAGER_ADJUSTMENT",
      source: "MANAGER_ADJUSTMENT",
    };
  }

  return {
    kind: "FINAL_RESULT",
    caseStatus: "RESOLVED",
    disposition: "INCLUDED",
    openedReason: "LEGACY_COMPLETED",
    source:
      session.approvalStatus === "APPROVED"
        ? "APPROVED_EXCEPTION"
        : "RAW_SESSION",
  };
}

export function canTransitionAttendanceResolutionCase(
  from: AttendanceResolutionCaseStatus,
  to: AttendanceResolutionCaseStatus,
) {
  return allowedTransitions[from].includes(to);
}

export function assertAttendanceResolutionTransition(
  from: AttendanceResolutionCaseStatus,
  to: AttendanceResolutionCaseStatus,
) {
  if (!canTransitionAttendanceResolutionCase(from, to)) {
    throw new AttendanceResolutionStateError(
      `Attendance Resolution Case cannot transition from ${from} to ${to}.`,
    );
  }
}

export function assertFinalAttendanceResultValues(input: {
  disposition: AttendanceFinalResultDisposition;
  clockInAt: Date | null;
  clockOutAt: Date | null;
  totalBreakMinutes: number;
  totalWorkedMinutes: number;
  expectedBreakMinutes: number;
  confirmedBreakMinutes: number | null;
}) {
  const minuteValues = [
    input.totalBreakMinutes,
    input.totalWorkedMinutes,
    input.expectedBreakMinutes,
  ];
  if (
    minuteValues.some((value) => !Number.isInteger(value) || value < 0) ||
    (input.confirmedBreakMinutes !== null &&
      (!Number.isInteger(input.confirmedBreakMinutes) ||
        input.confirmedBreakMinutes < 0))
  ) {
    throw new AttendanceResolutionStateError(
      "Final Attendance Result minutes must be non-negative integers.",
    );
  }

  if (
    input.disposition === "INCLUDED" &&
    (!input.clockInAt ||
      !input.clockOutAt ||
      input.clockOutAt <= input.clockInAt)
  ) {
    throw new AttendanceResolutionStateError(
      "An included Final Attendance Result requires a valid clock-in and clock-out.",
    );
  }
}

export class AttendanceResolutionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttendanceResolutionStateError";
  }
}
