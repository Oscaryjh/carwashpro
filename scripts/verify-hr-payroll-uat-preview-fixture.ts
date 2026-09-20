import { PrismaClient } from "@prisma/client";
import {
  assertCompletePreviewFixtureEvidence,
  assertHrPayrollUatFixtureEnvironment,
  assertPreviewDatabaseContents,
  capturePreviewFixtureEvidence,
} from "./uat-preview-database-guard";
import { HR_PAYROLL_EIGHT_ROLE_PERSONAS } from "./hr-payroll-eight-role-uat-contract";

const prisma = new PrismaClient();

async function main() {
  const guard = assertHrPayrollUatFixtureEnvironment(process.env);
  if (guard.mode !== "uat-preview") {
    throw new Error("HR_UAT_FIXTURE_PREVIEW_VERIFICATION_REQUIRED");
  }
  const state = await assertPreviewDatabaseContents(prisma, guard);
  if (state.state !== "synthetic-topology" || !state.businessId) {
    throw new Error("HR_UAT_FIXTURE_SYNTHETIC_TOPOLOGY_REQUIRED");
  }

  const evidence = await capturePreviewFixtureEvidence(prisma, state.businessId);
  assertCompletePreviewFixtureEvidence(evidence);
  const branchManagerPersona = HR_PAYROLL_EIGHT_ROLE_PERSONAS.find(
    (persona) => persona.key === "BRANCH_MANAGER",
  );
  if (!branchManagerPersona?.email) {
    throw new Error("HR_UAT_FIXTURE_BRANCH_MANAGER_SCOPE_MISMATCH");
  }
  const [branchManager, boundaryBranch] = await Promise.all([
    prisma.user.findUnique({
      where: { email: branchManagerPersona.email },
      select: { branchId: true, businessId: true },
    }),
    prisma.branch.findFirst({
      where: {
        businessId: state.businessId,
        name: "Synthetic Boundary Branch",
        status: "ACTIVE",
      },
      select: { id: true },
    }),
  ]);
  if (
    !branchManager ||
    !boundaryBranch ||
    branchManager.businessId !== state.businessId ||
    branchManager.branchId !== boundaryBranch.id
  ) {
    throw new Error("HR_UAT_FIXTURE_BRANCH_MANAGER_SCOPE_MISMATCH");
  }

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
