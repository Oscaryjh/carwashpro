import { z } from "zod";

export const eventTypeSchema = z.enum(["PURCHASED", "USED", "RESTORED", "CANCELLED"]);
export const sourceTypeSchema = z.enum(["CHECKOUT", "PAYMENT_REFUND", "INVOICE_VOID"]);
export type ActivityType = z.infer<typeof eventTypeSchema>;
const uses = z.number().int().min(0).max(2147483647);
const status = z.enum(["ACTIVE", "USED_UP", "CANCELLED", "PENDING_PAYMENT"]);
const stateSchema = z.object({ totalUses: uses, remainingUses: uses, status });
export type PackageState = z.infer<typeof stateSchema>;

export function derivePackageChange(type: ActivityType, before: PackageState, after: PackageState) {
  eventTypeSchema.parse(type);
  stateSchema.parse(before); stateSchema.parse(after);
  const delta = after.remainingUses - before.remainingUses;
  if (before.totalUses !== after.totalUses || before.remainingUses > before.totalUses || after.remainingUses > after.totalUses) throw new Error("Package activity capacity mismatch.");
  if ((type === "USED" && delta >= 0) || ((type === "PURCHASED" || type === "RESTORED") && delta < 0) || (type === "CANCELLED" && delta > 0)) throw new Error("Package activity direction mismatch.");
  return { totalUsesSnapshot: before.totalUses, remainingBefore: before.remainingUses, remainingAfter: after.remainingUses, usesDelta: delta, statusBefore: before.status, statusAfter: after.status };
}

const serviceChange = z.object({ balanceId: z.string().uuid(), serviceId: z.string().uuid(), totalUses: uses, remainingBefore: uses, remainingAfter: uses, usesDelta: z.number().int() }).strict().refine(row => row.remainingBefore <= row.totalUses && row.remainingAfter <= row.totalUses && row.remainingAfter - row.remainingBefore === row.usesDelta, "Invalid service balance change.");
export const serviceChangesSchema = z.array(serviceChange).refine(rows => new Set(rows.map(row => row.balanceId)).size === rows.length, "Duplicate balance identity.");
const ids = z.array(z.string().uuid()).refine(values => new Set(values).size === values.length, "Duplicate source identity.");
export const additionalSourceRefsSchema = z.object({ paymentIds: ids, refundIds: ids }).strict();
const nullableId = z.string().uuid().nullable().optional();
export const activityInputSchema = z.object({
  eventType: eventTypeSchema, sourceType: sourceTypeSchema,
  financialOperationId: z.string().uuid(), actorUserId: z.string().uuid(),
  customerPackageServiceBalanceId: nullableId, serviceId: nullableId,
  invoiceId: nullableId, invoiceItemId: nullableId, paymentId: nullableId, paymentRefundId: nullableId,
  appointmentId: nullableId, workOrderId: nullableId, originalUseActivityId: nullableId,
  assignedStaffId: nullableId, branchId: nullableId,
  additionalSourceRefs: additionalSourceRefsSchema.nullable().optional(),
  requestedUses: uses.nullable().optional(), reason: z.string().trim().max(2000).nullable().optional(),
  occurredAt: z.date().optional(),
  // Server writer evidence only; never accept this mapping from request input.
  purchaseSourceMapping: z.object({
    customerPackageId: z.string().uuid(), invoiceId: z.string().uuid(), invoiceItemId: z.string().uuid(),
  }).strict().optional(),
}).strict();
export type ActivityInput = z.infer<typeof activityInputSchema>;

export function activityEntryKey(input: { eventType: ActivityType; sourceType: z.infer<typeof sourceTypeSchema>; customerPackageId: string; paymentId?: string | null; paymentRefundId?: string | null }) {
  const { eventType: type, sourceType: source, customerPackageId: cp, paymentId: payment, paymentRefundId: refund } = input;
  z.string().uuid().parse(cp);
  if (type === "PURCHASED" && source === "CHECKOUT") return `purchase:${cp}`;
  if (type === "CANCELLED" && source === "PAYMENT_REFUND") return `cancel:${cp}`;
  if (payment) z.string().uuid().parse(payment);
  if (type === "USED" && source === "CHECKOUT" && payment) return `use:${payment}`;
  if (type === "RESTORED" && source === "INVOICE_VOID" && payment) return `void-restore:${payment}`;
  if (type === "RESTORED" && source === "PAYMENT_REFUND" && payment && refund) { z.string().uuid().parse(refund); return `restore:${refund}:${payment}`; }
  throw new Error("Invalid package activity source/key.");
}
