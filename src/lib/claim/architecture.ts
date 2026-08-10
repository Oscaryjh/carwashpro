export const CLAIM_ARCHITECTURE_POLICY = Object.freeze({
  structure: "HEADER_WITH_ITEMS",
  reimbursementMode: "SEPARATE_REIMBURSEMENT",
  payrollEligibility: "VERIFIED_NON_WAGE_ONLY",
  approvalStages: [
    "EMPLOYEE_SUBMIT",
    "MANAGER_REVIEW",
    "FINANCE_VERIFICATION",
  ] as const,
  approvedMeansPaid: false,
  paymentAvailable: true,
  bankFileAvailable: false,
  payrollEntryAllowanceIsClaimLedger: false,
});

export const CLAIM_C0_BOUNDARY = Object.freeze({
  domainWorkflowImplemented: true,
  staffUiImplemented: true,
  managerQueueImplemented: true,
  financeWorkspaceImplemented: true,
  payrollBridgeImplemented: true,
  signedDownloadImplemented: true,
  malwareScannerImplemented: false,
  s3CompatiblePrivateStorageImplemented: true,
});
