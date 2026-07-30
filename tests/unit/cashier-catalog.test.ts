import assert from "node:assert/strict";
import test from "node:test";
import { resolveCashierCatalogAvailability } from "../../src/lib/cashier/catalog";

test("cashier catalog opens the first available catalog type without relying on sales history", () => {
  assert.deepEqual(
    resolveCashierCatalogAvailability({
      packageCount: 10,
      productCount: 10,
      serviceCount: 10,
    }),
    {
      hasItems: true,
      initialType: "service",
      packageCount: 10,
      productCount: 10,
      serviceCount: 10,
    },
  );

  assert.equal(
    resolveCashierCatalogAvailability({
      packageCount: 3,
      productCount: 4,
      serviceCount: 0,
    }).initialType,
    "product",
  );

  assert.equal(
    resolveCashierCatalogAvailability({
      packageCount: 3,
      productCount: 0,
      serviceCount: 0,
    }).initialType,
    "package",
  );

  assert.equal(
    resolveCashierCatalogAvailability({
      packageCount: 0,
      productCount: 0,
      serviceCount: 0,
    }).hasItems,
    false,
  );
});
