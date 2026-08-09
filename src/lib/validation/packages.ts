import { z } from "zod";
import { financialOperationKeySchema } from "@/lib/financial-idempotency";

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

export const packageServiceBenefitsSchema = z
  .array(
    z.object({
      serviceId: z.string().uuid("Select a valid service."),
      totalUses: z.coerce
        .number()
        .int("Service uses must be a whole number.")
        .min(1, "Service uses must be at least 1.")
        .max(999, "Service uses cannot exceed 999."),
    }),
  )
  .min(1, "Add at least one service to this package.")
  .superRefine((benefits, context) => {
    const seen = new Set<string>();
    benefits.forEach((benefit, index) => {
      if (seen.has(benefit.serviceId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "The same service can only be added once.",
          path: [index, "serviceId"],
        });
      }
      seen.add(benefit.serviceId);
    });
  });

export const purchasePackageSchema = z.object({
  customerId: z.string().uuid("Customer is required."),
  packageId: z.string().uuid("Package is required."),
});

export const cashierPackagePurchaseSchema = z
  .object({
    operationId: financialOperationKeySchema,
    branchId: z.string().uuid("Branch is invalid.").optional().or(z.literal("")),
    method: z.enum(["CASH", "CARD", "DUITNOW", "EWALLET", "BANK_TRANSFER"]),
    packageIds: z
      .array(z.string().uuid("Package is invalid."))
      .min(1, "Select at least one package."),
    quantities: z
      .array(
        z.coerce
          .number()
          .int("Quantity must be a whole number.")
          .min(1, "Quantity must be at least 1.")
          .max(99, "Quantity cannot exceed 99."),
      )
      .min(1, "Quantity must be at least 1."),
    reference: z.string().trim().max(120, "Reference is too long.").optional(),
    customerId: z.string().uuid("Customer account is required."),
  })
  .superRefine((input, context) => {
    if (input.packageIds.length !== input.quantities.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each package must have a quantity.",
        path: ["quantities"],
      });
    }

    if (input.method !== "CASH" && !input.reference) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reference is required for non-cash payments.",
        path: ["reference"],
      });
    }
  });

export const usePackagePaymentSchema = z.object({
  operationId: financialOperationKeySchema,
  workOrderId: z.string().uuid("Work order is required."),
  customerPackageId: z.string().uuid("Customer package is required."),
});
