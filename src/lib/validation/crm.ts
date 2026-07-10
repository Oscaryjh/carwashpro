import { z } from "zod";

export function normalizeCustomerPhone(value: string) {
  const digits = value.trim().replace(/[^\d]/g, "");

  if (digits.startsWith("60") && digits.length > 9) {
    return `0${digits.slice(2)}`;
  }

  if (digits.startsWith("1") && digits.length >= 8) {
    return `0${digits}`;
  }

  return digits;
}

export function customerPhoneSearchVariants(value: string) {
  const digits = value.trim().replace(/[^\d]/g, "");
  const normalized = normalizeCustomerPhone(value);
  const variants = new Set<string>();

  if (digits) {
    variants.add(digits);
  }

  if (normalized) {
    variants.add(normalized);
  }

  if (normalized.startsWith("0")) {
    variants.add(`60${normalized.slice(1)}`);
  }

  if (digits.startsWith("60") && digits.length > 9) {
    variants.add(`0${digits.slice(2)}`);
  }

  if (digits.startsWith("1") && digits.length >= 8) {
    variants.add(`60${digits}`);
    variants.add(`0${digits}`);
  }

  return [...variants];
}

export const customerSchema = z.object({
  name: z.string().trim().min(2, "Customer name is required."),
  phone: z
    .string()
    .trim()
    .min(7, "Phone is required.")
    .max(20, "Phone is too long.")
    .regex(/^[0-9]+$/, "Phone can only contain numbers.")
    .transform(normalizeCustomerPhone),
  email: z.string().trim().email("Enter a valid email.").optional().or(z.literal("")),
  notes: z.string().trim().optional(),
});

export const vehicleSchema = z.object({
  customerId: z.string().uuid("Customer is required."),
  plateNumber: z.string().trim().min(2, "Plate number is required."),
  brand: z.string().trim().optional(),
  model: z.string().trim().optional(),
  color: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export const customerVehicleSchema = vehicleSchema.omit({ customerId: true });

export function normalizePlateNumber(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}
