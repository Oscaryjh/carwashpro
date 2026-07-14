import { z } from "zod";

export const packageSchema = z.object({
  name: z.string().trim().min(2, "Package name is required."),
  categoryId: z.string().uuid("Please select a valid package category."),
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

export const cashierPackagePurchaseSchema = z
  .object({
    branchId: z.string().uuid("Branch is invalid.").optional().or(z.literal("")),
    method: z.enum(["CASH", "CARD", "DUITNOW", "EWALLET", "BANK_TRANSFER"]),
    packageId: z.string().uuid("Package is required."),
    reference: z.string().trim().max(120, "Reference is too long.").optional(),
    customerId: z.string().uuid("Customer account is required."),
  })
  .superRefine((input, context) => {
    if (input.method !== "CASH" && !input.reference) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reference is required for non-cash payments.",
        path: ["reference"],
      });
    }
  });

export const usePackagePaymentSchema = z.object({
  workOrderId: z.string().uuid("Work order is required."),
  customerPackageId: z.string().uuid("Customer package is required."),
});
