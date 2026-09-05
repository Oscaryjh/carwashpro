import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { performanceEnabled, type PerformanceInput } from "./input";
import { cents, integer } from "./money";
import { assertPerformanceActor, type PerformanceActor } from "./scope";

/** An explicit NEW tip on an outstanding invoice, not a rewrite of any received tip. */
export async function appendCheckoutTip(tx: Prisma.TransactionClient, context: PerformanceActor, input: {
  invoiceId: string; additionalTipCents: number; paymentCents: number; operationKey: string; attribution: PerformanceInput | null;
}) {
  if (!performanceEnabled() || integer(input.additionalTipCents) <= 0 || integer(input.paymentCents) <= 0 || !input.attribution) throw new Error("An additional tip requires a new payment with explicit performance attribution.");
  const actor = await assertPerformanceActor(tx, context);
  const invoice = await tx.invoice.findFirstOrThrow({ where: { id: input.invoiceId, businessId: context.businessId, branchId: context.branchId } });
  if (["VOID", "REFUNDED", "PAID"].includes(invoice.status) || invoice.balance.lte(0)) throw new Error("Additional tips are only supported during an outstanding-balance payment.");
  const tipCents = integer(cents(invoice.tipAmount) + input.additionalTipCents);
  const totalCents = integer(cents(invoice.total) + input.additionalTipCents);
  const balanceCents = integer(cents(invoice.balance) + input.additionalTipCents);
  const money = (value: number) => `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
  const updated = await tx.invoice.update({ where: { id: invoice.id }, data: { tipAmount: money(tipCents), total: money(totalCents), balance: money(balanceCents) } });
  await writeAuditLog({ businessId: context.businessId, branchId: context.branchId,
    actor: { userId: actor.id, name: actor.name ?? "User", email: actor.email ?? "" }, action: "PERFORMANCE_CHECKOUT_TIP_ADDED", entityType: "Invoice", entityId: invoice.id,
    summary: "Additional tip explicitly added during balance payment; previously received tips and recipients are unchanged.",
    before: { tipAmount: invoice.tipAmount, total: invoice.total, balance: invoice.balance },
    after: { tipAmount: updated.tipAmount, total: updated.total, balance: updated.balance, additionalTipCents: input.additionalTipCents, operationKey: input.operationKey, payoutChanged: false },
  }, tx);
  return updated;
}
