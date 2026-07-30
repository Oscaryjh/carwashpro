import { z } from "zod";

const groupCodePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const businessGroupSchema = z.object({
  name: z.string().trim().min(2, "Group name must be at least 2 characters.").max(120),
  code: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, "Group code must be at least 2 characters.")
    .max(64)
    .regex(groupCodePattern, "Use lowercase letters, numbers, and hyphens only."),
});

export const businessGroupMembershipSchema = z.object({
  groupId: z.string().uuid(),
  businessId: z.string().uuid(),
});

export const businessGroupUserSchema = z
  .object({
    groupId: z.string().uuid(),
    userId: z.string().uuid(),
    role: z.enum(["GROUP_OWNER", "GROUP_MANAGER"]),
    businessIds: z.array(z.string().uuid()).default([]),
  })
  .superRefine((value, context) => {
    if (value.role === "GROUP_MANAGER" && value.businessIds.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["businessIds"],
        message: "Select at least one group business for a group manager.",
      });
    }
  });

export const businessGroupAccountSchema = z
  .object({
    groupId: z.string().uuid(),
    name: z.string().trim().min(2, "Name must be at least 2 characters.").max(120),
    email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters.")
      .max(72, "Password must be 72 characters or fewer."),
    confirmPassword: z.string(),
    role: z.enum(["GROUP_OWNER", "GROUP_MANAGER"]),
    businessIds: z.array(z.string().uuid()).default([]),
  })
  .superRefine((value, context) => {
    if (value.password !== value.confirmPassword) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmPassword"],
        message: "Passwords do not match.",
      });
    }

    if (value.role === "GROUP_MANAGER" && value.businessIds.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["businessIds"],
        message: "Select at least one group business for a group manager.",
      });
    }
  });

export const businessGroupAccountUpdateSchema = z
  .object({
    groupId: z.string().uuid(),
    groupUserId: z.string().uuid(),
    name: z.string().trim().min(2, "Name must be at least 2 characters.").max(120),
    email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
    password: z.string().max(72, "Password must be 72 characters or fewer.").default(""),
    confirmPassword: z.string().default(""),
  })
  .superRefine((value, context) => {
    if (value.password && value.password.length < 8) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["password"],
        message: "Password must be at least 8 characters.",
      });
    }

    if (value.password !== value.confirmPassword) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmPassword"],
        message: "Passwords do not match.",
      });
    }
  });

export function uniqueIds(values: Iterable<string>) {
  return Array.from(new Set(values));
}
