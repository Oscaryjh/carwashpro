import type { Prisma } from "@prisma/client";
import type { SaleShare } from "./money";

export type PerformanceActor = { businessId: string; branchId: string; actorUserId: string };
export type PerformancePermission = "PERFORMANCE_UNASSIGNED" | "PERFORMANCE_CORRECT_SALES" | "PERFORMANCE_CORRECT_TIP" | "PERFORMANCE_MANAGE_TARGETS";

export async function assertPerformanceActor(tx: Prisma.TransactionClient, context: PerformanceActor, permission?: PerformancePermission) {
  const [user, branch] = await Promise.all([
    tx.user.findFirst({ where: { id: context.actorUserId, businessId: context.businessId, status: "active", loginEnabled: true, business: { status: "active" } } }),
    tx.branch.findFirst({ where: { id: context.branchId, businessId: context.businessId } }),
  ]);
  if (!user || !branch || (user.role !== "BUSINESS_OWNER" && user.branchId !== branch.id)) throw new Error("Performance branch access denied.");
  if (permission && user.role !== "BUSINESS_OWNER" && !user.permissions.includes(permission)) throw new Error("Performance permission denied.");
  return user;
}

export function eligiblePerformanceWhere(businessId: string, branchId: string, at: Date): Prisma.EmployeeBusinessMembershipWhereInput {
  return {
    businessId, status: "ACTIVE", employeeAccount: { status: "ACTIVE" }, joinedAt: { lte: at },
    OR: [{ terminatedAt: null }, { terminatedAt: { gte: at } }],
    branchAssignments: { some: { businessId, branchId, status: "ACTIVE", effectiveFrom: { lte: at },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: at } }], branch: { businessId, status: "ACTIVE" } } },
  };
}

export async function validatePerformanceRecipients(tx: Prisma.TransactionClient, context: PerformanceActor, shares: readonly SaleShare[], at: Date, historical = false) {
  if (!shares.length) return [];
  const where = eligiblePerformanceWhere(context.businessId, context.branchId, at);
  // Corrections may refer to someone who subsequently left, but must retain dated branch evidence.
  if (historical) {
    delete where.status; delete where.employeeAccount;
    where.branchAssignments = { some: { businessId: context.businessId, branchId: context.branchId, effectiveFrom: { lte: at },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: at } }], branch: { businessId: context.businessId } } };
  }
  const members = await tx.employeeBusinessMembership.findMany({
    where: { ...where, id: { in: shares.map((share) => share.membershipId) } },
    select: { id: true, fullName: true, employeeCode: true },
  });
  if (members.length !== shares.length) throw new Error("A performance employee is not eligible for this business and branch.");
  return members;
}
