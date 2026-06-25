import { prisma } from "@/lib/prisma";

export type BranchOption = {
  id: string;
  name: string;
};

export async function getActiveBranches(businessId: string) {
  return prisma.branch.findMany({
    where: {
      businessId,
      status: "ACTIVE",
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
    },
  });
}

export async function resolveBranchId(
  businessId: string,
  requestedBranchId: FormDataEntryValue | null,
) {
  const branches = await getActiveBranches(businessId);
  const branchId = requestedBranchId?.toString() || "";

  if (!branches.length) {
    return null;
  }

  if (branches.length === 1) {
    return branches[0].id;
  }

  if (!branchId) {
    throw new Error("Branch is required.");
  }

  if (!branches.some((branch) => branch.id === branchId)) {
    throw new Error("Branch is invalid for this business.");
  }

  return branchId;
}

export function branchWhere(branchId?: string | null) {
  return branchId ? { branchId } : {};
}
