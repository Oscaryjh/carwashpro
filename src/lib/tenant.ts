import { cache } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { tryWriteAuthSecurityEvent } from "@/lib/auth/security";
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
  const access = await resolveBusinessAccess({
    userId: user.userId,
    requestedBusinessId,
    capability,
  });

  if (!access.granted && canUseFallback(access)) {
    await logAccessDenied(user, access);
    redirect("/business-context/recover");
  }

  if (!access.granted) {
    await logAccessDenied(user, access);
    if (access.fallback.kind === "NO_ACCESS") {
      redirect("/no-business-access");
    }
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
    permissions: access.permissions,
    role:
      access.effectiveBusinessRole === "BUSINESS_OWNER"
        ? ("BUSINESS_OWNER" as const)
        : user.role,
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

async function logAccessDenied(
  user: Awaited<ReturnType<typeof requireUser>>,
  access: Extract<ResolvedBusinessAccess, { granted: false }>,
) {
  await tryWriteAuthSecurityEvent({
    eventType: "PERMISSION_DENIED",
    surface: "BUSINESS_AUTHORIZATION",
    outcome: "DENIED",
    userId: user.userId,
    businessId: access.requestedBusinessId,
    sessionId: user.sessionId ?? null,
    reason: access.reason,
  });
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
