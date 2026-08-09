import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().max(254).email("Enter a valid email."),
  password: z.string().min(1, "Password is required.").max(256),
});
