import assert from "node:assert/strict";
import test from "node:test";
import { runAnalyticsRefreshSweep } from "../../src/lib/analytics/refresh-worker";

test("claims a lease, processes a bounded window, and advances checkpoint", async () => {
  const processedThrough = new Date("2026-07-30T00:00:00.000Z");
  const now = new Date("2026-07-30T00:01:00.000Z");
  const updates: unknown[] = [];
  let updateCall = 0;
  let refreshWindow:
    | { since: Date; until: Date | undefined }
    | undefined;
  const database = {
    analyticsRefreshCheckpoint: {
      upsert: async () => ({}),
      updateMany: async (args: { data: unknown }) => {
        updateCall += 1;
        updates.push(args.data);
        return { count: 1 };
      },
      findUniqueOrThrow: async () => ({ processedThrough, lastCoverageAt: now }),
    },
  } as never;

  const result = await runAnalyticsRefreshSweep(
    {
      now,
      ownerId: "worker-a",
      lagMs: 5_000,
    },
    database,
    {
      refreshLateEvents: (async (
        since: Date,
        _database: unknown,
        options: { until?: Date },
      ) => {
        refreshWindow = { since, until: options.until };
        return [{ runId: "run-1" }, { runId: "run-2" }];
      }) as never,
    },
  );

  assert.equal(updateCall, 2);
  assert.equal(result.status, "PROCESSED");
  assert.equal(result.refreshRunCount, 2);
  assert.equal(
    result.processedThrough.toISOString(),
    "2026-07-30T00:00:55.000Z",
  );
  assert.equal(refreshWindow?.since.toISOString(), processedThrough.toISOString());
  assert.equal(
    refreshWindow?.until?.toISOString(),
    "2026-07-30T00:00:55.000Z",
  );
  assert.deepEqual(updates[1], {
    processedThrough: new Date("2026-07-30T00:00:55.000Z"),
    leaseOwner: null,
    leaseExpiresAt: null,
    lastSweepCompletedAt: updates[1] &&
      (updates[1] as { lastSweepCompletedAt: Date }).lastSweepCompletedAt,
    lastRunCount: 2,
    lastErrorMessage: null,
  });
});

test("does not process when another worker owns the lease", async () => {
  let refreshCalls = 0;
  const database = {
    analyticsRefreshCheckpoint: {
      upsert: async () => ({}),
      updateMany: async () => ({ count: 0 }),
    },
  } as never;

  const result = await runAnalyticsRefreshSweep(
    {
      now: new Date("2026-07-30T00:01:00.000Z"),
      ownerId: "worker-b",
    },
    database,
    {
      refreshLateEvents: (async () => {
        refreshCalls += 1;
        return [];
      }) as never,
    },
  );

  assert.equal(result.status, "LOCKED");
  assert.equal(refreshCalls, 0);
});

test("failure releases the lease, records the error, and preserves cursor", async () => {
  const processedThrough = new Date("2026-07-30T00:00:00.000Z");
  const updatePayloads: Array<Record<string, unknown>> = [];
  let updateCall = 0;
  const database = {
    analyticsRefreshCheckpoint: {
      upsert: async () => ({}),
      updateMany: async (args: { data: Record<string, unknown> }) => {
        updateCall += 1;
        updatePayloads.push(args.data);
        return { count: 1 };
      },
      findUniqueOrThrow: async () => ({
        processedThrough,
        lastCoverageAt: new Date("2026-07-30T00:01:00.000Z"),
      }),
    },
  } as never;

  await assert.rejects(
    runAnalyticsRefreshSweep(
      {
        now: new Date("2026-07-30T00:01:00.000Z"),
        ownerId: "worker-c",
      },
      database,
      {
        refreshLateEvents: (async () => {
          throw new Error("refresh failed");
        }) as never,
      },
    ),
    /refresh failed/,
  );

  assert.equal(updateCall, 2);
  assert.deepEqual(updatePayloads[1], {
    leaseOwner: null,
    leaseExpiresAt: null,
    lastSweepCompletedAt:
      updatePayloads[1].lastSweepCompletedAt,
    lastErrorMessage: "refresh failed",
  });
  assert.equal("processedThrough" in updatePayloads[1], false);
});

test("rejects invalid worker timing and identity settings", async () => {
  const database = {} as never;
  await assert.rejects(
    runAnalyticsRefreshSweep(
      {
        now: new Date("invalid"),
        ownerId: "worker",
      },
      database,
    ),
    /valid time/,
  );
  await assert.rejects(
    runAnalyticsRefreshSweep(
      {
        ownerId: "",
      },
      database,
    ),
    /owner and checkpoint IDs/,
  );
  await assert.rejects(
    runAnalyticsRefreshSweep(
      {
        ownerId: "worker",
        leaseMs: 0,
      },
      database,
    ),
    /lease must be greater than zero/,
  );
  await assert.rejects(
    runAnalyticsRefreshSweep(
      {
        ownerId: "worker",
        coverageIntervalMs: 0,
      },
      database,
    ),
    /coverage interval must be greater than zero/,
  );
  await assert.rejects(
    runAnalyticsRefreshSweep(
      {
        ownerId: "worker",
        coverageDays: 15,
      },
      database,
    ),
    /coverage days must be between 1 and 14/,
  );
});

test("scheduled coverage runs when due even when there are no late events", async () => {
  const processedThrough = new Date("2026-07-30T00:00:00.000Z");
  const now = new Date("2026-07-30T00:01:00.000Z");
  const updatePayloads: Array<Record<string, unknown>> = [];
  let coverageAt: Date | undefined;
  const database = {
    analyticsRefreshCheckpoint: {
      upsert: async () => ({}),
      updateMany: async (args: { data: Record<string, unknown> }) => {
        updatePayloads.push(args.data);
        return { count: 1 };
      },
      findUniqueOrThrow: async () => ({
        processedThrough,
        lastCoverageAt: null,
      }),
    },
  } as never;

  const result = await runAnalyticsRefreshSweep(
    { now, ownerId: "coverage-worker", lagMs: 5_000 },
    database,
    {
      refreshLateEvents: (async () => []) as never,
      ensureDailyCoverage: (async (at: Date) => {
        coverageAt = at;
        return [{ runId: "coverage-run" }];
      }) as never,
    },
  );

  assert.equal(result.status, "PROCESSED");
  assert.equal(result.refreshRunCount, 1);
  assert.equal(coverageAt?.toISOString(), "2026-07-30T00:00:55.000Z");
  assert.ok(updatePayloads[1].lastCoverageAt instanceof Date);
});

test("does not advance the checkpoint after losing the lease at completion", async () => {
  const processedThrough = new Date("2026-07-30T00:00:00.000Z");
  let updateCall = 0;
  const database = {
    analyticsRefreshCheckpoint: {
      upsert: async () => ({}),
      updateMany: async () => {
        updateCall += 1;
        return { count: updateCall === 1 ? 1 : 0 };
      },
      findUniqueOrThrow: async () => ({
        processedThrough,
        lastCoverageAt: new Date("2026-07-30T00:01:00.000Z"),
      }),
    },
  } as never;

  await assert.rejects(
    runAnalyticsRefreshSweep(
      {
        now: new Date("2026-07-30T00:01:00.000Z"),
        ownerId: "lease-loser",
      },
      database,
      {
        refreshLateEvents: (async () => []) as never,
      },
    ),
    /lost its lease before checkpoint completion/,
  );
  assert.equal(updateCall, 3);
});
