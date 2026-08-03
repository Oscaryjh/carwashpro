export const CLAIM_ARCHITECTURE_POLICY = Object.freeze({
  structure: "HEADER_WITH_ITEMS",
  reimbursementMode: "SEPARATE_REIMBURSEMENT",
  payrollEligibility: "CATEGORY_EXPLICIT_OPT_IN",
  approvalStages: [
    "EMPLOYEE_SUBMIT",
    "MANAGER_REVIEW",
    "FINANCE_VERIFICATION",
  ] as const,
  approvedMeansPaid: false,
  paymentAvailable: false,
  bankFileAvailable: false,
  payrollEntryAllowanceIsClaimLedger: false,
});

export const CLAIM_C0_BOUNDARY = Object.freeze({
  domainWorkflowImplemented: false,
  staffUiImplemented: false,
  managerQueueImplemented: false,
  financeWorkspaceImplemented: false,
  payrollBridgeImplemented: false,
  signedDownloadImplemented: false,
  malwareScannerImplemented: false,
});
