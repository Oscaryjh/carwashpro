import { z } from "zod";

const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const moneyText = z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/, "Use a positive MYR amount with up to 2 decimals.");

export const claimLineInputSchema = z.object({
  lineNumber: z.coerce.number().int().min(1).max(20),
  categoryId: z.string().uuid(),
  expenseDate: dateText,
  merchant: z.string().trim().max(160).optional().nullable(),
  description: z.string().trim().min(3).max(500),
  amount: moneyText,
  mileageKm: z.union([z.string(), z.number()]).optional().nullable(),
});

export const submitClaimInputSchema = z.object({
  clientRequestId: z.string().uuid(),
  purpose: z.string().trim().min(3).max(500),
  currency: z.literal("MYR").default("MYR"),
  lines: z.array(claimLineInputSchema).min(1).max(20),
}).superRefine((value, context) => {
  if (new Set(value.lines.map((line) => line.lineNumber)).size !== value.lines.length) {
    context.addIssue({ code: "custom", path: ["lines"], message: "Claim line numbers must be unique." });
  }
});

export const withdrawClaimInputSchema = z.object({
  claimId: z.string().uuid(),
  expectedRevision: z.coerce.number().int().min(1),
  reason: z.string().trim().min(3).max(500),
});

export const cancelApprovedClaimInputSchema = z.object({
  claimId: z.string().uuid(),
  expectedRevision: z.coerce.number().int().min(2),
  reason: z.string().trim().min(5).max(500),
});

export const reviewClaimInputSchema = z.object({
  claimId: z.string().uuid(),
  expectedRevision: z.coerce.number().int().min(1),
  reason: z.string().trim().max(500).optional().nullable(),
  lines: z.array(z.object({
    lineId: z.string().uuid(),
    approvedAmount: z.union([moneyText, z.literal("0")]),
    reason: z.string().trim().max(500).optional().nullable(),
  })).min(1).max(20),
});

export const claimCategoryRevisionInputSchema = z.object({
  categoryId: z.string().uuid().optional().nullable(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,40}$/).optional().nullable(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  nature: z.enum(["GENERAL", "MILEAGE"]),
  effectiveFrom: dateText,
  receiptRequired: z.boolean(),
  descriptionRequired: z.boolean(),
  maxLineAmount: z.union([moneyText, z.literal("")]).optional().nullable(),
  mileageRatePerKm: z.union([z.string(), z.number()]).optional().nullable(),
  statutoryTreatmentStatus: z.enum(["VERIFIED_NON_WAGE", "REVIEW_REQUIRED"]).default("REVIEW_REQUIRED"),
  reason: z.string().trim().max(500).optional().nullable(),
}).superRefine((value, context) => {
  if (value.categoryId && !value.reason?.trim()) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Tell us why this policy is changing." });
  }
});

export const selectReimbursementChannelInputSchema = z.object({
  reimbursementId: z.string().uuid(),
  expectedRevision: z.coerce.number().int().min(0),
  operationKey: z.string().uuid(),
  channel: z.enum(["OUTSIDE_PAYROLL", "PAYROLL"]),
  payrollRunId: z.string().uuid().optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

export const markOutsidePayrollPaidInputSchema = z.object({
  reimbursementId: z.string().uuid(),
  expectedRevision: z.coerce.number().int().min(1),
  operationKey: z.string().uuid(),
  paymentReference: z.string().trim().min(2).max(120),
  note: z.string().trim().max(500).optional().nullable(),
});

export const reevaluateClaimPayrollTreatmentInputSchema = z.object({
  reimbursementId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  expectedSourceDigest: z.string().regex(/^[a-f0-9]{64}$/i),
});

export function parseMoneyCents(value: string | number) {
  const text = String(value).trim();
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(text)) throw new Error("Enter a valid MYR amount.");
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error("Claim amount must be greater than zero.");
  return cents;
}

export function parseNonNegativeMoneyCents(value: string | number) {
  if (String(value).trim() === "0") return 0;
  return parseMoneyCents(value);
}

export function parseClaimDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Claim expense date is invalid.");
  }
  return date;
}

export function centsToMoney(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("Claim amount is outside the supported range.");
  return (cents / 100).toFixed(2);
}

export function moneyToCents(value: { toString(): string }) {
  const text = value.toString();
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("Claim amount is outside the supported range.");
  return cents;
}

export function duplicateFingerprint(input: {
  membershipId: string;
  categoryId: string;
  expenseDate: string;
  amountCents: number;
}) {
  return `${input.membershipId}:${input.categoryId}:${input.expenseDate}:${input.amountCents}`;
}
