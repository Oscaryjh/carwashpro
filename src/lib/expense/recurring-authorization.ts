import type { Prisma } from "@prisma/client";
import { resolveBusinessAccess } from "@/lib/business-groups/business-access";
import { prisma } from "@/lib/prisma";

type Database = Pick<Prisma.TransactionClient, "user" | "business" | "businessGroupUser" | "branch" | "recurringExpenseTemplate">;
type Authority = { businessId: string; userId: string; capability: "MANAGE_EXPENSE_CATEGORY" | "CREATE_EXPENSE" };
const denied = () => new Error("Recurring Expense record is outside your authorised scope.");

// Used again inside the Serializable mutation transaction, including replay.
// Never accept client/session branch lists as record authorization evidence.
export async function assertRecurringExpenseScope(db: Database, input: Authority, branchId: string | null) {
  const access = await resolveBusinessAccess({ userId: input.userId, requestedBusinessId: input.businessId, capability: input.capability }, db);
  if (!access.granted || access.businessId !== input.businessId ||
      !["BUSINESS_OWNER", "STAFF"].includes(access.effectiveBusinessRole)) throw denied();
  if (branchId === null) {
    if (access.effectiveBusinessRole !== "BUSINESS_OWNER") throw denied();
    return;
  }
  // Historical Owner access is retained; active target validation remains in
  // the existing update lifecycle. Staff assignment must still be active.
  const branch = await db.branch.findFirst({ where: { businessId: input.businessId, id: branchId }, select: { id: true } });
  if (!branch || (access.effectiveBusinessRole !== "BUSINESS_OWNER" && access.branchId !== branch.id)) throw denied();
}

export async function authorizeRecurringExpenseTemplate(input: Authority & { templateId: string }, db: Database = prisma) {
  const template = await db.recurringExpenseTemplate.findFirst({ where: { businessId: input.businessId, id: input.templateId }, select: { id: true, branchId: true } });
  if (!template) throw denied();
  await assertRecurringExpenseScope(db, input, template.branchId);
  return template;
}
