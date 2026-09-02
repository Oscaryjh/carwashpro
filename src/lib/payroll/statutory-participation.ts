import { createHash } from "node:crypto";
import type {
  StatutoryParticipationSourceType,
  StatutoryParticipationStatus,
  StatutoryScheme,
} from "@prisma/client";

export const STATUTORY_PARTICIPATION_BLOCKERS = {
  MISSING: "STATUTORY_PARTICIPATION_MISSING",
  OVERLAP: "STATUTORY_PARTICIPATION_OVERLAP",
  AMBIGUOUS: "STATUTORY_PARTICIPATION_AMBIGUOUS",
  INVALID: "STATUTORY_PARTICIPATION_INVALID",
} as const;

export type StatutoryParticipationPeriod = {
  id: string;
  businessId: string;
  membershipId: string;
  scheme: StatutoryScheme;
  revision: number;
  effectiveFromMonth: Date;
  effectiveToMonth: Date | null;
  status: StatutoryParticipationStatus;
  sourceType: StatutoryParticipationSourceType;
  sourceReference: string | null;
  reason: string;
  sourceDigest: string;
  confirmedAt: Date;
};

export type StatutoryParticipationResolution =
  | {
      status: "RESOLVED";
      participationStatus: StatutoryParticipationStatus;
      source: "CANONICAL_PERIOD";
      period: StatutoryParticipationPeriod;
    }
  | {
      status: "RESOLVED";
      participationStatus: StatutoryParticipationStatus;
      source: "LEGACY_STATIC_BRIDGE";
      period: null;
    }
  | {
      status: "BLOCKED";
      blockerCode: (typeof STATUTORY_PARTICIPATION_BLOCKERS)[
        keyof typeof STATUTORY_PARTICIPATION_BLOCKERS
      ];
      period: null;
    };

export function resolveStatutoryParticipationForPayrollPeriod(input: {
  businessId: string;
  membershipId: string;
  scheme: StatutoryScheme;
  statutoryPeriod: Date;
  records: readonly StatutoryParticipationPeriod[];
  legacyEnabled: boolean;
  legacyStateUnambiguous?: boolean;
}): StatutoryParticipationResolution {
  const month = monthStart(input.statutoryPeriod);
  const scoped = input.records.filter(
    (record) =>
      record.businessId === input.businessId &&
      record.membershipId === input.membershipId &&
      record.scheme === input.scheme,
  );
  const applicable = scoped.filter(
    (record) =>
      month.getTime() >= monthStart(record.effectiveFromMonth).getTime() &&
      (!record.effectiveToMonth ||
        month.getTime() < monthStart(record.effectiveToMonth).getTime()),
  );

  if (applicable.length > 1) {
    return {
      status: "BLOCKED",
      blockerCode: STATUTORY_PARTICIPATION_BLOCKERS.OVERLAP,
      period: null,
    };
  }
  if (applicable.length === 1) {
    return {
      status: "RESOLVED",
      participationStatus: applicable[0].status,
      source: "CANONICAL_PERIOD",
      period: applicable[0],
    };
  }

  // Once a governed timeline exists, gaps and future-only rows are evidence
  // gaps. Never fall back to the mutable current boolean for those months.
  if (scoped.length > 0) {
    return {
      status: "BLOCKED",
      blockerCode: STATUTORY_PARTICIPATION_BLOCKERS.MISSING,
      period: null,
    };
  }
  if (input.legacyStateUnambiguous === false) {
    return {
      status: "BLOCKED",
      blockerCode: STATUTORY_PARTICIPATION_BLOCKERS.AMBIGUOUS,
      period: null,
    };
  }
  return {
    status: "RESOLVED",
    participationStatus: input.legacyEnabled
      ? "PARTICIPATING"
      : "NOT_PARTICIPATING",
    source: "LEGACY_STATIC_BRIDGE",
    period: null,
  };
}

export function validateStatutoryParticipationPeriod(input: {
  effectiveFromMonth: Date;
  effectiveToMonth: Date | null;
  sourceReference: string | null;
  sourceType: StatutoryParticipationSourceType;
}) {
  const from = monthStart(input.effectiveFromMonth);
  const to = input.effectiveToMonth
    ? monthStart(input.effectiveToMonth)
    : null;
  if (to && to.getTime() <= from.getTime()) {
    throw new Error(STATUTORY_PARTICIPATION_BLOCKERS.INVALID);
  }
  if (
    input.sourceType !== "LEGACY_REVIEW" &&
    !input.sourceReference?.trim()
  ) {
    throw new Error(STATUTORY_PARTICIPATION_BLOCKERS.INVALID);
  }
}

export function statutoryParticipationDigest(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function monthStart(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
