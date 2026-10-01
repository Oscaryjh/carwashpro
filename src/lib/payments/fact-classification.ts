/** Canonical tender classification; invoice sales are a separate fact. */
export type Method = "CASH" | "CARD" | "DUITNOW" | "EWALLET" | "BANK_TRANSFER" | "PACKAGE" | "FOREIGN_CURRENCY" | "CRYPTO" | "MEMBER_WALLET";
export type Purpose = "LEGACY" | "SALE" | "WALLET_TOP_UP";

export function classifyPaymentFact(input: { purpose: Purpose; method: Method }) {
  const methods: Method[] = ["CASH", "CARD", "DUITNOW", "EWALLET", "BANK_TRANSFER", "PACKAGE", "FOREIGN_CURRENCY", "CRYPTO", "MEMBER_WALLET"];
  if (!methods.includes(input.method) || !["LEGACY", "SALE", "WALLET_TOP_UP"].includes(input.purpose)) throw new Error("Unknown payment fact");
  if (input.method === "MEMBER_WALLET" && input.purpose !== "SALE") throw new Error("Wallet only settles sales");
  if (input.purpose === "WALLET_TOP_UP" && !["CASH", "CARD", "DUITNOW", "EWALLET", "BANK_TRANSFER"].includes(input.method)) throw new Error("Top-up requires a local external tender");
  return {
    classification: input.purpose,
    settlesInvoice: input.purpose === "LEGACY" ? null : input.purpose === "SALE",
    externalCollection: input.method !== "PACKAGE" && input.method !== "MEMBER_WALLET",
    cashMovement: input.method === "CASH",
    walletMovement: input.purpose === "WALLET_TOP_UP" ? "CREDIT" : input.method === "MEMBER_WALLET" ? "DEBIT" : null,
    salesRefund: input.purpose === "LEGACY" ? null : input.purpose === "SALE" && input.method !== "PACKAGE",
  };
}

export function classifyRefundFact(input: {
  originalPayment: { purpose: Purpose; method: Method };
  refundMethod: Method;
}) {
  const source = classifyPaymentFact(input.originalPayment);
  // A wallet credit cannot leave the wallet; an external refund cannot create wallet credit.
  if ((input.originalPayment.method === "MEMBER_WALLET") !== (input.refundMethod === "MEMBER_WALLET")) {
    throw new Error("Wallet refund must return to its original wallet tender");
  }
  const destination = classifyPaymentFact({ purpose: input.originalPayment.purpose, method: input.refundMethod });
  return {
    salesRefund: source.classification === "LEGACY" ? input.refundMethod !== "PACKAGE" : source.salesRefund === true,
    externalRefund: destination.externalCollection,
    cashMovement: destination.cashMovement,
    walletRefund: input.refundMethod === "MEMBER_WALLET",
    topUpReversal: source.classification === "WALLET_TOP_UP",
  };
}
