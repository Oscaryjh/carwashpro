import { randomUUID } from "node:crypto";
import {
  ensureAnalyticsDailyCoverage,
  refreshLateAnalyticsEvents,
} from "@/lib/analytics/daily-store-summary";
import { prisma } from "@/lib/prisma";

export const ANALYTICS_REFRESH_CHECKPOINT_KEY = "daily-store-summary";
export const DEFAULT_ANALYTICS_REFRESH_LOOKBACK_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_ANALYTICS_REFRESH_LEASE_MS = 2 * 60 * 1000;
export const DEFAULT_ANALYTICS_REFRESH_LAG_MS = 5_000;
export const DEFAULT_ANALYTICS_COVERAGE_INTERVAL_MS = 5 * 60 * 1000;
export const DEFAULT_ANALYTICS_COVERAGE_DAYS = 2;

type AnalyticsWorkerDatabase = typeof prisma;
type RefreshLateEvents = typeof refreshLateAnalyticsEvents;
type EnsureDailyCoverage = typeof ensureAnalyticsDailyCoverage;

export class AnalyticsRefreshLeaseLostError extends Error {}

export type AnalyticsRefreshSweepResult =
  | {
      status: "LOCKED";
      processedThrough: null;
      refreshRunCount: 0;
    }
  | {
      status: "IDLE" | "PROCESSED";
      processedThrough: Date;
      refreshRunCount: number;
    };

export async function runAnalyticsRefreshSweep(
  input: {
    now?: Date;
    ownerId?: string;
    checkpointKey?: string;
    lookbackMs?: number;
    leaseMs?: number;
    lagMs?: number;
    coverageIntervalMs?: number;
    coverageDays?: number;
  } = {},
  database: AnalyticsWorkerDatabase = prisma,
  dependencies: {
    refreshLateEvents?: RefreshLateEvents;
    ensureDailyCoverage?: EnsureDailyCoverage;
  } = {},
): Promise<AnalyticsRefreshSweepResult> {
  const now = input.now ?? new Date();
  const ownerId = input.ownerId ?? randomUUID();
  const checkpointKey =
    input.checkpointKey ?? ANALYTICS_REFRESH_CHECKPOINT_KEY;
  const lookbackMs =
    input.lookbackMs ?? DEFAULT_ANALYTICS_REFRESH_LOOKBACK_MS;
  const leaseMs = input.leaseMs ?? DEFAULT_ANALYTICS_REFRESH_LEASE_MS;
  const lagMs = input.lagMs ?? DEFAULT_ANALYTICS_REFRESH_LAG_MS;
  const coverageIntervalMs =
    input.coverageIntervalMs ?? DEFAULT_ANALYTICS_COVERAGE_INTERVAL_MS;
  const coverageDays =
    input.coverageDays ?? DEFAULT_ANALYTICS_COVERAGE_DAYS;
  validateSweepInput({
    now,
    ownerId,
    checkpointKey,
    lookbackMs,
    leaseMs,
    lagMs,
    coverageIntervalMs,
    coverageDays,
  });

  const upperBound = new Date(now.getTime() - lagMs);
  const initialProcessedThrough = new Date(
    upperBound.getTime() - lookbackMs,
  );
  await database.analyticsRefreshCheckpoint.upsert({
    where: { key: checkpointKey },
    create: {
      key: checkpointKey,
      processedThrough: initialProcessedThrough,
    },
    update: {},
  });

  const leaseExpiresAt = new Date(now.getTime() + leaseMs);
  const claim = await database.analyticsRefreshCheckpoint.updateMany({
    where: {
      key: checkpointKey,
      OR: [
        { leaseOwner: null },
        { leaseExpiresAt: { lte: now } },
        { leaseOwner: ownerId },
      ],
    },
    data: {
      leaseOwner: ownerId,
      leaseExpiresAt,
      lastSweepStartedAt: now,
    },
  });
  if (claim.count === 0) {
    return {
      status: "LOCKED",
      processedThrough: null,
      refreshRunCount: 0,
    };
  }

  const checkpoint =
    await database.analyticsRefreshCheckpoint.findUniqueOrThrow({
      where: { key: checkpointKey },
      select: { processedThrough: true, lastCoverageAt: true },
    });
  const heartbeat = startAnalyticsLeaseHeartbeat({
    database,
    checkpointKey,
    ownerId,
    leaseMs,
  });

  try {
    const refreshLateEvents =
      dependencies.refreshLateEvents ?? refreshLateAnalyticsEvents;
    const ensureDailyCoverage =
      dependencies.ensureDailyCoverage ?? ensureAnalyticsDailyCoverage;
    const runs: Array<{ runId: string }> = [];
    let processedThrough = checkpoint.processedThrough;
    if (upperBound > checkpoint.processedThrough) {
      runs.push(
        ...(await refreshLateEvents(
          checkpoint.processedThrough,
          database,
          { until: upperBound },
        )),
      );
      processedThrough = upperBound;
    }
    heartbeat.assertOwned();

    let coverageCompletedAt: Date | null = null;
    if (
      !checkpoint.lastCoverageAt ||
      now.getTime() - checkpoint.lastCoverageAt.getTime() >=
        coverageIntervalMs
    ) {
      runs.push(
        ...(await ensureDailyCoverage(
          upperBound,
          database,
          { days: coverageDays },
        )),
      );
      coverageCompletedAt = new Date();
    }
    heartbeat.assertOwned();
    await heartbeat.stop();
    await completeSweep({
      database,
      checkpointKey,
      ownerId,
      processedThrough,
      refreshRunCount: runs.length,
      completedAt: new Date(),
      coverageCompletedAt,
    });
    return {
      status: runs.length > 0 ? "PROCESSED" : "IDLE",
      processedThrough,
      refreshRunCount: runs.length,
    };
  } catch (error) {
    await heartbeat.cancel();
    await database.analyticsRefreshCheckpoint.updateMany({
      where: { key: checkpointKey, leaseOwner: ownerId },
      data: {
        leaseOwner: null,
        leaseExpiresAt: null,
        lastSweepCompletedAt: new Date(),
        lastErrorMessage: errorMessage(error),
      },
    });
    throw error;
  }
}

