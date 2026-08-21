import type {
  StatutoryComponentReviewDecisionValue,
  StatutoryComponentTreatment,
  StatutoryReviewBlockingScope,
} from "@prisma/client";

const CORE_WAGE_COMPONENTS = new Set([
  "BASIC_SALARY",
  "REGULAR_DAILY_PAY",
  "REGULAR_HOURLY_PAY",
  "COMMISSION",
  "OVERTIME_PAY",
  "PAID_LEAVE_PAY",
]);

export const CLAIM_STATUTORY_NATURES = [
  "ACTUAL_EXPENSE_REIMBURSEMENT",
  "ALLOWANCE",
  "WAGE_EARNING",
  "UNKNOWN",
] as const;

export function classificationBlockingScope(input: {
  componentCode: string;
  currentTreatment: StatutoryComponentTreatment;
  latestDecision: StatutoryComponentReviewDecisionValue | null;
}): StatutoryReviewBlockingScope | null {
  if (effectiveClassificationTreatment(input) !== "UNKNOWN") return null;
  if (input.latestDecision !== "KEEP_UNKNOWN") return "GLOBAL_ACTIVATION_BLOCKER";
  return CORE_WAGE_COMPONENTS.has(input.componentCode)
    ? "GLOBAL_ACTIVATION_BLOCKER"
    : "CONDITIONAL_RUNTIME_BLOCKER";
}

export function isClassificationActivationBlocking(input: {
  componentCode: string;
  currentTreatment: StatutoryComponentTreatment;
  latestDecision: StatutoryComponentReviewDecisionValue | null;
}) {
  return classificationBlockingScope(input) === "GLOBAL_ACTIVATION_BLOCKER";
}

export function isClassificationRuntimeBlocking(input: {
  componentCode: string;
  currentTreatment: StatutoryComponentTreatment;
  latestDecision: StatutoryComponentReviewDecisionValue | null;
}) {
  return effectiveClassificationTreatment(input) === "UNKNOWN";
}

export function effectiveClassificationTreatment(input: {
  currentTreatment: StatutoryComponentTreatment;
  latestDecision: StatutoryComponentReviewDecisionValue | null;
}): StatutoryComponentTreatment {
  if (input.latestDecision === "INCLUDED") return "INCLUDED";
  if (input.latestDecision === "ADDITIONAL_REMUNERATION") {
    return "ADDITIONAL_REMUNERATION";
  }
  if (input.latestDecision === "EXCLUDED") return "EXCLUDED";
  return input.currentTreatment;
}

export function assertArrearsDecision(componentCode: string, decision: StatutoryComponentReviewDecisionValue) {
  if (isArrearsComponent(componentCode) && decision !== "KEEP_UNKNOWN") {
    throw new Error("ARREARS_STATUTORY_SOURCE_NATURE_REQUIRED");
  }
}

export function isArrearsComponent(componentCode: string) {
  return componentCode === "ARREARS" || componentCode === "SALARY_ARREARS";
}
