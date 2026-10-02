import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { crmUiBoundaries } from "../helpers/crm-ui-fixture";

const require = createRequire(import.meta.url);
let directory: string;
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
async function component(name: "wallet-views" | "wallet-offers") {
  directory ??= await mkdtemp(join(process.cwd(), "node_modules/.cache/wallet-offers-ui-"));
  const outfile = join(directory, `${name}.cjs`);
  await build({ entryPoints: [`src/components/wallet/${name}.tsx`], outfile, bundle: true, platform: "node", format: "cjs", packages: "external", loader: { ".css": "empty" }, plugins: [crmUiBoundaries()] });
  return require(outfile);
}
const offer = { id: "offer", version: 4, name: "Summer credit", paidAmount: "1000.00", bonusAmount: "100.00", totalCredited: "1100.00", active: false };

test("create offer starts Active with zero preview, required name and non-submitting Cancel", async () => {
  const { WalletTopUpOfferForm } = await component("wallet-views");
  const html = renderToStaticMarkup(createElement(WalletTopUpOfferForm, { businessId: "business", pending: false, onSubmit() {}, onCancel() {} }));
  assert.match(html, /Offer name/);
  assert.match(html, /Top-up amount \(RM\)/);
  assert.match(html, /Bonus credit \(RM\)/);
  assert.match(html, /Total wallet credit/);
  assert.match(html, /RM 0\.00/);
  assert.doesNotMatch(html, /—|Customer pays|Wallet receives/);
  assert.match(html, /<option value="true" selected="">Active/);
  const nameInput = html.match(/<input[^>]*name="name"[^>]*>/)?.[0] ?? "";
  assert.match(nameInput, /required=""/);
  assert.match(nameInput, /maxLength="160"/);
  assert.match(html, /<button type="button"[^>]*>Cancel<\/button>/);
  assert.match(html, /<button type="submit"[^>]*>Create offer<\/button>/);
});

test("edit offer keeps saved values/status/version and derives total with paid/bonus composition", async () => {
  const { WalletTopUpOfferForm } = await component("wallet-views");
  const html = renderToStaticMarkup(createElement(WalletTopUpOfferForm, { businessId: "business", offer, pending: false, onSubmit() {}, onCancel() {} }));
  assert.match(html, /RM 1,100\.00/);
  assert.match(html, /RM 1,000\.00 top-up \+ RM 100\.00 bonus credit/);
  assert.match(html, /Amount the customer pays\./);
  assert.match(html, /Extra wallet credit given by the business\./);
  assert.match(html, /name="version"[^>]*value="4"/);
  assert.match(html, /name="name"[^>]*value="Summer credit"/);
  assert.match(html, /<option value="false" selected="">Inactive/);
  for (const [name, minimum] of [["paidAmount", "0.01"], ["bonusAmount", "0"]]) {
    const input = html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? "";
    assert.ok(input.includes(`min="${minimum}"`));
    assert.match(input, /step="0.01"/);
    assert.match(input, /required=""/);
  }
  assert.doesNotMatch(html, /name="totalCredited"/);
  assert.match(html, />Save changes<\/button>/);
});

test("invalid preview falls back to zero rather than dash or a misleading nonzero total", async () => {
  const { WalletTopUpOfferForm } = await component("wallet-views");
  for (const paidAmount of ["", "0", "0.00", "-1", "1.234", "invalid"]) {
    const html = renderToStaticMarkup(createElement(WalletTopUpOfferForm, { businessId: "business", offer: { ...offer, paidAmount }, pending: false, onSubmit() {} }));
    assert.match(html, /<strong>RM 0\.00<\/strong>/);
    assert.doesNotMatch(html, /—|top-up \+/);
  }
});

test("decimal preview uses existing exact cents calculation and rejects invalid bonus inputs", async () => {
  const { WalletTopUpOfferForm } = await component("wallet-views");
  for (const [paidAmount, bonusAmount, expected] of [["12.34", "0.66", "RM 13.00"], ["0.60", "0.60", "RM 1.20"], ["10", "0", "RM 10.00"], ["10", "-1", "RM 0.00"], ["10", "", "RM 0.00"], ["10", "0.001", "RM 0.00"]]) {
    const html = renderToStaticMarkup(createElement(WalletTopUpOfferForm, { businessId: "business", offer: { ...offer, paidAmount, bonusAmount }, pending: false, onSubmit() {} }));
    assert.ok(html.includes(`<strong>${expected}</strong>`));
  }
});

test("saving disables both cancel and submit without changing editable field semantics", async () => {
  const { WalletTopUpOfferForm } = await component("wallet-views");
  const html = renderToStaticMarkup(createElement(WalletTopUpOfferForm, { businessId: "business", offer, pending: true, onSubmit() {}, onCancel() {} }));
  assert.match(html, /<button type="button"[^>]*disabled=""[^>]*>Cancel<\/button>/);
  assert.match(html, /<button type="submit"[^>]*disabled=""[^>]*>Saving…<\/button>/);
  assert.doesNotMatch(html, /<(input|select)[^>]*disabled/);
});

test("offer table retains six columns and exposes signed bonus plus emphasized total", async () => {
  const { WalletOffers } = await component("wallet-offers");
  const html = renderToStaticMarkup(createElement(WalletOffers, { businessId: "business", initialOffers: [offer] }));
  assert.equal((html.match(/<th(?:\s|>)/g) ?? []).length, 6);
  for (const label of ["Offer name", "Top-up amount", "Bonus credit", "Total wallet credit"]) assert.ok(html.includes(label));
  assert.match(html, /\+RM 100\.00/);
  assert.match(html, /<strong>RM 1,100\.00<\/strong>/);
  assert.match(html, />Edit<\/button>/);
  assert.match(html, />Activate<\/button>/);
  assert.doesNotMatch(html, /Customer pays|Wallet receives/);
});

test("empty offers explains next step without adding a second create CTA", async () => {
  const { WalletOffers } = await component("wallet-offers");
  const html = renderToStaticMarkup(createElement(WalletOffers, { businessId: "business", initialOffers: [] }));
  assert.match(html, /No top-up offers yet/);
  assert.match(html, /Create your first wallet top-up offer\./);
  assert.equal((html.match(/>Create offer<\/button>/g) ?? []).length, 1);
  assert.match(html, /colSpan="6"/);
});
