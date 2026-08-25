type LeaveLedgerEvent = Readonly<{
  policyId: string;
  eventType: string;
  units: number;
}>;

export type LeaveLedgerProjection = Readonly<{
  balanceByPolicy: ReadonlyMap<string, number>;
  carryForwardByPolicy: ReadonlyMap<string, number>;
  manualAdjustmentByPolicy: ReadonlyMap<string, number>;
  usedByPolicy: ReadonlyMap<string, number>;
  approvedLeaveDays: number;
}>;

/**
 * Canonical read projection for Leave ledger balances.
 *
 * Callers may own different permission-scoped queries, but they must not
 * reinterpret consumption, cancellation restores, carry forward or manual
 * adjustments independently.
 */
export function projectLeaveLedger(events: readonly LeaveLedgerEvent[]): LeaveLedgerProjection {
  const balanceByPolicy = new Map<string, number>();
  const carryForwardByPolicy = new Map<string, number>();
  const manualAdjustmentByPolicy = new Map<string, number>();
  const usedByPolicy = new Map<string, number>();

  for (const event of events) {
    const units = Number(event.units || 0);
    balanceByPolicy.set(event.policyId, (balanceByPolicy.get(event.policyId) ?? 0) + units);

    if (event.eventType === "APPROVED_CONSUMPTION") {
      usedByPolicy.set(event.policyId, (usedByPolicy.get(event.policyId) ?? 0) + Math.abs(units));
    } else if (event.eventType === "CANCELLATION_RESTORE") {
      usedByPolicy.set(event.policyId, Math.max(0, (usedByPolicy.get(event.policyId) ?? 0) - units));
    } else if (event.eventType === "CARRY_FORWARD") {
      carryForwardByPolicy.set(event.policyId, (carryForwardByPolicy.get(event.policyId) ?? 0) + units);
    } else if (event.eventType === "MANUAL_ADJUSTMENT") {
      manualAdjustmentByPolicy.set(event.policyId, (manualAdjustmentByPolicy.get(event.policyId) ?? 0) + units);
    }
  }

  return {
    balanceByPolicy,
    carryForwardByPolicy,
    manualAdjustmentByPolicy,
    usedByPolicy,
    approvedLeaveDays: [...usedByPolicy.values()].reduce((sum, units) => sum + units, 0),
  };
}
