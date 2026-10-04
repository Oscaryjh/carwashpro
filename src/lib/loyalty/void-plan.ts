type Fact = { id: string; paymentId: string | null; type: string; points: number };

/** VOID has no partial-refund sequence. Reconcile the original ledger once,
 * using the existing net-compensation/no-points-debt balance convention. */
export function planVoidLoyalty(balance: number, facts: Fact[]) {
  if (!Number.isSafeInteger(balance) || balance < 0) throw new Error("Invalid loyalty balance.");
  let restored = 0, reversed = 0;
  const seen = new Set<string>();
  const rows = facts.map(fact => {
    const key = `${fact.paymentId}:${fact.type}`;
    if (!fact.paymentId || seen.has(key) || !Number.isSafeInteger(fact.points) ||
        (fact.type !== "REDEEM" && fact.type !== "EARN") ||
        (fact.type === "REDEEM" ? fact.points >= 0 : fact.points <= 0)) {
      throw new Error("Loyalty VOID source evidence is ambiguous or already compensated.");
    }
    seen.add(key);
    if (fact.type === "REDEEM") restored -= fact.points;
    else reversed += fact.points;
    return { sourceId: fact.id, paymentId: fact.paymentId,
      type: fact.type === "REDEEM" ? "REDEMPTION_REFUND" as const : "REFUND_REVERSAL" as const,
      points: -fact.points };
  });
  const nextBalance = Math.max(0, balance + restored - reversed);
  if (![restored,reversed,nextBalance].every(Number.isSafeInteger)) throw new Error("Invalid loyalty VOID totals.");
  return { balance: nextBalance, restored, reversed, rows };
}
