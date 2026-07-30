import { ANALYTICS_REFRESH_CHECKPOINT_KEY } from "../src/lib/analytics/refresh-worker";
import {
  getAllStoresKpiReport,
  type AllStoresRange,
} from "../src/lib/business-groups/all-stores-kpi";
import { prisma } from "../src/lib/prisma";

function option(name: string) {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

async function main() {
  const groupId = option("group");
  if (!groupId) {
    throw new Error(
      "Usage: npm run analytics:check-all-stores -- --group=UUID [--range=today|7days|30days]",
    );
  }
  const range = (option("range") ?? "30days") as AllStoresRange;
  if (!["today", "7days", "30days"].includes(range)) {
    throw new Error("Health-check range must be today, 7days, or 30days.");
  }
  const [account, member, checkpoint] = await Promise.all([
    prisma.businessGroupUser.findFirst({
      where: { groupId, role: "GROUP_OWNER" },
      select: { userId: true },
    }),
    prisma.businessGroupMember.findFirst({
      where: { groupId, removedAt: null },
      select: { businessId: true },
    }),
    prisma.analyticsRefreshCheckpoint.findUnique({
      where: { key: ANALYTICS_REFRESH_CHECKPOINT_KEY },
      select: {
        processedThrough: true,
        lastSweepCompletedAt: true,
        lastCoverageAt: true,
        lastErrorMessage: true,
      },
    }),
  ]);
  if (!account || !member) {
    throw new Error("An active Group Owner and current store are required.");
  }

  const report = await getAllStoresKpiReport(
    {
      userId: account.userId,
      groupId,
      activeBusinessId: member.businessId,
      range,
    },
    prisma,
    { analyticsReadMode: "PRIMARY" },
  );
  if (!report) {
    throw new Error("The selected Group is not authorized for All Stores.");
  }

  const result = {
    status:
      report.dataSource === "DAILY_SUMMARY" ? "HEALTHY" : "FALLBACK",
    groupId,
    range,
    storeCount: report.authorizedBusinessCount,
    dataSource: report.dataSource,
    fallbackReason: report.analyticsFallbackReason,
    worker: checkpoint
      ? {
          processedThrough: checkpoint.processedThrough.toISOString(),
          lastSweepCompletedAt:
            checkpoint.lastSweepCompletedAt?.toISOString() ?? null,
          lastCoverageAt:
            checkpoint.lastCoverageAt?.toISOString() ?? null,
          lastErrorMessage: checkpoint.lastErrorMessage,
        }
      : null,
  };
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "HEALTHY") process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
