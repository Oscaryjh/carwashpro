import assert from "node:assert/strict";
import test from "node:test";
import {
  getGroupClosingReport,
  GroupClosingInputError,
  summarizeGroupClosings,
  type GroupClosingRow,
} from "../../src/lib/business-groups/group-closing-report";

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

test("summarizes frozen financial and cash values without inventing invalid data", () => {
  const rows = [
    closingRow({
      id: "snapshot-1",
      businessId: salon.id,
      branchId: "branch-1",
      financial: {
        grossSalesCents: 12_000,
        netSalesCents: 10_000,
        collectedCents: 8_000,
        outstandingCents: 2_000,
        refundsCents: 500,
        discountsCents: 1_500,
      },
      expectedCashCents: 5_000,
      actualCashCents: 5_000,
      cashDifferenceCents: 0,
    }),
    closingRow({
      id: "snapshot-2",
      businessId: auto.id,
      branchId: "branch-2",
      financial: {
        grossSalesCents: 20_000,
        netSalesCents: 19_000,
        collectedCents: 19_000,
        outstandingCents: 0,
        refundsCents: 1_000,
        discountsCents: 0,
      },
      expectedCashCents: 10_000,
      actualCashCents: 10_500,
      cashDifferenceCents: 500,
    }),
    closingRow({
      id: "snapshot-3",
      businessId: auto.id,
      branchId: "branch-2",
      financial: null,
      expectedCashCents: 2_000,
      actualCashCents: 1_800,
      cashDifferenceCents: -200,
    }),
  ];

  assert.deepEqual(summarizeGroupClosings(rows), {
    snapshotCount: 3,
    storeCount: 2,
    branchCount: 2,
    invalidReportCount: 1,
    grossSalesCents: 32_000,
    netSalesCents: 29_000,
    collectedCents: 27_000,
    outstandingCents: 2_000,
    refundsCents: 1_500,
    expectedCashCents: 17_000,
    actualCashCents: 17_300,
    cashDifferenceCents: 300,
    balancedCount: 1,
    overCount: 1,
    shortCount: 1,
  });
});

test("uses only authorized stores and rejects an unauthorized store filter", async () => {
  const calls: unknown[] = [];
  const database = {
    dailyClosingSnapshot: {
      findMany: async (args: unknown) => {
        calls.push(args);
        return [];
      },
    },
  };
  const result = await getGroupClosingReport(
    {
      userId: "user",
      groupId: scope.groupId,
      activeBusinessId: salon.id,
      range: "custom",
      from: "2026-07-01",
      to: "2026-07-07",
      store: salon.id,
    },
    database as never,
    {
      now: new Date("2026-07-07T12:00:00.000Z"),
      resolveScope: async () => scope,
    },
  );

  assert.equal(result?.authorizedBusinesses.length, 2);
  assert.equal(result?.filters.storeId, salon.id);
  assert.equal(calls.length, 1);
  const where = (calls[0] as { where: { OR: Array<{ businessId: string }> } })
    .where;
  assert.deepEqual(where.OR.map((item) => item.businessId), [salon.id]);

  await assert.rejects(
    () =>
      getGroupClosingReport(
        {
          userId: "user",
          groupId: scope.groupId,
          activeBusinessId: salon.id,
          store: "44444444-4444-4444-8444-444444444444",
        },
        database as never,
        { resolveScope: async () => scope },
      ),
    GroupClosingInputError,
  );
});

function closingRow(
  overrides: Partial<GroupClosingRow> &
    Pick<GroupClosingRow, "id" | "businessId" | "branchId">,
): GroupClosingRow {
  return {
    businessName: "QA Store",
    branchName: "QA Branch",
    businessDate: "2026-07-01",
    expectedCashCents: 0,
    actualCashCents: 0,
    cashDifferenceCents: 0,
    closingNote: null,
    closedAt: new Date("2026-07-01T15:00:00.000Z"),
    closedByName: "QA Owner",
    reportVersion: 1,
    financial: null,
    whatsappStatus: "NOT_QUEUED",
    ...overrides,
  };
}
