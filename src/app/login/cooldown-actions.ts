"use server";

import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validation/login";
import { assertServerActionSameOrigin, authSecurityHashes, checkPasswordLoginRateLimit, getAuthRequestContext } from "@/lib/auth/security";

// Public login status only: no account lookup, credentials, or event writes.
export async function getLoginCooldown(email: string) {
  const parsed = loginSchema.shape.email.safeParse(email);
  if (!parsed.success) throw new Error("Invalid login identifier");
  const requestHeaders = await headers();
  assertServerActionSameOrigin(requestHeaders);
  const request = getAuthRequestContext(requestHeaders);
  const hashes = authSecurityHashes({ identifier: parsed.data.trim().toLowerCase(), ...request });
  const now = new Date();
  const limit = await checkPasswordLoginRateLimit({ ...hashes, now }, prisma);
  return { serverNow: now.getTime(), retryAt: limit.retryAt?.getTime() ?? null };
}
