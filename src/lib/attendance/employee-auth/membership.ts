import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type MembershipDatabase =
  | Pick<PrismaClient, "employeeAccount">
  | Pick<Prisma.TransactionClient, "employeeAccount">;

export type EligibleEmployeeMembership = Readonly<{
  employeeAccountId: string;
  membershipId: string;
  businessId: string;
  businessName: string;
  employeeCode: string;
  fullName: string;
  primaryBranchId: string;
  primaryBranchName: string;
}>;

export type EligibleEmployeeIdentity = Readonly<{
  employeeAccountId: string;
  memberships: readonly EligibleEmployeeMembership[];
}>;

const eligibleAccountSelect = {
  id: true,
  status: true,
  memberships: {
    where: {
      status: "ACTIVE",
      attendanceEnabled: true,
      business: {
        status: "active",
      },
    },
    select: {
      id: true,
      businessId: true,
      employeeCode: true,
      fullName: true,
      business: {
        select: {
          id: true,
          name: true,
          status: true,
        },
      },
      branchAssignments: {
        select: {
          branchId: true,
          isPrimary: true,
          canClockIn: true,
          effectiveFrom: true,
          effectiveUntil: true,
          status: true,
          branch: {
            select: {
              id: true,
              businessId: true,
              name: true,
              status: true,
              attendanceSetting: {
                select: {
                  businessId: true,
                  branchId: true,
                  isEnabled: true,
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.EmployeeAccountSelect;

type EligibleAccountRecord = Prisma.EmployeeAccountGetPayload<{
  select: typeof eligibleAccountSelect;
}>;

export async function findEligibleEmployeeIdentityByPhone(
  phoneNumberNormalized: string,
  at: Date = new Date(),
  database: MembershipDatabase = prisma,
): Promise<EligibleEmployeeIdentity | null> {
  const account = await database.employeeAccount.findUnique({
    where: { phoneNormalized: phoneNumberNormalized },
    select: eligibleAccountSelect,
  });

  return mapEligibleIdentity(account, at);
}

export async function findEligibleEmployeeIdentityById(
  employeeAccountId: string,
  at: Date = new Date(),
  database: MembershipDatabase = prisma,
): Promise<EligibleEmployeeIdentity | null> {
  const account = await database.employeeAccount.findUnique({
    where: { id: employeeAccountId },
    select: eligibleAccountSelect,
  });

  return mapEligibleIdentity(account, at);
}

export async function resolveEligibleEmployeeMembership(
  employeeAccountId: string,
  membershipId: string,
  at: Date = new Date(),
  database: MembershipDatabase = prisma,
) {
  const identity = await findEligibleEmployeeIdentityById(
    employeeAccountId,
    at,
    database,
  );

  return (
    identity?.memberships.find(
      (membership) => membership.membershipId === membershipId,
    ) ?? null
  );
}

function mapEligibleIdentity(
  account: EligibleAccountRecord | null,
  at: Date,
): EligibleEmployeeIdentity | null {
  if (!account || account.status !== "ACTIVE") {
    return null;
  }

  const memberships = account.memberships.flatMap((membership) => {
    if (
      membership.business.status !== "active" ||
      membership.business.id !== membership.businessId
    ) {
      return [];
    }

    const primaryAssignments = membership.branchAssignments.filter(
      (assignment) =>
        assignment.isPrimary &&
        assignment.canClockIn &&
        assignment.status === "ACTIVE" &&
        assignment.branch.status === "ACTIVE" &&
        assignment.branch.businessId === membership.businessId &&
        assignment.branch.attendanceSetting?.isEnabled === true &&
        assignment.branch.attendanceSetting.businessId ===
          membership.businessId &&
        assignment.branch.attendanceSetting.branchId === assignment.branchId &&
        assignment.effectiveFrom.getTime() <= at.getTime() &&
        (assignment.effectiveUntil === null ||
          assignment.effectiveUntil.getTime() >= at.getTime()),
    );

    if (primaryAssignments.length !== 1) {
      return [];
    }

    const primary = primaryAssignments[0];

    return [
      {
        employeeAccountId: account.id,
        membershipId: membership.id,
        businessId: membership.businessId,
        businessName: membership.business.name,
        employeeCode: membership.employeeCode,
        fullName: membership.fullName,
        primaryBranchId: primary.branchId,
        primaryBranchName: primary.branch.name,
      },
    ];
  });

  if (memberships.length === 0) {
    return null;
  }

  return {
    employeeAccountId: account.id,
    memberships,
  };
}
