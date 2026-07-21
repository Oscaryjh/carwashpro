import { z } from "zod";

const optionalMoney = z.preprocess(
  (value) => (value === "" || value == null ? undefined : value),
  z.coerce.number().min(0, "Amount cannot be negative.").max(1000000, "Amount is too large.").optional(),
);

const optionalPercentage = z.preprocess(
  (value) => (value === "" || value == null ? undefined : value),
  z.coerce.number().gt(0, "Discount must be more than 0%.").max(100, "Discount cannot exceed 100%.").optional(),
);

const optionalPositiveMoney = z.preprocess(
  (value) => (value === "" || value == null ? undefined : value),
  z.coerce.number().gt(0, "Discount amount must be more than RM0.").max(1000000, "Amount is too large.").optional(),
);

const optionalDate = z.preprocess(
  (value) => (value === "" || value == null ? undefined : value),
  z.coerce.date().optional(),
);

export const catalogDiscountSchema = z
  .object({
    name: z.string().trim().min(1, "Discount name is required.").max(80, "Discount name is too long."),
    discountType: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]),
    percentage: optionalPercentage,
    fixedAmount: optionalPositiveMoney,
    scope: z.enum(["ALL", "SERVICES", "PRODUCTS", "PACKAGES"]),
    branchId: z.string().uuid("Branch is invalid.").optional().or(z.literal("")),
    minimumSpend: optionalMoney.default(0),
    maximumDiscount: optionalMoney,
    allowLoyaltyStacking: z.coerce.boolean().default(false),
    startsAt: optionalDate,
    endsAt: optionalDate,
    active: z.coerce.boolean().default(true),
  })
  .superRefine((input, context) => {
    if (input.discountType === "PERCENTAGE" && input.percentage == null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Discount percentage is required.",
        path: ["percentage"],
      });
    }
    if (input.discountType === "FIXED_AMOUNT" && input.fixedAmount == null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Discount amount is required.",
        path: ["fixedAmount"],
      });
    }
    if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End date must be after the start date.",
        path: ["endsAt"],
      });
    }
  });
