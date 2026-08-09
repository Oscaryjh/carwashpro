import { z } from "zod";
import { financialOperationKeySchema } from "@/lib/financial-idempotency";

const paymentMethodSchema = z.enum(["CASH", "CARD", "DUITNOW", "EWALLET", "BANK_TRANSFER"]);

const optionalReferenceSchema = z.preprocess(
  (value) => (value === null ? undefined : value),
  z.string().trim().optional(),
);

const optionalMoney = z.preprocess(
  (value) => (value === null || value === undefined || value === "" ? 0 : value),
  z.coerce.number().min(0, "Amount cannot be negative."),
);

function requireReferenceForNonCash<T extends { method: string; reference?: string }>(
  input: T,
  context: z.RefinementCtx,
) {
  if (input.method !== "CASH" && !input.reference?.trim()) {
    context.addIssue({
      code: "custom",
      message: "Reference is required for non-cash payments.",
      path: ["reference"],
    });
  }
}

export const paymentSchema = z
  .object({
    operationId: financialOperationKeySchema,
    workOrderId: z.string().uuid("Work order is required."),
    amount: z.coerce.number().positive("Payment amount must be more than 0."),
    method: paymentMethodSchema,
    reference: optionalReferenceSchema,
  })
  .superRefine(requireReferenceForNonCash);

export const packagePurchasePaymentSchema = z
  .object({
    operationId: financialOperationKeySchema,
    customerPackageId: z.string().uuid("Customer package is required."),
    amount: z.coerce.number().positive("Payment amount must be more than 0."),
    method: paymentMethodSchema,
    reference: optionalReferenceSchema,
  })
  .superRefine(requireReferenceForNonCash);

export const salonAppointmentPaymentSchema = z
  .object({
    operationId: financialOperationKeySchema,
    appointmentId: z.string().uuid("Appointment is required."),
    amount: optionalMoney,
    method: paymentMethodSchema,
    reference: optionalReferenceSchema,
    discountAmount: optionalMoney,
    catalogDiscountId: z.string().uuid("Catalog discount is invalid.").optional().or(z.literal("")),
    discountReference: z.string().trim().max(160, "Discount reference is too long.").optional(),
    depositAmount: optionalMoney,
    depositMethod: paymentMethodSchema.default("CASH"),
    depositReference: optionalReferenceSchema,
    tipAmount: optionalMoney,
    customerPackageIds: z.array(z.string().uuid("Customer package is invalid.")).default([]),
  })
  .superRefine((input, context) => {
    if (input.catalogDiscountId && input.discountAmount > 0) {
      context.addIssue({
        code: "custom",
        message: "Use either a catalog discount or a manual discount.",
        path: ["catalogDiscountId"],
      });
    }
    if (input.catalogDiscountId && !input.discountReference) {
      context.addIssue({
        code: "custom",
        message: "Enter a reference for the catalog discount.",
        path: ["discountReference"],
      });
    }
    if (input.amount <= 0 && input.depositAmount <= 0 && input.customerPackageIds.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Enter a payment amount or deposit amount.",
        path: ["amount"],
      });
    }

    if (input.amount > 0) {
      requireReferenceForNonCash(input, context);
    }

    if (input.depositAmount > 0 && input.depositMethod !== "CASH" && !input.depositReference?.trim()) {
      context.addIssue({
        code: "custom",
        message: "Reference is required for non-cash deposits.",
        path: ["depositReference"],
      });
    }
  });

export function toCents(value: unknown) {
  return Math.round(Number(value) * 100);
}

export function fromCents(value: number) {
  return (value / 100).toFixed(2);
}

export function sumMoneyAmounts(values: readonly unknown[]) {
  return values.reduce<number>((total, value) => total + Number(value), 0);
}
