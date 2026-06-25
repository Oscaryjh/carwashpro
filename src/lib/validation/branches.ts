import { z } from "zod";

export const branchSchema = z.object({
  name: z.string().trim().min(2, "Branch name is required."),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});
