import { PrismaClient } from "@prisma/client";
import {
  assertHrPayrollUatFixtureEnvironment,
  assertPreviewDatabaseContents,
  capturePreviewFixtureCounts,
} from "./uat-preview-database-guard";

const prisma = new PrismaClient();

async function main() {
  const guard = assertHrPayrollUatFixtureEnvironment(process.env);
  if (guard.mode !== "uat-preview") {
    throw new Error("HR_UAT_FIXTURE_PREVIEW_VERIFICATION_REQUIRED");
  }
  const state = await assertPreviewDatabaseContents(prisma, guard);
  if (state.state !== "synthetic-marker" || !state.businessId) {
    throw new Error("HR_UAT_FIXTURE_SYNTHETIC_MARKER_REQUIRED");
  }

  const counts = await capturePreviewFixtureCounts(prisma, state.businessId);
  const exactCounts = {
    businesses: 1,
    employeeAccounts: 6,
    employeeMemberships: 6,
    activeDevices: 6,
    attendanceTimesheets: 1,
    leaveRequests: 2,
    leaveDays: 2,
    payrollRuns: 1,
    payrollEntries: 6,
    payslipPublications: 6,
  } as const;
  for (const [name, expected] of Object.entries(exactCounts)) {
    if (counts[name as keyof typeof counts] !== expected) {
      throw new Error("HR_UAT_FIXTURE_COUNT_MISMATCH");
    }
  }
  if (counts.payrollComponents <= 0) {
    throw new Error("HR_UAT_FIXTURE_PAYROLL_COMPONENTS_MISSING");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        verified: true,
        marker: guard.syntheticBusinessSlug,
        counts,
      },
      null,
      2,
    )}\n`,
  );
}

main()
  .catch((error: unknown) => {
    const message =
      error instanceof Error && /^HR_UAT_FIXTURE_[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "HR_UAT_FIXTURE_VERIFICATION_FAILED";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