async function completeSweep(input: {
  database: AnalyticsWorkerDatabase;
  checkpointKey: string;
  ownerId: string;
  processedThrough: Date;
  refreshRunCount: number;
  completedAt: Date;
  coverageCompletedAt: Date | null;
}) {
  const completion = await input.database.analyticsRefreshCheckpoint.updateMany({
    where: {
      key: input.checkpointKey,
      leaseOwner: input.ownerId,
    },
    data: {
      processedThrough: input.processedThrough,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastSweepCompletedAt: input.completedAt,
      lastRunCount: input.refreshRunCount,
      lastErrorMessage: null,
      ...(input.coverageCompletedAt
        ? { lastCoverageAt: input.coverageCompletedAt }
        : {}),
    },
  });
  if (completion.count !== 1) {
    throw new AnalyticsRefreshLeaseLostError(
      "Analytics refresh worker lost its lease before checkpoint completion.",
    );
  }
}

function startAnalyticsLeaseHeartbeat(input: {
  database: AnalyticsWorkerDatabase;
  checkpointKey: string;
  ownerId: string;
  leaseMs: number;
}) {
  const intervalMs = Math.max(25, Math.floor(input.leaseMs / 3));
  let stopped = false;
  let failure: unknown = null;
  let pending = Promise.resolve();
  const timer = setInterval(() => {
    pending = pending.then(async () => {
      if (stopped || failure) return;
      try {
        const renewed =
          await input.database.analyticsRefreshCheckpoint.updateMany({
            where: {
              key: input.checkpointKey,
              leaseOwner: input.ownerId,
            },
            data: {
              leaseExpiresAt: new Date(Date.now() + input.leaseMs),
            },
          });
        if (renewed.count !== 1) {
          throw new AnalyticsRefreshLeaseLostError(
            "Analytics refresh worker lost its lease during processing.",
          );
        }
      } catch (error) {
        failure = error;
        clearInterval(timer);
      }
    });
  }, intervalMs);
  timer.unref();

  function stopTimer() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  }

  return {
    assertOwned() {
      if (failure) throw failure;
    },
    async stop() {
      stopTimer();
      await pending;
      if (failure) throw failure;
    },
    async cancel() {
      stopTimer();
      await pending;
    },
  };
}

function validateSweepInput(input: {
  now: Date;
  ownerId: string;
  checkpointKey: string;
  lookbackMs: number;
  leaseMs: number;
  lagMs: number;
  coverageIntervalMs: number;
  coverageDays: number;
}) {
  if (Number.isNaN(input.now.getTime())) {
    throw new Error("Analytics refresh sweep requires a valid time.");
  }
  if (!input.ownerId.trim() || !input.checkpointKey.trim()) {
    throw new Error("Analytics refresh sweep requires owner and checkpoint IDs.");
  }
  for (const [label, value] of [
    ["lookback", input.lookbackMs],
    ["lease", input.leaseMs],
    ["lag", input.lagMs],
    ["coverage interval", input.coverageIntervalMs],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Analytics refresh ${label} must be non-negative milliseconds.`);
    }
  }
  if (input.leaseMs === 0) {
    throw new Error("Analytics refresh lease must be greater than zero.");
  }
  if (input.coverageIntervalMs === 0) {
    throw new Error("Analytics refresh coverage interval must be greater than zero.");
  }
  if (!Number.isSafeInteger(input.coverageDays) || input.coverageDays < 1 || input.coverageDays > 14) {
    throw new Error("Analytics refresh coverage days must be between 1 and 14.");
  }
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    2_000,
  );
}
