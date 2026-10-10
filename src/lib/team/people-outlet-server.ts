import "server-only";
import { prisma } from "@/lib/prisma";
import { resolveBusinessOutletTopology } from "@/lib/outlet-context";
import { canSimplifyPeopleWorkplace, type PeopleWorkplacePresentation } from "./people-outlet";

/** Caller must first authorize the person through the existing People reader. */
export async function readPeopleWorkplaceProfile(businessId: string, employeeId: string, posHomeBranchId?: string | null): Promise<PeopleWorkplacePresentation | undefined> {
  const employee = await prisma.employeeBusinessMembership.findFirst({
    where: { businessId, id: employeeId },
    select: { status: true, updatedAt: true, branchAssignments: true },
  });
  if (!employee) return undefined;
  return {
    updatedAt: employee.updatedAt.toISOString(),
    canSimplify: canSimplifyPeopleWorkplace(await resolveBusinessOutletTopology(businessId), {
      status: employee.status, assignments: employee.branchAssignments,
      ...(posHomeBranchId === undefined ? {} : { posHomeBranchId }),
    }),
  };
}
