import { PrismaClient } from "@prisma/client";
import {
  assertCompletePreviewFixtureEvidence,
  assertHrPayrollUatFixtureEnvironment,
  assertPreviewDatabaseContents,
  capturePreviewFixtureEvidence,
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

  const evidence = await capturePreviewFixtureEvidence(prisma, state.businessId);
  assertCompletePreviewFixtureEvidence(evidence);

  process.stdout.write(
    `${JSON.stringify(
      {
        verified: true,
        marker: guard.syntheticBusinessSlug,
        ...evidence,
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
