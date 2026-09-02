export type LeaveStatusTone = "neutral" | "success" | "warning" | "danger" | "info";

export type StaffLeaveRequestSummary = {
  status: string;
  supportingEvidenceRequired: boolean;
  supportingEvidenceStatus: string;
  supportingDocuments: Array<{ reviewStatus: string }>;
};

export function leaveDecisionPresentation(status: string): { label: string; tone: LeaveStatusTone } {
  switch (status) {
    case "PENDING":
    case "SUBMITTED":
      return { label: "Waiting for manager", tone: "warning" };
    case "APPROVED":
      return { label: "Approved", tone: "success" };
    case "REJECTED":
      return { label: "Rejected", tone: "danger" };
    case "CANCELLED":
    case "WITHDRAWN":
      return { label: "Cancelled", tone: "neutral" };
    case "DRAFT":
      return { label: "Draft", tone: "neutral" };
    default:
      return { label: "Status unavailable", tone: "neutral" };
  }
}

export function leaveEvidencePresentation(request: StaffLeaveRequestSummary): {
  label: string;
  tone: LeaveStatusTone;
  actionNeeded: boolean;
} | null {
  const hasEvidence = request.supportingDocuments.length > 0 || request.supportingEvidenceRequired;
  if (!hasEvidence) return null;

  const statuses = new Set([
    request.supportingEvidenceStatus,
    ...request.supportingDocuments.map((document) => document.reviewStatus),
  ]);
  if (statuses.has("REJECTED") || statuses.has("REVIEW_REQUIRED")) {
    return { label: "Needs follow-up", tone: "danger", actionNeeded: true };
  }
  if (request.supportingEvidenceStatus === "VERIFIED" && request.supportingDocuments.every((document) => document.reviewStatus === "VERIFIED")) {
    return { label: "Verified", tone: "success", actionNeeded: false };
  }
  return { label: "Awaiting review", tone: "info", actionNeeded: false };
}

export function leaveRowStatus(request: StaffLeaveRequestSummary) {
  const decision = leaveDecisionPresentation(request.status);
  const evidence = leaveEvidencePresentation(request);
  return evidence?.actionNeeded
    ? { label: "Action needed", tone: "danger" as const, decision, evidence }
    : { ...decision, decision, evidence };
}

export function formatLeaveUnits(value: number, unit = "day") {
  const amount = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${amount} ${value === 1 || value === 0.5 ? unit : `${unit}s`}`;
}

export function formatLeaveDate(value: string, includeYear = false) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    ...(includeYear ? { year: "numeric" as const } : {}),
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

export function formatLeaveDateRange(startsOn: string, endsOn: string, includeYear = false) {
  if (startsOn === endsOn) return formatLeaveDate(startsOn, includeYear);
  return `${formatLeaveDate(startsOn)}–${formatLeaveDate(endsOn, includeYear)}`;
}

export function sortLeaveBalances<T extends { applicationReady: boolean; remainingDays: number | null; carryForwardBuckets: Array<{ expiresAt: string | null }> }>(policies: readonly T[]) {
  return [...policies].sort((left, right) => {
    const usable = Number(right.applicationReady) - Number(left.applicationReady);
    if (usable) return usable;
    const positive = Number((right.remainingDays ?? 0) > 0) - Number((left.remainingDays ?? 0) > 0);
    if (positive) return positive;
    const leftExpiry = nearestExpiry(left.carryForwardBuckets);
    const rightExpiry = nearestExpiry(right.carryForwardBuckets);
    if (leftExpiry !== rightExpiry) return leftExpiry.localeCompare(rightExpiry);
    return (right.remainingDays ?? Number.NEGATIVE_INFINITY) - (left.remainingDays ?? Number.NEGATIVE_INFINITY);
  });
}

function nearestExpiry(buckets: Array<{ expiresAt: string | null }>) {
  return buckets.map((bucket) => bucket.expiresAt).filter((value): value is string => Boolean(value)).sort()[0] ?? "9999-12-31";
}
