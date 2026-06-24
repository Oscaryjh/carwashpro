import { z } from "zod";

export const customerSchema = z.object({
  name: z.string().trim().min(2, "Customer name is required."),
  phone: z.string().trim().min(5, "Phone is required."),
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

export function normalizePlateNumber(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}
