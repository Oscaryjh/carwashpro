import { createHash } from "node:crypto";

export type ExpectedAttendanceEvidence = {
  id: string;
  kind: "WORKDAY" | "NOT_SCHEDULED" | "REST_DAY" | "PUBLIC_HOLIDAY";
  expectedStartAt: Date | null;
  expectedEndAt: Date | null;
  graceMinutes: number;
  revision: number;
};

export type AttendanceDayFacts = {
  sessionId: string | null;
  firstClockInAt: Date | null;
  lastClockOutAt: Date | null;
  totalBreakMinutes: number;
  totalWorkedMinutes: number;
};

export type AttendanceLeaveContext = {
  id: string;
  status: "APPROVED";
  payTreatment: "PAID" | "UNPAID";
  emergency: boolean;
  dayFraction?: number;
} | null;

export type AttendanceP2DetectedException = {
  type:
    | "MISSING_CLOCK_IN"
    | "MISSING_CLOCK_OUT"
    | "LATE_ARRIVAL"
    | "EARLY_DEPARTURE"
    | "NO_ATTENDANCE_RECORDED"
    | "SUSPECTED_NO_SHOW"
    | "LEAVE_ATTENDANCE_CONFLICT";
  severity: "BLOCKER";
  reasonCode: string;
  exceptionMinutes: number;
  sourceDigest: string;
  stableKey: string;
};

export type AttendanceP2Warning = {
  type: "REPEATED_CORRECTION_WARNING" | "OVERNIGHT_EVIDENCE_REVIEW";
  severity: "WARNING";
  reasonCode: string;
};

export type AttendanceP2DetectionInput = {
  businessId: string;
  membershipId: string;
  workDate: Date;
  expected: ExpectedAttendanceEvidence | null;
  facts: AttendanceDayFacts;
  leave: AttendanceLeaveContext;
  approvedCorrectionCountThisMonth?: number;
  correctionWarningThreshold?: number;
};

export type AttendanceP2DetectionResult = {
  exceptions: AttendanceP2DetectedException[];
  warnings: AttendanceP2Warning[];
  suggestedOutcome:
    | "PRESENT"
    | "APPROVED_PAID_LEAVE"
    | "APPROVED_UNPAID_LEAVE"
    | "AUTHORIZED_EMERGENCY_LEAVE"
    | "NOT_SCHEDULED"
    | "REST_DAY"
    | "PUBLIC_HOLIDAY"
    | null;
  sourceDigest: string;
};

/**
 * Central P2 interpretation boundary. Raw punches remain facts; this function only
 * derives exceptions. It deliberately never creates leave or payroll effects.
 */
