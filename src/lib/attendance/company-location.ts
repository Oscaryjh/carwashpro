import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import { resolveAttendanceOutletContext } from "@/lib/attendance/outlet-server";
import { prisma } from "@/lib/prisma";

export async function resolveCompanyLocationTarget(access: ResolvedBusinessAccess, database = prisma) {
  const { scope, topology } = await resolveAttendanceOutletContext(access, database);
  if (topology.kind === "no_location") return { kind: "zero" } as const;
  if (topology.kind === "legacy_multi_branch") return { kind: "legacy" } as const;
  if (!scope.allowedBranchIds.includes(topology.internalBranchId)) return { kind: "denied" } as const;
  const branches = await database.branch.findMany({
    where: { businessId: scope.businessId, status: "ACTIVE", id: topology.internalBranchId },
    select: { id: true, name: true, attendanceSetting: true },
  });
  const branch = branches[0];
  if (!branch) return { kind: "denied" } as const;
  return { kind: "single", branch, scope } as const;
}
