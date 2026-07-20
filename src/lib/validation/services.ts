import { z } from "zod";

export const serviceSchema = z.object({
  name: z.string().trim().min(2, "Service name is required."),
  categoryId: z.string().uuid("Please select a valid category."),
  category: z.string().trim().optional(),
  description: z.string().trim().optional(),
  price: z.coerce.number().min(0, "Price must be 0 or more."),
  taxable: z.boolean().default(true),
  taxRate: z.preprocess(
    (value) => (value === "" || value == null ? undefined : value),
    z.coerce.number().min(0, "Tax rate cannot be negative.").max(100, "Tax rate cannot exceed 100.").optional(),
  ),
  durationMinutes: z.preprocess(
    (value) => (value === "" || value == null ? undefined : value),
    z.coerce
      .number()
      .int("Duration must be a whole number of minutes.")
      .min(5, "Duration must be at least 5 minutes.")
      .max(720, "Duration cannot exceed 12 hours.")
      .optional(),
  ),
  staffIds: z.array(z.string().uuid()).default([]),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

export function money(value: number) {
  return value.toFixed(2);
}