export function detectAttendanceExceptions(input: AttendanceP2DetectionInput): AttendanceP2DetectionResult {
  const sourceDigest = attendanceP2Digest({
    expected: input.expected
      ? {
          id: input.expected.id,
          kind: input.expected.kind,
          start: iso(input.expected.expectedStartAt),
          end: iso(input.expected.expectedEndAt),
          grace: input.expected.graceMinutes,
          revision: input.expected.revision,
        }
      : null,
    facts: {
      sessionId: input.facts.sessionId,
      firstIn: iso(input.facts.firstClockInAt),
      lastOut: iso(input.facts.lastClockOutAt),
      breaks: input.facts.totalBreakMinutes,
      worked: input.facts.totalWorkedMinutes,
    },
    leave: input.leave,
  });
  const exceptions: AttendanceP2DetectedException[] = [];
  const warnings: AttendanceP2Warning[] = [];
  const hasAnyPunch = Boolean(input.facts.firstClockInAt || input.facts.lastClockOutAt);
  const add = (
    type: AttendanceP2DetectedException["type"],
    reasonCode: string,
    exceptionMinutes = 0,
  ) => exceptions.push({
    type,
    severity: "BLOCKER",
    reasonCode,
    exceptionMinutes,
    sourceDigest,
    stableKey: attendanceP2StableKey(input, type, sourceDigest),
  });

  if (input.leave && hasAnyPunch) {
    add("LEAVE_ATTENDANCE_CONFLICT", "APPROVED_LEAVE_WITH_ATTENDANCE_FACTS");
  }

  if (!hasAnyPunch) {
    if (input.leave) {
      return result(
        exceptions,
        warnings,
        input.leave.emergency
          ? "AUTHORIZED_EMERGENCY_LEAVE"
          : input.leave.payTreatment === "PAID"
            ? "APPROVED_PAID_LEAVE"
            : "APPROVED_UNPAID_LEAVE",
        sourceDigest,
        input,
      );
    }
    if (input.expected?.kind === "WORKDAY") {
      add("SUSPECTED_NO_SHOW", "EXPECTED_WORKDAY_WITHOUT_ATTENDANCE");
    } else if (!input.expected) {
      // Lack of roster evidence can only prove absence of a record, never no-show.
      add("NO_ATTENDANCE_RECORDED", "NO_EXPECTED_ATTENDANCE_EVIDENCE");
    } else {
      return result(exceptions, warnings, outcomeForNonWorkday(input.expected.kind), sourceDigest, input);
    }
    return result(exceptions, warnings, null, sourceDigest, input);
  }

  if (!input.facts.firstClockInAt) {
    add("MISSING_CLOCK_IN", "CLOCK_OUT_WITHOUT_CLOCK_IN");
  }
  if (!input.facts.lastClockOutAt) {
    add("MISSING_CLOCK_OUT", "CLOCK_IN_WITHOUT_CLOCK_OUT");
  }

  if (input.expected?.kind === "WORKDAY") {
    if (input.expected.expectedStartAt && input.facts.firstClockInAt) {
      const lateBoundary = input.expected.expectedStartAt.getTime() + input.expected.graceMinutes * 60_000;
      if (input.facts.firstClockInAt.getTime() > lateBoundary) {
        add(
          "LATE_ARRIVAL",
          "CLOCK_IN_AFTER_EXPECTED_START_AND_GRACE",
          Math.ceil((input.facts.firstClockInAt.getTime() - lateBoundary) / 60_000),
        );
      }
    }
    if (input.expected.expectedEndAt && input.facts.lastClockOutAt && input.facts.lastClockOutAt < input.expected.expectedEndAt) {
      add(
        "EARLY_DEPARTURE",
        "CLOCK_OUT_BEFORE_EXPECTED_END",
        Math.ceil((input.expected.expectedEndAt.getTime() - input.facts.lastClockOutAt.getTime()) / 60_000),
      );
    }
    if (input.expected.expectedEndAt && input.expected.expectedStartAt &&
        input.expected.expectedEndAt.getUTCDate() !== input.expected.expectedStartAt.getUTCDate()) {
      warnings.push({ type: "OVERNIGHT_EVIDENCE_REVIEW", severity: "WARNING", reasonCode: "OVERNIGHT_WORKDAY_EVIDENCE" });
    }
  }

  return result(exceptions, warnings, exceptions.length ? null : "PRESENT", sourceDigest, input);
}

export function attendanceP2Digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function result(
  exceptions: AttendanceP2DetectedException[],
  warnings: AttendanceP2Warning[],
  suggestedOutcome: AttendanceP2DetectionResult["suggestedOutcome"],
  sourceDigest: string,
  input: AttendanceP2DetectionInput,
): AttendanceP2DetectionResult {
  const threshold = input.correctionWarningThreshold ?? 3;
  if ((input.approvedCorrectionCountThisMonth ?? 0) >= threshold) {
    warnings.push({
      type: "REPEATED_CORRECTION_WARNING",
      severity: "WARNING",
      reasonCode: "MONTHLY_APPROVED_CORRECTION_THRESHOLD_REACHED",
    });
  }
  return { exceptions, warnings, suggestedOutcome, sourceDigest };
}

function attendanceP2StableKey(
  input: AttendanceP2DetectionInput,
  type: AttendanceP2DetectedException["type"],
  sourceDigest: string,
) {
  return attendanceP2Digest([
    input.businessId,
    input.membershipId,
    input.workDate.toISOString().slice(0, 10),
    type,
    sourceDigest,
  ]);
}

function outcomeForNonWorkday(kind: ExpectedAttendanceEvidence["kind"]) {
  if (kind === "NOT_SCHEDULED") return "NOT_SCHEDULED" as const;
  if (kind === "REST_DAY") return "REST_DAY" as const;
  if (kind === "PUBLIC_HOLIDAY") return "PUBLIC_HOLIDAY" as const;
  return null;
}

function iso(value: Date | null) {
  return value?.toISOString() ?? null;
}
