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
    .min(1, "Phone is required.")
    .regex(
      /^[0-9+()\-\s]+$/,
      "Phone can only contain numbers and common separators.",
    )
    .transform(normalizeCustomerPhone)
    .pipe(
      z
        .string()
        .min(7, "Phone is required.")
        .max(20, "Phone is too long."),
    ),
  email: z.string().trim().email("Enter a valid email.").optional().or(z.literal("")),
  dateOfBirth: z
    .string()
    .trim()
    .refine(
      (value) => !value || isValidDateInput(value),
      "Enter a valid date of birth.",
    )
    .refine(
      (value) => !value || new Date(`${value}T00:00:00.000Z`) <= new Date(),
      "Date of birth cannot be in the future.",
    )
    .optional()
    .or(z.literal("")),
  notes: z.string().trim().optional(),
});

function isValidDateInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseDateOfBirth(value?: string) {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

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
