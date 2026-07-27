import assert from "node:assert/strict";
import test from "node:test";
import {
  getGroupReports,
  GroupReportsInputError,
  parseGroupReportFilters,
} from "../../src/lib/business-groups/group-reports";

const salon = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "QA Salon",
  industryType: "SALON_BEAUTY" as const,
  logoUrl: null,
  timezone: "Asia/Kuching",
  businessDayCutoffTime: "02:00",
  isCurrent: true,
};
const auto = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "QA Auto",
  industryType: "AUTO_DETAILING" as const,
  logoUrl: null,
  timezone: "Asia/Tokyo",
  businessDayCutoffTime: "04:00",
  isCurrent: false,
};
const scope = {
  groupId: "33333333-3333-4333-8333-333333333333",
  groupName: "QA Group",
  role: "GROUP_OWNER" as const,
  canViewAllStores: true,
  businesses: [salon, auto],
};

test("validates store, payment method, status, page, and 31-day range", () => {
  assert.deepEqual(
    parseGroupReportFilters(
      {
        range: "custom",
        from: "2026-07-01",
        to: "2026-07-31",
        store: salon.id,
        paymentMethod: "cash",
        status: "partial",
        page: "2",
      },
      scope,
    ),
    {
      range: "custom",
      from: "2026-07-01",
      to: "2026-07-31",
      storeId: salon.id,
      paymentMethod: "CASH",
      status: "PARTIAL",
      page: 2,
    },
  );
  assert.throws(
    () => parseGroupReportFilters({ store: crypto.randomUUID() }, scope),
    GroupReportsInputError,
  );
  assert.throws(
    () => parseGroupReportFilters({ paymentMethod: "PACKAGE" }, scope),
    /valid payment method/,
  );
  assert.throws(
    () => parseGroupReportFilters({ status: "cancelled" }, scope),
    /valid transaction status/,
  );
  assert.throws(
    () => parseGroupReportFilters({ page: "0" }, scope),
    /valid report page/,
  );
  assert.throws(
    () =>
      parseGroupReportFilters(
        {
          range: "custom",
          from: "2026-07-01",
          to: "2026-08-01",
        },
        scope,
      ),
    /cannot exceed 31/,
  );
});

test("uses five bounded queries and keeps payment/refund events in their own business period", async () => {
  const calls: Array<{ model: string; operation: string; args: unknown }> = [];
  const invoice = {
    id: "44444444-4444-4444-8444-444444444444",
    businessId: salon.id,
    invoiceNumber: "QA-001",
    issuedAt: new Date("2026-06-30T20:00:00.000Z"),
    total: "120.00",
    discountAmount: "10.00",
    loyaltyDiscountAmount: "5.00",
    tipAmount: "10.00",
    balance: "25.00",
    status: "PARTIAL" as const,
    customer: { name: "QA Customer" },
    payments: [
      {
        amount: "20.00",
        method: "PACKAGE" as const,
        paidAt: new Date("2026-06-30T20:00:00.000Z"),
      },
      {
        amount: "50.00",
        method: "CASH" as const,
        paidAt: new Date("2026-06-30T21:00:00.000Z"),
      },
      {
        amount: "25.00",
        method: "CARD" as const,
        paidAt: new Date("2026-07-01T21:00:00.000Z"),
      },
    ],
    refunds: [
      {
        amount: "5.00",
        method: "CASH" as const,
        refundedAt: new Date("2026-06-30T22:00:00.000Z"),
      },
    ],
  };
  const database = {
    invoice: {
      findMany: async (args: unknown) => {
        calls.push({ model: "invoice", operation: "findMany", args });
        return calls.filter((call) => call.model === "invoice").length === 1
          ? [
              {
                businessId: salon.id,
                discountAmount: "10.00",
                id: invoice.id,
                issuedAt: invoice.issuedAt,
                loyaltyDiscountAmount: "5.00",
                payments: [{ amount: "20.00" }],
                tipAmount: "10.00",
                total: "120.00",
              },
            ]
          : [invoice];
      },
      count: async (args: unknown) => {
        calls.push({ model: "invoice", operation: "count", args });
        return 1;
      },
    },
    payment: {
      findMany: async (args: unknown) => {
        calls.push({ model: "payment", operation: "findMany", args });
        return [
          {
            amount: "50.00",
            businessId: salon.id,
            paidAt: new Date("2026-06-30T21:00:00.000Z"),
          },
        ];
      },
    },
    paymentRefund: {
      findMany: async (args: unknown) => {
        calls.push({ model: "refund", operation: "findMany", args });
        return [
          {
            amount: "5.00",
            businessId: salon.id,
            refundedAt: new Date("2026-06-30T22:00:00.000Z"),
          },
        ];
      },
    },
  };

  const result = await getGroupReports(
    {
      userId: "user",
      groupId: scope.groupId,
      activeBusinessId: salon.id,
      range: "custom",
      from: "2026-07-01",
      to: "2026-07-01",
      paymentMethod: "CASH",
      status: "PARTIAL",
    },
    database as never,
    { resolveScope: async () => scope },
  );

  assert.equal(calls.length, 5);
  assert.equal(result?.summary.grossSalesCents, 10_500);
  assert.equal(result?.summary.netSalesCents, 8_500);
  assert.equal(result?.summary.paymentsCollectedCents, 5_000);
  assert.equal(result?.summary.refundsCents, 500);
  assert.equal(result?.summary.transactionCount, 1);
  assert.equal(result?.rows.length, 1);
  assert.equal(result?.rows[0].paidAmountCents, 5_000);
  assert.equal(result?.rows[0].refundAmountCents, 500);
  assert.equal(result?.rows[0].packageRedemptionCents, 2_000);
  assert.deepEqual(result?.rows[0].paymentMethods, ["CASH"]);
  const paged = calls.find(
    (call) =>
      call.model === "invoice" &&
      call.operation === "findMany" &&
      "take" in (call.args as object),
  )?.args as { take: number; skip: number; orderBy: unknown };
  assert.equal(paged.take, 25);
  assert.equal(paged.skip, 0);
  assert.deepEqual(paged.orderBy, [{ issuedAt: "desc" }, { id: "desc" }]);
});

test("returns null before any report query when authorization is unavailable", async () => {
  let queried = false;
  const database = {
    invoice: {
      findMany: async () => {
        queried = true;
        return [];
      },
      count: async () => 0,
    },
    payment: { findMany: async () => [] },
    paymentRefund: { findMany: async () => [] },
  };
  const result = await getGroupReports(
    {
      userId: "user",
      groupId: scope.groupId,
      activeBusinessId: salon.id,
    },
    database as never,
    { resolveScope: async () => null },
  );
  assert.equal(result, null);
  assert.equal(queried, false);
});
