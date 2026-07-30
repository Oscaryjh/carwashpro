import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { runAnalyticsRefreshSweep } from "../../src/lib/analytics/refresh-worker";

const prisma = new PrismaClient();

test("database lease allows one worker and persists cursor across restart", async () => {
  assertLocalDatabase();
  const checkpointKey = `integration-${randomUUID()}`;
  const now = new Date("2026-07-30T04:00:00.000Z");
  let signalStarted: (() => void) | undefined;
  let releaseFirst: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  try {
    const firstSweep = runAnalyticsRefreshSweep(
      {
        checkpointKey,
        now,
        ownerId: "integration-worker-a",
        lagMs: 5_000,
        lookbackMs: 60_000,
      },
      prisma,
      {
        refreshLateEvents: (async () => {
          signalStarted?.();
          await release;
          return [];
        }) as never,
        ensureDailyCoverage: (async () => []) as never,
      },
    );
    await started;

    let secondRefreshCalls = 0;
    const secondSweep = await runAnalyticsRefreshSweep(
      {
        checkpointKey,
        now,
        ownerId: "integration-worker-b",
        lagMs: 5_000,
        lookbackMs: 60_000,
      },
      prisma,
      {
        refreshLateEvents: (async () => {
          secondRefreshCalls += 1;
          return [];
        }) as never,
      },
    );
    assert.equal(secondSweep.status, "LOCKED");
    assert.equal(secondRefreshCalls, 0);

    releaseFirst?.();
    const firstResult = await firstSweep;
    assert.equal(firstResult.status, "IDLE");
    assert.equal(
      firstResult.processedThrough.toISOString(),
      "2026-07-30T03:59:55.000Z",
    );

    let resumedSince: Date | undefined;
    const resumedResult = await runAnalyticsRefreshSweep(
      {
        checkpointKey,
        now: new Date("2026-07-30T04:01:00.000Z"),
        ownerId: "integration-worker-c",
        lagMs: 5_000,
        lookbackMs: 60_000,
      },
      prisma,
      {
        refreshLateEvents: (async (since: Date) => {
          resumedSince = since;
          return [{ runId: "synthetic-run" }];
        }) as never,
        ensureDailyCoverage: (async () => []) as never,
      },
    );
    assert.equal(resumedResult.status, "PROCESSED");
    assert.equal(
      resumedSince?.toISOString(),
      "2026-07-30T03:59:55.000Z",
    );

    const checkpoint =
      await prisma.analyticsRefreshCheckpoint.findUniqueOrThrow({
        where: { key: checkpointKey },
      });
    assert.equal(checkpoint.leaseOwner, null);
    assert.equal(checkpoint.leaseExpiresAt, null);
    assert.equal(checkpoint.lastRunCount, 1);
    assert.equal(
      checkpoint.processedThrough.toISOString(),
      "2026-07-30T04:00:55.000Z",
    );
  } finally {
    await prisma.analyticsRefreshCheckpoint.deleteMany({
      where: { key: checkpointKey },
    });
  }
});

test("lease heartbeat prevents takeover during a long refresh", async () => {
  assertLocalDatabase();
  const checkpointKey = `heartbeat-${randomUUID()}`;
  const now = new Date();
  let signalStarted: (() => void) | undefined;
  let releaseFirst: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  try {
    const firstSweep = runAnalyticsRefreshSweep(
      {
        checkpointKey,
        now,
        ownerId: "heartbeat-worker-a",
        lagMs: 0,
        lookbackMs: 1_000,
        leaseMs: 90,
      },
      prisma,
      {
        refreshLateEvents: (async () => {
          signalStarted?.();
          await release;
          return [];
        }) as never,
        ensureDailyCoverage: (async () => []) as never,
      },
    );
    await started;
    await new Promise((resolve) => setTimeout(resolve, 180));

    const secondSweep = await runAnalyticsRefreshSweep(
      {
        checkpointKey,
        now: new Date(),
        ownerId: "heartbeat-worker-b",
        lagMs: 0,
        lookbackMs: 1_000,
        leaseMs: 90,
      },
      prisma,
      {
        refreshLateEvents: (async () => []) as never,
      },
    );
    assert.equal(secondSweep.status, "LOCKED");

    releaseFirst?.();
    const firstResult = await firstSweep;
    assert.equal(firstResult.status, "IDLE");
  } finally {
    releaseFirst?.();
    await prisma.analyticsRefreshCheckpoint.deleteMany({
      where: { key: checkpointKey },
    });
  }
});

test.after(async () => {
  await prisma.$disconnect();
});

function assertLocalDatabase() {
  assert.match(process.env.DATABASE_URL ?? "", /(?:localhost|127\.0\.0\.1)/);
}
