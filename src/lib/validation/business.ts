import { z } from "zod";

const businessIndustrySchema = z.enum([
  "AUTO_DETAILING",
  "SALON_BEAUTY",
  "PET_GROOMING",
  "DEVICE_REPAIR",
  "BICYCLE_REPAIR",
  "SHOE_CLEANING",
  "LAUNDRY",
  "WATCH_REPAIR",
  "GENERAL_SERVICE",
]);

const businessFieldsSchema = z.object({
  name: z.string().trim().min(2, "Company name is required."),
  slug: z
    .string()
    .trim()
    .min(2, "Company slug is required.")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Use lowercase letters, numbers, and single hyphens.",
    ),
  companyNo: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().email("Enter a valid email.").optional().or(z.literal("")),
  address: z.string().trim().optional(),
  sstEnabled: z.boolean(),
  sstLabel: z.string().trim().min(1, "Tax label is required.").max(30),
  sstRate: z.coerce.number().min(0, "Tax rate cannot be negative.").max(100, "Tax rate cannot exceed 100."),
  sstRegistrationNo: z.string().trim().max(80).optional(),
  status: z.enum(["active", "inactive"]),
});

export const businessSchema = businessFieldsSchema.superRefine((business, context) => {
  if (business.sstEnabled && !business.sstRegistrationNo) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "SST registration number is required when SST is enabled.",
      path: ["sstRegistrationNo"],
    });
  }
});

export type BusinessFormValues = z.infer<typeof businessSchema>;

export const createBusinessSchema = z.object({
  name: businessFieldsSchema.shape.name,
  slug: businessFieldsSchema.shape.slug,
  industryType: businessIndustrySchema,
  companyNo: businessFieldsSchema.shape.companyNo,
  phone: businessFieldsSchema.shape.phone,
  ownerName: z.string().trim().min(2, "Owner name is required."),
  ownerEmail: z.string().trim().email("Enter a valid owner email."),
  ownerPassword: z.string().min(8, "Owner password must be at least 8 characters."),
});

export const adminResetUserPasswordSchema = z.object({
  businessId: z.string().uuid("Business id is required."),
  userId: z.string().uuid("User id is required."),
  newPassword: z.string().min(8, "New password must be at least 8 characters."),
});

export const adminUpdateUserEmailSchema = z.object({
  businessId: z.string().uuid("Business id is required."),
  userId: z.string().uuid("User id is required."),
  email: z.string().trim().email("Enter a valid login email."),
});
