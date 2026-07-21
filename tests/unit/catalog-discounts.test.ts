import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateCatalogDiscountCents,
  type CatalogDiscountOption,
} from "../../src/lib/catalog-discounts";
import { catalogDiscountSchema } from "../../src/lib/validation/catalog-discounts";

function discount(
  overrides: Partial<CatalogDiscountOption> = {},
): CatalogDiscountOption {
  return {
    id: "discount-1",
    name: "Member offer",
    discountType: "PERCENTAGE",
    percentage: 10,
    fixedAmount: null,
    scope: "ALL",
    minimumSpend: 0,
    maximumDiscount: null,
    allowLoyaltyStacking: false,
    ...overrides,
  };
}

test("catalog discount applies its percentage to all eligible lines", () => {
  assert.equal(
    calculateCatalogDiscountCents({
      discount: discount(),
      lines: [
        { lineTotalCents: 10_000, type: "service" },
        { lineTotalCents: 5_000, type: "product" },
      ],
    }),
    1_500,
  );
});

test("scoped discounts only reduce matching catalog line types", () => {
  assert.equal(
    calculateCatalogDiscountCents({
      discount: discount({ percentage: 20, scope: "PRODUCTS" }),
      lines: [
        { lineTotalCents: 10_000, type: "service" },
        { lineTotalCents: 5_000, type: "product" },
        { lineTotalCents: 20_000, type: "package" },
      ],
    }),
    1_000,
  );
});

test("minimum spend prevents the rule from applying below its threshold", () => {
  assert.equal(
    calculateCatalogDiscountCents({
      discount: discount({ minimumSpend: 100 }),
      lines: [{ lineTotalCents: 9_999, type: "service" }],
    }),
    0,
  );
});

test("maximum discount caps a larger calculated discount", () => {
  assert.equal(
    calculateCatalogDiscountCents({
      discount: discount({ percentage: 50, maximumDiscount: 30 }),
      lines: [{ lineTotalCents: 10_000, type: "service" }],
    }),
    3_000,
  );
});

test("a full discount never exceeds the transaction subtotal", () => {
  assert.equal(
    calculateCatalogDiscountCents({
      discount: discount({ percentage: 100 }),
      lines: [
        { lineTotalCents: 7_001, type: "service" },
        { lineTotalCents: -500, type: "product" },
      ],
    }),
    7_001,
  );
});

test("fixed amount discounts deduct the configured ringgit amount", () => {
  assert.equal(
    calculateCatalogDiscountCents({
      discount: discount({
        discountType: "FIXED_AMOUNT",
        percentage: null,
        fixedAmount: 5,
      }),
      lines: [{ lineTotalCents: 2_500, type: "product" }],
    }),
    500,
  );
});

test("fixed amount discounts never exceed the eligible scoped subtotal", () => {
  assert.equal(
    calculateCatalogDiscountCents({
      discount: discount({
        discountType: "FIXED_AMOUNT",
        percentage: null,
        fixedAmount: 50,
        scope: "PRODUCTS",
      }),
      lines: [
        { lineTotalCents: 10_000, type: "service" },
        { lineTotalCents: 2_000, type: "product" },
      ],
    }),
    2_000,
  );
});

test("fixed amount discount validation accepts an RM value", () => {
  const result = catalogDiscountSchema.parse({
    name: "RM5 off",
    discountType: "FIXED_AMOUNT",
    fixedAmount: "5",
    percentage: null,
    scope: "ALL",
    branchId: "",
    minimumSpend: "0",
    maximumDiscount: null,
    allowLoyaltyStacking: false,
    startsAt: null,
    endsAt: null,
    active: true,
  });

  assert.equal(result.fixedAmount, 5);
  assert.equal(result.percentage, undefined);
});

test("fixed amount discount validation rejects a missing RM value", () => {
  const result = catalogDiscountSchema.safeParse({
    name: "Missing amount",
    discountType: "FIXED_AMOUNT",
    fixedAmount: "",
    percentage: null,
    scope: "ALL",
    branchId: "",
    minimumSpend: "0",
    maximumDiscount: null,
    allowLoyaltyStacking: false,
    startsAt: null,
    endsAt: null,
    active: true,
  });

  assert.equal(result.success, false);
});
