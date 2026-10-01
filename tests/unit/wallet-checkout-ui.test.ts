import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const form = readFileSync("src/components/cashier-unified-sale-form.tsx", "utf8");
test("wallet receipt identifies wallet and external tender without exposing account balances", () => {
  const receipt = readFileSync("src/components/appointment-invoice-modal.tsx", "utf8");
  assert.match(receipt, /invoice\.walletPaidAmount/);
  assert.match(receipt, /invoice\.externalPaidAmount/);
  assert.match(receipt, /invoice\.externalPaymentMethod/);
  assert.doesNotMatch(receipt, /paidBalance|bonusBalance/);
});
test("wallet success clears sale adjustments and respects appointment checkout state", () => {
  const success = form.slice(form.indexOf("async function sendWalletIntent"), form.indexOf("function saveShiftDraft"));
  for (const reset of ['setDiscountValue("0")', 'setLoyaltyPoints("0")', 'setPerformanceTip("0")', 'setPaymentReference("")', 'setAssignedStaffId("")', 'setCashReceived("")']) assert.ok(success.includes(reset), reset);
  assert.match(success, /if \(!appointmentSale\)/);
});
test("recovery never substitutes None for a real staff ID and split cash asks only for remainder", () => {
  assert.match(form, /name \?\? \(assignedStaffId \|\| "None"\)/);
  assert.match(form, /placeholder=\{formatMoney\(externalDue\)\}/);
  assert.match(form, /amountDue=\{externalDue\}/);
});
test("zero wallet input remains ordinary tender, and full wallet omits stale converted tender", () => {
  assert.match(form, /const walletReady = !walletAmount \|\| \(walletAmountValid && walletCents === 0\)/);
  assert.match(form, /const convertedTenderReady = fullWallet \|\| !isConvertedTender/);
  assert.match(form, /name="tenderAmount" type="hidden" value=\{!fullWallet && isConvertedTender/);
});
test("recovery identity survives gate closure and is checked before an empty catalog", () => {
  const page = readFileSync("src/app/(business)/cashier/page.tsx", "utf8");
  const panel = readFileSync("src/components/cashier-sales-panel.tsx", "utf8");
  assert.match(page, /walletCheckoutScope=\{`\$\{businessId\}:\$\{user.userId\}`\}/);
  assert.match(page, /walletCheckoutEnabled=\{isWalletAccessAllowed\(\{ businessId \}\)\}/);
  assert.match(panel, /!mustRecover && !hasCatalogItems/);
  assert.match(panel, /readWalletCheckoutRecovery\(sessionStorage, props.walletCheckoutScope!/);
  assert.match(form, /walletCheckoutEnabled && walletScope && customer/);
});
