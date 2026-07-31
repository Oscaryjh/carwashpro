const PUBLIC_PAYROLL_ERROR_PREFIXES = [
  "Select a valid payroll month.",
  "This payroll month is finalized and cannot be regenerated.",
  "The editable payroll entry was not found.",
  "The payroll draft is empty or no longer editable.",
  "Payroll requires authorized access to every active branch.",
  "The selected branch is outside your payroll scope.",
  "The public holiday was not found in your payroll scope.",
  "Enter a valid non-negative RM amount with up to 2 decimals.",
  "Date of birth and statutory nationality are required",
  "Select the employee's SOCSO contribution category.",
  "Date of birth must be in the past.",
  "The employee was not found in your payroll scope.",
] as const;

const INTERNAL_ERROR_PATTERN =
  /prisma|invocation|database|column\s+[`"']|\bsql\b|stack trace/i;

export function getPublicPayrollErrorMessage(
  error: unknown,
  fallback: string,
) {
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
