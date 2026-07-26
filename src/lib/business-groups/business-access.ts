import type {
  BusinessGroupUserRole,
  BusinessIndustry,
  UserRole,
} from "@prisma/client";
import type { BusinessCapability } from "@/lib/business-groups/capabilities";
import {
  canDirectStaff,
  canGroupManager,
  canGroupOwner,
} from "@/lib/business-groups/capabilities";
import { prisma } from "@/lib/prisma";

export type BusinessAccessSource =
  | "DIRECT_BUSINESS"
  | "GROUP_ACCESS"
  | "PLATFORM_ADMIN";

export type EffectiveBusinessRole =
  | "BUSINESS_OWNER"
  | "STAFF"
  | "GROUP_MANAGER_READ_ONLY"
  | "PLATFORM_ADMIN";

export type BusinessAccessDeniedReason =
  | "USER_INACTIVE"
  | "BUSINESS_REQUIRED"
  | "BUSINESS_INACTIVE"
  | "DIRECT_BUSINESS_MISMATCH"
  | "GROUP_ACCESS_NOT_FOUND"
  | "GROUP_MEMBERSHIP_INACTIVE"
  | "GROUP_ROLE_INACTIVE"
  | "GROUP_MANAGER_SCOPE_MISSING"
  | "CAPABILITY_REQUIRED"
  | "CAPABILITY_DENIED";

export type BusinessAccessFallback =
  | { kind: "BUSINESS"; businessId: string; source: "HOME" | "GROUP" }
  | { kind: "PLATFORM_ADMIN" }
  | { kind: "NO_ACCESS" };

export type ResolvedBusinessAccess =
  | {
      granted: true;
      userId: string;
      homeBusinessId: string | null;
      businessId: string | null;
      branchId: string | null;
      identityRole: UserRole;
      actorRole: UserRole | BusinessGroupUserRole;
      effectiveBusinessRole: EffectiveBusinessRole;
      permissions: string[];
      industryType: BusinessIndustry | null;
      source: BusinessAccessSource;
      groupId: string | null;
      groupUserId: string | null;
      capability: BusinessCapability | null;
    }
  | {
      granted: false;
      userId: string;
      requestedBusinessId: string | null;
      reason: BusinessAccessDeniedReason;
      fallback: BusinessAccessFallback;
    };

type ResolveBusinessAccessInput = {
  userId: string;
  requestedBusinessId: string | null;
  capability?: BusinessCapability;
};

type AccessDatabase = Pick<
  typeof prisma,
  "user" | "business" | "businessGroupUser"
>;

