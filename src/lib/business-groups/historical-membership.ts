import type {
  AuthorizedGroupBusiness,
  AuthorizedGroupReportingContext,
} from "@/lib/business-groups/all-stores-access";

export type MembershipAwareEventRange = {
  businessId: string;
  gte: Date;
  lt: Date;
};

export function getReportingBusinesses(
  scope: AuthorizedGroupReportingContext,
): AuthorizedGroupBusiness[] {
  return scope.reportingBusinesses?.length
    ? scope.reportingBusinesses
    : scope.businesses;
}

export function intersectBusinessMemberships(
  business: AuthorizedGroupBusiness,
  gte: Date,
  lt: Date,
): MembershipAwareEventRange[] {
  const periods = business.membershipPeriods;
  if (!periods?.length) {
    return gte < lt ? [{ businessId: business.id, gte, lt }] : [];
  }

  return periods.flatMap((period) => {
    const effectiveFrom =
      period.joinedAt > gte ? period.joinedAt : gte;
    const effectiveTo =
      period.removedAt && period.removedAt < lt ? period.removedAt : lt;
    return effectiveFrom < effectiveTo
      ? [{ businessId: business.id, gte: effectiveFrom, lt: effectiveTo }]
      : [];
  });
}

export function isEventWithinAuthorizedMembership(
  business: AuthorizedGroupBusiness,
  occurredAt: Date,
): boolean {
  const periods = business.membershipPeriods;
  if (!periods?.length) return true;
  return periods.some(
    (period) =>
      occurredAt >= period.joinedAt &&
      (!period.removedAt || occurredAt < period.removedAt),
  );
}

export function hasMembershipOverlap(
  business: AuthorizedGroupBusiness,
  gte: Date,
  lt: Date,
): boolean {
  return intersectBusinessMemberships(business, gte, lt).length > 0;
}
