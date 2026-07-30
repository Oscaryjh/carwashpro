import {
  compareDailyStoreSummaryRange,
  refreshDailyStoreSummaries,
  refreshLateAnalyticsEvents,
} from "../src/lib/analytics/daily-store-summary";
import { prisma } from "../src/lib/prisma";

function option(name: string) {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

function hasFlag(name: string) {
  return process.argv.slice(2).includes(`--${name}`);
}

async function main() {
  const lateSince = option("late-since");
  if (lateSince) {
    const since = new Date(lateSince);
    const results = await refreshLateAnalyticsEvents(since);
    console.log(
      JSON.stringify(
        {
          mode: "late-event",
          since: since.toISOString(),
          runs: results,
        },
        null,
        2,
      ),
    );
    return;
  }

  const fromDate = option("from");
  const toDate = option("to") ?? fromDate;
  if (!fromDate || !toDate) {
    throw new Error(
      "Usage: npm run analytics:refresh -- --from=YYYY-MM-DD [--to=YYYY-MM-DD] [--business=UUID]",
    );
  }
  const businessIds = option("business")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const triggerOption = option("trigger") ?? "MANUAL";
  if (triggerOption !== "MANUAL" && triggerOption !== "BACKFILL") {
    throw new Error("Refresh trigger must be MANUAL or BACKFILL.");
  }

  const result = await refreshDailyStoreSummaries({
    fromDate,
    toDate,
    businessIds,
    trigger: triggerOption,
  });
  const comparison = hasFlag("compare")
    ? await compareDailyStoreSummaryRange({
        fromDate,
        toDate,
        businessIds,
      })
    : null;
  console.log(
    JSON.stringify(
      {
        mode: "date-range",
        ...result,
        sourceWatermark: result.sourceWatermark?.toISOString() ?? null,
        comparison,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
