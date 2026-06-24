import { z } from "zod";

export const serviceSchema = z.object({
  name: z.string().trim().min(2, "Service name is required."),
  description: z.string().trim().optional(),
  price: z.coerce.number().min(0, "Price must be 0 or more."),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

export function money(value: number) {
  return value.toFixed(2);
}
