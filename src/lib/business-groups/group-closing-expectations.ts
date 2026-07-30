import type { BranchStatus } from "@prisma/client";
import { getBusinessDayRange } from "@/lib/business-day";
import { addDaysToDateValue } from "@/lib/business-time";
import type {
  AuthorizedGroupBusiness,
  BusinessGroupMembershipPeriod,
} from "@/lib/business-groups/all-stores-access";
import { isDailyClosingIndustry } from "@/lib/daily-closing/types";

export type IntervalCoverage = "NONE" | "PARTIAL" | "FULL";

export type GroupClosingExpectationStatus = "COMPLETE" | "MISSING";

export type GroupClosingExpectationRow = {
  businessId: string;
  businessName: string;
  branchId: string;
  branchName: string;
  businessDate: string;
  timezone: string;
  dueAt: Date;
  status: GroupClosingExpectationStatus;
  snapshotId: string | null;
};

export type GroupClosingExpectationSummary = {
  requiredCount: number;
  completedCount: number;
  missingCount: number;
  completionPercent: number | null;
  notDueCount: number;
  notApplicableCount: number;
  partialMembershipCount: number;
  branchNotOpenCount: number;
  branchHistoryUnknownCount: number;
  unsupportedIndustryCount: number;
  unexpectedSnapshotCount: number;
};

export type GroupClosingExpectationResult = {
  rows: GroupClosingExpectationRow[];
  summary: GroupClosingExpectationSummary;
};

export type GroupClosingExpectationBusiness = Pick<
  AuthorizedGroupBusiness,
  | "id"
  | "name"
  | "industryType"
  | "timezone"
  | "businessDayCutoffTime"
  | "membershipPeriods"
> & {
  fromDateValue: string;
  toDateValue: string;
};

export type GroupClosingExpectationBranch = {
  id: string;
  businessId: string;
  name: string;
  status: BranchStatus;
  createdAt: Date;
};

export type GroupClosingExpectationSnapshot = {
  id: string;
  businessId: string;
  branchId: string;
  businessDate: string;
};

export function buildGroupClosingExpectations(input: {
  businesses: GroupClosingExpectationBusiness[];
  branches: GroupClosingExpectationBranch[];
  snapshots: GroupClosingExpectationSnapshot[];
  now: Date;
}): GroupClosingExpectationResult {
  const branchesByBusiness = groupBy(
    input.branches,
    (branch) => branch.businessId,
  );
  const snapshotByKey = new Map(
    input.snapshots.map((snapshot) => [
      closingKey(
        snapshot.businessId,
        snapshot.branchId,
        snapshot.businessDate,
      ),
      snapshot,
    ]),
  );
  const rows: GroupClosingExpectationRow[] = [];
  const requiredKeys = new Set<string>();
  let notDueCount = 0;
  let notApplicableCount = 0;
  let partialMembershipCount = 0;
  let branchNotOpenCount = 0;
  let branchHistoryUnknownCount = 0;
  let unsupportedIndustryCount = 0;

  for (const business of input.businesses) {
    const branches = branchesByBusiness.get(business.id) ?? [];
    if (!isDailyClosingIndustry(business.industryType)) {
      const excludedCount =
        countDateValues(
          business.fromDateValue,
          business.toDateValue,
        ) * branches.length;
      unsupportedIndustryCount += excludedCount;
      notApplicableCount += excludedCount;
      continue;
    }
    for (
      let businessDate = business.fromDateValue;
      businessDate <= business.toDateValue;
      businessDate = addDaysToDateValue(businessDate, 1)
    ) {
      const businessDay = getBusinessDayRange({
        fromDateValue: businessDate,
        toDateValue: businessDate,
        timezone: business.timezone,
        businessDayCutoffTime: business.businessDayCutoffTime,
      });
      const membershipCoverage = classifyIntervalCoverage(
        {
          from: businessDay.fromDate,
          toExclusive: businessDay.toDateExclusive,
        },
        membershipIntervals(business.membershipPeriods),
      );

      for (const branch of branches) {
        if (branch.status !== "ACTIVE") {
          branchHistoryUnknownCount += 1;
          notApplicableCount += 1;
          continue;
        }
        if (branch.createdAt > businessDay.fromDate) {
          branchNotOpenCount += 1;
          notApplicableCount += 1;
          continue;
        }
        if (membershipCoverage !== "FULL") {
          if (membershipCoverage === "PARTIAL") {
            partialMembershipCount += 1;
          }
          notApplicableCount += 1;
          continue;
        }
        if (businessDay.toDateExclusive > input.now) {
          notDueCount += 1;
          continue;
        }

        const key = closingKey(business.id, branch.id, businessDate);
        const snapshot = snapshotByKey.get(key);
        requiredKeys.add(key);
        rows.push({
          businessId: business.id,
          businessName: business.name,
          branchId: branch.id,
          branchName: branch.name,
          businessDate,
          timezone: business.timezone,
          dueAt: businessDay.toDateExclusive,
          status: snapshot ? "COMPLETE" : "MISSING",
          snapshotId: snapshot?.id ?? null,
        });
      }
    }
  }

  rows.sort(
    (left, right) =>
      right.businessDate.localeCompare(left.businessDate) ||
      left.businessName.localeCompare(right.businessName) ||
      left.branchName.localeCompare(right.branchName) ||
      left.branchId.localeCompare(right.branchId),
  );
  const completedCount = rows.filter(
    (row) => row.status === "COMPLETE",
  ).length;
  const requiredCount = rows.length;
  const missingCount = requiredCount - completedCount;
  const unexpectedSnapshotCount = input.snapshots.filter(
    (snapshot) =>
      !requiredKeys.has(
        closingKey(
          snapshot.businessId,
          snapshot.branchId,
          snapshot.businessDate,
        ),
      ),
  ).length;

  return {
    rows,
    summary: {
      requiredCount,
      completedCount,
      missingCount,
      completionPercent:
        requiredCount === 0
          ? null
          : Math.round((completedCount / requiredCount) * 1000) / 10,
      notDueCount,
      notApplicableCount,
      partialMembershipCount,
      branchNotOpenCount,
      branchHistoryUnknownCount,
      unsupportedIndustryCount,
      unexpectedSnapshotCount,
    },
  };
}

