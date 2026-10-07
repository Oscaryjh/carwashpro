import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveBusinessAccess } from "@/lib/business-groups/business-access";
import { isBusinessModuleEnabled } from "@/lib/modules/entitlements";
import type { PackageHubContext } from "./hub-types";

const contextSchema = z.object({ businessId: z.string().uuid(), user: z.object({ userId: z.string().uuid() }), branchId: z.string().uuid().nullish() });
export async function resolvePackageHubScope(context: PackageHubContext, tx: Prisma.TransactionClient = prisma) {
  const ctx = contextSchema.parse(context);
  const access = await resolveBusinessAccess({ userId: ctx.user.userId, requestedBusinessId: ctx.businessId }, tx);
  if (!access.granted || access.businessId !== ctx.businessId || access.effectiveBusinessRole !== "BUSINESS_OWNER"
    || !await isBusinessModuleEnabled(ctx.businessId, "POS", { database: tx })) throw new Error("Package Hub access denied.");
  const branchId = ctx.branchId ?? null;
  if (branchId && !await tx.branch.findFirst({ where: { id: branchId, businessId: ctx.businessId }, select: { id: true } })) {
    throw new Error("Package Hub branch unavailable.");
  }
  return { businessId: ctx.businessId, branchId };
}
