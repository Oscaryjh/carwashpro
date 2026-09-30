/** Foundation only: existing financial readers deliberately do not consume this yet. */
type Method = "CASH" | "CARD" | "DUITNOW" | "EWALLET" | "BANK_TRANSFER" | "PACKAGE" | "FOREIGN_CURRENCY" | "CRYPTO" | "MEMBER_WALLET";
type Purpose = "LEGACY" | "SALE" | "WALLET_TOP_UP";

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
