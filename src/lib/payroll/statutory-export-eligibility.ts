import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SYNTHETIC_STATUTORY_EVIDENCE_NOT_EXPORTABLE } from "./statutory-evidence";

type EligibilityDatabase = Pick<
  PrismaClient | Prisma.TransactionClient,
  "payrollEntryStatutorySnapshot"
>;

export async function assertPayrollRunOfficialStatutoryExportEligible(
  input: { businessId: string; payrollRunId: string },
  database: EligibilityDatabase = prisma,
) {
  const nonExportableCount = await database.payrollEntryStatutorySnapshot.count({
    where: {
      businessId: input.businessId,
      payrollRunId: input.payrollRunId,
      OR: [
        { evidenceNature: "SYNTHETIC_TESTING" },
        { officialExportEligible: false },
      ],
    },
  });
  if (nonExportableCount > 0) {
    throw new Error(SYNTHETIC_STATUTORY_EVIDENCE_NOT_EXPORTABLE);
  }
}
