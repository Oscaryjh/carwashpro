export type ClaimOperationalStage = "NEEDS_REVIEW" | "READY_TO_PAY" | "PROCESSING" | "COMPLETED";

type ClaimPresentationInput = {
  claimStatus: string;
  reimbursementStatus?: string | null;
};

export function getClaimOperationalStage(input: ClaimPresentationInput): ClaimOperationalStage {
  if (["REJECTED", "WITHDRAWN"].includes(input.claimStatus)) return "COMPLETED";
  if (["OUTSIDE_PAYROLL_PAID", "PAYROLL_SETTLED", "CANCELLED"].includes(input.reimbursementStatus ?? "")) return "COMPLETED";
  if (input.claimStatus === "SUBMITTED") return "NEEDS_REVIEW";
  if (input.reimbursementStatus === "AWAITING_CHANNEL") return "READY_TO_PAY";
  if (["OUTSIDE_PAYROLL_PENDING", "PAYROLL_LINKED"].includes(input.reimbursementStatus ?? "")) return "PROCESSING";
  if (["APPROVED", "PARTIALLY_APPROVED"].includes(input.claimStatus)) return "READY_TO_PAY";
  return "PROCESSING";
}

export function getManagerClaimStatus(input: ClaimPresentationInput): string {
  const reimbursement = input.reimbursementStatus;
  if (input.claimStatus === "SUBMITTED") return "Needs review";
  if (input.claimStatus === "REJECTED") return "Rejected";
  if (input.claimStatus === "WITHDRAWN") return "Withdrawn";
  if (reimbursement === "AWAITING_CHANNEL") return "Choose payment method";
  if (reimbursement === "OUTSIDE_PAYROLL_PENDING") return "Payment pending";
  if (reimbursement === "OUTSIDE_PAYROLL_PAID") return "Paid separately";
  if (reimbursement === "PAYROLL_LINKED") return "Added to payroll";
  if (reimbursement === "PAYROLL_SETTLED") return "Included in finalized payroll";
  if (reimbursement === "CANCELLED") return "Cancelled";
  if (input.claimStatus === "PARTIALLY_APPROVED") return "Partially approved";
  if (input.claimStatus === "APPROVED") return "Approved";
  return humanize(input.claimStatus);
}

export function getEmployeeClaimStatus(input: ClaimPresentationInput): string {
  const reimbursement = input.reimbursementStatus;
  if (input.claimStatus === "SUBMITTED") return "Under review";
  if (input.claimStatus === "REJECTED") return "Not approved";
  if (input.claimStatus === "WITHDRAWN") return "Withdrawn";
  if (reimbursement === "AWAITING_CHANNEL") return "Approved — awaiting payment";
  if (reimbursement === "OUTSIDE_PAYROLL_PENDING") return "Payment processing";
  if (reimbursement === "OUTSIDE_PAYROLL_PAID") return "Paid";
  if (reimbursement === "PAYROLL_SETTLED") return "Included in finalized payroll";
  if (reimbursement === "PAYROLL_LINKED") return "Added to payroll";
  if (reimbursement === "CANCELLED") return "Cancelled";
  if (input.claimStatus === "PARTIALLY_APPROVED") return "Partially approved — awaiting payment";
  if (input.claimStatus === "APPROVED") return "Approved — awaiting payment";
  return humanize(input.claimStatus);
}

export const claimStageContent: Record<ClaimOperationalStage, { label: string; emptyTitle: string; emptyBody: string }> = {
  NEEDS_REVIEW: { label: "Needs review", emptyTitle: "No claims need review", emptyBody: "New employee submissions will appear here." },
  READY_TO_PAY: { label: "Ready to pay", emptyTitle: "No claims are waiting for payment setup", emptyBody: "Approved claims will appear here when a payment method is needed." },
  PROCESSING: { label: "Processing", emptyTitle: "No reimbursements are processing", emptyBody: "Claims added to payroll or awaiting a separate payment will appear here." },
  COMPLETED: { label: "Completed", emptyTitle: "No completed claims yet", emptyBody: "Paid, payroll-finalized, rejected, withdrawn and cancelled claims will appear here." },
};

function humanize(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
