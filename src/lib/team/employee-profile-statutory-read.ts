import type { PrismaClient } from "@prisma/client";
import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { prisma } from "@/lib/prisma";

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
        expectedRevision: number;
        impact: PayrollProfileImpact;
        membershipId: string;
        nationality: "MALAYSIAN" | "PERMANENT_RESIDENT" | "NON_MALAYSIAN" | null;
        epfEnabled: boolean;
        epfMemberNumberMasked: string | null;
        epfMemberBeforeAug1998: boolean;
        socsoEnabled: boolean;
        socsoCategory: "FIRST" | "SECOND" | null;
        socsoMemberNumberMasked: string | null;
        eisEnabled: boolean;
        eisPreviouslyContributed: boolean;
        lindung24OptIn: boolean;
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
        identityNumberMasked: string | null;
        countryCode: string | null;
        tinMasked: string | null;
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

  const [statutoryProfile, taxProfile, impactRuns] = await Promise.all([
    canViewStatutory
      ? database.employeeBusinessMembership.findFirst({
          where: { businessId: input.businessId, id: input.membershipId },
          select: {
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
            expectedRevision: statutoryProfile.statutoryProfileRevision,
            impact,
            membershipId: statutoryProfile.id,
            nationality: statutoryProfile.statutoryNationality,
            epfEnabled: statutoryProfile.epfEnabled,
            epfMemberNumberMasked: maskIdentifier(
              statutoryProfile.epfMemberNumber,
            ),
            epfMemberBeforeAug1998: statutoryProfile.epfMemberBeforeAug1998,
            socsoEnabled: statutoryProfile.socsoEnabled,
            socsoCategory: statutoryProfile.socsoCategory,
            socsoMemberNumberMasked: maskIdentifier(
              statutoryProfile.socsoMemberNumber,
            ),
            eisEnabled: statutoryProfile.eisEnabled,
            eisPreviouslyContributed:
              statutoryProfile.eisPreviouslyContributed,
            lindung24OptIn: statutoryProfile.lindung24OptIn,
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
            identityNumberMasked: maskIdentifier(
              taxProfile.statutoryIdentityNumber,
            ),
            countryCode: taxProfile.statutoryCountryCode,
            tinMasked: maskIdentifier(taxProfile.taxIdentificationNumber),
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
  if (!value) return null;
  const compact = value.replace(/[^A-Za-z0-9]/g, "");
  if (!compact) return null;
  if (compact.length <= 4) return "••••";
  return `•••• ${compact.slice(-4)}`;
}
