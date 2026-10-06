import type { Prisma } from "@prisma/client";
import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import { prisma } from "@/lib/prisma";

export type SalonAccess = {
  access: ResolvedBusinessAccess;
  requestedBranchId?: string;
};

export function hasBroadSalonPerformanceAccess(access: ResolvedBusinessAccess) {
  return access.granted && (access.effectiveBusinessRole === "BUSINESS_OWNER" ||
    (access.source === "GROUP_ACCESS" && access.effectiveBusinessRole === "GROUP_MANAGER_READ_ONLY") ||
    (access.source === "DIRECT_BUSINESS" && access.effectiveBusinessRole === "STAFF" && access.permissions.includes("ALL_BRANCHES")));
}

// Historical reading only. Never use this scope for operational mutations or
// other Dashboard/Reports domains. ACTIVE governs selectors, not history.
export async function resolveSalonPerformanceScope(
  businessId: string,
  { access, requestedBranchId }: SalonAccess,
  database: Pick<Prisma.TransactionClient, "branch"> = prisma,
): Promise<{ branchId?: string | { in: string[] } }> {
  const denied = { branchId: { in: [] as string[] } };
  if (!access.granted || access.businessId !== businessId) return denied;
  const broad = hasBroadSalonPerformanceAccess(access);
  const explicit = requestedBranchId !== undefined;
  const branchId = explicit ? requestedBranchId.trim() : broad ? null : access.branchId;
  if (!branchId) return broad && !explicit ? {} : denied;
  if (!broad && branchId !== access.branchId) return denied;
  const branches = await database.branch.findMany({
    // Match only against server-read IDs. Never pass an unvalidated URL value
    // into a UUID database predicate (malformed input must deny, not throw).
    where: { businessId }, select: { id: true },
  });
  return branches.some(branch => branch.id === branchId) ? { branchId } : denied;
}
