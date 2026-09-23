/** Presentation of canonical readiness issues only. Never calculates readiness or amounts. */
type Issue = { code: string; severity: string; message: string };
export type SubmissionProfileFacts = {
  statutoryProfileRevision: number;
  taxProfileRevision: number;
  epfEnabled: boolean;
  epfMemberNumber: string | null;
  socsoEnabled: boolean;
  socsoMemberNumber: string | null;
  taxIdentificationNumber: string | null;
};

export function payrollStalePresentation(issues: readonly Issue[], status: string, canCreate: boolean) {
  const stale = issues.filter(issue => issue.code === "STALE_STATUTORY_PROFILE");
  return {
    stale,
    canUpdate: stale.length > 0 && status === "DRAFT" && canCreate,
    guidance: !canCreate
      ? "An authorised payroll user must update this payroll."
      : status !== "DRAFT"
        ? "Payroll must be in Draft before it can be updated. Use the existing authorised workflow."
        : null,
    // Scheme text labels canonical issues; it does not determine whether anything is stale.
    snapshots: stale.map(issue => {
      const scheme = /^(EPF|SOCSO|EIS|LINDUNG24|PCB)\b/.exec(issue.message)?.[1];
      return scheme ? `${scheme} snapshot needs refresh` : "Statutory calculation snapshot needs refresh";
    }),
    other: issues.filter(issue => issue.code !== "STALE_STATUTORY_PROFILE"),
  };
}

export function payrollReadinessPresentation(issues: readonly Issue[], facts: SubmissionProfileFacts | null) {
  const payment = issues.filter(issue => ["MISSING_BANK_ACCOUNT", "BANK_ACCOUNT_UNVERIFIED"].includes(issue.code));
  const profileIssue = issues.find(issue => issue.code === "STATUTORY_PROFILE_INCOMPLETE");
  const submission: string[] = [];
  const setup: string[] = [];
  if (profileIssue && facts) {
    if (facts.epfEnabled && !facts.epfMemberNumber) submission.push("EPF member number is missing.");
    if (facts.socsoEnabled && !facts.socsoMemberNumber) submission.push("SOCSO member number is missing.");
    if (!facts.taxIdentificationNumber) submission.push("Tax identification number is missing.");
    if (facts.statutoryProfileRevision === 0) setup.push("Statutory profile setup needs review.");
    if (facts.taxProfileRevision === 0) setup.push("Tax profile setup needs review.");
  }
  if (profileIssue && !submission.length && !setup.length) setup.push("Review statutory profile and submission details.");
  return {
    payment,
    paymentIsReviewOnly: payment.length > 0 && payment.every(issue => issue.severity === "REVIEW"),
    submission,
    submissionIsReviewOnly: submission.length > 0 && profileIssue?.severity === "REVIEW",
    setup,
    other: issues.filter(issue => !["STALE_STATUTORY_PROFILE", "MISSING_BANK_ACCOUNT", "BANK_ACCOUNT_UNVERIFIED", "STATUTORY_PROFILE_INCOMPLETE"].includes(issue.code)),
  };
}
