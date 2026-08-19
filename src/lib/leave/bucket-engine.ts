import type {
  LeaveCarryForwardExpiryRule,
  LeaveConsumptionPriority,
} from "@prisma/client";

const DAY_MS = 86_400_000;

export type AllocatableLeaveBucket = Readonly<{
  id: string;
  grantedUnits: number;
  consumedUnits: number;
  restoredUnits: number;
  expiredUnits: number;
  availableFrom: Date;
  expiresAt: Date | null;
  createdAt: Date;
}>;

export type LeaveBucketAllocation = Readonly<{
  bucketId: string;
  units: number;
}>;

function utcDate(year: number, monthIndex: number, day: number) {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, monthIndex, Math.min(day, lastDay)));
}

export function startOfUtcDate(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function leaveUnits(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateBucketRemaining(bucket: Pick<AllocatableLeaveBucket,
  "grantedUnits" | "consumedUnits" | "restoredUnits" | "expiredUnits">) {
  return leaveUnits(Math.max(0,
    bucket.grantedUnits - bucket.consumedUnits + bucket.restoredUnits - bucket.expiredUnits));
}

export function calculateCarryForward(input: {
  enabled: boolean;
  sourceRemainingUnits: number;
  limitUnits?: number | null;
}) {
  const sourceRemainingUnits = leaveUnits(Math.max(0, input.sourceRemainingUnits));
  const carriedUnits = input.enabled
    ? leaveUnits(Math.min(sourceRemainingUnits, input.limitUnits == null
      ? sourceRemainingUnits
      : Math.max(0, input.limitUnits)))
    : 0;
  return {
    sourceRemainingUnits,
    carriedUnits,
    lapsedUnits: leaveUnits(sourceRemainingUnits - carriedUnits),
  } as const;
}

export function resolveCarryForwardExpiry(input: {
  destinationPeriodStart: Date;
  destinationPeriodEnd: Date;
  rule: LeaveCarryForwardExpiryRule;
  value?: string | null;
}) {
  if (input.rule === "NO_EXPIRY") return null;
  const start = startOfUtcDate(input.destinationPeriodStart);
  let result: Date;

  if (input.rule === "DAYS_AFTER_ROLLOVER") {
    const days = Number(input.value);
    if (!Number.isInteger(days) || days < 1 || days > 3660) {
      throw new Error("Carry-forward expiry days must be between 1 and 3660.");
    }
    result = new Date(start.getTime() + (days - 1) * DAY_MS);
  } else if (input.rule === "MONTHS_AFTER_ROLLOVER") {
    const months = Number(input.value);
    if (!Number.isInteger(months) || months < 1 || months > 120) {
      throw new Error("Carry-forward expiry months must be between 1 and 120.");
    }
    const boundary = utcDate(start.getUTCFullYear(), start.getUTCMonth() + months, start.getUTCDate());
    result = new Date(boundary.getTime() - DAY_MS);
  } else {
    const match = /^(\d{2})-(\d{2})$/.exec(input.value ?? "");
    if (!match) throw new Error("Fixed carry-forward expiry must use MM-DD.");
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      throw new Error("Fixed carry-forward expiry must use a valid MM-DD date.");
    }
    result = utcDate(start.getUTCFullYear(), month - 1, day);
    if (result < start) result = utcDate(start.getUTCFullYear() + 1, month - 1, day);
  }

  const periodEnd = startOfUtcDate(input.destinationPeriodEnd);
  return result > periodEnd ? periodEnd : result;
}

export function allocateLeaveConsumption(input: {
  requestedUnits: number;
  asOf: Date;
  priority: LeaveConsumptionPriority;
  buckets: readonly AllocatableLeaveBucket[];
}) {
  const asOf = startOfUtcDate(input.asOf);
  let unallocatedUnits = leaveUnits(Math.max(0, input.requestedUnits));
  const eligible = input.buckets
    .filter((bucket) => startOfUtcDate(bucket.availableFrom) <= asOf)
    .filter((bucket) => !bucket.expiresAt || startOfUtcDate(bucket.expiresAt) >= asOf)
    .filter((bucket) => calculateBucketRemaining(bucket) > 0)
    .sort((left, right) => {
      if (input.priority === "EARLIEST_EXPIRY_FIRST") {
        const leftExpiry = left.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const rightExpiry = right.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
        if (leftExpiry !== rightExpiry) return leftExpiry - rightExpiry;
      }
      const available = left.availableFrom.getTime() - right.availableFrom.getTime();
      if (available !== 0) return available;
      const created = left.createdAt.getTime() - right.createdAt.getTime();
      return created !== 0 ? created : left.id.localeCompare(right.id);
    });

  const allocations: LeaveBucketAllocation[] = [];
  for (const bucket of eligible) {
    if (unallocatedUnits <= 0) break;
    const units = leaveUnits(Math.min(calculateBucketRemaining(bucket), unallocatedUnits));
    if (units > 0) allocations.push({ bucketId: bucket.id, units });
    unallocatedUnits = leaveUnits(unallocatedUnits - units);
  }

  return {
    allocations,
    allocatedUnits: leaveUnits(input.requestedUnits - unallocatedUnits),
    unallocatedUnits,
  } as const;
}

export function canRestoreAllocationToBucket(input: { expiresAt: Date | null; cancelledAt: Date }) {
  return !input.expiresAt
    || startOfUtcDate(input.expiresAt) >= startOfUtcDate(input.cancelledAt);
}
