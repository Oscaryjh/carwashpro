import assert from "node:assert/strict";
import test from "node:test";
import { getGroupReportBusinessCoverage } from "../../src/lib/business-groups/group-reports";

const range = {
  fromDateValue: "2026-07-01",
  toDateValue: "2026-07-03",
  fromDate: new Date("2026-06-30T18:00:00.000Z"),
  toDateExclusive: new Date("2026-07-03T18:00:00.000Z"),
  dayCount: 3,
  timezone: "Asia/Kuching",
  businessDayCutoffTime: "02:00",
};

test("marks legacy unrestricted and fully covered memberships as full", () => {
  assert.equal(
    getGroupReportBusinessCoverage(business(), range),
    "FULL",
  );
  assert.equal(
    getGroupReportBusinessCoverage(
      business([
        {
          joinedAt: new Date("2026-06-01T00:00:00.000Z"),
          removedAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      ]),
      range,
    ),
    "FULL",
  );
});

test("distinguishes partial coverage from no membership overlap", () => {
  assert.equal(
    getGroupReportBusinessCoverage(
      business([
        {
          joinedAt: new Date("2026-07-01T18:00:00.000Z"),
          removedAt: null,
        },
      ]),
      range,
    ),
    "PARTIAL",
  );
  assert.equal(
    getGroupReportBusinessCoverage(
      business([
        {
          joinedAt: new Date("2026-06-01T00:00:00.000Z"),
          removedAt: new Date("2026-06-15T00:00:00.000Z"),
        },
      ]),
      range,
    ),
    "NONE",
  );
});

test("merges touching membership periods and keeps exclusive boundaries", () => {
  assert.equal(
    getGroupReportBusinessCoverage(
      business([
        {
          joinedAt: range.fromDate,
          removedAt: new Date("2026-07-02T00:00:00.000Z"),
        },
        {
          joinedAt: new Date("2026-07-02T00:00:00.000Z"),
          removedAt: range.toDateExclusive,
        },
      ]),
      range,
    ),
    "FULL",
  );
  assert.equal(
    getGroupReportBusinessCoverage(
      business([
        {
          joinedAt: new Date("2026-06-01T00:00:00.000Z"),
          removedAt: range.fromDate,
        },
      ]),
      range,
    ),
    "NONE",
  );
  assert.equal(
    getGroupReportBusinessCoverage(
      business([
        {
          joinedAt: range.toDateExclusive,
          removedAt: null,
        },
      ]),
      range,
    ),
    "NONE",
  );
});

function business(
  membershipPeriods?: Array<{ joinedAt: Date; removedAt: Date | null }>,
) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Coverage Store",
    industryType: "AUTO_DETAILING" as const,
    logoUrl: null,
    timezone: "Asia/Kuching",
    businessDayCutoffTime: "02:00",
    isCurrent: true,
    membershipPeriods,
  };
}
