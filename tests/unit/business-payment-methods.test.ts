import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultBusinessPaymentMethods,
  mergeBusinessPaymentMethods,
} from "../../src/lib/payments/business-methods";

test("uses safe default checkout methods when a business has no overrides", () => {
  const methods = mergeBusinessPaymentMethods([]);
  assert.deepEqual(methods, defaultBusinessPaymentMethods);
  assert.equal(methods.some((method) => method.canonicalMethod === "DUITNOW"), true);
});

test("merges built-in visibility changes with custom reporting aliases", () => {
  const methods = mergeBusinessPaymentMethods([
    {
      id: "00000000-0000-4000-8000-000000000001",
      code: "BUILTIN_CARD",
      label: "Card terminal",
      canonicalMethod: "CARD",
      paymentKind: "LOCAL_TENDER",
      settlementCurrency: "MYR",
      assetSymbol: null,
      behavior: "STANDARD_TENDER",
      builtIn: true,
      active: false,
      sortOrder: 20,
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      code: "CUSTOM_TNG",
      label: "Touch & Go",
      canonicalMethod: "EWALLET",
      paymentKind: "LOCAL_TENDER",
      settlementCurrency: "MYR",
      assetSymbol: null,
      behavior: "STANDARD_TENDER",
      builtIn: false,
      active: true,
      sortOrder: 25,
    },
  ]);

  const card = methods.find((method) => method.code === "BUILTIN_CARD");
  const touchNGo = methods.find((method) => method.code === "CUSTOM_TNG");
  assert.equal(card?.active, false);
  assert.equal(card?.label, "Card terminal");
  assert.equal(touchNGo?.canonicalMethod, "EWALLET");
  assert.equal(methods.indexOf(touchNGo!), 2);
});

test("never exposes PACKAGE as a configurable checkout payment alias", () => {
  const methods = mergeBusinessPaymentMethods([
    {
      id: "00000000-0000-4000-8000-000000000003",
      code: "CUSTOM_PACKAGE",
      label: "Package",
      canonicalMethod: "PACKAGE",
      paymentKind: "LOCAL_TENDER",
      settlementCurrency: "MYR",
      assetSymbol: null,
      behavior: "STANDARD_TENDER",
      builtIn: false,
      active: true,
      sortOrder: 5,
    },
  ]);
  assert.equal(methods.some((method) => String(method.canonicalMethod) === "PACKAGE"), false);
});

test("keeps foreign currency and crypto methods distinct from MYR cash and e-wallet", () => {
  const methods = mergeBusinessPaymentMethods([
    {
      id: "00000000-0000-4000-8000-000000000004",
      code: "CUSTOM_USD",
      label: "US Dollar Cash",
      canonicalMethod: "FOREIGN_CURRENCY",
      paymentKind: "FOREIGN_CURRENCY",
      settlementCurrency: "USD",
      assetSymbol: null,
      behavior: "STANDARD_TENDER",
      builtIn: false,
      active: true,
      sortOrder: 70,
    },
    {
      id: "00000000-0000-4000-8000-000000000005",
      code: "CUSTOM_BTC",
      label: "Bitcoin",
      canonicalMethod: "CRYPTO",
      paymentKind: "CRYPTO_ASSET",
      settlementCurrency: "MYR",
      assetSymbol: "BTC",
      behavior: "STANDARD_TENDER",
      builtIn: false,
      active: true,
      sortOrder: 80,
    },
  ]);

  const usd = methods.find((method) => method.code === "CUSTOM_USD");
  const bitcoin = methods.find((method) => method.code === "CUSTOM_BTC");
  assert.equal(usd?.canonicalMethod, "FOREIGN_CURRENCY");
  assert.equal(usd?.settlementCurrency, "USD");
  assert.equal(bitcoin?.canonicalMethod, "CRYPTO");
  assert.equal(bitcoin?.assetSymbol, "BTC");
});
