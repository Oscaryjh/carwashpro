import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  buildCurrentPeopleAssignmentWhere,
  buildPeopleMembershipScopeWhere,
  type PeopleScopeInput,
} from "@/lib/team/people-scope";

type EmployeeProfileReadInput = PeopleScopeInput & {
  membershipId: string;
};

export async function getEmployeeProfileOverview(
  input: EmployeeProfileReadInput,
  database: PrismaClient = prisma,
) {
  const currentAssignmentWhere = buildCurrentPeopleAssignmentWhere(input);

  return database.employeeBusinessMembership.findFirst({
    where: {
      ...buildPeopleMembershipScopeWhere(input),
      id: input.membershipId,
    },
    select: {
      id: true,
      employeeCode: true,
      employmentType: true,
      status: true,
      position: true,
      joinedAt: true,
      attendanceEnabled: true,
      business: {
        select: {
          timezone: true,
        },
      },
      branchAssignments: {
        where: currentAssignmentWhere,
        orderBy: [{ isPrimary: "desc" }, { branch: { name: "asc" } }],
        select: {
          id: true,
          isPrimary: true,
          canClockIn: true,
          branch: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      staffUser: {
        select: {
          id: true,
          status: true,
          loginEnabled: true,
          appointmentBookable: true,
          _count: {
            select: {
              serviceStaffAssignments: {
                where: {
                  businessId: input.businessId,
                },
              },
            },
          },
        },
      },
    },
  });
}

export async function getEmployeeProfilePersonal(
  input: EmployeeProfileReadInput,
  database: PrismaClient = prisma,
) {
  return database.employeeBusinessMembership.findFirst({
    where: {
      ...buildPeopleMembershipScopeWhere(input),
      id: input.membershipId,
    },
    select: {
      id: true,
      fullName: true,
      phoneNumber: true,
      dateOfBirth: true,
      staffUser: {
        select: {
          id: true,
          email: true,
        },
      },
    },
  });
}

export async function getEmployeeProfileEmployment(
  input: EmployeeProfileReadInput,
  database: PrismaClient = prisma,
) {
  const currentAssignmentWhere = buildCurrentPeopleAssignmentWhere(input);

  return database.employeeBusinessMembership.findFirst({
    where: {
      ...buildPeopleMembershipScopeWhere(input),
      id: input.membershipId,
    },
    select: {
      id: true,
      employeeCode: true,
      employmentType: true,
      status: true,
      position: true,
      joinedAt: true,
      terminatedAt: true,
      business: {
        select: {
          timezone: true,
        },
      },
      branchAssignments: {
        where: currentAssignmentWhere,
        orderBy: [{ isPrimary: "desc" }, { branch: { name: "asc" } }],
        select: {
          id: true,
          isPrimary: true,
          canClockIn: true,
          effectiveFrom: true,
          effectiveUntil: true,
          status: true,
          branch: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      staffUser: {
        select: {
          id: true,
          status: true,
          loginEnabled: true,
          appointmentBookable: true,
          staffRoleProfile: {
            select: {
              name: true,
            },
          },
          serviceStaffAssignments: {
            where: {
              businessId: input.businessId,
            },
            orderBy: {
              service: {
                name: "asc",
              },
            },
            select: {
              service: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      },
    },
  });
}
