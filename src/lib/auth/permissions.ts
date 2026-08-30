import type { UserRole } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import type { BusinessCapability } from "@/lib/business-groups/capabilities";
import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import type { AppSession } from "./session";

export function isPlatformAdmin(user: AppSession) {
  return user.role === "PLATFORM_ADMIN";
}

export function assertRole(user: AppSession, roles: UserRole[]) {
  if (!roles.includes(user.role)) {
    redirect("/reports");
  }
}

export function assertCanAccessBusiness(user: AppSession, businessId: string) {
  if (user.role === "PLATFORM_ADMIN") {
    return;
  }

  if (user.homeBusinessId !== businessId) {
    notFound();
  }
}

export function assertCanManageBusiness(user: AppSession, businessId: string) {
  if (user.role === "PLATFORM_ADMIN") {
    return;
  }

  if (
    user.role === "BUSINESS_OWNER" &&
    user.homeBusinessId === businessId
  ) {
    return;
  }

  redirect("/reports");
}

export function assertResolvedBusinessCapability(
  access: ResolvedBusinessAccess,
  capability: BusinessCapability,
) {
  if (!access.granted || access.businessId === null) {
    notFound();
  }

  if (access.capability !== capability) {
    notFound();
  }
}
