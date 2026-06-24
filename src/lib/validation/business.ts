import { z } from "zod";

export const businessSchema = z.object({
  name: z.string().trim().min(2, "Business name is required."),
  slug: z
    .string()
    .trim()
    .min(2, "Business slug is required.")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Use lowercase letters, numbers, and single hyphens.",
    ),
  phone: z.string().trim().optional(),
  email: z.string().trim().email("Enter a valid email.").optional().or(z.literal("")),
  address: z.string().trim().optional(),
  status: z.enum(["active", "inactive"]),
});

export type BusinessFormValues = z.infer<typeof businessSchema>;

export const createBusinessSchema = z.object({
  name: businessSchema.shape.name,
  slug: businessSchema.shape.slug,
  phone: businessSchema.shape.phone,
  ownerName: z.string().trim().min(2, "Owner name is required."),
  ownerEmail: z.string().trim().email("Enter a valid owner email."),
  ownerPassword: z.string().min(8, "Owner password must be at least 8 characters."),
});
