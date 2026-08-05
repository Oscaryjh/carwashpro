import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { requireUser } from "@/lib/auth/session";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { prisma } from "@/lib/prisma";
import type { PayrollPaymentContext } from "./types";

export type PaymentReadAccess =
  | { granted: false; scopeRestricted: boolean }
  | {
      granted: true;
      businessId: string;
      userId: string;
      canViewEmployeeProfile: boolean;
      actions: {
        canApprove: boolean;
        canCancel: boolean;
        canCreate: boolean;
        canSubmit: boolean;
        canViewAudit: boolean;
      };
      paymentContext: PayrollPaymentContext;
    };

export async function resolvePaymentReadAccess(): Promise<PaymentReadAccess> {
  const identity = await requireUser();
  const context = await requireBusinessUser(
    identity.activeBusinessId !== identity.homeBusinessId
      ? "VIEW_DASHBOARD"
      : undefined,
  );

  if (!hasBusinessCapability(context.access, "VIEW_PAYMENT_BATCH")) {
    return { granted: false, scopeRestricted: false };
  }

  const [scope, activeBranchCount] = await Promise.all([
    resolveAttendanceScope(context.access),
    prisma.branch.count({
      where: { businessId: context.businessId, status: "ACTIVE" },
    }),
  ]);
  const wholeBusiness =
    scope.allowedBranchIds.length === activeBranchCount &&
    !(
      context.access.effectiveBusinessRole === "STAFF" &&
      !context.access.permissions.includes("ALL_BRANCHES")
    );

  if (!wholeBusiness) return { granted: false, scopeRestricted: true };

  return {
    granted: true,
    businessId: context.businessId,
    userId: context.user.userId,
    canViewEmployeeProfile: hasBusinessCapability(
      context.access,
      "VIEW_TEAM_DIRECTORY",
    ),
    actions: {
      canApprove: hasBusinessCapability(context.access, "APPROVE_PAYMENT_BATCH"),
      canCancel: hasBusinessCapability(context.access, "CANCEL_PAYMENT_BATCH"),
      canCreate: hasBusinessCapability(context.access, "CREATE_PAYMENT_BATCH"),
      canSubmit: hasBusinessCapability(context.access, "SUBMIT_PAYMENT_BATCH"),
      canViewAudit: hasBusinessCapability(context.access, "VIEW_PAYMENT_AUDIT"),
    },
    paymentContext: {
      access: context.access,
      actor: context.user,
      allowedBranchIds: [...scope.allowedBranchIds],
      businessId: context.businessId,
      request: {},
    },
  };
}