export async function resolveBusinessAccess(
  input: ResolveBusinessAccessInput,
  database: AccessDatabase = prisma,
): Promise<ResolvedBusinessAccess> {
  const user = await database.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      businessId: true,
      branchId: true,
      role: true,
      permissions: true,
      status: true,
      loginEnabled: true,
      business: {
        select: {
          id: true,
          status: true,
          industryType: true,
        },
      },
      branch: {
        select: {
          id: true,
          businessId: true,
          status: true,
        },
      },
    },
  });

  if (!user || user.status !== "active" || !user.loginEnabled) {
    return denied(input, "USER_INACTIVE", { kind: "NO_ACCESS" });
  }

  if (user.role === "PLATFORM_ADMIN") {
    return {
      granted: true,
      userId: user.id,
      homeBusinessId: user.businessId,
      businessId: null,
      branchId: user.branchId,
      identityRole: user.role,
      actorRole: user.role,
      effectiveBusinessRole: "PLATFORM_ADMIN",
      permissions: user.permissions,
      industryType: null,
      source: "PLATFORM_ADMIN",
      groupId: null,
      groupUserId: null,
      capability: input.capability ?? null,
    };
  }

  if (!input.requestedBusinessId) {
    return denied(
      input,
      "BUSINESS_REQUIRED",
      await findFallback(user, database),
    );
  }

  if (
    user.businessId === input.requestedBusinessId &&
    user.business?.status === "active"
  ) {
    if (
      input.capability &&
      user.role === "STAFF" &&
      !canDirectStaff(user.permissions, input.capability)
    ) {
      return denied(input, "CAPABILITY_DENIED", {
        kind: "BUSINESS",
        businessId: user.businessId,
        source: "HOME",
      });
    }

    return {
      granted: true,
      userId: user.id,
      homeBusinessId: user.businessId,
      businessId: user.business.id,
      branchId:
        user.branch?.status === "ACTIVE" &&
        user.branch.businessId === user.business.id
          ? user.branch.id
          : null,
      identityRole: user.role,
      actorRole: user.role,
      effectiveBusinessRole:
        user.role === "BUSINESS_OWNER" ? "BUSINESS_OWNER" : "STAFF",
      permissions: user.permissions,
      industryType: user.business.industryType,
      source: "DIRECT_BUSINESS",
      groupId: null,
      groupUserId: null,
      capability: input.capability ?? null,
    };
  }

  const requestedBusiness = await database.business.findUnique({
    where: { id: input.requestedBusinessId },
    select: { id: true, status: true, industryType: true },
  });

  if (!requestedBusiness || requestedBusiness.status !== "active") {
    return denied(
      input,
      "BUSINESS_INACTIVE",
      await findFallback(user, database),
    );
  }

  const groupGrant = await database.businessGroupUser.findFirst({
    where: {
      userId: user.id,
      status: "ACTIVE",
      group: {
        status: "ACTIVE",
        members: {
          some: {
            businessId: requestedBusiness.id,
            status: "ACTIVE",
          },
        },
      },
    },
    select: {
      id: true,
      groupId: true,
      role: true,
      status: true,
      accessScope: true,
      businessAccesses: {
        where: { businessId: requestedBusiness.id },
        select: { businessId: true },
      },
    },
  });

  if (!groupGrant) {
    return denied(
      input,
      user.businessId ? "DIRECT_BUSINESS_MISMATCH" : "GROUP_ACCESS_NOT_FOUND",
      await findFallback(user, database),
    );
  }

  if (!input.capability && groupGrant.role === "GROUP_MANAGER") {
    return denied(
      input,
      "CAPABILITY_REQUIRED",
      await findFallback(user, database),
    );
  }

  if (
    groupGrant.role === "GROUP_MANAGER" &&
    (groupGrant.accessScope !== "SELECTED_BUSINESSES" ||
      groupGrant.businessAccesses.length !== 1)
  ) {
    return denied(
      input,
      "GROUP_MANAGER_SCOPE_MISSING",
      await findFallback(user, database),
    );
  }

  const capabilityAllowed =
    !input.capability ||
    (groupGrant.role === "GROUP_OWNER"
      ? canGroupOwner(input.capability)
      : canGroupManager(input.capability));
  if (!capabilityAllowed) {
    return denied(
      input,
      "CAPABILITY_DENIED",
      await findFallback(user, database),
    );
  }

  return {
    granted: true,
    userId: user.id,
    homeBusinessId: user.businessId,
    businessId: requestedBusiness.id,
    branchId: null,
    identityRole: user.role,
    actorRole: groupGrant.role,
    effectiveBusinessRole:
      groupGrant.role === "GROUP_OWNER"
        ? "BUSINESS_OWNER"
        : "GROUP_MANAGER_READ_ONLY",
    permissions: [],
    industryType: requestedBusiness.industryType,
    source: "GROUP_ACCESS",
    groupId: groupGrant.groupId,
    groupUserId: groupGrant.id,
    capability: input.capability ?? null,
  };
}

async function findFallback(
  user: {
    id: string;
    businessId: string | null;
    business: { status: string } | null;
  },
  database: AccessDatabase,
): Promise<BusinessAccessFallback> {
  if (user.businessId && user.business?.status === "active") {
    return { kind: "BUSINESS", businessId: user.businessId, source: "HOME" };
  }

  const groupGrants = await database.businessGroupUser.findMany({
    where: {
      userId: user.id,
      status: "ACTIVE",
      group: { status: "ACTIVE" },
    },
    orderBy: [{ grantedAt: "asc" }, { id: "asc" }],
    select: {
      role: true,
      groupId: true,
      group: {
        select: {
          members: {
            where: {
              status: "ACTIVE",
              business: { status: "active" },
            },
            orderBy: { businessId: "asc" },
            select: { businessId: true },
          },
        },
      },
      businessAccesses: {
        where: { business: { status: "active" } },
        orderBy: { businessId: "asc" },
        select: { businessId: true },
      },
    },
  });

  for (const groupGrant of groupGrants) {
    const activeMemberIds = new Set(
      groupGrant.group.members.map((member) => member.businessId),
    );
    const businessId =
      groupGrant.role === "GROUP_OWNER"
        ? groupGrant.group.members[0]?.businessId
        : groupGrant.businessAccesses.find((access) =>
            activeMemberIds.has(access.businessId),
          )?.businessId;

    if (businessId) {
      return { kind: "BUSINESS", businessId, source: "GROUP" };
    }
  }

  return { kind: "NO_ACCESS" };
}

function denied(
  input: ResolveBusinessAccessInput,
  reason: BusinessAccessDeniedReason,
  fallback: BusinessAccessFallback,
): ResolvedBusinessAccess {
  return {
    granted: false,
    userId: input.userId,
    requestedBusinessId: input.requestedBusinessId,
    reason,
    fallback,
  };
}
