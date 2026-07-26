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

export function uniqueIds(values: Iterable<string>) {
  return Array.from(new Set(values));
}
