import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGroupClosingExpectations,
  classifyIntervalCoverage,
} from "../../src/lib/business-groups/group-closing-expectations";

const business = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "QA Salon",
  industryType: "SALON_BEAUTY" as const,
  timezone: "UTC",
  businessDayCutoffTime: "00:00",
  membershipPeriods: [
    {
      joinedAt: new Date("2026-01-01T00:00:00.000Z"),
      removedAt: null,
    },
  ],
  fromDateValue: "2026-07-01",
  toDateValue: "2026-07-02",
};
const branch = {
  id: "22222222-2222-4222-8222-222222222222",
  businessId: business.id,
  name: "Main Branch",
  status: "ACTIVE" as const,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

test("counts only ended business days and matches snapshots by branch-date", () => {
  const result = buildGroupClosingExpectations({
    businesses: [business],
    branches: [branch],
    snapshots: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        businessId: business.id,
        branchId: branch.id,
        businessDate: "2026-07-01",
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        businessId: business.id,
        branchId: branch.id,
        businessDate: "2026-07-02",
      },
    ],
    now: new Date("2026-07-02T12:00:00.000Z"),
  });

  assert.deepEqual(
    result.rows.map((row) => ({
      businessDate: row.businessDate,
      status: row.status,
    })),
    [{ businessDate: "2026-07-01", status: "COMPLETE" }],
  );
  assert.equal(result.summary.requiredCount, 1);
  assert.equal(result.summary.completedCount, 1);
  assert.equal(result.summary.missingCount, 0);
  assert.equal(result.summary.completionPercent, 100);
  assert.equal(result.summary.notDueCount, 1);
  assert.equal(result.summary.unexpectedSnapshotCount, 1);
});

test("marks a due branch-date missing and returns N/A when nothing is due", () => {
  const missing = buildGroupClosingExpectations({
    businesses: [{ ...business, toDateValue: "2026-07-01" }],
    branches: [branch],
    snapshots: [],
    now: new Date("2026-07-02T00:00:00.000Z"),
  });
  assert.equal(missing.rows[0]?.status, "MISSING");
  assert.equal(missing.summary.missingCount, 1);
  assert.equal(missing.summary.completionPercent, 0);

  const open = buildGroupClosingExpectations({
    businesses: [{ ...business, toDateValue: "2026-07-01" }],
    branches: [branch],
    snapshots: [],
    now: new Date("2026-07-01T23:59:59.999Z"),
  });
  assert.equal(open.summary.requiredCount, 0);
  assert.equal(open.summary.notDueCount, 1);
  assert.equal(open.summary.completionPercent, null);
});

test("excludes partial membership, branches created mid-day, and unsupported industries", () => {
  const partialMembership = buildGroupClosingExpectations({
    businesses: [
      {
        ...business,
        toDateValue: "2026-07-01",
        membershipPeriods: [
          {
            joinedAt: new Date("2026-07-01T12:00:00.000Z"),
            removedAt: null,
          },
        ],
      },
    ],
    branches: [branch],
    snapshots: [],
    now: new Date("2026-07-02T00:00:00.000Z"),
  });
  assert.equal(partialMembership.summary.requiredCount, 0);
  assert.equal(partialMembership.summary.partialMembershipCount, 1);

  const lateBranch = buildGroupClosingExpectations({
    businesses: [{ ...business, toDateValue: "2026-07-01" }],
    branches: [
      {
        ...branch,
        createdAt: new Date("2026-07-01T12:00:00.000Z"),
      },
    ],
    snapshots: [],
    now: new Date("2026-07-02T00:00:00.000Z"),
  });
  assert.equal(lateBranch.summary.branchNotOpenCount, 1);
  assert.equal(lateBranch.summary.requiredCount, 0);

  const unsupported = buildGroupClosingExpectations({
    businesses: [
      {
        ...business,
        industryType: "GENERAL_SERVICE" as const,
        toDateValue: "2026-07-01",
      },
    ],
    branches: [branch],
    snapshots: [],
    now: new Date("2026-07-02T00:00:00.000Z"),
  });
  assert.equal(unsupported.summary.unsupportedIndustryCount, 1);
  assert.equal(unsupported.summary.requiredCount, 0);
});

test("classifies merged full, partial, and absent interval coverage", () => {
  const target = {
    from: new Date("2026-07-01T00:00:00.000Z"),
    toExclusive: new Date("2026-07-02T00:00:00.000Z"),
  };
  assert.equal(
    classifyIntervalCoverage(target, [
      {
        from: new Date("2026-06-30T00:00:00.000Z"),
        toExclusive: new Date("2026-07-01T12:00:00.000Z"),
      },
      {
        from: new Date("2026-07-01T12:00:00.000Z"),
        toExclusive: null,
      },
    ]),
    "FULL",
  );
  assert.equal(
    classifyIntervalCoverage(target, [
      {
        from: new Date("2026-07-01T12:00:00.000Z"),
        toExclusive: null,
      },
    ]),
    "PARTIAL",
  );
  assert.equal(
    classifyIntervalCoverage(target, [
      {
        from: new Date("2026-07-02T00:00:00.000Z"),
        toExclusive: null,
      },
    ]),
    "NONE",
  );
});
