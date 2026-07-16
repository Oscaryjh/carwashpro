import { z } from "zod";

const paymentMethodSchema = z.enum(["CASH", "CARD", "DUITNOW", "EWALLET", "BANK_TRANSFER"]);

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
    workOrderId: z.string().uuid("Work order is required."),
    amount: z.coerce.number().positive("Payment amount must be more than 0."),
    method: paymentMethodSchema,
    reference: z.string().trim().optional(),
  })
  .superRefine(requireReferenceForNonCash);

export const packagePurchasePaymentSchema = z
  .object({
    customerPackageId: z.string().uuid("Customer package is required."),
    amount: z.coerce.number().positive("Payment amount must be more than 0."),
    method: paymentMethodSchema,
    reference: z.string().trim().optional(),
  })
  .superRefine(requireReferenceForNonCash);

export const salonAppointmentPaymentSchema = z
  .object({
    appointmentId: z.string().uuid("Appointment is required."),
    amount: z.coerce.number().positive("Payment amount must be more than 0."),
    method: paymentMethodSchema,
    reference: z.string().trim().optional(),
  })
  .superRefine(requireReferenceForNonCash);

export function toCents(value: unknown) {
  return Math.round(Number(value) * 100);
}

export function fromCents(value: number) {
  return (value / 100).toFixed(2);
}
