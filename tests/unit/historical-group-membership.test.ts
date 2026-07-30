import assert from "node:assert/strict";
import test from "node:test";
import {
  getReportingBusinesses,
  intersectBusinessMemberships,
  isEventWithinAuthorizedMembership,
} from "../../src/lib/business-groups/historical-membership";
import { getAllStoresKpiReport } from "../../src/lib/business-groups/all-stores-kpi";

const historicalBusiness = {
  id: "historical",
  name: "Historical Store",
  industryType: "GENERAL_SERVICE" as const,
  logoUrl: null,
  timezone: "UTC",
  businessDayCutoffTime: "00:00",
  isCurrent: false,
  membershipPeriods: [
    {
      joinedAt: new Date("2026-01-15T00:00:00.000Z"),
      removedAt: new Date("2026-01-18T00:00:00.000Z"),
    },
    {
      joinedAt: new Date("2026-03-01T00:00:00.000Z"),
      removedAt: null,
    },
  ],
};

test("membership intersections use inclusive join and exclusive removal boundaries", () => {
  assert.deepEqual(
    intersectBusinessMemberships(
      historicalBusiness,
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-04-01T00:00:00.000Z"),
    ),
    [
      {
        businessId: "historical",
        gte: new Date("2026-01-15T00:00:00.000Z"),
        lt: new Date("2026-01-18T00:00:00.000Z"),
      },
      {
        businessId: "historical",
        gte: new Date("2026-03-01T00:00:00.000Z"),
        lt: new Date("2026-04-01T00:00:00.000Z"),
      },
    ],
  );
  assert.equal(
    isEventWithinAuthorizedMembership(
      historicalBusiness,
      new Date("2026-01-14T23:59:59.999Z"),
    ),
    false,
  );
  assert.equal(
    isEventWithinAuthorizedMembership(
      historicalBusiness,
      new Date("2026-01-15T00:00:00.000Z"),
    ),
    true,
  );
  assert.equal(
    isEventWithinAuthorizedMembership(
      historicalBusiness,
      new Date("2026-01-18T00:00:00.000Z"),
    ),
    false,
  );
});

test("reporting scope keeps removed stores separate from current navigation stores", () => {
  const currentBusiness = {
    ...historicalBusiness,
    id: "current",
    name: "Current Store",
    isCurrent: true,
    membershipPeriods: undefined,
  };
  const scope = {
    groupId: "group",
    groupName: "Group",
    role: "GROUP_OWNER" as const,
    canViewAllStores: true,
    businesses: [currentBusiness],
    reportingBusinesses: [historicalBusiness, currentBusiness],
  };

  assert.deepEqual(
    getReportingBusinesses(scope).map((business) => business.id),
    ["historical", "current"],
  );
  assert.deepEqual(scope.businesses.map((business) => business.id), [
    "current",
  ]);
});

test("All Stores KPI excludes events before joining and at or after removal", async () => {
  const currentA = {
    ...historicalBusiness,
    id: "current-a",
    name: "Current A",
    isCurrent: true,
    membershipPeriods: [
      {
        joinedAt: new Date("2026-02-01T00:00:00.000Z"),
        removedAt: null,
      },
    ],
  };
  const currentB = {
    ...currentA,
    id: "current-b",
    name: "Current B",
    isCurrent: false,
  };
  const scope = {
    groupId: "group",
    groupName: "Group",
    role: "GROUP_OWNER" as const,
    canViewAllStores: true,
    businesses: [currentA, currentB],
    reportingBusinesses: [historicalBusiness, currentA, currentB],
  };
  let invoiceWhere: unknown;
  const database = {
    invoice: {
      findMany: async (args: { where: unknown }) => {
        invoiceWhere = args.where;
        return [
          invoiceAt("before-join", "2026-01-14T23:59:59.999Z"),
          invoiceAt("at-join", "2026-01-15T00:00:00.000Z"),
          invoiceAt("before-removal", "2026-01-17T23:59:59.999Z"),
          invoiceAt("at-removal", "2026-01-18T00:00:00.000Z"),
        ];
      },
    },
    payment: { findMany: async () => [] },
    paymentRefund: { findMany: async () => [] },
  } as never;

  const report = await getAllStoresKpiReport(
    {
      userId: "owner",
      groupId: "group",
      activeBusinessId: "current-a",
      range: "custom",
      from: "2026-01-01",
      to: "2026-01-31",
    },
    database,
    { resolveScope: async () => scope },
  );

  assert.equal(report?.authorizedBusinessCount, 1);
  assert.deepEqual(
    report?.businesses.map((business) => business.businessId),
    ["historical"],
  );
  assert.equal(report?.current.transactionCount, 2);
  assert.equal(report?.current.grossSalesCents, 2_000);
  assert.match(JSON.stringify(invoiceWhere), /2026-01-15/);
  assert.match(JSON.stringify(invoiceWhere), /2026-01-18/);
});

function invoiceAt(id: string, issuedAt: string) {
  return {
    id,
    businessId: "historical",
    issuedAt: new Date(issuedAt),
    total: "10.00",
    tipAmount: "0.00",
    discountAmount: "0.00",
    loyaltyDiscountAmount: "0.00",
    payments: [],
  };
}
