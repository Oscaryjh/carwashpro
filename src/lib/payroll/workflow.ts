export type PayrollWorkflowStatus = "DRAFT" | "REVIEW" | "FINALIZED";

export type PayrollWorkflowAction =
  | "SUBMIT_FOR_REVIEW"
  | "RETURN_TO_DRAFT"
  | "FINALIZE"
  | "REOPEN";

const TRANSITIONS: Record<
  PayrollWorkflowAction,
  Readonly<{ from: PayrollWorkflowStatus; to: PayrollWorkflowStatus }>
> = {
  SUBMIT_FOR_REVIEW: { from: "DRAFT", to: "REVIEW" },
  RETURN_TO_DRAFT: { from: "REVIEW", to: "DRAFT" },
  FINALIZE: { from: "REVIEW", to: "FINALIZED" },
  REOPEN: { from: "FINALIZED", to: "DRAFT" },
};

export function payrollTransition(
  status: PayrollWorkflowStatus,
  action: PayrollWorkflowAction,
) {
  const transition = TRANSITIONS[action];
  if (status !== transition.from) {
    throw new Error(payrollTransitionError(action));
  }
  return transition.to;
}

function payrollTransitionError(action: PayrollWorkflowAction) {
  switch (action) {
    case "SUBMIT_FOR_REVIEW":
      return "Only an editable payroll draft can be submitted for review.";
    case "RETURN_TO_DRAFT":
      return "Only payroll awaiting review can be returned to draft.";
    case "FINALIZE":
      return "Payroll must be submitted for review before it can be finalized.";
    case "REOPEN":
      return "Only a finalized payroll run can be reopened.";
  }
}
