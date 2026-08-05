import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { requireUser } from "@/lib/auth/session";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { prisma } from "@/lib/prisma";

export type PayrollRunsReadAccess =
  | { granted: false; scopeRestricted: boolean }
  | {
      granted: true;
      businessId: string;
      userId: string;
      ownerSelfApproval: boolean;
      actions: {
        canCreate: boolean;
        canEditEntry: boolean;
        canExportPayroll: boolean;
        canCreatePaymentBatch: boolean;
        canViewPaymentBatch: boolean;
        canViewPayslip: boolean;
      };
      workflow: {
        canSubmitReview: boolean;
        canReturnToDraft: boolean;
        canFinalize: boolean;
        canReopen: boolean;
      };
    };

export async function resolvePayrollRunsReadAccess(): Promise<PayrollRunsReadAccess> {
  const identity = await requireUser();
  const context = await requireBusinessUser(
    identity.activeBusinessId !== identity.homeBusinessId
      ? "VIEW_DASHBOARD"
      : undefined,
  );

  if (!hasBusinessCapability(context.access, "VIEW_PAYROLL_RUN")) {
    return { granted: false, scopeRestricted: false };
  }

  const [scope, activeBranchCount] = await Promise.all([
    resolveAttendanceScope(context.access),
    prisma.branch.count({
      where: { businessId: context.businessId, status: "ACTIVE" },
    }),
  ]);
  const hasWholeBusinessScope =
    scope.allowedBranchIds.length === activeBranchCount &&
    !(
      context.access.effectiveBusinessRole === "STAFF" &&
      !context.access.permissions.includes("ALL_BRANCHES")
    );

  return hasWholeBusinessScope
    ? {
        granted: true,
        businessId: context.businessId,
        userId: context.user.userId,
        ownerSelfApproval:
          context.access.effectiveBusinessRole === "BUSINESS_OWNER",
        actions: {
          canCreate: hasBusinessCapability(
            context.access,
            "CREATE_PAYROLL_RUN",
          ),
          canEditEntry: hasBusinessCapability(
            context.access,
            "EDIT_PAYROLL_ENTRY",
          ),
          canExportPayroll: hasBusinessCapability(
            context.access,
            "EXPORT_PAYROLL",
          ),
          canCreatePaymentBatch: hasBusinessCapability(
            context.access,
            "CREATE_PAYMENT_BATCH",
          ),
          canViewPaymentBatch: hasBusinessCapability(
            context.access,
            "VIEW_PAYMENT_BATCH",
          ),
          canViewPayslip: hasBusinessCapability(
            context.access,
            "VIEW_PAYSLIP",
          ),
        },
        workflow: {
          canSubmitReview: hasBusinessCapability(
            context.access,
            "SUBMIT_PAYROLL_REVIEW",
          ),
          canReturnToDraft: hasBusinessCapability(
            context.access,
            "RETURN_PAYROLL_TO_DRAFT",
          ),
          canFinalize: hasBusinessCapability(context.access, "APPROVE_PAYROLL"),
          canReopen: hasBusinessCapability(context.access, "REOPEN_PAYROLL"),
        },
      }
    : { granted: false, scopeRestricted: true };
}
