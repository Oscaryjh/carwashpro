import { z } from "zod";

export const paymentSchema = z.object({
  workOrderId: z.string().uuid("Work order is required."),
  amount: z.coerce.number().positive("Payment amount must be more than 0."),
  method: z.enum(["CASH", "CARD", "DUITNOW", "EWALLET", "BANK_TRANSFER"]),
  reference: z.string().trim().optional(),
});

export function toCents(value: unknown) {
  return Math.round(Number(value) * 100);
}

export function fromCents(value: number) {
  return (value / 100).toFixed(2);
}

export function makeInvoiceNumber() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const time = `${now.getHours()}${now.getMinutes()}${now.getSeconds()}${now.getMilliseconds()}`
    .padStart(9, "0")
    .slice(0, 9);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();

  return `INV-${date}-${time}-${suffix}`;
}
