import type { PrismaClient } from "@prisma/client";
import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { toSafeEmployeeBankVersion } from "@/lib/payroll/payment/bank-account-service";
import type { PaymentCryptoEnvironment } from "@/lib/payroll/payment/bank-account-crypto";
import { prisma } from "@/lib/prisma";

type EmployeeBankSectionInput = {
  access: ResolvedBusinessAccess;
  allowedBranchIds: readonly string[];
  businessId: string;
  membershipId: string;
};

export type EmployeeBankSectionResult =
  | { status: "NOT_FOUND" }
  | {
      status: "ACCESS_DENIED";
      reason: "CAPABILITY" | "WHOLE_BUSINESS_SCOPE";
    }
  | {
      status: "READY";
      data: {
        bank:
          | (ReturnType<typeof toSafeEmployeeBankVersion> & {
              accountNumber: string;
            })
          | null;
        canEdit: boolean;
        canVerify: boolean;
        membershipId: string;
      };
    };

export async function loadEmployeeBankSection(
  input: EmployeeBankSectionInput,
  database: PrismaClient = prisma,
  _environment?: PaymentCryptoEnvironment,
): Promise<EmployeeBankSectionResult> {
  if (!hasBusinessCapability(input.access, "VIEW_BANK_ACCOUNT")) {
    return { status: "ACCESS_DENIED", reason: "CAPABILITY" };
  }

  const activeBranches = await database.branch.findMany({
    where: { businessId: input.businessId, status: "ACTIVE" },
    select: { id: true },
  });
  const allowed = new Set(input.allowedBranchIds);
  const hasWholeBusinessScope =
    allowed.size === activeBranches.length &&
    activeBranches.every((branch) => allowed.has(branch.id)) &&
    !(
      input.access.granted &&
      input.access.effectiveBusinessRole === "STAFF" &&
      !input.access.permissions.includes("ALL_BRANCHES")
    );
  if (!hasWholeBusinessScope) {
    return { status: "ACCESS_DENIED", reason: "WHOLE_BUSINESS_SCOPE" };
  }

  const membership = await database.employeeBusinessMembership.findFirst({
    where: { businessId: input.businessId, id: input.membershipId },
    select: { id: true },
  });
  if (!membership) return { status: "NOT_FOUND" };

  const bank = await database.employeeBankAccountVersion.findFirst({
    where: {
      businessId: input.businessId,
      employeeMembershipId: input.membershipId,
      isPrimary: true,
    },
    orderBy: [{ revision: "desc" }, { createdAt: "desc" }],
    select: {
      accountHolderName: true,
      accountNumberLast4: true,
      bankCode: true,
      bankNameSnapshot: true,
      effectiveFrom: true,
      effectiveUntil: true,
      id: true,
      revision: true,
      status: true,
      verificationStatus: true,
    },
  });

  return {
    status: "READY",
    data: {
      bank: bank
        ? {
            ...toSafeEmployeeBankVersion(bank),
            accountNumber: `•••• ${bank.accountNumberLast4}`,
          }
        : null,
      canEdit: hasBusinessCapability(input.access, "EDIT_BANK_ACCOUNT"),
      canVerify: hasBusinessCapability(input.access, "VERIFY_BANK_ACCOUNT"),
      membershipId: membership.id,
    },
  };
}
