import { z } from "zod";
import { financialOperationKeySchema } from "@/lib/financial-idempotency";

const quantitySchema = z.coerce
  .number()
  .int("Quantity must be a whole number.")
  .min(1, "Quantity must be at least 1.")
  .max(99, "Quantity cannot exceed 99.");

export const cashierSaleSchema = z
  .object({
    operationId: financialOperationKeySchema,
    branchId: z.string().uuid("Branch is invalid.").optional().or(z.literal("")),
    appointmentId: z.string().uuid("Appointment is invalid.").optional().or(z.literal("")),
    assignedStaffId: z.string().uuid("Staff member is invalid.").optional().or(z.literal("")),
    customerId: z.string().uuid("Customer is invalid.").optional().or(z.literal("")),
    method: z.enum(["CASH", "CARD", "DUITNOW", "EWALLET", "BANK_TRANSFER"]),
    packageIds: z.array(z.string().uuid("Package is invalid.")),
    packageQuantities: z.array(quantitySchema),
    productIds: z.array(z.string().uuid("Product is invalid.")),
    productQuantities: z.array(quantitySchema),
    serviceIds: z.array(z.string().uuid("Service is invalid.")).default([]),
    serviceQuantities: z.array(quantitySchema).default([]),
    customerPackageIds: z.array(z.string().uuid("Customer package is invalid.")).default([]),
    reference: z.string().trim().max(120, "Reference is too long.").optional(),
    discountType: z.enum(["AMOUNT", "PERCENT"]).default("AMOUNT"),
    discountValue: z.coerce
      .number()
      .min(0, "Discount cannot be negative.")
      .max(1000000, "Discount is too large.")
      .default(0),
    discountReference: z.string().trim().max(160, "Discount reference is too long.").optional(),
    catalogDiscountId: z.string().uuid("Catalog discount is invalid.").optional().or(z.literal("")),
    loyaltyPoints: z.coerce
      .number()
      .int("Loyalty points must be a whole number.")
      .min(0, "Loyalty points cannot be negative.")
      .max(1000000, "Loyalty points are too large.")
      .default(0),
  })
  .superRefine((input, context) => {
    if (!input.packageIds.length && !input.productIds.length && !input.serviceIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Add at least one product, service, or package.",
        path: ["productIds"],
      });
    }

    if (input.packageIds.length !== input.packageQuantities.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each package must have a quantity.",
        path: ["packageQuantities"],
      });
    }

    if (input.productIds.length !== input.productQuantities.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each product must have a quantity.",
        path: ["productQuantities"],
      });
    }

    if (input.serviceIds.length !== input.serviceQuantities.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each service must have a quantity.",
        path: ["serviceQuantities"],
      });
    }

    if (input.serviceIds.length && !input.appointmentId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Create service visits from Appointments before checkout.",
        path: ["appointmentId"],
      });
    }

    if (input.packageIds.length && !input.customerId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select a customer before selling a package.",
        path: ["customerId"],
      });
    }

    if (input.serviceIds.length && !input.customerId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select a customer before selling a service.",
        path: ["customerId"],
      });
    }

    if (input.serviceIds.length && !input.assignedStaffId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select a staff member for the service.",
        path: ["assignedStaffId"],
      });
    }

    if (input.method !== "CASH" && !input.reference) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reference is required for non-cash payments.",
        path: ["reference"],
      });
    }

    if (input.discountType === "PERCENT" && input.discountValue > 100) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Percentage discount cannot exceed 100%.",
        path: ["discountValue"],
      });
    }

    if ((input.discountValue > 0 || input.catalogDiscountId) && !input.discountReference) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a reference for the discount.",
        path: ["discountReference"],
      });
    }

    if (input.catalogDiscountId && input.discountValue > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Use either a catalog discount or a manual discount.",
        path: ["catalogDiscountId"],
      });
    }

    if (input.loyaltyPoints > 0 && !input.customerId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select a customer before redeeming loyalty points.",
        path: ["customerId"],
      });
    }

    if (input.customerPackageIds.length && !input.customerId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select a customer before using a package.",
        path: ["customerId"],
      });
    }
  });
