/** Prevent old payment adapters from silently dropping an unsupported wallet intent. */
export function rejectWalletOutsideCashier(form: FormData): void {
  const amount = form.get("walletAmount");
  if (form.get("method") === "MEMBER_WALLET" || form.get("depositMethod") === "MEMBER_WALLET"
    || form.get("paymentMethodCode") === "MEMBER_WALLET" || (amount !== null && amount !== "")) {
    throw new Error("Wallet payment is only supported through Cashier checkout.");
  }
}
