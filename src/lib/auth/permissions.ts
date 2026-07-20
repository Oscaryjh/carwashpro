import type { UserRole } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
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

  if (user.businessId !== businessId) {
    notFound();
  }
}

export function assertCanManageBusiness(user: AppSession, businessId: string) {
  if (user.role === "PLATFORM_ADMIN") {
    return;
  }

  if (user.role === "BUSINESS_OWNER" && user.businessId === businessId) {
    return;
  }

  redirect("/reports");
}
