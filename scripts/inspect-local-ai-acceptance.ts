import { prisma } from "../src/lib/prisma";
import { reconcileAiCommercialUsage } from "../src/lib/ai/commercial";

async function main() {
  const businessId = process.argv[2];
  if (!businessId) throw new Error("Business id required.");
  const scopeKey = `BUSINESS:${businessId}`;
  const [period, successes, quotaDenied, usage, reconciliation] = await Promise.all([
    prisma.aiAllowancePeriod.findFirst({ where: { scopeKey }, orderBy: { periodStart: "desc" }, select: { consumedRequests: true, reservedRequests: true, requestLimitSnapshot: true } }),
    prisma.aiUsageEvent.count({ where: { scopeKey, eventType: "SUCCEEDED", commerciallyCounted: true } }),
    prisma.aiUsageEvent.count({ where: { scopeKey, eventType: "QUOTA_DENIED" } }),
    prisma.aiUsage.findMany({ where: { businessId, commerciallyCounted: true }, orderBy: { createdAt: "desc" }, take: 2, select: { status: true, provider: true, inputTokens: true, outputTokens: true, totalTokens: true, providerRequestId: true } }),
    reconcileAiCommercialUsage(scopeKey),
  ]);
  process.stdout.write(`${JSON.stringify({ period, successes, quotaDenied, usage: usage.map((row) => ({ ...row, providerRequestIdCaptured: Boolean(row.providerRequestId), providerRequestId: undefined })), reconciliation })}\n`);
  await prisma.$disconnect();
}

main();
