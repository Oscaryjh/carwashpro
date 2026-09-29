import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { prisma } from "@/lib/prisma";

export async function resolveCompanyLocationTarget(access: ResolvedBusinessAccess, database = prisma) {
  const scope = await resolveAttendanceScope(access, database);
  const branches = await database.branch.findMany({
    where: { businessId: scope.businessId, status: "ACTIVE" },
    select: { id: true, name: true, attendanceSetting: true },
  });
  if (!branches.length) return { kind: "zero" } as const;
  if (branches.length > 1) return { kind: "legacy" } as const;
  const branch = branches[0];
  if (!scope.allowedBranchIds.includes(branch.id)) return { kind: "denied" } as const;
  return { kind: "single", branch, scope } as const;
}
