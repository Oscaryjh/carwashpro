import { cache } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import type { BusinessCapability } from "@/lib/business-groups/capabilities";
import {
  resolveBusinessAccess,
  type ResolvedBusinessAccess,
} from "@/lib/business-groups/business-access";

export type RequireBusinessContextOptions = {
  capability?: BusinessCapability;
};

export const getBusinessContext = cache(async function getBusinessContext(
  capability?: BusinessCapability,
) {
  const user = await requireUser();
  const requestedBusinessId =
    user.activeBusinessId ?? user.homeBusinessId;
  let access = await resolveBusinessAccess({
    userId: user.userId,
    requestedBusinessId,
    capability,
  });

  if (!access.granted && canUseFallback(access)) {
    access = await resolveBusinessAccess({
      userId: user.userId,
      requestedBusinessId: access.fallback.businessId,
      capability,
    });
  }

  if (!access.granted) {
    redirect("/login?error=business-access-denied");
  }

  if (access.source === "PLATFORM_ADMIN") {
    return {
      user,
      isPlatformAdmin: true,
      businessId: null,
      industryType: null,
      access,
      contextVersion: user.contextVersion,
    };
  }

  const contextUser = {
    ...user,
    activeBusinessId: access.businessId,
    businessId: access.businessId,
    branchId: access.branchId,
    industryType: access.industryType,
  };

  return {
    user: contextUser,
    isPlatformAdmin: false,
    businessId: access.businessId,
    industryType: access.industryType,
    access,
    contextVersion: user.contextVersion,
  };
});

export async function requireBusinessContext(
  options: RequireBusinessContextOptions = {},
) {
  const context = await getBusinessContext(options.capability);

  if (!context.businessId || !context.industryType) {
    redirect("/admin/businesses");
  }

  return {
    user: context.user,
    businessId: context.businessId,
    industryType: context.industryType,
    access: context.access,
    contextVersion: context.contextVersion,
  };
}

export function withBusinessScope<TWhere extends Record<string, unknown>>(
  businessId: string,
  where?: TWhere,
) {
  return {
    ...where,
    businessId,
  };
}

function canUseFallback(
  access: Extract<ResolvedBusinessAccess, { granted: false }>,
): access is typeof access & {
  fallback: { kind: "BUSINESS"; businessId: string };
} {
  return (
    access.fallback.kind === "BUSINESS" &&
    !["CAPABILITY_REQUIRED", "CAPABILITY_DENIED"].includes(access.reason)
  );
}
