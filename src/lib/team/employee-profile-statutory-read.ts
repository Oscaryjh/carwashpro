import type { PrismaClient } from "@prisma/client";
import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { prisma } from "@/lib/prisma";
import { parseEmployeePcbProfile, type EmployeePcbProfile } from "@/lib/payroll/pcb-profile";

type EmployeeStatutoryReadInput = {
  access: ResolvedBusinessAccess;
  allowedBranchIds: readonly string[];
  businessId: string;
  membershipId: string;
};

type RestrictedSection = {
  status: "ACCESS_DENIED";
  reason: "CAPABILITY" | "WHOLE_BUSINESS_SCOPE";
};

type PayrollProfileImpact = {
  artifactCount: number;
  draftCount: number;
  finalizedCount: number;
  reviewCount: number;
};

type StatutorySection =
  | RestrictedSection
  | {
      status: "READY";
      data: {
        canEdit: boolean;
        employeeAge: number | null;
        expectedRevision: number;
        impact: PayrollProfileImpact;
        membershipId: string;
        nationality: "MALAYSIAN" | "PERMANENT_RESIDENT" | "NON_MALAYSIAN" | null;
        epfEnabled: boolean;
        epfMemberNumber: string | null;
        epfMemberNumberMasked: string | null;
        epfMemberBeforeAug1998: boolean;
        socsoEnabled: boolean;
        socsoCategory: "FIRST" | "SECOND" | null;
        socsoMemberNumber: string | null;
        socsoMemberNumberMasked: string | null;
        eisEnabled: boolean;
        eisPreviouslyContributed: boolean;
        lindung24OptIn: boolean;
        lindung24ExpectedRevision: number;
        lindung24ParticipationHistory: Array<{
          act4Covered: boolean;
          effectiveFromMonth: string;
          effectiveToMonth: string | null;
          employerContext: "SINGLE_EMPLOYER" | "MULTIPLE_EMPLOYER";
          officialSubmittedAt: string | null;
          revision: number;
          selectedEmployer: "CURRENT_BUSINESS" | "OTHER_EMPLOYER" | "PERKESO_SELECTION_PENDING";
          sourceReference: string;
          sourceType: string;
          status: "MANDATORY" | "DEFAULT_PARTICIPATING" | "VOLUNTARY_OPT_IN" | "VOLUNTARY_OPT_OUT";
        }>;
        profileUpdatedAt: string | null;
      };
    };

type TaxSection =
  | RestrictedSection
  | {
      status: "READY";
      data: {
        canEdit: boolean;
        expectedRevision: number;
        impact: PayrollProfileImpact;
        membershipId: string;
        identityType: "NEW_IC" | "OLD_IC" | "PASSPORT" | "OTHER" | null;
        identityNumber: string | null;
        identityNumberMasked: string | null;
        countryCode: string | null;
        tin: string | null;
        tinMasked: string | null;
        pcbProfile: EmployeePcbProfile | null;
        profileUpdatedAt: string | null;
      };
    };

export type EmployeeStatutoryProfileResult =
  | { status: "NOT_FOUND" }
  | {
      status: "READY";
      statutory: StatutorySection;
      tax: TaxSection;
    };

