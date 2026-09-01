import type {
  EmployeeCorrectionArchiveItem,
  EmployeeCorrectionStatus,
  EmployeeCorrectionType,
} from "@/lib/attendance/employee-correction-archive";

export type EmployeeCorrectionStatusPresentation = Readonly<{
  label: string;
  detail: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
}>;

export type EmployeeCorrectionActionRouteAudit = Readonly<{
  status:
    | "SAFE_EXISTING_ROUTE"
    | "NO_EMPLOYEE_ACTION_ROUTE"
    | "ACTION_ROUTE_ENRICHMENT_REQUIRED";
  href: string | null;
  label: string | null;
  helper: string | null;
}>;

const STATUS_PRESENTATION: Record<
  EmployeeCorrectionStatus,
  EmployeeCorrectionStatusPresentation
> = {
  ACTION_REQUIRED: {
    label: "Action needed",
    detail: "Complete this attendance correction so your manager can review it.",
    tone: "danger",
  },
  PENDING: {
    label: "Waiting for manager",
    detail: "Your correction is waiting for manager review.",
    tone: "warning",
  },
  RETURNED: {
    label: "Returned for update",
    detail: "Your manager returned this correction for an update.",
    tone: "warning",
  },
  APPROVED: {
    label: "Approved",
    detail: "Your attendance correction was approved.",
    tone: "success",
  },
  REJECTED: {
    label: "Rejected",
    detail: "Your attendance correction was not approved.",
    tone: "danger",
  },
  CANCELLED: {
    label: "Cancelled",
    detail: "This attendance correction was cancelled.",
    tone: "neutral",
  },
  SUPERSEDED: {
    label: "Superseded",
    detail: "A newer attendance correction replaced this request.",
    tone: "neutral",
  },
  UNKNOWN: {
    label: "Status unavailable",
    detail: "This correction has historical data that cannot yet be shown as a final status.",
    tone: "neutral",
  },
};

const CORRECTION_TYPE_COPY: Record<EmployeeCorrectionType, string> = {
  MISSING_CLOCK_IN: "Missing clock in",
  MISSING_CLOCK_OUT: "Missing clock out",
  CLOCK_IN_CORRECTION: "Clock-in correction",
  CLOCK_OUT_CORRECTION: "Clock-out correction",
  DAY_ATTENDANCE_CORRECTION: "Attendance correction",
  OTHER: "Attendance correction",
};

export function getEmployeeCorrectionStatusPresentation(
  status: EmployeeCorrectionStatus,
) {
  return STATUS_PRESENTATION[status] ?? STATUS_PRESENTATION.UNKNOWN;
}

export function getEmployeeCorrectionTypeCopy(
  type: EmployeeCorrectionType | string,
) {
  return CORRECTION_TYPE_COPY[type as EmployeeCorrectionType] ?? "Attendance correction";
}

export function getEmployeeCorrectionFinalResultCopy(
  disposition: EmployeeCorrectionArchiveItem["finalDisposition"],
) {
  if (disposition === "INCLUDED") return "Included in attendance result";
  if (disposition === "EXCLUDED") return "Not included in attendance result";
  return null;
}

export function auditEmployeeCorrectionActionRoute(
  item: Pick<
    EmployeeCorrectionArchiveItem,
    "canEmployeeAct" | "nextAction" | "sourceType"
  >,
): EmployeeCorrectionActionRouteAudit {
  if (!item.canEmployeeAct || item.nextAction === "NONE") {
    return {
      status: "NO_EMPLOYEE_ACTION_ROUTE",
      href: null,
      label: null,
      helper: null,
    };
  }

  if (item.sourceType !== "RESOLUTION_CASE") {
    return {
      status: "ACTION_ROUTE_ENRICHMENT_REQUIRED",
      href: null,
      label: null,
      helper: null,
    };
  }

  if (item.nextAction === "SUBMIT") {
    return {
      status: "SAFE_EXISTING_ROUTE",
      href: "/staff#attendance-issues",
      label: "Complete correction",
      helper: "Continue in the existing attendance response flow.",
    };
  }

  if (item.nextAction === "UPDATE") {
    return {
      status: "SAFE_EXISTING_ROUTE",
      href: "/staff#attendance-issues",
      label: "Update correction",
      helper: "Review the manager note and update your existing response.",
    };
  }

  return {
    status: "ACTION_ROUTE_ENRICHMENT_REQUIRED",
    href: null,
    label: null,
    helper: null,
  };
}

export function appendEmployeeCorrectionArchiveItems(
  current: readonly EmployeeCorrectionArchiveItem[],
  incoming: readonly EmployeeCorrectionArchiveItem[],
) {
  const seen = new Set(current.map((item) => item.sourceKey));
  const appended = incoming.filter((item) => {
    if (seen.has(item.sourceKey)) return false;
    seen.add(item.sourceKey);
    return true;
  });
  return [...current, ...appended];
}
