import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateCreditNoteAmounts,
  calculatePackageTax,
  calculateTax,
} from "../../src/lib/tax/calculator";

test("calculates SST from taxable service lines", () => {
  const result = calculateTax({
    sstEnabled: true,
    sstRate: 6,
    lines: [
      { lineTotal: 100, taxable: true },
      { lineTotal: 50, taxable: false },
    ],
  });

  assert.equal(result.subtotal, 150);
  assert.equal(result.taxableSubtotal, 100);
  assert.equal(result.tax, 6);
  assert.equal(result.total, 156);
  assert.deepEqual(result.lineTax, [6, 0]);
});

test("applies an explicit service rate after discount allocation", () => {
  const result = calculateTax({
    sstEnabled: true,
    sstRate: 6,
    discount: 10,
    tip: 5,
    lines: [
      { lineTotal: 100, taxable: true, taxRate: 8 },
      { lineTotal: 100, taxable: true },
    ],
  });

  assert.equal(result.taxableSubtotal, 190);
  assert.equal(result.tax, 13.3);
  assert.equal(result.tip, 5);
  assert.equal(result.total, 208.3);
  assert.deepEqual(result.lineDiscount, [5, 5]);
});

test("returns no tax when SST is disabled", () => {
  const result = calculateTax({
    sstEnabled: false,
    sstRate: 6,
    lines: [{ lineTotal: 100, taxable: true }],
  });

  assert.equal(result.tax, 0);
  assert.equal(result.taxableSubtotal, 0);
  assert.equal(result.total, 100);
  assert.deepEqual(result.lineTax, [0]);
});

test("exposes the allocated line discount for package coverage", () => {
  const result = calculateTax({
    sstEnabled: true,
    sstRate: 6,
    discount: 15,
    lines: [
      { lineTotal: 100, taxable: true },
      { lineTotal: 50, taxable: true },
    ],
  });

  assert.deepEqual(result.lineDiscount, [10, 5]);
  assert.deepEqual(result.lineTax, [5.4, 2.7]);
  assert.equal(result.total, 143.1);
});

test("calculates package tax using the service taxability and rate", () => {
  const taxable = calculatePackageTax({
    price: 100,
    taxable: true,
    sstEnabled: true,
    sstRate: 6,
  });
  const exempt = calculatePackageTax({
    price: 100,
    taxable: false,
    sstEnabled: true,
    sstRate: 6,
  });

  assert.equal(taxable.total, 106);
  assert.equal(taxable.tax, 6);
  assert.equal(exempt.total, 100);
  assert.equal(exempt.tax, 0);
});

test("allocates a refund into credit note subtotal and tax", () => {
  const result = calculateCreditNoteAmounts({
    invoiceSubtotal: 100,
    invoiceTax: 6,
    invoiceTotal: 106,
    refundTotal: 53,
  });

  assert.equal(result.subtotal, 50);
  assert.equal(result.tax, 3);
  assert.equal(result.total, 53);
});