export async function loadEmployeeStatutoryProfileSection(
  input: EmployeeStatutoryReadInput,
  database: PrismaClient = prisma,
): Promise<EmployeeStatutoryProfileResult> {
  const canViewStatutory = hasBusinessCapability(
    input.access,
    "VIEW_STATUTORY_PROFILE",
  );
  const canViewTax = hasBusinessCapability(input.access, "VIEW_TAX_PROFILE");
  const canEditStatutory = hasBusinessCapability(
    input.access,
    "EDIT_STATUTORY_PROFILE",
  );
  const canEditTax = hasBusinessCapability(input.access, "EDIT_TAX_PROFILE");

  if (!canViewStatutory && !canViewTax) {
    return {
      status: "READY",
      statutory: { status: "ACCESS_DENIED", reason: "CAPABILITY" },
      tax: { status: "ACCESS_DENIED", reason: "CAPABILITY" },
    };
  }

  const activeBranchCount = await database.branch.count({
    where: { businessId: input.businessId, status: "ACTIVE" },
  });
  const hasWholeBusinessScope =
    input.allowedBranchIds.length === activeBranchCount &&
    !(
      input.access.granted &&
      input.access.effectiveBusinessRole === "STAFF" &&
      !input.access.permissions.includes("ALL_BRANCHES")
    );

  if (!hasWholeBusinessScope) {
    return {
      status: "READY",
      statutory: canViewStatutory
        ? { status: "ACCESS_DENIED", reason: "WHOLE_BUSINESS_SCOPE" }
        : { status: "ACCESS_DENIED", reason: "CAPABILITY" },
      tax: canViewTax
        ? { status: "ACCESS_DENIED", reason: "WHOLE_BUSINESS_SCOPE" }
        : { status: "ACCESS_DENIED", reason: "CAPABILITY" },
    };
  }

  const [statutoryProfile, taxProfile, impactRuns, lindung24ParticipationHistory] = await Promise.all([
    canViewStatutory
      ? database.employeeBusinessMembership.findFirst({
          where: { businessId: input.businessId, id: input.membershipId },
          select: {
            dateOfBirth: true,
            id: true,
            statutoryProfileRevision: true,
            statutoryNationality: true,
            epfEnabled: true,
            epfMemberBeforeAug1998: true,
            epfMemberNumber: true,
            socsoEnabled: true,
            socsoCategory: true,
            socsoMemberNumber: true,
            eisEnabled: true,
            eisPreviouslyContributed: true,
            lindung24OptIn: true,
            statutoryProfileUpdatedAt: true,
          },
        })
      : null,
    canViewTax
      ? database.employeeBusinessMembership.findFirst({
          where: { businessId: input.businessId, id: input.membershipId },
          select: {
            id: true,
            taxProfileRevision: true,
            statutoryIdentityType: true,
            statutoryIdentityNumber: true,
            statutoryCountryCode: true,
            taxIdentificationNumber: true,
            pcbProfile: true,
            statutoryProfileUpdatedAt: true,
          },
        })
      : null,
    canEditStatutory || canEditTax
      ? database.payrollRun.findMany({
          where: {
            businessId: input.businessId,
            entries: { some: { membershipId: input.membershipId } },
          },
          select: {
            status: true,
            _count: { select: { statutoryArtifacts: true } },
          },
        })
      : [],
    canViewStatutory
      ? (database.employeeLindung24ParticipationVersion?.findMany({
          where: { businessId: input.businessId, membershipId: input.membershipId },
          orderBy: [{ effectiveFromMonth: "asc" }, { revision: "asc" }],
          select: {
            act4Covered: true,
            effectiveFromMonth: true,
            effectiveToMonth: true,
            employerContext: true,
            officialSubmittedAt: true,
            revision: true,
            selectedEmployer: true,
            sourceReference: true,
            sourceType: true,
            status: true,
          },
        }) ?? [])
      : [],
  ]);

  if ((canViewStatutory && !statutoryProfile) || (canViewTax && !taxProfile)) {
    return { status: "NOT_FOUND" };
  }
  const impact = impactRuns.reduce<PayrollProfileImpact>(
    (result, run) => ({
      artifactCount: result.artifactCount + run._count.statutoryArtifacts,
      draftCount: result.draftCount + (run.status === "DRAFT" ? 1 : 0),
      finalizedCount:
        result.finalizedCount + (run.status === "FINALIZED" ? 1 : 0),
      reviewCount: result.reviewCount + (run.status === "REVIEW" ? 1 : 0),
    }),
    { artifactCount: 0, draftCount: 0, finalizedCount: 0, reviewCount: 0 },
  );

  return {
    status: "READY",
    statutory: statutoryProfile
      ? {
          status: "READY",
          data: {
            canEdit: canEditStatutory,
            employeeAge: calculateAge(statutoryProfile.dateOfBirth),
            expectedRevision: statutoryProfile.statutoryProfileRevision,
            impact,
            membershipId: statutoryProfile.id,
            nationality: statutoryProfile.statutoryNationality,
            epfEnabled: statutoryProfile.epfEnabled,
            epfMemberNumber: canEditTax
              ? statutoryProfile.epfMemberNumber
              : null,
            epfMemberNumberMasked: maskIdentifier(
              statutoryProfile.epfMemberNumber,
            ),
            epfMemberBeforeAug1998: statutoryProfile.epfMemberBeforeAug1998,
            socsoEnabled: statutoryProfile.socsoEnabled,
            socsoCategory: statutoryProfile.socsoCategory,
            socsoMemberNumber: canEditTax
              ? statutoryProfile.socsoMemberNumber
              : null,
            socsoMemberNumberMasked: maskIdentifier(
              statutoryProfile.socsoMemberNumber,
            ),
            eisEnabled: statutoryProfile.eisEnabled,
            eisPreviouslyContributed:
              statutoryProfile.eisPreviouslyContributed,
            lindung24OptIn: statutoryProfile.lindung24OptIn,
            lindung24ExpectedRevision:
              lindung24ParticipationHistory.at(-1)?.revision ?? 0,
            lindung24ParticipationHistory: lindung24ParticipationHistory.map((record) => ({
              ...record,
              effectiveFromMonth: record.effectiveFromMonth.toISOString(),
              effectiveToMonth: record.effectiveToMonth?.toISOString() ?? null,
              officialSubmittedAt: record.officialSubmittedAt?.toISOString() ?? null,
            })),
            profileUpdatedAt:
              statutoryProfile.statutoryProfileUpdatedAt?.toISOString() ?? null,
          },
        }
      : { status: "ACCESS_DENIED", reason: "CAPABILITY" },
    tax: taxProfile
      ? {
          status: "READY",
          data: {
            canEdit: canEditTax,
            expectedRevision: taxProfile.taxProfileRevision,
            impact,
            membershipId: taxProfile.id,
            identityType: taxProfile.statutoryIdentityType,
            identityNumber: canEditTax
              ? taxProfile.statutoryIdentityNumber
              : null,
            identityNumberMasked: maskIdentifier(
              taxProfile.statutoryIdentityNumber,
            ),
            countryCode: taxProfile.statutoryCountryCode,
            tin: canEditTax ? taxProfile.taxIdentificationNumber : null,
            tinMasked: maskIdentifier(taxProfile.taxIdentificationNumber),
            pcbProfile: parseEmployeePcbProfile(taxProfile.pcbProfile),
            profileUpdatedAt:
              taxProfile.statutoryProfileUpdatedAt?.toISOString() ?? null,
          },
        }
      : { status: "ACCESS_DENIED", reason: "CAPABILITY" },
  };
}

export function maskPayrollIdentifier(value: string | null) {
  return maskIdentifier(value);
}

function maskIdentifier(value: string | null) {
  if (!value) {
    return null;
  }
  const compact = value.replace(/[^A-Za-z0-9]/g, "");
  if (!compact) return null;
  if (compact.length <= 4) return "••••";
  return `•••• ${compact.slice(-4)}`;
}

function calculateAge(dateOfBirth: Date | null | undefined) {
  if (!dateOfBirth) return null;

  const today = new Date();
  let age = today.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const birthdayHasPassed =
    today.getUTCMonth() > dateOfBirth.getUTCMonth() ||
    (today.getUTCMonth() === dateOfBirth.getUTCMonth() &&
      today.getUTCDate() >= dateOfBirth.getUTCDate());

  if (!birthdayHasPassed) age -= 1;
  return age;
}
