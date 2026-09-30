/** A business rejection thrown before writes or from an awaited rolled-back transaction.
 * Clients may correct it only when no earlier request outcome was unknown.
 */
export class WalletRefundRejected extends Error {}

/** A definite refusal, raised inside the awaited transaction before reversal writes. */
export class WalletTopUpAlreadyConsumedError extends WalletRefundRejected {
  readonly code = "TOP_UP_ALREADY_CONSUMED";
  constructor() { super("TOP_UP_ALREADY_CONSUMED: a later wallet debit exists."); }
}
