import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { prisma } from "../src/lib/prisma";

type FreshArtifact = {
  environment: string;
  businessId: string;
  leavePolicy: {
    id: string;
    versionId: string;
  };
};

async function main() {
  const artifact = JSON.parse(
    readFileSync(
      path.join(process.cwd(), ".tmp", "hr-payroll-fresh-e2e.json"),
      "utf8",
    ),
  ) as FreshArtifact;

  if (artifact.environment !== "LOCAL FRESH E2E") {
    throw new Error("Refusing to repair a non-local Fresh E2E artifact.");
  }

  const repairedVersionId = await prisma.$transaction(async (transaction) => {
    const policy = await transaction.leavePolicy.findFirstOrThrow({
      where: {
        id: artifact.leavePolicy.id,
        businessId: artifact.businessId,
        origin: "BUSINESS_CUSTOM",
      },
      select: { id: true },
    });
    const version = await transaction.leavePolicyVersion.findFirstOrThrow({
      where: {
        id: artifact.leavePolicy.versionId,
        policyId: policy.id,
        businessId: artifact.businessId,
        origin: "BUSINESS_CUSTOM",
      },
      select: {
        id: true,
        revision: true,
        effectiveFrom: true,
        effectiveTo: true,
        nameSnapshot: true,
        payTreatment: true,
        countMode: true,
        balanceTracked: true,
        defaultEntitlementDays: true,
        underTwoYearsDays: true,
        twoToFiveYearsDays: true,
        fiveYearsPlusDays: true,
        requiresDocument: true,
        allowNegativeBalance: true,
        statutoryCategory: true,
        entitlementPeriodType: true,
        customYearStartMonth: true,
        customYearStartDay: true,
        prorationMethod: true,
        entitlementRounding: true,
        eligibleEmploymentTypes: true,
        carryForwardEnabled: true,
        carryForwardLimitUnits: true,
        carryForwardExpiryRule: true,
        carryForwardExpiryValue: true,
        consumptionPriority: true,
        createdById: true,
      },
    });

    await transaction.leavePolicy.update({
      where: { id: policy.id },
      data: { legalStatus: "COMPANY_POLICY_ONLY" },
    });
    const existingRepairedVersion = await transaction.leavePolicyVersion.findFirst({
      where: {
        businessId: artifact.businessId,
        policyId: policy.id,
        origin: "BUSINESS_CUSTOM",
        legalStatus: "COMPANY_POLICY_ONLY",
      },
      orderBy: { revision: "desc" },
      select: { id: true },
    });
    const repairedVersion = existingRepairedVersion ?? await transaction.leavePolicyVersion.create({
      data: {
        businessId: artifact.businessId,
        policyId: policy.id,
        revision: version.revision + 1,
        effectiveFrom: version.effectiveFrom,
        effectiveTo: version.effectiveTo,
        nameSnapshot: version.nameSnapshot,
        payTreatment: version.payTreatment,
        countMode: version.countMode,
        balanceTracked: version.balanceTracked,
        defaultEntitlementDays: version.defaultEntitlementDays,
        underTwoYearsDays: version.underTwoYearsDays,
        twoToFiveYearsDays: version.twoToFiveYearsDays,
        fiveYearsPlusDays: version.fiveYearsPlusDays,
        requiresDocument: version.requiresDocument,
        allowNegativeBalance: version.allowNegativeBalance,
        origin: "BUSINESS_CUSTOM",
        legalStatus: "COMPANY_POLICY_ONLY",
        statutoryCategory: version.statutoryCategory,
        entitlementPeriodType: version.entitlementPeriodType,
        customYearStartMonth: version.customYearStartMonth,
        customYearStartDay: version.customYearStartDay,
        prorationMethod: version.prorationMethod,
        entitlementRounding: version.entitlementRounding,
        eligibleEmploymentTypes: version.eligibleEmploymentTypes,
        carryForwardEnabled: version.carryForwardEnabled,
        carryForwardLimitUnits: version.carryForwardLimitUnits,
        carryForwardExpiryRule: version.carryForwardExpiryRule,
        carryForwardExpiryValue: version.carryForwardExpiryValue,
        consumptionPriority: version.consumptionPriority,
        sourceReference: "LOCAL_FRESH_E2E_BASELINE_REPAIR",
        reason: "Repair Fresh E2E company-policy fixture classification.",
        createdById: version.createdById,
      },
      select: { id: true },
    });
    return repairedVersion.id;
  });
  artifact.leavePolicy.versionId = repairedVersionId;
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  writeFileSync(
    path.join(process.cwd(), ".tmp", "hr-payroll-fresh-e2e.json"),
    serialized,
  );
  writeFileSync(
    path.join(process.cwd(), "..", "CodexTetamuP0-staff-ui", ".tmp", "hr-payroll-fresh-e2e.json"),
    serialized,
  );

  process.stdout.write(
    `${JSON.stringify({
      environment: artifact.environment,
      repaired: true,
      legalStatus: "COMPANY_POLICY_ONLY",
    })}\n`,
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
