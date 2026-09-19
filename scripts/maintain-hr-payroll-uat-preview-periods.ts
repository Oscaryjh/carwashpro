import { PrismaClient } from "@prisma/client";
import { maintainApprovedBoundaryPeriods } from "./uat-preview-boundary-payroll-maintenance";

const database = new PrismaClient();
async function main() {
  if (process.argv.length !== 2) throw new Error("HR_UAT_PERIOD_MAINTENANCE_ARGUMENTS_FORBIDDEN");
  const proof = await maintainApprovedBoundaryPeriods(database, process.env);
  process.stdout.write(`${JSON.stringify({ maintenance: "approved-r5-boundary-periods", ...proof })}\n`);
}
main().catch((error: unknown) => {
  const message = error instanceof Error && /^HR_UAT_(?:PERIOD_MAINTENANCE|FIXTURE)_[A-Z0-9_]+$/.test(error.message)
    ? error.message : "HR_UAT_PERIOD_MAINTENANCE_TRANSACTION_FAILED";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}).finally(() => database.$disconnect());
