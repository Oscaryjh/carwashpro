/** Monetary boundaries use integer MYR cents, never floating point ringgit. */
export type Cents = number;
export type WalletBalances = { paidCents: Cents; bonusCents: Cents };
export const MAX_PAYMENT_CENTS = 9_999_999_999;

export class WalletRuleError extends Error {}
export class WalletVersionConflict extends Error {}
