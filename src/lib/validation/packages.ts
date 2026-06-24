import { z } from "zod";

export const packageSchema = z.object({
  name: z.string().trim().min(2, "Package name is required."),
  description: z.string().trim().optional(),
  serviceId: z.string().uuid("Linked service is invalid.").optional().or(z.literal("")),
  price: z.coerce.number().positive("Package price must be more than 0."),
  totalUses: z.coerce
    .number()
    .int("Total uses must be a whole number.")
    .min(1, "Total uses must be at least 1.")
    .default(10),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

export const purchasePackageSchema = z.object({
  customerId: z.string().uuid("Customer is required."),
  packageId: z.string().uuid("Package is required."),
});

export const usePackagePaymentSchema = z.object({
  workOrderId: z.string().uuid("Work order is required."),
  customerPackageId: z.string().uuid("Customer package is required."),
});
