import assert from "node:assert/strict";
import test from "node:test";
import type { AllStoresKpi } from "../../src/lib/business-groups/all-stores-kpi";
import {
  hasGroupStoreActivity,
  rankGroupStorePerformance,
} from "../../src/lib/business-groups/group-store-performance";

test("ranks stores by net sales, gross sales, and stable identity", () => {
  const stores = [
    store("store-c", "Charlie", 0, 0),
    store("store-b", "Beta", 10_000, 11_000),
    store("store-a", "Alpha", 10_000, 12_000),
    store("store-d", "Delta", 10_000, 12_000),
  ];

  const ranked = rankGroupStorePerformance(stores);

  assert.deepEqual(
    ranked.map((item) => ({
      businessId: item.business.businessId,
      rank: item.rank,
    })),
    [
      { businessId: "store-a", rank: 1 },
      { businessId: "store-d", rank: 2 },
      { businessId: "store-b", rank: 3 },
      { businessId: "store-c", rank: 4 },
    ],
  );
  assert.deepEqual(
    stores.map((item) => item.businessId),
    ["store-c", "store-b", "store-a", "store-d"],
  );
});

test("distinguishes a verified zero period from financial activity", () => {
  assert.equal(hasGroupStoreActivity(metrics()), false);
  assert.equal(
    hasGroupStoreActivity(
      metrics({
        refundsCents: 500,
        netSalesCents: -500,
      }),
    ),
    true,
  );
});

function store(
  businessId: string,
  businessName: string,
  netSalesCents: number,
  grossSalesCents: number,
) {
  return {
    businessId,
    businessName,
    current: { netSalesCents, grossSalesCents },
  };
}

function metrics(overrides: Partial<AllStoresKpi> = {}): AllStoresKpi {
  return {
    averageTransactionValueCents: null,
    grossSalesCents: 0,
    netSalesCents: 0,
    paymentsCollectedCents: 0,
    refundsCents: 0,
    transactionCount: 0,
    ...overrides,
  };
}
