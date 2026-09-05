import { Prisma } from "@prisma/client";

export const PERFORMANCE_POLICY_VERSION = "sales-and-tips-ex-tax-v1";
export type Components = { sales: number; tax: number; tip: number; unresolved: number };
export const emptyComponents = (): Components => ({ sales: 0, tax: 0, tip: 0, unresolved: 0 });

export function cents(value: Prisma.Decimal.Value): number {
  const scaled = new Prisma.Decimal(value).mul(100);
  if (!scaled.isInteger() || !scaled.isFinite()) throw new Error("Money must have at most two decimal places.");
  return integer(scaled.toNumber());
}

export function integer(value: number): number {
  if (!Number.isSafeInteger(value)) throw new Error("Money must be safe integer cents.");
  return value;
}

export function sum(values: readonly number[]) {
  return values.reduce((total, value) => integer(total + integer(value)), 0);
}

/** Largest remainder, stable caller-supplied keys; all products are BigInt. */
export function apportion(amount: number, weights: readonly { key: string; weight: number }[]) {
  integer(amount);
  if (amount < 0) throw new Error("Cannot apportion a negative amount.");
  const total = sum(weights.map(({ weight }) => {
    if (weight < 0) throw new Error("Negative allocation weight.");
    return weight;
  }));
  if (new Set(weights.map(({ key }) => key)).size !== weights.length) throw new Error("Duplicate allocation recipient.");
  if (!total && amount) throw new Error("No remaining components to allocate.");
  const rows = weights.map(({ key, weight }) => {
    const numerator = BigInt(amount) * BigInt(weight);
    return { key, amount: total ? Number(numerator / BigInt(total)) : 0, remainder: total ? numerator % BigInt(total) : 0n };
  });
  let remainder = amount - sum(rows.map((row) => row.amount));
  for (const row of [...rows].sort((a, b) => a.remainder === b.remainder ? a.key.localeCompare(b.key) : a.remainder > b.remainder ? -1 : 1)) {
    if (!remainder) break;
    row.amount += 1;
    remainder -= 1;
  }
  return Object.fromEntries(rows.map((row) => [row.key, row.amount]));
}

export function totalComponents(value: Components) { return sum(Object.values(value)); }

export function subtractComponents(total: Components, used: Components): Components {
  const remaining = Object.fromEntries(Object.keys(total).map((key) => {
    const part = key as keyof Components;
    const amount = integer(total[part] - used[part]);
    if (amount < 0) throw new Error(`Receipt ${part} exceeds remaining component.`);
    return [part, amount];
  })) as Components;
  return remaining;
}

export function receiveComponents(amount: number, remaining: Components, exact?: Components): Components {
  if (amount < 0 || amount > totalComponents(remaining)) throw new Error("Receipt exceeds remaining components.");
  if (exact) {
    if (totalComponents(exact) !== amount) throw new Error("Receipt components must equal the received amount.");
    for (const value of Object.values(exact)) if (integer(value) < 0) throw new Error("Negative receipt component.");
    subtractComponents(remaining, exact);
    return exact;
  }
  return apportion(amount, Object.entries(remaining).map(([key, weight]) => ({ key, weight }))) as Components;
}

export type SaleShare = { membershipId: string; basisPoints: number };
export function validateShares(shares: readonly SaleShare[]) {
  if (!shares.length) return;
  if (shares.length > 50) throw new Error("Too many sales recipients.");
  if (new Set(shares.map((share) => share.membershipId)).size !== shares.length) throw new Error("Duplicate sales recipient.");
  if (shares.some((share) => !Number.isInteger(share.basisPoints) || share.basisPoints <= 0 || share.basisPoints > 10_000)
    || sum(shares.map((share) => share.basisPoints)) !== 10_000) throw new Error("Sales allocation must total 100%.");
}

export function allocateSales(amount: number, shares: readonly SaleShare[]) {
  validateShares(shares);
  return apportion(amount, shares.length
    ? shares.map((share) => ({ key: share.membershipId, weight: share.basisPoints }))
    : [{ key: "UNASSIGNED", weight: 10_000 }]);
}
