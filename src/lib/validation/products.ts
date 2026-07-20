import { z } from "zod";

const optionalMoney = z.preprocess(
  (value) => (value === "" || value == null ? undefined : value),
  z.coerce.number().finite().min(0).optional(),
);

export const productSchema = z.object({
  name: z.string().trim().min(1, "Product name is required.").max(120),
  sku: z.string().trim().max(60, "SKU is too long.").optional(),
  categoryId: z.string().uuid("Please select a product category."),
  description: z.string().trim().max(500, "Description is too long.").optional(),
  price: z.coerce.number().finite().min(0, "Price cannot be negative."),
  costPrice: optionalMoney,
  taxable: z.boolean().default(false),
  taxRate: optionalMoney,
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

export const productSaleSchema = z
  .object({
    branchId: z.string().uuid("Branch is invalid.").optional().or(z.literal("")),
    customerId: z.string().uuid("Customer is invalid.").optional().or(z.literal("")),
    method: z.enum(["CASH", "CARD", "DUITNOW", "EWALLET", "BANK_TRANSFER"]),
    productIds: z.array(z.string().uuid("Product is invalid.")).min(1, "Select at least one product."),
    quantities: z.array(
      z.coerce
        .number()
        .int("Quantity must be a whole number.")
        .min(1, "Quantity must be at least 1."),
    ).min(1, "Quantity must be at least 1."),
    reference: z.string().trim().max(120, "Reference is too long.").optional(),
  })
  .superRefine((input, context) => {
    if (input.productIds.length !== input.quantities.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each product must have a quantity.",
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
