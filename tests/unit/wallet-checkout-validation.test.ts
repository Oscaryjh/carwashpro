import assert from "node:assert/strict";
import test from "node:test";
import { cashierSaleSchema } from "../../src/lib/validation/cashier";
const id = "00000000-0000-4000-8000-000000000001";
const base = { operationId: "wallet-checkout-test-key", productIds: [id], productQuantities: [1], packageIds: [], packageQuantities: [], customerId: id };
test("full wallet needs no fake cash reference; split keeps five external methods", () => {
  assert.equal(cashierSaleSchema.safeParse({ ...base, method: "MEMBER_WALLET", paymentMethodCode: "MEMBER_WALLET", walletAmount: "10.00" }).success, true);
  for (const method of ["CASH", "CARD", "DUITNOW", "EWALLET", "BANK_TRANSFER"]) assert.equal(cashierSaleSchema.safeParse({ ...base, method, walletAmount: "5.00", reference: "confirmed" }).success, true);
});
test("wallet fails closed for malformed amounts, customer omission and unsupported items/tenders", () => {
  for (const walletAmount of ["-1", "NaN", "0.001", "1e2", "1000000000"])
    assert.equal(cashierSaleSchema.safeParse({ ...base, method: "CASH", walletAmount }).success, false);
  for (const patch of [{ customerId: "" }, { customerPackageIds: [id] },
    { method: "CRYPTO", reference: "ref", tenderAmount: 1, exchangeRateToMyr: 10 }])
    assert.equal(cashierSaleSchema.safeParse({ ...base, method: "CASH", walletAmount: "5", ...patch }).success, false);
});
test("Wallet permits new package purchases but not package-use redemption", () => {
  for (const method of ["CASH", "MEMBER_WALLET"]) {
    const purchase = { ...base, productIds: [], productQuantities: [], packageIds: [id], packageQuantities: [1], method, paymentMethodCode: method === "CASH" ? "BUILTIN_CASH" : method, walletAmount: "100" };
    assert.equal(cashierSaleSchema.safeParse(purchase).success, true);
    assert.equal(cashierSaleSchema.safeParse({ ...purchase, customerPackageIds: [id] }).success, false);
  }
});
test("wallet does not relax service appointment or assignment requirements", () => {
  assert.equal(cashierSaleSchema.safeParse({ ...base, method: "CASH", walletAmount: "5", serviceIds: [id], serviceQuantities: [1] }).success, false);
});
