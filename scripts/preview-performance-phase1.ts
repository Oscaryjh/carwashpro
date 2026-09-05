import { PrismaClient } from "@prisma/client";
import { readPerformanceLedger } from "../src/lib/performance/read";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/^\/tetamu_performance_disposable_[a-z0-9_]+$/.test(url.pathname)) throw new Error("Read-only preview requires an explicit isolated local/test performance database.");
  const [businessId, branchId, actorUserId, yearText, monthText, asOfText] = process.argv.slice(2);
  if (![businessId, branchId, actorUserId, yearText, asOfText].every(Boolean)) throw new Error("Usage: preview-performance-phase1 <businessId> <branchId> <actorUserId> <year> [month or all] <asOf ISO timestamp>");
  const db = new PrismaClient();
  try {
    const result = { mode: "READ_ONLY_NO_BACKFILL", ...await readPerformanceLedger(
      { businessId, branchId, actorUserId },
      { year: Number(yearText), month: monthText === "all" ? undefined : Number(monthText), asOf: new Date(asOfText) }, db) };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally { await db.$disconnect(); }
}
main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : error}\n`); process.exitCode = 1; });
