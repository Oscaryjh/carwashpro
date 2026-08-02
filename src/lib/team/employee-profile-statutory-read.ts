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

type StatutorySection =
  | RestrictedSection
  | {
      status: "READY";
      data: {
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

  const [statutoryProfile, taxProfile] = await Promise.all([
    canViewStatutory
      ? database.employeeBusinessMembership.findFirst({
          where: { businessId: input.businessId, id: input.membershipId },
          select: {
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
            statutoryIdentityType: true,
            statutoryIdentityNumber: true,
            statutoryCountryCode: true,
            taxIdentificationNumber: true,
            statutoryProfileUpdatedAt: true,
          },
        })
      : null,
  ]);

  if ((canViewStatutory && !statutoryProfile) || (canViewTax && !taxProfile)) {
    return { status: "NOT_FOUND" };
  }

  return {
    status: "READY",
    statutory: statutoryProfile
      ? {
          status: "READY",
          data: {
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
