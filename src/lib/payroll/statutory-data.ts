import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parsePayrollMonth } from "@/lib/payroll/service";
import type {
  StatutoryBusinessProfile,
  StatutorySubmissionRun,
} from "@/lib/payroll/statutory-submission";

export async function loadStatutorySubmissionData(
  businessId: string,
  month: string,
  database: Pick<PrismaClient, "businessStatutoryProfile" | "payrollRun"> = prisma,
) {
  const period = parsePayrollMonth(month);
  const [storedProfile, storedRun] = await Promise.all([
    database.businessStatutoryProfile.findUnique({ where: { businessId } }),
    database.payrollRun.findUnique({
      where: {
        businessId_periodStart_periodEnd: {
          businessId,
          periodStart: period.start,
          periodEnd: period.end,
        },
      },
      include: {
        entries: {
          orderBy: { fullNameSnapshot: "asc" },
          include: {
            membership: {
              select: {
                statutoryIdentityType: true,
                statutoryIdentityNumber: true,
                statutoryCountryCode: true,
                epfMemberNumber: true,
                socsoMemberNumber: true,
                taxIdentificationNumber: true,
              },
            },
          },
        },
        statutorySubmissions: {
          orderBy: [{ provider: "asc" }, { revision: "desc" }],
          include: { artifact: true },
        },
      },
    }),
  ]);

  const profile: StatutoryBusinessProfile | null = storedProfile && {
    epfEmployerNumber: storedProfile.epfEmployerNumber,
    perkesoEmployerCode: storedProfile.perkesoEmployerCode,
    perkesoRegistrationNumber: storedProfile.perkesoRegistrationNumber,
    lhdnEmployerNumberHq: storedProfile.lhdnEmployerNumberHq,
    lhdnEmployerNumber: storedProfile.lhdnEmployerNumber,
  };
  const run: StatutorySubmissionRun | null = storedRun && {
    id: storedRun.id,
    status: storedRun.status,
    periodStart: storedRun.periodStart,
    entries: storedRun.entries.map((entry) => ({
      id: entry.id,
      membershipId: entry.membershipId,
      employeeCode: entry.employeeCodeSnapshot,
      fullName: entry.fullNameSnapshot,
      epfWageBase: Number(entry.epfWageBase),
      perkesoWageBase: Number(entry.perkesoWageBase),
      epfEmployee: Number(entry.epfEmployee),
      employerEpf: Number(entry.employerEpf),
      socsoEmployee: Number(entry.socsoEmployee),
      employerSocso: Number(entry.employerSocso),
      eisEmployee: Number(entry.eisEmployee),
      employerEis: Number(entry.employerEis),
      lindung24Employee: Number(entry.lindung24Employee),
      pcb: Number(entry.pcb),
      membership: entry.membership,
    })),
  };

  return {
    period,
    profile,
    run,
    submissions: storedRun?.statutorySubmissions ?? [],
  };
}
