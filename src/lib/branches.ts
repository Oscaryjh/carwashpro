import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/auth/session";

export const DENIED_OPERATIONAL_BRANCH_ID =
  "00000000-0000-0000-0000-000000000000";

type OperationalBranchUser = Pick<AppSession, "branchId" | "role">;

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

export async function getOperationalBranches(
  businessId: string,
  user: Pick<AppSession, "branchId" | "role">,
) {
  const branches = await getActiveBranches(businessId);

  if (user.role === "BUSINESS_OWNER") {
    return branches;
  }

  if (!user.branchId) {
    return [];
  }

  return branches.filter((branch) => branch.id === user.branchId);
}

export async function resolveOperationalBranchId(
  businessId: string,
  user: Pick<AppSession, "branchId" | "role">,
  requestedBranchId: FormDataEntryValue | null,
) {
  if (user.role !== "BUSINESS_OWNER") {
    if (!user.branchId) {
      throw new Error("Staff branch is required. Ask the owner to assign this staff to a branch.");
    }

    const branch = await prisma.branch.findFirst({
      where: {
        id: user.branchId,
        businessId,
        status: "ACTIVE",
      },
      select: { id: true },
    });

    if (!branch) {
      throw new Error("Staff branch is inactive or invalid.");
    }

    return branch.id;
  }

  return resolveBranchId(businessId, requestedBranchId);
}

export function branchWhere(branchId?: string | null) {
  return branchId ? { branchId } : {};
}

/**
 * Canonical operational-data scope for business routes.
 *
 * Customer and vehicle identities remain business-wide. Operational records
 * (appointments, invoices, payments, work orders, etc.) do not. `ALL_BRANCHES`
 * is intentionally absent: it only expands Reports visibility.
 */
export function authorizedOperationalBranchWhere(
  user: OperationalBranchUser,
) {
  return user.role === "BUSINESS_OWNER"
    ? {}
    : { branchId: user.branchId ?? DENIED_OPERATIONAL_BRANCH_ID };
}

/**
 * Customer packages with no branch are business-wide; otherwise the same
 * operational branch rule applies.
 */
export function authorizedCustomerPackageBranchWhere(
  user: OperationalBranchUser,
) {
  if (user.role === "BUSINESS_OWNER") {
    return {};
  }

  return {
    OR: [
      { branchId: null },
      { branchId: user.branchId ?? DENIED_OPERATIONAL_BRANCH_ID },
    ],
  };
}

export function canAccessOperationalBranch(
  user: OperationalBranchUser,
  branchId: string | null,
) {
  return (
    user.role === "BUSINESS_OWNER" ||
    Boolean(user.branchId && branchId === user.branchId)
  );
}
