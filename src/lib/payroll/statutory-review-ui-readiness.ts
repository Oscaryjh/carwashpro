export type StatutoryReviewerMfaStatus = "NOT_ENROLLED" | "PENDING" | "ENROLLED";

export type StatutoryHumanSignOffReadiness =
  | "READY"
  | "SIGN_OFF_EXECUTED"
  | "BLOCKED_STEP_UP_INFRASTRUCTURE"
  | "BLOCKED_REVIEWER_CAPABILITY"
  | "BLOCKED_REVIEWER_MFA_ENROLLMENT"
  | "BLOCKED_HUMAN_REVIEW_PENDING";

export function statutoryHumanSignOffReadiness(input: {
  stepUpInfrastructureStatus: "READY" | "BLOCKED";
  reviewerMfaStatus: StatutoryReviewerMfaStatus;
  reviewerCanSign: boolean;
  humanReviewStatus: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  signOffExecuted: boolean;
}): StatutoryHumanSignOffReadiness {
  if (input.signOffExecuted) return "SIGN_OFF_EXECUTED";
  if (input.stepUpInfrastructureStatus !== "READY") {
    return "BLOCKED_STEP_UP_INFRASTRUCTURE";
  }
  if (!input.reviewerCanSign) return "BLOCKED_REVIEWER_CAPABILITY";
  if (input.reviewerMfaStatus !== "ENROLLED") {
    return "BLOCKED_REVIEWER_MFA_ENROLLMENT";
  }
  if (input.humanReviewStatus !== "COMPLETED") {
    return "BLOCKED_HUMAN_REVIEW_PENDING";
  }
  return "READY";
}

export function statutoryReviewerMfaLabel(status: StatutoryReviewerMfaStatus) {
  if (status === "ENROLLED") return "ENROLLED" as const;
  if (status === "PENDING") return "ENROLLMENT PENDING" as const;
  return "NOT ENROLLED" as const;
}