export function classifyIntervalCoverage(
  target: { from: Date; toExclusive: Date },
  intervals: Array<{ from: Date; toExclusive: Date | null }>,
): IntervalCoverage {
  if (target.from >= target.toExclusive) return "NONE";
  if (!intervals.length) return "FULL";

  const targetFrom = target.from.getTime();
  const targetTo = target.toExclusive.getTime();
  const merged = intervals
    .map((interval) => ({
      from: interval.from.getTime(),
      to: interval.toExclusive?.getTime() ?? Number.POSITIVE_INFINITY,
    }))
    .filter((interval) => interval.from < interval.to)
    .sort((left, right) => left.from - right.from)
    .reduce<Array<{ from: number; to: number }>>((result, interval) => {
      const previous = result[result.length - 1];
      if (!previous || interval.from > previous.to) {
        result.push({ ...interval });
      } else {
        previous.to = Math.max(previous.to, interval.to);
      }
      return result;
    }, []);

  let overlaps = false;
  for (const interval of merged) {
    if (interval.from <= targetFrom && interval.to >= targetTo) {
      return "FULL";
    }
    if (interval.from < targetTo && interval.to > targetFrom) {
      overlaps = true;
    }
  }
  return overlaps ? "PARTIAL" : "NONE";
}

export function closingKey(
  businessId: string,
  branchId: string,
  businessDate: string,
) {
  return `${businessId}:${branchId}:${businessDate}`;
}

function membershipIntervals(
  periods: BusinessGroupMembershipPeriod[] | undefined,
) {
  return (
    periods?.map((period) => ({
      from: period.joinedAt,
      toExclusive: period.removedAt,
    })) ?? []
  );
}

function groupBy<T>(
  values: T[],
  key: (value: T) => string,
): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const value of values) {
    const itemKey = key(value);
    const current = result.get(itemKey) ?? [];
    current.push(value);
    result.set(itemKey, current);
  }
  return result;
}

function countDateValues(from: string, to: string) {
  let count = 0;
  for (
    let value = from;
    value <= to;
    value = addDaysToDateValue(value, 1)
  ) {
    count += 1;
  }
  return count;
}
