const PUBLIC_PAYROLL_ERROR_PREFIXES = [
  "Select a valid payroll month.",
  "This payroll month is finalized and cannot be regenerated.",
  "Payroll awaiting review or already finalized cannot be regenerated.",
  "Lock the monthly Attendance Timesheet before creating or refreshing Payroll.",
  "Attendance has a newer locked Timesheet revision.",
  "The editable payroll entry was not found.",
  "Payroll entry changed after this page was loaded.",
  "Payroll component editing requires compensation access.",
  "The manual payroll adjustment was not found.",
  "Enter a valid positive RM amount with up to 2 decimals.",
  "Manual adjustment amount must be greater than zero.",
  "Adjustment description must be 2 to 120 characters.",
  "Adjustment reason must be 5 to 500 characters.",
  "Removal reason must be 5 to 500 characters.",
  "PAYROLL_COMPONENT_RECONCILIATION_FAILED",
  "MID_PERIOD_PRORATION_NOT_READY",
  "The payroll draft is empty or no longer editable.",
  "Payroll run not found.",
  "Only an editable payroll draft can be submitted for review.",
  "Only payroll awaiting review can be returned to draft.",
  "Payroll must be submitted for review before it can be finalized.",
  "Only a finalized payroll run can be reopened.",
  "Payroll with a statutory export or correction record cannot be reopened directly.",
  "An empty payroll draft cannot be submitted for review.",
  "An empty payroll run cannot be finalized.",
  "Payroll requires authorized access to every active branch.",
  "The selected branch is outside your payroll scope.",
  "The public holiday was not found in your payroll scope.",
  "Enter a valid non-negative RM amount with up to 2 decimals.",
  "Date of birth and statutory nationality are required",
  "Select the employee's SOCSO contribution category.",
  "Date of birth must be in the past.",
  "The employee was not found in your payroll scope.",
  "Statutory submission record was not found.",
  "Rejected statutory submission was not found.",
  "Legacy unverified submissions cannot create an artifact-backed correction revision.",
  "A newer statutory correction revision already exists.",
  "Only an artifact-backed statutory revision can advance submission status.",
  "Only the latest statutory revision can change status.",
  "Only finalized payroll can update statutory submissions.",
  "Only finalized payroll can produce official submission files.",
  "This statutory submission status change is not allowed.",
  "Enter a rejection reason of at least 5 characters.",
  "Enter the portal submission reference.",
  "Complete the company statutory registration profile.",
  "KWSP employer number is required.",
  "PERKESO employer code must contain exactly 12 letters or digits.",
  "LHDN HQ employer number must contain exactly 10 digits.",
  "LHDN employer number must contain exactly 10 digits.",
  "Identity type and number are required.",
  "New IC must contain exactly 12 digits.",
  "KWSP member number is required.",
  "SOCSO/identity number must be 1 to 12 letters or digits.",
  "Tax Identification Number must contain exactly 11 digits.",
  "Passport holders require a 2-letter LHDN country code.",
  "Employee code must be 1 to 10 letters or digits for CP39.",
] as const;

const INTERNAL_ERROR_PATTERN =
  /prisma|invocation|database|column\s+[`"']|\bsql\b|stack trace/i;

export function getPublicPayrollErrorMessage(
  error: unknown,
  fallback: string,
) {
  const mfaMessage = publicPayrollMfaError(error);
  if (mfaMessage) return mfaMessage;
  if (!(error instanceof Error)) return fallback;
  return PUBLIC_PAYROLL_ERROR_PREFIXES.some((prefix) =>
    error.message.startsWith(prefix),
  )
    ? error.message
    : fallback;
}

export function sanitizePayrollNotice(
  message: string | undefined,
  type: string | undefined,
) {
  const value = message?.trim();
  if (!value) return null;

  if (INTERNAL_ERROR_PATTERN.test(value)) {
    return type === "error"
      ? "Payroll could not be completed. Please refresh and try again."
      : null;
  }

  return value.slice(0, 180);
}
import { publicPayrollMfaError } from "@/lib/payroll/high-risk-mfa";
