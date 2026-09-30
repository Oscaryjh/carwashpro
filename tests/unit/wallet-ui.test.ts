import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, rm, access } from "node:fs/promises";
import { join } from "node:path";
const require = createRequire(import.meta.url);
let directory: string;
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
async function ui() {
  assert.equal(await access("src/components/wallet/wallet-views.tsx").then(() => true, () => false), true, "shared wallet presentation must exist");
  directory ??= await mkdtemp(join(process.cwd(), "node_modules/.cache/wallet-ui-"));
  await build({ entryPoints: ["src/components/wallet/wallet-views.tsx"], bundle: true, platform: "node", format: "cjs", packages: "external", outfile: join(directory, "ui.cjs") });
  return require(join(directory, "ui.cjs"));
}
test("wallet summary separates credit from loyalty and suppresses Staff history/details", async () => {
  const { WalletSummaryView } = await ui();
  const render = (ownerDetails: unknown, canTopUp: boolean) => renderToStaticMarkup(createElement(WalletSummaryView, { panel: { totalBalance: "0.00", hasAccount: false, canTopUp, ownerDetails }, onTopUp() {}, onHistory() {}, entry: "customer" }));
  const staff = render(null, false);
  assert.match(staff, /RM 0\.00/);
  assert.doesNotMatch(staff, /View transactions|Paid credit|Bonus credit|>Top up</);
  const owner = render({ paidBalance: "1000.00", bonusBalance: "100.00" }, true);
  assert.match(owner, /View transactions/);
  assert.match(owner, /Paid credit/);
  assert.match(owner, /RM 1,000\.00/);
  assert.match(owner, />Top up</);
  assert.doesNotMatch(owner, /Loyalty|Use wallet/);
});
test("offer form derives receive and has version, no delete, explicit paid/bonus constraints", async () => {
  const { WalletTopUpOfferForm } = await ui();
  const html = renderToStaticMarkup(createElement(WalletTopUpOfferForm, { businessId: "biz", offer: { id: "offer", version: 3, name: "Offer", paidAmount: "1000.00", bonusAmount: "100.00", active: true }, pending: false, onSubmit() {} }));
  assert.match(html, /RM 1,100\.00/);
  assert.match(html, /name="version"[^>]*value="3"/);
  assert.doesNotMatch(html, /name="totalCredited"|Delete/);
  assert.match(html.match(/<input[^>]*name="paidAmount"[^>]*>/)?.[0] ?? "", /min="0.01"/);
});
test("confirmation shows actual result, payment and staff without sales invoice wording", async () => {
  const { WalletConfirmation } = await ui();
  const html = renderToStaticMarkup(createElement(WalletConfirmation, { customerName: "Synthetic customer", staffName: "Synthetic cashier", receipt: { paidAmount: "1000.00", bonusAmount: "100.00", totalCredited: "1100.00", totalBalance: "1450.00", postedAt: "2026-09-30T00:00:00Z", offerNameSnapshot: "Synthetic offer", paymentMethodLabel: "Cash", reference: "ref" }, onDone() {} }));
  assert.match(html, /Top-up successful/);
  assert.match(html, /RM 1,450\.00/);
  assert.match(html, /Synthetic cashier/);
  assert.doesNotMatch(html, /Sales invoice|SST/);
});

test("restored pending confirmation displays the original CARD offer, reference and amounts and retries exactly once", async () => {
  const { WalletTopUpIntent } = await import("../../src/lib/wallet/top-up-intent");
  let saved: string | null = null;
  const storage = { read: () => saved, write: (value: string) => { saved = value; }, remove: () => { saved = null; } };
  const original = new WalletTopUpIntent(storage);
  const request = original.confirm({ customerId: "customer", offerId: "original-offer", expectedOfferVersion: 7, paymentMethodCode: "BUILTIN_CARD", reference: "CARD-123" }, {
    offerName: "Original offer", paymentMethodLabel: "Card", paidAmount: "1000.00", bonusAmount: "100.00", totalCredited: "1100.00",
  });
  const restored = new WalletTopUpIntent(storage);
  const { WalletPendingConfirmation } = await ui();
  assert.ok(WalletPendingConfirmation, "pending recovery must render its saved confirmation, not current defaults");
  const html = renderToStaticMarkup(createElement(WalletPendingConfirmation, { confirmation: restored.confirmation }));
  assert.match(html, /Original offer/);
  assert.match(html, /Card/);
  assert.match(html, /CARD-123/);
  assert.match(html, /RM 1,000\.00/);
  assert.match(html, /RM 100\.00/);
  assert.match(html, /RM 1,100\.00/);
  assert.doesNotMatch(html, /Cash|select|input/);
  assert.deepEqual(restored.confirm({ customerId: "wrong", offerId: "new-offer", expectedOfferVersion: 8, paymentMethodCode: "BUILTIN_CASH", reference: "changed" }), request);
  assert.equal(restored.confirm(request!), null);
  assert.deepEqual(Object.keys(request!).sort(), ["customerId", "expectedOfferVersion", "offerId", "operationKey", "paymentMethodCode", "reference"]);
});

test("legacy pending payload remains retryable without inventing original amounts or default Cash", async () => {
  const { WalletTopUpIntent } = await import("../../src/lib/wallet/top-up-intent");
  const request = { customerId: "customer", offerId: "legacy-offer", expectedOfferVersion: 3, paymentMethodCode: "BUILTIN_CARD", reference: "legacy-ref", operationKey: "original-key" };
  const restored = new WalletTopUpIntent({ read: () => JSON.stringify(request), write() {}, remove() {} });
  const { WalletPendingConfirmation } = await ui();
  assert.ok(WalletPendingConfirmation);
  const html = renderToStaticMarkup(createElement(WalletPendingConfirmation, { confirmation: restored.confirmation }));
  assert.match(html, /legacy-offer/);
  assert.match(html, /BUILTIN_CARD/);
  assert.match(html, /legacy-ref/);
  assert.match(html, /Original amounts were not saved/);
  assert.doesNotMatch(html, /Cash|RM 0/);
  assert.deepEqual(restored.confirm(request), request);
});
