export type StaffCommissionStatus = "CALCULATED" | "APPROVED" | "APPLIED_TO_PAYROLL";
export type StaffCommissionSourceType = "SERVICE" | "PRODUCT" | "PACKAGE_PURCHASE" | "PACKAGE_REDEMPTION";
export type StaffCommissionAdjustmentType = "REFUND" | "VOID" | "MANUAL_CORRECTION";

export function commissionStatusPresentation(status: StaffCommissionStatus) {
  if (status === "CALCULATED") return { label: "Awaiting review", tone: "warning" as const };
  if (status === "APPROVED") return { label: "Approved", tone: "success" as const };
  return { label: "Added to payroll", tone: "info" as const };
}

export function sourceTypeLabel(type: StaffCommissionSourceType) {
  if (type === "SERVICE") return "Service";
  if (type === "PRODUCT") return "Product";
  if (type === "PACKAGE_PURCHASE") return "Package purchase";
  return "Package redemption";
}

export function commissionItemName(name: string | null | undefined, type: StaffCommissionSourceType) {
  return name?.trim() || `${sourceTypeLabel(type)} (name not recorded)`;
}

/** Only display facts frozen by the calculation engine, never infer a rate from totals.
 * Return an allowlisted presentation object, not the internal calculation trace.
 */
export function commissionCalculationDetails(value: unknown): { rateLabel: string; basisLabel: string | null } {
  const trace = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  let rateLabel = "Not recorded";
  const rate = trace.appliedRateBasisPoints;
  const fixed = trace.fixedAmountCents;
  if ((trace.ruleType === "PERCENTAGE" || trace.ruleType === "TIERED_PERCENTAGE")
    && typeof rate === "number" && Number.isSafeInteger(rate) && rate >= 0 && rate <= 10_000) {
    rateLabel = `${rate / 100}%${trace.ruleType === "TIERED_PERCENTAGE" ? " (tiered)" : ""}`;
  } else if (trace.ruleType === "FIXED_AMOUNT" && typeof fixed === "number"
    && Number.isSafeInteger(fixed) && fixed >= 0 && fixed <= 100_000_000) {
    rateLabel = `${formatCommissionMoney(fixed)} per unit`;
  }
  const basisLabel = trace.basisOverride === "TRAINING_COMPLIMENTARY_GROSS"
    ? "Original gross amount (training / complimentary)"
    : trace.basis === "GROSS" ? "Gross amount"
      : trace.basis === "NET_AFTER_DISCOUNT" ? "Net after discount" : null;
  return { rateLabel, basisLabel };
}

export function adjustmentTypeLabel(type: StaffCommissionAdjustmentType) {
  if (type === "REFUND") return "Refund adjustment";
  if (type === "VOID") return "Void adjustment";
  return "Correction";
}

export function employeeSafeAdjustmentReason(type: StaffCommissionAdjustmentType, reason: string) {
  if (type === "MANUAL_CORRECTION") return reason;
  if (type === "REFUND") return "A refunded source was adjusted in this statement.";
  return "A voided source was adjusted in this statement.";
}

export function formatCommissionPeriod(start: Date, end: Date) {
  const startParts = utcDateParts(start);
  const endParts = utcDateParts(end);
  const lastDay = new Date(Date.UTC(startParts.year, startParts.month, 0)).getUTCDate();
  const fullMonth = startParts.year === endParts.year
    && startParts.month === endParts.month
    && startParts.day === 1
    && endParts.day === lastDay;
  if (fullMonth) {
    return new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric", timeZone: "UTC" }).format(start);
  }
  if (startParts.year === endParts.year) {
    return `${formatCommissionDayMonth(start)} – ${formatCommissionDate(end)}`;
  }
  return `${formatCommissionDate(start)} – ${formatCommissionDate(end)}`;
}

function utcDateParts(value: Date) {
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

export function formatCommissionDayMonth(value: Date) {
  return new Intl.DateTimeFormat("en-MY", { day: "2-digit", month: "short", timeZone: "UTC" }).format(value);
}

export function formatCommissionDate(value: Date) {
  return new Intl.DateTimeFormat("en-MY", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(value);
}

export function formatCommissionMoney(valueCents: number) {
  return new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(valueCents / 100);
}

export function formatSignedCommissionMoney(valueCents: number) {
  const absolute = formatCommissionMoney(Math.abs(valueCents));
  return valueCents > 0 ? `+${absolute}` : valueCents < 0 ? `−${absolute}` : absolute;
}
