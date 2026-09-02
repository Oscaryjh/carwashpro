import { randomUUID } from "node:crypto";
import {
  runAnalyticsRefreshSweep,
  type AnalyticsRefreshSweepResult,
} from "../src/lib/analytics/refresh-worker";
import { prisma } from "../src/lib/prisma";
import {
  emitOpsAlert,
  emitScheduledJobFailure,
} from "../src/lib/ops/alerting";

const ownerId = `analytics-worker:${randomUUID()}`;
const pollIntervalMs = parsePositiveInteger(
  process.env.ANALYTICS_REFRESH_POLL_MS,
  15_000,
);
let shuttingDown = false;
let consecutiveSweepFailures = 0;
let sweepAlertActive = false;

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch(async (error) => {
  console.error("[analytics-refresh-worker] Fatal error", errorMessage(error));
  await emitScheduledJobFailure({
    job: "analytics-refresh-worker",
    code: "ANALYTICS_WORKER_FATAL",
    message: errorMessage(error),
    severity: "CRITICAL",
  }).catch(() => undefined);
  await prisma.$disconnect();
  process.exit(1);
});

async function main() {
  console.log("[analytics-refresh-worker] Started", {
    ownerId,
    pollIntervalMs,
  });

  while (!shuttingDown) {
    try {
      const result = await runAnalyticsRefreshSweep({ ownerId });
      if (sweepAlertActive) {
        await emitOpsAlert({
          event: "SCHEDULED_JOB_RECOVERED",
          severity: "INFO",
          service: process.env.RAILWAY_SERVICE_NAME ?? "tetamu-pos-worker",
          stage: "scheduled-job",
          code: "ANALYTICS_REFRESH_RECOVERED",
          message: "Analytics refresh sweep recovered.",
          status: "RECOVERED",
          jobId: "analytics-refresh-sweep",
          metadata: { consecutiveSuccesses: 1 },
        }).catch(() => undefined);
      }
      consecutiveSweepFailures = 0;
      sweepAlertActive = false;
      logSweep(result);
    } catch (error) {
      consecutiveSweepFailures += 1;
      console.error(
        "[analytics-refresh-worker] Sweep failed",
        errorMessage(error),
      );
      if (consecutiveSweepFailures >= 3 && !sweepAlertActive) {
        await emitScheduledJobFailure({
          job: "analytics-refresh-sweep",
          attempt: consecutiveSweepFailures,
          code: "ANALYTICS_REFRESH_REPEATED_FAILURE",
          message: errorMessage(error),
        }).catch(() => undefined);
        sweepAlertActive = true;
      }
    }

    if (!shuttingDown) await sleep(pollIntervalMs);
  }

  await prisma.$disconnect();
  console.log("[analytics-refresh-worker] Stopped");
}

function logSweep(result: AnalyticsRefreshSweepResult) {
  if (result.status === "PROCESSED") {
    console.log("[analytics-refresh-worker] Refreshed late events", {
      processedThrough: result.processedThrough.toISOString(),
      refreshRunCount: result.refreshRunCount,
    });
  }
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1_000 ||
    parsed > 300_000
  ) {
    throw new Error(
      "ANALYTICS_REFRESH_POLL_MS must be between 1000 and 300000.",
    );
  }
  return parsed;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function shutdown() {
  shuttingDown = true;
}
